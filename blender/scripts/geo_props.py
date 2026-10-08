"""Geometry helpers for the HARNEST props kit (used by build_props.py). Blender 5.1, bmesh based.

A `Prop` accumulates parts into ONE mesh with material slots named by the palette (§7.6).
Every part is built in its own temporary bmesh, transformed and appended, so parts never weld together
and keep crisp silhouettes. `finish()` marks sharp edges by angle (organic "soft" parts use a looser
angle), writes box-projected UVs (0..1 on screens), optionally bakes a soft AO/grime colour attribute,
and adds a Weighted Normal modifier: chamfered boxes then shade like rounded hard-surface parts while
their big faces stay flat.

Conventions: 1 unit = 1 m, Blender Z-up, front = -Y. Rotations are Euler XYZ in degrees.
"""

import math
import random
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

V = Vector
TAU = 2.0 * math.pi


def rmat(rot):
    """Euler degrees (XYZ) / Matrix / None -> 4x4 rotation matrix."""
    if rot is None:
        return Matrix.Identity(4)
    if isinstance(rot, Matrix):
        return rot.to_4x4()
    return Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()


def tmat(at=(0.0, 0.0, 0.0), rot=None):
    return Matrix.Translation(V(at)) @ rmat(rot)


def _edge_axis(edge):
    d = edge.verts[1].co - edge.verts[0].co
    a = [abs(d.x), abs(d.y), abs(d.z)]
    return "xyz"[a.index(max(a))]


def _bevel(bm, width, seg=1, edges=None, profile=0.5):
    if width <= 0:
        return
    es = list(bm.edges) if edges is None else list(edges)
    if es:
        bmesh.ops.bevel(
            bm, geom=es, offset=width, offset_type="OFFSET", segments=seg, profile=profile,
            affect="EDGES", clamp_overlap=True,
        )


# ───────────────────────────── paths ─────────────────────────────


def bezier(p0, p1, p2, p3, n=8):
    """Cubic Bezier polyline, n segments (n + 1 points)."""
    p0, p1, p2, p3 = V(p0), V(p1), V(p2), V(p3)
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(p0 * u ** 3 + p1 * 3 * u * u * t + p2 * 3 * u * t * t + p3 * t ** 3)
    return out


