"""Geometry helpers for the HARNEST character / interactable generators (Blender 5.1).

Usage (inside a generator, after `import common`):

    b = geo.Builder("Body", origin=(0, 0, 0.27))      # origin = the node's pivot, in asset space
    b.box((0.5, 0.4, 0.3), "M_HarniShell", loc=(0, 0, 0.5), bevel=0.02)
    b.cyl(0.05, 0.1, "M_MetalDark", loc=(0.3, 0, 0.6), axis="X", bevel=0.006)
    body = b.finish(collection, parent=root, parent_origin=(0, 0, 0))

Every primitive is placed with `loc` (metres, asset space = relative to the asset root) and `rot`
(XYZ Euler, degrees), applied after the canonical orientation chosen by `axis`:

    prism / cyl / tube / frame, profile (a, b) and extrusion:
      axis "Y": front view  - a = +X, b = +Z, extruded along Y (the "front" cap faces -Y)
      axis "X": side view   - a = forward (-Y), b = +Z, extruded along X
      axis "Z": top view    - a = +X, b = forward (-Y), extruded along Z
    lathe (profile (r, h), revolved): axis "Z" h -> +Z, axis "Y" h -> -Y (front), axis "X" h -> +X

Shading: all faces smooth, edges sharper than `sharp_angle` (and open borders) marked sharp, plus a
Weighted Normal modifier (face area, keep sharp): big faces stay flat, bevels catch the light,
cylinders and domes stay smooth. Parts without explicit UVs get a box projection (1 UV unit = 1 m).
"""

import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

import common

# canonical -> requested orientation
_PRISM_AXIS = {
    "Y": Matrix.Identity(4),
    "Z": Matrix.Rotation(math.radians(90), 4, "X"),  # (x, y, z) -> (x, -z, y)
    "X": Matrix.Rotation(math.radians(-90), 4, "Z"),  # (x, y, z) -> (y, -x, z)
}
_LATHE_AXIS = {
    "Z": Matrix.Identity(4),
    "Y": Matrix.Rotation(math.radians(90), 4, "X"),  # +Z -> -Y
    "X": Matrix.Rotation(math.radians(90), 4, "Y"),  # +Z -> +X
}


def xform(loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    m = Matrix.Translation(Vector(loc)) @ Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()
    if scale is not None:
        m = m @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    return m


def resolve_material(name):
    if name in common.PALETTE:
        return common.mat(name)
    material = bpy.data.materials.get(name)
    if material is None:
        raise KeyError(f"material {name} not found: create it with common.make_material() first")
    return material


# ───────────────────────────── 2D profiles ─────────────────────────────


def circle(r, n, start=0.0):
    return [(r * math.cos(start + 2 * math.pi * i / n), r * math.sin(start + 2 * math.pi * i / n)) for i in range(n)]


def rect(w, h):
    return [(w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2)]


def rrect(w, h, r, n=4):
    """Rounded rectangle, CCW, centred. r may be a single radius or 4 radii (BR, TR, TL, BL)."""
    radii = r if isinstance(r, (list, tuple)) else (r, r, r, r)
    corners = [(w / 2, -h / 2, -90), (w / 2, h / 2, 0), (-w / 2, h / 2, 90), (-w / 2, -h / 2, 180)]
    pts = []
    for (cx, cy, a0), rad in zip(corners, radii):
        rad = min(rad, w / 2 - 1e-4, h / 2 - 1e-4)
        if rad <= 1e-5:
            pts.append((cx, cy))
            continue
        ox = cx - math.copysign(rad, cx)
        oy = cy - math.copysign(rad, cy)
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((ox + rad * math.cos(a), oy + rad * math.sin(a)))
    return dedupe(pts, closed=True)


def dedupe(pts, closed=False, eps=1e-6):
    out = []
    for p in pts:
        if not out or (Vector(p) - Vector(out[-1])).length > eps:
            out.append(tuple(p))
    if closed and len(out) > 2 and (Vector(out[0]) - Vector(out[-1])).length <= eps:
        out.pop()
    return out


def fillet(pts, radius, n=3, closed=False):
    """Round the corners of a 2D polyline. `radius` is a number or a per-point list (0 = keep sharp)."""
    out = []
    count = len(pts)
    for i in range(count):
        p = Vector(pts[i])
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        if r <= 0 or (not closed and (i == 0 or i == count - 1)):
            out.append(tuple(p))
            continue
        a = Vector(pts[i - 1])
        c = Vector(pts[(i + 1) % count])
        d1 = a - p
        d2 = c - p
        if d1.length < 1e-9 or d2.length < 1e-9:
            out.append(tuple(p))
            continue
        ang = d1.angle(d2)
        if ang < 1e-3 or ang > math.pi - 1e-3:
            out.append(tuple(p))
            continue
        t = r / math.tan(ang / 2)
        t = min(t, d1.length * 0.49, d2.length * 0.49)
        r_eff = t * math.tan(ang / 2)
        u1 = d1.normalized()
        u2 = d2.normalized()
        p1 = p + u1 * t
        p2 = p + u2 * t
        centre = p + (u1 + u2).normalized() * (r_eff / math.sin(ang / 2))
        a1 = math.atan2(p1.y - centre.y, p1.x - centre.x)
        a2 = math.atan2(p2.y - centre.y, p2.x - centre.x)
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        for k in range(n + 1):
            ak = a1 + da * k / n
            out.append((centre.x + r_eff * math.cos(ak), centre.y + r_eff * math.sin(ak)))
    return dedupe(out, closed=closed)


def smooth_path(points, samples=8):
    """Catmull-Rom spline through 3D points; `samples` segments per span (end points kept)."""
    P = [Vector(p) for p in points]
    if len(P) < 3:
        return [tuple(p) for p in P]
    ext = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(samples):
            t = k / samples
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)))
    out.append(tuple(P[-1]))
    return out


def arc(cx, cy, r, a0, a1, n):
    """Points on an arc (degrees, inclusive)."""
    return [
        (cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n)))
        for i in range(n + 1)
    ]


def _face_near(face, centre, radius):
    """True when the face's bounding box, grown by `radius`, contains `centre`."""
    for axis in range(3):
        values = [v.co[axis] for v in face.verts]
        if centre[axis] < min(values) - radius or centre[axis] > max(values) + radius:
            return False
    return True


# ───────────────────────────── builder ─────────────────────────────