def sag(p0, p1, droop, n=10):
    """Hanging cable between two points: straight line plus a parabolic droop in -Z."""
    p0, p1 = V(p0), V(p1)
    return [p0.lerp(p1, i / n) - V((0, 0, droop * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]


def helix(centre, radius, z0, z1, turns, n, phase=0.0):
    c = V(centre)
    return [
        c + V((radius * math.cos(phase + TAU * turns * i / n), radius * math.sin(phase + TAU * turns * i / n),
               z0 + (z1 - z0) * i / n))
        for i in range(n + 1)
    ]


# ───────────────────────────── Prop ─────────────────────────────


class Prop:
    def __init__(self, name, seed=0):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.stack = [Matrix.Identity(4)]
        self.rng = random.Random(seed)
        self.soft = set()
        self.screens = []
        self.lights = []  # (position in prop space, kind) of emissive parts, for docs and preview lights

    def light(self, pos, kind):
        self.lights.append((self.M @ V(pos), kind))

    # transform stack ------------------------------------------------------
    @property
    def M(self):
        return self.stack[-1]

    @contextmanager
    def frame(self, at=(0.0, 0.0, 0.0), rot=None):
        self.stack.append(self.M @ tmat(at, rot))
        try:
            yield
        finally:
            self.stack.pop()

    def mi(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def add(self, part, mat, at=(0.0, 0.0, 0.0), rot=None, soft=False, mats=None):
        """Append temporary bmesh `part` (local coords) placed by at/rot inside the current frame."""
        M = self.M @ tmat(at, rot)
        part.transform(M)
        flip = M.to_3x3().determinant() < 0
        vmap = {v: self.bm.verts.new(v.co) for v in part.verts}
        faces = []
        for f in part.faces:
            vs = [vmap[v] for v in f.verts]
            if flip:
                vs.reverse()
            try:
                nf = self.bm.faces.new(vs)
            except ValueError:
                continue
            nf.material_index = self.mi(mats[f.material_index] if mats else mat)
            nf.smooth = True
            faces.append(nf)
        part.free()
        if soft:
            self.soft.update(faces)
        return faces

    # primitives -----------------------------------------------------------
    def box(self, size, at=(0.0, 0.0, 0.0), rot=None, mat="M_MetalDark", bevel=0.0, seg=1, axes=None,
            taper=None, shear=None, soft=False):
        """Box centred at `at`. taper=(fx, fy) scales the top face, shear=(dx, dy) shifts it."""
        sx, sy, sz = size
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            x, y, z = v.co.x * sx, v.co.y * sy, v.co.z * sz
            if z > 0:
                if taper:
                    x, y = x * taper[0], y * taper[1]
                if shear:
                    x, y = x + shear[0], y + shear[1]
            v.co = V((x, y, z))
        if bevel > 0:
            edges = [e for e in bm.edges if axes is None or _edge_axis(e) in axes]
            _bevel(bm, bevel, seg, edges)
        return self.add(bm, mat, at, rot, soft)

    def boxz(self, size, x=0.0, y=0.0, z0=0.0, **kw):
        """Box standing on z0 (bottom centred at x, y)."""
        return self.box(size, at=(x, y, z0 + size[2] / 2), **kw)

    def beam(self, a, b, size2, mat="M_MetalDark", bevel=0.0, roll=0.0):
        """Box of cross-section size2 = (w, t) running from point a to point b."""
        a, b = V(a), V(b)
        d = b - a
        R = d.to_track_quat("Z", "Y").to_matrix().to_4x4() @ Matrix.Rotation(math.radians(roll), 4, "Z")
        return self.box((size2[0], size2[1], d.length), at=(a + b) / 2, rot=R, mat=mat, bevel=bevel)

    def drop_to_ground(self):
        """Translate everything so the lowest vertex sits on z = 0. Returns the applied offset."""
        z = min(v.co.z for v in self.bm.verts)
        for v in self.bm.verts:
            v.co.z -= z
        self.lights = [(pos - V((0.0, 0.0, z)), kind) for pos, kind in self.lights]
        return -z

    def bounds(self):
        xs = [v.co.x for v in self.bm.verts]
        ys = [v.co.y for v in self.bm.verts]
        zs = [v.co.z for v in self.bm.verts]
        return V((min(xs), min(ys), min(zs))), V((max(xs), max(ys), max(zs)))

    def cyl(self, r, h, at=(0.0, 0.0, 0.0), rot=None, mat="M_MetalDark", n=12, r2=None, bevel=0.0, seg=1,
            caps=True, soft=False):
        """Cylinder / frustum centred at `at`, axis local Z (r bottom, r2 top)."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=n, radius1=r,
                              radius2=r if r2 is None else r2, depth=h)
        if bevel > 0 and caps:
            caps_f = [f for f in bm.faces if len(f.verts) == n]
            _bevel(bm, bevel, seg, {e for f in caps_f for e in f.edges})
        return self.add(bm, mat, at, rot, soft)

    def cylz(self, r, z0, z1, x=0.0, y=0.0, **kw):
        """Vertical cylinder from z0 to z1."""
        return self.cyl(r, z1 - z0, at=(x, y, (z0 + z1) / 2), **kw)

    def lathe(self, prof, n=16, at=(0.0, 0.0, 0.0), rot=None, mat="M_MetalDark", bands=None, cap0=True,
              cap1=True, closed=False, phase=0.0, sx=1.0, sy=1.0, soft=False):
        """Revolve profile [(r, z), ...] (bottom -> top on the outside) about local Z.

        r == 0 makes a pole. bands[i] = material of the band between profile points i and i+1.
        closed=True joins the last point to the first (profile must run counter-clockwise in r-z).
        """
        bm = bmesh.new()
        names = []

        def li(name):
            name = name or mat
            if name not in names:
                names.append(name)
            return names.index(name)

        rings = []
        for r, z in prof:
            if r < 1e-6:
                rings.append([bm.verts.new((0.0, 0.0, z))])
            else:
                rings.append([
                    bm.verts.new((r * math.cos(phase + TAU * k / n) * sx, r * math.sin(phase + TAU * k / n) * sy, z))
                    for k in range(n)
                ])
        count = len(rings) if closed else len(rings) - 1
        for i in range(count):
            a, b = rings[i], rings[(i + 1) % len(rings)]
            if len(a) == 1 and len(b) == 1:
                continue
            m = li(bands[i] if bands else None)
            for k in range(n):
                k2 = (k + 1) % n
                if len(a) == 1:
                    vs = (a[0], b[k2], b[k])
                elif len(b) == 1:
                    vs = (a[k], a[k2], b[0])
                else:
                    vs = (a[k], a[k2], b[k2], b[k])
                bm.faces.new(vs).material_index = m
        if not closed:
            if cap0 and len(rings[0]) > 1:
                bm.faces.new(list(reversed(rings[0]))).material_index = li(bands[0] if bands else None)
            if cap1 and len(rings[-1]) > 1:
                bm.faces.new(rings[-1]).material_index = li(bands[-1] if bands else None)
        return self.add(bm, None, at, rot, soft, mats=names)

    def patch_cyl(self, r, k0, k1, n, z0, z1, thick=0.003, at=(0.0, 0.0, 0.0), rot=None, mat="M_MetalRust",
                  zj0=None, zj1=None, phase=0.0):
        """Curved plate hugging a lathe body of `n` segments: angles k0..k1 (in segment steps), inner radius r.

        zj0 / zj1: per-column offsets of the bottom / top edge (ragged patches)."""
        bm = bmesh.new()
        cols = []
        for i, k in enumerate(range(k0, k1 + 1)):
            a = phase + TAU * k / n
            c, s = math.cos(a), math.sin(a)
            lo = z0 + (zj0[i] if zj0 else 0.0)
            hi = z1 + (zj1[i] if zj1 else 0.0)
            ri, ro = r, r + thick
            cols.append([bm.verts.new((ri * c, ri * s, lo)), bm.verts.new((ro * c, ro * s, lo)),
                         bm.verts.new((ro * c, ro * s, hi)), bm.verts.new((ri * c, ri * s, hi))])
        for i in range(len(cols) - 1):
            a, b = cols[i], cols[i + 1]
            bm.faces.new((a[1], b[1], b[2], a[2]))  # outer
            bm.faces.new((a[3], b[3], b[0], a[0]))  # inner
            bm.faces.new((a[2], b[2], b[3], a[3]))  # top
            bm.faces.new((a[0], b[0], b[1], a[1]))  # bottom
        a, b = cols[0], cols[-1]
        bm.faces.new((a[0], a[1], a[2], a[3]))
        bm.faces.new((b[3], b[2], b[1], b[0]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return self.add(bm, mat, at, rot)

    def tube(self, pts, r, n=8, mat="M_Cable", cap0=True, cap1=True, radii=None, twist=0.0, soft=True):
        """Sweep a circle along a polyline (parallel-transport frames)."""
        pts = [V(p) for p in pts]
        cnt = len(pts)
        tans = []
        for i in range(cnt):
            if i == 0:
                t = pts[1] - pts[0]
            elif i == cnt - 1:
                t = pts[-1] - pts[-2]
            else:
                t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            tans.append(t.normalized())
        ref = V((0, 0, 1)) if abs(tans[0].z) < 0.9 else V((1, 0, 0))
        nrm = tans[0].cross(ref).normalized()
        frames = []
        for i in range(cnt):
            if i > 0:
                axis = tans[i - 1].cross(tans[i])
                if axis.length > 1e-9:
                    nrm = Matrix.Rotation(tans[i - 1].angle(tans[i]), 3, axis.normalized()) @ nrm
            bin_ = tans[i].cross(nrm).normalized()
            nrm = bin_.cross(tans[i]).normalized()
            frames.append((nrm, bin_))
        bm = bmesh.new()
        rings = []
        for i, p in enumerate(pts):
            nv, bv = frames[i]
            rr = radii[i] if radii else r
            # keep the cross-section width at bends (miter)
            scale = 1.0
            if 0 < i < cnt - 1:
                d0 = (pts[i] - pts[i - 1]).normalized()
                cosh = max(0.35, d0.dot(tans[i]))
                scale = 1.0 / cosh
            ring = []
            for k in range(n):
                a = TAU * k / n + twist
                off = nv * math.cos(a) + bv * math.sin(a)
                if scale != 1.0:
                    # stretch only along the bend direction (component perpendicular to the tangent in the bend plane)
                    d0 = (pts[i] - pts[i - 1]).normalized()
                    bend = (d0 - tans[i] * d0.dot(tans[i]))
                    if bend.length > 1e-9:
                        bend.normalize()
                        comp = off.dot(bend)
                        off = off + bend * comp * (scale - 1.0)
                ring.append(bm.verts.new(p + off * rr))
            rings.append(ring)
        for i in range(cnt - 1):
            a, b = rings[i], rings[i + 1]
            for k in range(n):
                k2 = (k + 1) % n
                bm.faces.new((a[k], a[k2], b[k2], b[k]))
        if cap0:
            bm.faces.new(list(reversed(rings[0])))
        if cap1:
            bm.faces.new(rings[-1])
        return self.add(bm, mat, soft=soft)

    def sphere(self, r, at=(0.0, 0.0, 0.0), rot=None, mat="M_MetalDark", u=12, v=8, scale=(1.0, 1.0, 1.0),
               deform=None, soft=True):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
        for i, vt in enumerate(bm.verts):
            co = V((vt.co.x * scale[0], vt.co.y * scale[1], vt.co.z * scale[2]))
            if deform:
                co = V(deform(co, i))
            vt.co = co
        return self.add(bm, mat, at, rot, soft)

    def torus(self, R, r, at=(0.0, 0.0, 0.0), rot=None, mat="M_MetalDark", n=16, m=6, arc=None, soft=False):
        """Torus about local Z. arc=(deg0, deg1) makes an open, capped arc."""
        bm = bmesh.new()
        cnt = n if arc is None else n + 1
        rings = []
        for i in range(cnt):
            a = TAU * i / n if arc is None else math.radians(arc[0] + (arc[1] - arc[0]) * i / n)
            c = V((R * math.cos(a), R * math.sin(a), 0.0))
            o = V((math.cos(a), math.sin(a), 0.0))
            rings.append([bm.verts.new(c + o * (r * math.cos(TAU * j / m)) + V((0, 0, r * math.sin(TAU * j / m))))
                          for j in range(m)])
        for i in range(n):
            a, b = rings[i], rings[(i + 1) % cnt]
            for j in range(m):
                j2 = (j + 1) % m
                bm.faces.new((a[j], b[j], b[j2], a[j2]))
        if arc is not None:
            bm.faces.new(rings[0])
            bm.faces.new(list(reversed(rings[-1])))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return self.add(bm, mat, at, rot, soft)

    def prism(self, poly, depth, at=(0.0, 0.0, 0.0), rot=None, mat="M_MetalDark", bevel=0.0, soft=False):
        """2D polygon in the local XZ plane (seen from the front), extruded along local Y, centred."""
        pts = [V(p) for p in poly]
        area = sum(pts[i].x * pts[(i + 1) % len(pts)].y - pts[(i + 1) % len(pts)].x * pts[i].y
                   for i in range(len(pts)))
        if area < 0:
            pts.reverse()
        bm = bmesh.new()
        d = depth / 2
        F = [bm.verts.new((p.x, -d, p.y)) for p in pts]
        B = [bm.verts.new((p.x, d, p.y)) for p in pts]
        bm.faces.new(F)
        bm.faces.new(list(reversed(B)))
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            bm.faces.new((F[i], B[i], B[j], F[j]))
        if bevel > 0:
            _bevel(bm, bevel, 1)
        return self.add(bm, mat, at, rot, soft)

    def side_prism(self, poly_yz, thick, x=0.0, mat="M_MetalDark", bevel=0.0):
        """Profile drawn in the side view (y, z) and extruded along X (thickness centred on x)."""
        return self.prism(poly_yz, thick, at=(x, 0.0, 0.0), rot=(0, 0, 90), mat=mat, bevel=bevel)

    def surface(self, nu, nv, fn, mat="M_TarpBlue", thick=0.0, mat_fn=None, up=(0.0, 0.0, 1.0), soft=True,
                close_edges=True):
        """Parametric sheet fn(u, v) -> point, u, v in [0, 1]. Faces orient toward `up` (checked on the
        first quad). thick > 0 makes a closed slab (offset against the normal)."""
        P = [[V(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
        e1 = P[1][0] - P[0][0]
        e2 = P[0][1] - P[0][0]
        flip = e1.cross(e2).dot(V(up)) < 0
        bm = bmesh.new()
        names = []

        def li(name):
            name = name or mat
            if name not in names:
                names.append(name)
            return names.index(name)

        def quad(vs, m, rev=False):
            vs = list(vs)
            if flip != rev:
                vs.reverse()
            bm.faces.new(vs).material_index = m

        top = [[bm.verts.new(P[i][j]) for j in range(nv + 1)] for i in range(nu + 1)]
        for i in range(nu):
            for j in range(nv):
                quad((top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]), li(mat_fn(i, j) if mat_fn else mat))
        if thick > 0:
            N = [[None] * (nv + 1) for _ in range(nu + 1)]
            for i in range(nu + 1):
                for j in range(nv + 1):
                    du = P[min(i + 1, nu)][j] - P[max(i - 1, 0)][j]
                    dv = P[i][min(j + 1, nv)] - P[i][max(j - 1, 0)]
                    nn = du.cross(dv)
                    nn = nn.normalized() if nn.length > 1e-12 else V((0, 0, 1))
                    N[i][j] = -nn if flip else nn
            bot = [[bm.verts.new(P[i][j] - N[i][j] * thick) for j in range(nv + 1)] for i in range(nu + 1)]
            for i in range(nu):
                for j in range(nv):
                    quad((bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1]),
                         li(mat_fn(i, j) if mat_fn else mat), rev=True)
            if close_edges:
                for i in range(nu):  # v = 0 and v = nv borders
                    m0 = li(mat_fn(i, 0) if mat_fn else mat)
                    m1 = li(mat_fn(i, nv - 1) if mat_fn else mat)
                    quad((top[i][0], bot[i][0], bot[i + 1][0], top[i + 1][0]), m0)
                    quad((top[i + 1][nv], bot[i + 1][nv], bot[i][nv], top[i][nv]), m1)
                for j in range(nv):  # u = 0 and u = nu borders
                    m0 = li(mat_fn(0, j) if mat_fn else mat)
                    m1 = li(mat_fn(nu - 1, j) if mat_fn else mat)
                    quad((top[0][j + 1], bot[0][j + 1], bot[0][j], top[0][j]), m0)
                    quad((top[nu][j], bot[nu][j], bot[nu][j + 1], top[nu][j + 1]), m1)
        return self.add(bm, None, soft=soft, mats=names)

    def tub(self, bot, top, z0, z1, thick, mat="M_MetalTeal", inner=None, floor=None, bevel=0.0,
            at=(0.0, 0.0, 0.0), rot=None):
        """Open-top tapered box: outer footprint bot=(w, d) at z0, top=(w, d) at z1, walls `thick`,
        inner floor at `floor` (default z0 + thick). Outer vertical and bottom edges chamfered by `bevel`."""
        bm = bmesh.new()
        names = [mat, inner or mat]

        def rect(w, d, z):
            return [bm.verts.new((sx * w / 2, sy * d / 2, z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]

        ob = rect(bot[0], bot[1], z0)
        ot = rect(top[0], top[1], z1)
        fz = z0 + thick if floor is None else floor
        k = (fz - z0) / (z1 - z0)
        ib = rect(bot[0] + (top[0] - bot[0]) * k - 2 * thick, bot[1] + (top[1] - bot[1]) * k - 2 * thick, fz)
        it = rect(top[0] - 2 * thick, top[1] - 2 * thick, z1)
        outer = []
        for i in range(4):
            j = (i + 1) % 4
            outer.append(bm.faces.new((ob[i], ob[j], ot[j], ot[i])))
            f = bm.faces.new((ib[i], it[i], it[j], ib[j]))
            f.material_index = 1
            bm.faces.new((ot[i], ot[j], it[j], it[i]))
        outer.append(bm.faces.new(list(reversed(ob))))
        bm.faces.new(ib).material_index = 1
        if bevel > 0:
            outer_set = set(outer)
            edges = [e for e in bm.edges if len(e.link_faces) == 2 and all(f in outer_set for f in e.link_faces)]
            _bevel(bm, bevel, 1, edges)
        return self.add(bm, None, at, rot, mats=names)

    def flat(self, poly, thick, at=(0.0, 0.0, 0.0), rz=0.0, mat="M_MetalRust"):
        """Flat plate lying on the XY plane (polygon given as (x, y) seen from above), bottom at at.z."""
        pts = [(x, -y) for x, y in poly]  # prism maps local z -> -y after the 90 deg X rotation
        return self.prism(pts, thick, at=(at[0], at[1], at[2] + thick / 2), rot=(90, 0, rz), mat=mat)

    def plate(self, poly, thick, at=(0.0, 0.0, 0.0), rot=None, mat="M_MetalRust"):
        """Thin plate on a front-facing (-Y) surface: polygon in the XZ plane, back face at local y=0."""
        with self.frame(at, rot):
            return self.prism(poly, thick, at=(0.0, -thick / 2, 0.0), mat=mat)

    def ring_frame(self, w, d, bar, h, at=(0.0, 0.0, 0.0), rot=None, mat="M_MetalDark", bevel=0.0):
        """Rectangular frame of four bars around a w x d opening (outer size w + 2 bar, d + 2 bar), height h.
        Front/back bars span the full width, side bars fit between them (no overlapping faces)."""
        faces = []
        with self.frame(at, rot):
            for sy in (-1, 1):
                faces += self.box((w + 2 * bar, bar, h), at=(0, sy * (d / 2 + bar / 2), 0), mat=mat, bevel=bevel)
            for sx in (-1, 1):
                faces += self.box((bar, d, h), at=(sx * (w / 2 + bar / 2), 0, 0), mat=mat, bevel=bevel)
        return faces

    def mark_screen(self, faces):
        """Faces that get 0..1 UVs across their group (upright), e.g. CRT screens."""
        self.screens.append(list(faces))


    # finishing ------------------------------------------------------------
    def finish(self, collection, materials, location=(0.0, 0.0, 0.0), hard=46.0, soft_angle=80.0,
               weighted=True, ao=None):
        """Build the mesh object. materials: callable name -> bpy material.
        ao: None or dict(ground=bool, wall=bool, strength=0..1, samples=int) for the COLOR_0 grime bake."""
        bm = self.bm
        bm.normal_update()
        hard_r, soft_r = math.radians(hard), math.radians(soft_angle)
        for e in bm.edges:
            if len(e.link_faces) != 2:
                continue
            f0, f1 = e.link_faces
            lim = soft_r if (f0 in self.soft and f1 in self.soft) else hard_r
            e.smooth = e.calc_face_angle(0.0) <= lim

        uv = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop in f.loops:
                c = loop.vert.co
                loop[uv].uv = (c.y, c.z) if ax == 0 else (c.x, c.z) if ax == 1 else (c.x, c.y)
        for group in self.screens:
            nsum = V((0, 0, 0))
            for f in group:
                nsum += f.normal * f.calc_area()
            nrm = nsum.normalized()
            upv = V((0, 0, 1)) if abs(nrm.z) < 0.95 else V((0, 1, 0))
            right = upv.cross(nrm).normalized()
            upv = nrm.cross(right).normalized()
            pts = [loop.vert.co for f in group for loop in f.loops]
            us = [p.dot(right) for p in pts]
            vs = [p.dot(upv) for p in pts]
            u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
            for f in group:
                for loop in f.loops:
                    p = loop.vert.co
                    loop[uv].uv = ((p.dot(right) - u0) / max(u1 - u0, 1e-6), (p.dot(upv) - v0) / max(v1 - v0, 1e-6))

        if ao:
            bake_grime(bm, **ao)

        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        self.bm = None
        for name in self.mats:
            me.materials.append(materials(name))
        if ao and me.color_attributes:
            me.color_attributes.active_color = me.color_attributes[0]
            me.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, me)
        collection.objects.link(obj)
        obj.location = location
        if weighted:
            mod = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
            mod.mode = "FACE_AREA"
            mod.keep_sharp = True
        return obj


def facing(normal, up=(0.0, 0.0, 1.0)):
    """Rotation whose local -Y points along `normal` (a decal frame for a surface), local Z as upright as possible."""
    n = V(normal).normalized()
    u = V(up)
    z = u - n * u.dot(n)
    if z.length < 1e-6:
        z = V((0.0, 1.0, 0.0)) - n * n.y
    z.normalize()
    y = -n
    x = y.cross(z)
    return Matrix((x, y, z)).transposed().to_4x4()


def verts_of(faces):
    return {v for f in faces for v in f.verts}


def dent(faces, centre, radius, depth, direction=None):
    """Push the vertices of `faces` near `centre` inward (toward the local Z axis, or along -direction)."""
    c = V(centre)
    for v in verts_of(faces):
        d = (v.co - c).length
        if d < radius:
            k = (1.0 - d / radius) ** 2 * depth
            if direction is None:
                radial = V((v.co.x, v.co.y, 0.0))
                if radial.length < 1e-9:
                    continue
                v.co -= radial.normalized() * k
            else:
                v.co -= V(direction).normalized() * k


def jitter(faces, amount, rng, axes=(1.0, 1.0, 1.0)):
    """Deterministic per-vertex jitter (shared vertices move once)."""
    for v in sorted(verts_of(faces), key=lambda vv: (round(vv.co.x, 5), round(vv.co.y, 5), round(vv.co.z, 5))):
        v.co += V((rng.uniform(-amount, amount) * axes[0], rng.uniform(-amount, amount) * axes[1],
                   rng.uniform(-amount, amount) * axes[2]))


# ───────────────────────────── grime / AO bake ─────────────────────────────


def _hemisphere(samples, seed=7):
    rng = random.Random(seed)
    out = []
    for i in range(samples):
        # cosine-weighted directions around +Z
        u1, u2 = (i + rng.random()) / samples, rng.random()
        r = math.sqrt(u1)
        phi = TAU * u2
        out.append(V((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1 - u1)))))
    return out


def bake_grime(bm, ground=True, wall=False, strength=0.55, samples=24, dist=0.6, low=0.62, height=0.35,
               floor=0.0, seed=7):
    """Per-corner colour attribute 'Col' (linear grey): ambient occlusion from the prop itself, the
    ground plane (z = floor) and/or the wall plane (y = 0), plus a gentle darkening near the ground.
    Corner domain so each part keeps its own value along its seams. Values stay within [low, 1].

    Corners of a vertex joined through smooth edges (one shading fan) share a single sample, so the colour
    only splits vertices where the normals split anyway (keeps the exported vertex count down).
    Call after the edge smooth flags are set."""
    bm.normal_update()
    bm.verts.index_update()
    bm.faces.index_update()
    tree = BVHTree.FromBMesh(bm)
    dirs = _hemisphere(samples, seed)
    col = bm.loops.layers.float_color.new("Col")
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for e in bm.edges:
        if e.smooth and len(e.link_faces) == 2:
            f1, f2 = e.link_faces
            for v in e.verts:
                a, b = find((f1.index, v.index)), find((f2.index, v.index))
                if a != b:
                    parent[a] = b
    fan_normal = {}
    for f in bm.faces:
        for loop in f.loops:
            k = find((f.index, loop.vert.index))
            fan_normal[k] = fan_normal.get(k, V((0.0, 0.0, 0.0))) + f.normal * max(f.calc_area(), 1e-8)
    cache = {}
    for f in bm.faces:
        for loop in f.loops:
            v = loop.vert
            key = find((f.index, v.index))
            if key not in cache:
                n = fan_normal[key].normalized() if fan_normal[key].length > 1e-12 else f.normal
                t = n.orthogonal().normalized()
                b = n.cross(t)
                origin = v.co + n * 0.004
                hit = 0.0
                for d in dirs:
                    w = t * d.x + b * d.y + n * d.z
                    occ = 0.0
                    loc, nrm, _idx, dd = tree.ray_cast(origin, w, dist)
                    # a back-face hit means this corner is buried inside another part: don't let that
                    # darkness bleed across the visible faces it shares
                    if loc is not None and nrm.dot(w) < 0.0:
                        occ = 1.0 - (dd / dist) ** 0.7
                    if ground and w.z < -1e-4:
                        dg = max(0.0, (origin.z - floor) / -w.z)  # < 0: corner sits under the ground plane
                        if dg < dist:
                            occ = max(occ, 1.0 - (dg / dist) ** 0.7)
                    if wall and w.y > 1e-4:
                        dw = (-origin.y) / w.y
                        if 0 <= dw < dist:
                            occ = max(occ, 1.0 - (dw / dist) ** 0.7)
                    hit += occ
                ao = 1.0 - strength * (hit / len(dirs))
                if ground and height > 0:
                    ao *= 0.86 + 0.14 * min(1.0, max(0.0, (v.co.z - floor) / height))
                cache[key] = max(low, min(1.0, ao))
            g = cache[key]
            loop[col] = (g, g, g, 1.0)