class Builder:
    """Accumulates bevelled primitives into one mesh (one node of an asset)."""

    def __init__(self, name, origin=(0.0, 0.0, 0.0)):
        self.name = name
        self.origin = Vector(origin)
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.uv_flag = self.bm.faces.layers.int.new("hn_uv")
        self.mats = []
        self.groups = [Matrix.Identity(4)]

    def group(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=None, pivot=None):
        """Context manager: primitives inside are placed in this local frame (nested frames compose).

        pivot: rotate/scale about this point (asset space of the enclosing frame) instead of `loc`.
        """
        builder = self
        if pivot is not None:
            p = Vector(pivot)
            m = Matrix.Translation(Vector(loc) + p) @ xform((0, 0, 0), rot, scale) @ Matrix.Translation(-p)
        else:
            m = xform(loc, rot, scale)

        class _Group:
            def __enter__(self):
                builder.groups.append(builder.groups[-1] @ m)
                return builder

            def __exit__(self, *exc):
                builder.groups.pop()
                return False

        return _Group()

    # ---- internals

    def mi(self, material):
        if material not in self.mats:
            self.mats.append(material)
        return self.mats.index(material)

    @staticmethod
    def _tmp():
        t = bmesh.new()
        t.loops.layers.uv.new("UVMap")
        return t

    def _commit(self, t, matrix, bevel_edges=None, bevel=0.0, segs=2, profile=0.5, recalc=True, has_uv=False):
        if recalc:
            bmesh.ops.recalc_face_normals(t, faces=t.faces[:])
        if bevel > 0 and bevel_edges:
            edges = [e for e in bevel_edges if e.is_valid]
            bmesh.ops.bevel(
                t,
                geom=edges,
                offset=bevel,
                offset_type="OFFSET",
                segments=segs,
                profile=profile,
                affect="EDGES",
                clamp_overlap=True,
                material=-1,
            )
        matrix = Matrix.Translation(-self.origin) @ self.groups[-1] @ matrix
        flip = matrix.to_3x3().determinant() < 0
        uv_t = t.loops.layers.uv.active
        vmap = {}
        for v in t.verts:
            vmap[v] = self.bm.verts.new(matrix @ v.co)
        for f in t.faces:
            loops = list(f.loops)
            if flip:
                loops.reverse()
            try:
                nf = self.bm.faces.new([vmap[l.vert] for l in loops])
            except ValueError:
                continue
            nf.material_index = f.material_index
            nf[self.uv_flag] = 1 if has_uv else 0
            if uv_t is not None:
                for ls, ld in zip(loops, nf.loops):
                    ld[self.uv].uv = ls[uv_t].uv
        for e in t.edges:
            if not e.smooth:
                ne = self.bm.edges.get([vmap[e.verts[0]], vmap[e.verts[1]]])
                if ne is not None:
                    ne.smooth = False
        t.free()

    # ---- primitives

    def box(self, size, material, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, segs=2, profile=0.5):
        sx, sy, sz = size
        t = self._tmp()
        idx = self.mi(material)
        v = [t.verts.new((x * sx / 2, y * sy / 2, z * sz / 2)) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
        for a, b, c, d in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            t.faces.new((v[a], v[b], v[c], v[d])).material_index = idx
        self._commit(t, xform(loc, rot), t.edges[:], bevel, segs, profile)

    def prism(
        self,
        profile,
        depth,
        material,
        loc=(0, 0, 0),
        rot=(0, 0, 0),
        axis="Y",
        bevel=0.0,
        segs=2,
        taper=(1.0, 1.0),
        shift=(0.0, 0.0),
        bevel_sides=False,
        cap_material=None,
        bevel_profile=0.5,
    ):
        """Extrude a 2D profile by `depth` (centred). taper/shift scale/offset the back (+Y) cap."""
        t = self._tmp()
        idx = self.mi(material)
        cidx = self.mi(cap_material) if cap_material else idx
        pts = dedupe(profile, closed=True)
        n = len(pts)
        front = [t.verts.new((a, -depth / 2, b)) for a, b in pts]
        back = [t.verts.new((a * taper[0] + shift[0], depth / 2, b * taper[1] + shift[1])) for a, b in pts]
        f_front = t.faces.new(front)
        f_back = t.faces.new(list(reversed(back)))
        f_front.material_index = cidx
        f_back.material_index = cidx
        for i in range(n):
            t.faces.new((front[i], back[i], back[(i + 1) % n], front[(i + 1) % n])).material_index = idx
        edges = list(f_front.edges) + list(f_back.edges)
        if bevel_sides:
            edges = t.edges[:]
        self._commit(t, xform(loc, rot) @ _PRISM_AXIS[axis], edges, bevel, segs, bevel_profile)

    def rbox(self, size, radius, material, loc=(0, 0, 0), rot=(0, 0, 0), axis="Y", n=4, bevel=0.0, segs=2, **kw):
        """Box with rounded corners in the profile plane of `axis`. size is in world axes (x, y, z)."""
        sx, sy, sz = size
        if axis == "Y":
            prof, depth = rrect(sx, sz, radius, n), sy
        elif axis == "X":
            prof, depth = rrect(sy, sz, radius, n), sx
        else:
            prof, depth = rrect(sx, sy, radius, n), sz
        self.prism(prof, depth, material, loc, rot, axis, bevel, segs, **kw)

    def cyl(self, r, depth, material, loc=(0, 0, 0), rot=(0, 0, 0), axis="Y", segs=24, bevel=0.0, bsegs=1, r2=None, start=None, cap_material=None):
        """Cylinder (or frustum when r2 is given: r at the front/-Y cap, r2 at the back)."""
        start = math.pi / segs if start is None else start
        taper = (r2 / r, r2 / r) if r2 is not None else (1.0, 1.0)
        self.prism(circle(r, segs, start), depth, material, loc, rot, axis, bevel, bsegs, taper=taper, cap_material=cap_material)

    def tube(self, r_out, r_in, depth, material, loc=(0, 0, 0), rot=(0, 0, 0), axis="Y", segs=24, bevel=0.0, bsegs=1):
        self.frame(circle(r_out, segs), circle(r_in, segs), depth, material, loc, rot, axis, bevel, bsegs)

    def frame(self, outer, inner, depth, material, loc=(0, 0, 0), rot=(0, 0, 0), axis="Y", bevel=0.0, segs=2):
        """Profile with a hole: `outer` and `inner` loops must have the same point count and phase."""
        assert len(outer) == len(inner)
        t = self._tmp()
        idx = self.mi(material)
        n = len(outer)
        of = [t.verts.new((a, -depth / 2, b)) for a, b in outer]
        ob = [t.verts.new((a, depth / 2, b)) for a, b in outer]
        inf = [t.verts.new((a, -depth / 2, b)) for a, b in inner]
        ib = [t.verts.new((a, depth / 2, b)) for a, b in inner]
        rims = []
        for i in range(n):
            j = (i + 1) % n
            for quad in ((of[i], ob[i], ob[j], of[j]), (inf[i], inf[j], ib[j], ib[i]), (of[i], of[j], inf[j], inf[i]), (ob[i], ib[i], ib[j], ob[j])):
                t.faces.new(quad).material_index = idx
        for ring in (of, ob, inf, ib):
            for i in range(n):
                e = t.edges.get([ring[i], ring[(i + 1) % n]])
                if e is not None:
                    rims.append(e)
        self._commit(t, xform(loc, rot) @ _PRISM_AXIS[axis], rims, bevel, segs)

    def lathe(self, profile, material, loc=(0, 0, 0), rot=(0, 0, 0), axis="Z", segs=24, start=None, cap=True, uv_planar=None, closed=False):
        """Revolve a (r, h) profile (listed bottom to top). r == 0 at an end makes a pole.

        closed=True joins the last profile point back to the first (rings, bezels; no caps).
        uv_planar=R: planar UV over the disc of radius R seen along the axis (u along +X, v along +Z
        for axis "Y" seen from the front), centred at 0.5 - for lenses and round screens.
        """
        start = math.pi / segs if start is None else start
        t = self._tmp()
        uv_t = t.loops.layers.uv.active
        idx = self.mi(material)
        rings = []
        for r, h in profile:
            if r <= 1e-7:
                rings.append([t.verts.new((0.0, 0.0, h))])
            else:
                rings.append([t.verts.new((r * math.cos(start + 2 * math.pi * i / segs), r * math.sin(start + 2 * math.pi * i / segs), h)) for i in range(segs)])
        faces = []
        pairs = list(zip(rings[:-1], rings[1:]))
        if closed:
            pairs.append((rings[-1], rings[0]))
            cap = False
        for ra, rb in pairs:
            if len(ra) == 1 and len(rb) == 1:
                continue
            for i in range(segs):
                j = (i + 1) % segs
                if len(ra) == 1:
                    vs = (ra[0], rb[i], rb[j])
                elif len(rb) == 1:
                    vs = (ra[i], rb[0], ra[j])
                else:
                    vs = (ra[i], rb[i], rb[j], ra[j])
                faces.append(t.faces.new(vs))
        if cap:
            if len(rings[0]) > 1:
                faces.append(t.faces.new(list(reversed(rings[0]))))
            if len(rings[-1]) > 1:
                faces.append(t.faces.new(rings[-1]))
        for f in faces:
            f.material_index = idx
        solid = cap or closed or (len(rings[0]) == 1 and len(rings[-1]) == 1)
        if solid:
            bmesh.ops.recalc_face_normals(t, faces=t.faces[:])
        else:
            # open shell: outward = away from the axis
            for f in t.faces:
                c = f.calc_center_median()
                if f.normal.dot(Vector((c.x, c.y, 0.0))) < 0:
                    f.normal_flip()
        m = xform(loc, rot) @ _LATHE_AXIS[axis]
        if uv_planar:
            # project in canonical space: for axis Y the canonical +X stays +X and canonical -Y becomes +Z
            # (seen from the front). Build the UV from the final axis-mapped coordinates instead.
            a = _LATHE_AXIS[axis]
            for f in t.faces:
                for loop in f.loops:
                    p = a @ loop.vert.co
                    if axis == "Y":
                        u, v = p.x, p.z
                    elif axis == "X":
                        u, v = -p.y, p.z
                    else:
                        u, v = p.x, -p.y
                    loop[uv_t].uv = (0.5 + u / (2 * uv_planar), 0.5 + v / (2 * uv_planar))
        self._commit(t, m, recalc=False, has_uv=bool(uv_planar))

    def sphere(self, r, material, loc=(0, 0, 0), rot=(0, 0, 0), segs=16, rings=8, scale=(1, 1, 1), uv=None):
        """uv=(u, v): give every corner this UV (a uniform sample for UV-driven runtime materials)."""
        t = self._tmp()
        bmesh.ops.create_uvsphere(t, u_segments=segs, v_segments=rings, radius=r)
        idx = self.mi(material)
        uv_t = t.loops.layers.uv.active
        for f in t.faces:
            f.material_index = idx
            if uv is not None:
                for loop in f.loops:
                    loop[uv_t].uv = uv
        self._commit(t, xform(loc, rot, scale), has_uv=uv is not None)

    def sweep(self, pts, radius, material, segs=8, caps=True, closed=False, radii=None, up=(0, 0, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        """Tube of `radius` along a 3D polyline (parallel-transport frames)."""
        P = [Vector(p) for p in pts]
        n = len(P)
        tang = []
        for i in range(n):
            if closed:
                d = P[(i + 1) % n] - P[i - 1]
            else:
                d = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
            tang.append(d.normalized())
        ref = Vector(up)
        if abs(tang[0].dot(ref)) > 0.95:
            ref = Vector((1, 0, 0))
        nrm = (ref - tang[0] * ref.dot(tang[0])).normalized()
        t = self._tmp()
        idx = self.mi(material)
        rings = []
        for i in range(n):
            if i > 0:
                axis = tang[i - 1].cross(tang[i])
                if axis.length > 1e-9:
                    nrm = Matrix.Rotation(tang[i - 1].angle(tang[i]), 3, axis.normalized()) @ nrm
            bn = tang[i].cross(nrm)
            r = radii[i] if radii else radius
            rings.append([t.verts.new(P[i] + (nrm * math.cos(2 * math.pi * k / segs) + bn * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
        count = n if closed else n - 1
        for i in range(count):
            ra, rb = rings[i], rings[(i + 1) % n]
            for k in range(segs):
                kk = (k + 1) % segs
                t.faces.new((ra[k], ra[kk], rb[kk], rb[k])).material_index = idx
        if caps and not closed:
            t.faces.new(list(reversed(rings[0]))).material_index = idx
            t.faces.new(rings[-1]).material_index = idx
        self._commit(t, xform(loc, rot), recalc=caps or closed)

    def screen(self, w, h, material, loc=(0, 0, 0), rot=(0, 0, 0), nx=6, ny=4, bulge=0.0):
        """Open grid facing -Y with UV 0..1 (u -> +X, v -> +Z as seen from the front), optional CRT bulge."""
        t = self._tmp()
        uv_t = t.loops.layers.uv.active
        idx = self.mi(material)
        grid = []
        for j in range(ny + 1):
            row = []
            for i in range(nx + 1):
                u, v = i / nx, j / ny
                x, z = (u - 0.5) * w, (v - 0.5) * h
                y = -bulge * (1 - (2 * u - 1) ** 2) * (1 - (2 * v - 1) ** 2)
                row.append((t.verts.new((x, y, z)), (u, v)))
            grid.append(row)
        for j in range(ny):
            for i in range(nx):
                quad = (grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])
                f = t.faces.new([q[0] for q in quad])
                f.material_index = idx
                for loop, q in zip(f.loops, quad):
                    loop[uv_t].uv = q[1]
                if f.normal.y > 0:
                    f.normal_flip()
        self._commit(t, xform(loc, rot), recalc=False, has_uv=True)

    def raw(self, verts, faces, material, loc=(0, 0, 0), rot=(0, 0, 0), uvs=None, recalc=True, bevel=0.0, segs=2):
        """Arbitrary mesh: verts [(x,y,z)], faces [(i,j,k,...)], optional per-face-corner uvs [[(u,v),...]]."""
        t = self._tmp()
        uv_t = t.loops.layers.uv.active
        idx = self.mi(material)
        vs = [t.verts.new(v) for v in verts]
        for fi, face in enumerate(faces):
            f = t.faces.new([vs[i] for i in face])
            f.material_index = idx
            if uvs:
                for loop, uv in zip(f.loops, uvs[fi]):
                    loop[uv_t].uv = uv
        self._commit(t, xform(loc, rot), t.edges[:] if bevel else None, bevel, segs, recalc=recalc, has_uv=bool(uvs))

    def dent(self, centre, radius, depth, material=None, direction=None, cuts=0):
        """Push vertices near `centre` (asset space) inward with a smooth falloff - wear dents.

        Only faces with `material` are affected when given. direction: push direction (default: the
        vertex normal, inward). cuts: edge loops added per axis inside the dent first (geometry for
        a visible crater)."""
        c = Vector(centre) - self.origin
        idx = self.mats.index(material) if material else None
        if cuts:
            offsets = [radius * 0.8 * (2 * (i + 0.5) / cuts - 1) for i in range(cuts)]
            for axis in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))):
                for off in offsets:
                    faces = [f for f in self.bm.faces if (idx is None or f.material_index == idx) and _face_near(f, c, radius * 1.1)]
                    if not faces:
                        continue
                    edges = list({e for f in faces for e in f.edges})
                    verts = list({v for f in faces for v in f.verts})
                    bmesh.ops.bisect_plane(self.bm, geom=faces + edges + verts, plane_co=c + axis * off, plane_no=axis)
        self.bm.normal_update()
        moves = []
        for v in self.bm.verts:
            d = (v.co - c).length
            if d >= radius:
                continue
            if idx is not None and not any(f.material_index == idx for f in v.link_faces):
                continue
            k = 1 - (d / radius) ** 3  # flat-ish floor, crisp rim
            push = Vector(direction).normalized() if direction else -v.normal
            moves.append((v, push * depth * k))
        for v, delta in moves:
            v.co += delta
        return len(moves)

    def deform(self, fn, material=None):
        """Move vertices (of faces with `material`, or all): fn(Vector asset-space) -> Vector."""
        idx = self.mats.index(material) if material else None
        for v in self.bm.verts:
            if idx is not None and not any(f.material_index == idx for f in v.link_faces):
                continue
            v.co = Vector(fn(v.co + self.origin)) - self.origin

    # ---- output

    def finish(self, collection, parent=None, parent_origin=(0, 0, 0), sharp_angle=50.0, weighted=True, box_uv=True):
        bm = self.bm
        limit = math.radians(sharp_angle)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if not e.is_manifold:
                e.smooth = False
            elif e.calc_face_angle(0.0) > limit:
                e.smooth = False
        if box_uv:
            bm.normal_update()
            for f in bm.faces:
                if f[self.uv_flag]:
                    continue
                nx, ny, nz = (abs(c) for c in f.normal)
                for loop in f.loops:
                    co = loop.vert.co + self.origin
                    if nx >= ny and nx >= nz:
                        loop[self.uv].uv = (co.y, co.z)
                    elif ny >= nz:
                        loop[self.uv].uv = (co.x, co.z)
                    else:
                        loop[self.uv].uv = (co.x, co.y)
        bm.faces.layers.int.remove(self.uv_flag)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for name in self.mats:
            mesh.materials.append(resolve_material(name))
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        if parent is not None:
            obj.parent = parent
            obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.location = self.origin - Vector(parent_origin)
        if weighted:
            mod = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
            mod.mode = "FACE_AREA"
            mod.weight = 50
            mod.keep_sharp = True
        return obj


def empty(name, collection, location=(0, 0, 0), parent=None, size=0.25):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = size
    collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = location
    return obj


def strip_name_prefixes(glb_path, manifest_path=None, sep="/"):
    """Rename glTF nodes/meshes 'asset/Node' -> 'Node' after export.

    Blender object names are unique per file, but the asset contract needs the same child names in
    several assets (every NPC has Body / Head / Face). Generators name such objects '<asset>/<Node>'
    and this rewrites the GLB JSON chunk (and the manifest 'nodes' lists) after common.export_glb().
    """
    import json
    import struct

    with open(glb_path, "rb") as handle:
        data = handle.read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    chunks = []
    off = 12
    while off < len(data):
        length, ctype = struct.unpack_from("<II", data, off)
        chunks.append([ctype, data[off + 8 : off + 8 + length]])
        off += 8 + length
    doc = json.loads(chunks[0][1].decode("utf-8"))
    renamed = 0
    for key in ("nodes", "meshes"):
        for item in doc.get(key, []):
            name = item.get("name", "")
            if sep in name:
                item["name"] = name.split(sep)[-1]
                renamed += 1
    body = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body += b" " * ((4 - len(body) % 4) % 4)
    chunks[0][1] = body
    out = bytearray(struct.pack("<III", magic, version, 0))
    for ctype, payload in chunks:
        out += struct.pack("<II", len(payload), ctype) + payload
    struct.pack_into("<I", out, 8, len(out))
    with open(glb_path, "wb") as handle:
        handle.write(out)
    if manifest_path:
        with open(manifest_path, encoding="utf-8") as handle:
            manifest = json.load(handle)
        for entry in manifest:
            entry["nodes"] = [n.split(sep)[-1] for n in entry.get("nodes", [])]
        with open(manifest_path, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=1)
    return renamed


def closeup(centre, size, filename, view="three_quarter", resolution=(800, 700)):
    """Render a close-up around `centre` (world) framing a box of `size` metres (everything visible)."""
    mesh = bpy.data.meshes.new("HN_TmpFrame")
    h = size / 2
    mesh.from_pydata([(x * h, y * h, z * h) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)], [], [])
    tmp = bpy.data.objects.new("HN_TmpFrame", mesh)
    bpy.context.scene.collection.objects.link(tmp)
    tmp.location = centre
    tmp.hide_render = True
    try:
        bpy.context.view_layer.update()
        return common.render_preview([tmp], filename, view=view, resolution=resolution, margin=1.0, isolate=False)
    finally:
        bpy.data.objects.remove(tmp, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def hide_startup_objects():
    """Hide the default Cube / Camera / Light (viewport + render) without deleting them."""
    for name in ("Cube", "Camera", "Light"):
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        obj.hide_render = True
        obj.hide_viewport = True
        try:
            obj.hide_set(True)
        except RuntimeError:
            pass
