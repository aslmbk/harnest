"""Geometry helpers for the HARNEST facade kit (used by build_facades.py). Blender 5.1, bmesh based.

Every asset is accumulated in ONE bmesh (`MB`) so the result is a single mesh object with several material
slots. Coordinates are Blender axes in metres: x right, y into the wall (+Y = behind the wall plane),
z up; the asset front is -Y (three.js +Z).

Vertex colours ("Col", FLOAT_COLOR, corner domain, linear) carry a baked soft occlusion + dirt term that
the game multiplies into the base colour. Faces are tagged to choose how they are shaded:
    T_AO     ray-traced occlusion (against the asset + environment proxies) x dirt function
    T_FLAT   constant 1.0 (glass, emissive surfaces)
    T_PRESET value given by a `pre(co, n)` function at build time (continuous trims: identical on every
             module so ledges, plinths and parapets match across seams and corners)
    T_WALL   like T_AO, but blended to the storey's standard profile near the module's side edges so
             any two modules of a storey type meet without a colour step
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

V = Vector

T_AO = 0
T_FLAT = 1
T_PRESET = 2
T_WALL = 3


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smoothstep(a, b, x):
    if a == b:
        return 1.0 if x >= b else 0.0
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def rot_z(deg, origin=(0.0, 0.0, 0.0)):
    o = V(origin)
    return Matrix.Translation(o) @ Matrix.Rotation(math.radians(deg), 4, "Z") @ Matrix.Translation(-o)


def axis_basis(a):
    """Two unit vectors perpendicular to `a` (and each other)."""
    a = V(a).normalized()
    t = V((0.0, 0.0, 1.0)) if abs(a.z) < 0.9 else V((1.0, 0.0, 0.0))
    u = a.cross(t).normalized()
    w = a.cross(u).normalized()
    return u, w


_DIR_AXES = {"-x": V((-1, 0, 0)), "+x": V((1, 0, 0)), "-y": V((0, -1, 0)), "+y": V((0, 1, 0)),
             "-z": V((0, 0, -1)), "+z": V((0, 0, 1))}


class MB:
    """Mesh builder: one bmesh, material slots by palette name, per-face shading tags."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.l_tag = self.bm.faces.layers.int.new("hn_tag")
        self.l_pre = self.bm.loops.layers.float.new("hn_pre")

    # ── basics ──
    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _finish(self, f, mat, normal=None, smooth=False, tag=T_AO, pre=None):
        f.normal_update()
        if normal is not None and f.normal.dot(V(normal)) < 0:
            f.normal_flip()
            f.normal_update()
        f.material_index = self.mi(mat)
        f.smooth = smooth
        f[self.l_tag] = tag
        if pre is not None:
            n = f.normal
            for loop in f.loops:
                loop[self.l_pre] = pre(loop.vert.co, n) if callable(pre) else float(pre)
        return f

    def face(self, pts, mat, normal=None, smooth=False, tag=T_AO, pre=None, M=None):
        if M is not None:
            pts = [M @ V(p) for p in pts]
            if normal is not None:
                normal = M.to_3x3() @ V(normal)
        vs = [self.bm.verts.new(V(p)) for p in pts]
        f = self.bm.faces.new(vs)
        return self._finish(f, mat, normal, smooth, tag, pre)

    def face_front(self, pts_xz, y, mat, tag=T_AO, pre=None, M=None):
        """Flat polygon in the plane y = const facing -Y. pts as (x, z)."""
        return self.face([(x, y, z) for x, z in pts_xz], mat, normal=(0, -1, 0), tag=tag, pre=pre, M=M)

    def merge(self, src, mat, tag=T_AO, pre=None, smooth=None, M=None, mats=None):
        """Copy every face of bmesh `src` into this builder. `mats` maps src material_index → name."""
        flip = M is not None and M.determinant() < 0
        vmap = {}
        for v in src.verts:
            vmap[v] = self.bm.verts.new(M @ v.co if M is not None else v.co.copy())
        out = []
        for f in src.faces:
            vs = [vmap[v] for v in f.verts]
            if flip:
                vs.reverse()
            nf = self.bm.faces.new(vs)
            m = mats[f.material_index] if mats else mat
            self._finish(nf, m, None, f.smooth if smooth is None else smooth, tag, pre)
            out.append(nf)
        return out

    # ── primitives ──
    def box(self, lo, hi, mat, skip="", chamfer=0.0, cham_keys=None, tag=T_AO, pre=None, M=None):
        """Axis-aligned box [lo, hi] (optionally transformed by M). skip: faces to omit, e.g. '+y -z'.
        chamfer: bevel width for edges between kept faces (only edges touching `cham_keys` faces if given)."""
        lo, hi = V(lo), V(hi)
        size = hi - lo
        if min(size) <= 1e-6:
            raise ValueError(f"{self.name}: degenerate box {tuple(lo)} {tuple(hi)}")
        skips = set(skip.split())
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        for v in tmp.verts:
            v.co = V((lo.x + (v.co.x + 0.5) * size.x, lo.y + (v.co.y + 0.5) * size.y, lo.z + (v.co.z + 0.5) * size.z))
        tmp.normal_update()

        def key_of(f):
            n = f.normal
            for k, a in _DIR_AXES.items():
                if n.dot(a) > 0.999:
                    return k
            return None

        if chamfer > 0:
            keys = {f: key_of(f) for f in tmp.faces}
            edges = []
            for e in tmp.edges:
                ks = [keys[f] for f in e.link_faces]
                if any(k in skips for k in ks):
                    continue
                if cham_keys is not None and not any(k in cham_keys for k in ks):
                    continue
                edges.append(e)
            if edges:
                bmesh.ops.bevel(tmp, geom=edges, offset=chamfer, offset_type="OFFSET", segments=1, profile=0.5,
                                affect="EDGES", clamp_overlap=True)
        tmp.normal_update()
        if skips:
            planes = {"-x": lo.x, "+x": hi.x, "-y": lo.y, "+y": hi.y, "-z": lo.z, "+z": hi.z}
            dead = []
            for f in tmp.faces:
                k = key_of(f)
                if k in skips:
                    c = f.calc_center_median()
                    axis = "xyz".index(k[1])
                    if abs(c[axis] - planes[k]) < 1e-5:
                        dead.append(f)
            bmesh.ops.delete(tmp, geom=dead, context="FACES_ONLY")
        faces = self.merge(tmp, mat, tag=tag, pre=pre, smooth=False, M=M)
        tmp.free()
        return faces

    def cyl(self, p0, p1, r, mat, seg=8, cap0=False, cap1=True, smooth=True, tag=T_AO, pre=None, r1=None, phase=None):
        """Cylinder (or cone with r1) from p0 to p1."""
        p0, p1 = V(p0), V(p1)
        a = (p1 - p0).normalized()
        u, w = axis_basis(a)
        if phase is None:
            phase = math.pi / seg
        r1 = r if r1 is None else r1
        ring0, ring1, dirs = [], [], []
        for i in range(seg):
            ang = phase + 2 * math.pi * i / seg
            d = u * math.cos(ang) + w * math.sin(ang)
            dirs.append(d)
            ring0.append(self.bm.verts.new(p0 + d * r))
            ring1.append(self.bm.verts.new(p1 + d * r1))
        out = []
        for i in range(seg):
            j = (i + 1) % seg
            f = self.bm.faces.new([ring0[i], ring0[j], ring1[j], ring1[i]])
            out.append(self._finish(f, mat, (dirs[i] + dirs[j]), smooth, tag, pre))
        if cap0:
            out.append(self._finish(self.bm.faces.new(list(ring0)), mat, -a, False, tag, pre))
        if cap1:
            out.append(self._finish(self.bm.faces.new(list(ring1)), mat, a, False, tag, pre))
        return out

    def sweep(self, profile, p0, p1, up, mat, closed=False, caps=False, smooth=False, tag=T_AO, pre=None,
              normals=None):
        """Sweep a 2D profile [(s, t), ...] from p0 to p1. t runs along `up`, s along side = axis × up
        (for a +X run with up=+Z, side = -Y: s is the distance in front of the wall).
        Outward normals follow the profile's winding (an open profile is treated as closed by a straight
        segment back to its start, e.g. the wall). normals: optional explicit 2D normals per segment."""
        p0, p1 = V(p0), V(p1)
        a = (p1 - p0).normalized()
        upv = V(up).normalized()
        side = a.cross(upv).normalized()
        upv = side.cross(a).normalized()

        def P(base, s, t):
            return base + side * s + upv * t

        r0 = [self.bm.verts.new(P(p0, s, t)) for s, t in profile]
        r1 = [self.bm.verts.new(P(p1, s, t)) for s, t in profile]
        n = len(profile)
        segs = n if closed else n - 1
        out = []
        area = sum(profile[i][0] * profile[(i + 1) % n][1] - profile[(i + 1) % n][0] * profile[i][1] for i in range(n))
        for i in range(segs):
            j = (i + 1) % n
            (s0, t0), (s1, t1) = profile[i], profile[j]
            if normals is not None:
                ns, nt = normals[i]
            else:
                ds, dt = s1 - s0, t1 - t0
                ns, nt = (dt, -ds) if area > 0 else (-dt, ds)
            nrm = side * ns + upv * nt
            f = self.bm.faces.new([r0[i], r0[j], r1[j], r1[i]])
            out.append(self._finish(f, mat, nrm, smooth, tag, pre))
        if caps and closed:
            out.append(self._finish(self.bm.faces.new(list(r0)), mat, -a, False, tag, pre))
            out.append(self._finish(self.bm.faces.new(list(r1)), mat, a, False, tag, pre))
        return out

    def grid_surface(self, origin, du, dv, nu, nv, mat, disp=None, normal=None, tag=T_AO, pre=None, smooth=True):
        """Quad grid origin + du*i/nu + dv*j/nv, displaced along `normal` by disp(i/nu, j/nv)."""
        origin, du, dv = V(origin), V(du), V(dv)
        nrm = V(normal).normalized() if normal is not None else du.cross(dv).normalized()
        vs = {}
        for i in range(nu + 1):
            for j in range(nv + 1):
                p = origin + du * (i / nu) + dv * (j / nv)
                if disp is not None:
                    p = p + nrm * disp(i / nu, j / nv)
                vs[i, j] = self.bm.verts.new(p)
        out = []
        for i in range(nu):
            for j in range(nv):
                f = self.bm.faces.new([vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]])
                out.append(self._finish(f, mat, nrm, smooth, tag, pre))
        return out

    def prism(self, poly, z0, z1, mat, chamfer=0.0, tag=T_AO, pre=None, M=None):
        """Vertical prism over a CCW (seen from above) polygon [(x, y), ...]: top + sides, no bottom.
        chamfer bevels the top rim."""
        tmp = bmesh.new()
        bot = [tmp.verts.new((x, y, z0)) for x, y in poly]
        top = [tmp.verts.new((x, y, z1)) for x, y in poly]
        n = len(poly)
        ftop = tmp.faces.new(top)
        for i in range(n):
            j = (i + 1) % n
            tmp.faces.new([bot[i], bot[j], top[j], top[i]])
        tmp.normal_update()
        if ftop.normal.z < 0:
            for f in tmp.faces:
                f.normal_flip()
        if chamfer > 0:
            edges = list(ftop.edges)
            bmesh.ops.bevel(tmp, geom=edges, offset=chamfer, offset_type="OFFSET", segments=1, profile=0.5,
                            affect="EDGES", clamp_overlap=True)
        faces = self.merge(tmp, mat, tag=tag, pre=pre, smooth=False, M=M)
        tmp.free()
        return faces

    def blob(self, centre, radii, mat, rng, rough=0.18, subdiv=1, flat_bottom=None, tag=T_AO, smooth=True):
        """Lumpy ellipsoid (foliage, sandbag-ish shapes). Deterministic with `rng`."""
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=1.0)
        for v in tmp.verts:
            k = 1.0 + rng.uniform(-rough, rough)
            co = v.co * k
            co = V((co.x * radii[0], co.y * radii[1], co.z * radii[2]))
            if flat_bottom is not None and co.z < flat_bottom:
                co.z = flat_bottom
            v.co = co + V(centre)
        faces = self.merge(tmp, mat, tag=tag, smooth=smooth)
        tmp.free()
        return faces

    # ── walls ──
    def wall_grid(self, x0, x1, z0, z1, holes, mat="M_Wall", y=0.0, step_x=0.25, step_z=0.28, tag=T_WALL,
                  extra_x=(), extra_z=()):
        """Rectilinear quad grid in the plane y (facing -Y) covering [x0,x1]×[z0,z1] minus rectangular
        holes (hx0, hx1, hz0, hz1). Hole edges become grid lines, so vertex colours have support everywhere."""
        def breaks(a, b, step, forced):
            forced = sorted({round(v, 5) for v in forced if a - 1e-6 <= v <= b + 1e-6} | {round(a, 5), round(b, 5)})
            n = max(1, round((b - a) / step))
            base = [a + (b - a) * i / n for i in range(1, n)]
            keep = [v for v in base if all(abs(v - f) > 0.07 for f in forced)]
            return sorted(set(forced) | {round(v, 5) for v in keep})

        fx = [h[0] for h in holes] + [h[1] for h in holes] + list(extra_x)
        fz = [h[2] for h in holes] + [h[3] for h in holes] + list(extra_z)
        xs = breaks(x0, x1, step_x, fx)
        zs = breaks(z0, z1, step_z, fz)
        vs = {}

        def vert(i, j):
            if (i, j) not in vs:
                vs[i, j] = self.bm.verts.new(V((xs[i], y, zs[j])))
            return vs[i, j]

        out = []
        for i in range(len(xs) - 1):
            for j in range(len(zs) - 1):
                cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
                if any(h[0] < cx < h[1] and h[2] < cz < h[3] for h in holes):
                    continue
                f = self.bm.faces.new([vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1)])
                out.append(self._finish(f, mat, (0, -1, 0), False, tag, None))
        return out

    def reveal(self, x0, x1, z0, z1, depth, mat, sides="l r t b", y0=0.0, tag=T_AO):
        """Inner faces of a rectangular opening from the wall plane y0 back to y0+depth."""
        y1 = y0 + depth
        s = set(sides.split())
        out = []
        if "l" in s:
            out.append(self.face([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], mat, (1, 0, 0), tag=tag))
        if "r" in s:
            out.append(self.face([(x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0)], mat, (-1, 0, 0), tag=tag))
        if "t" in s:
            out.append(self.face([(x0, y0, z1), (x0, y1, z1), (x1, y1, z1), (x1, y0, z1)], mat, (0, 0, -1), tag=tag))
        if "b" in s:
            out.append(self.face([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], mat, (0, 0, 1), tag=tag))
        return out

    # ── finishing ──
    def polys(self):
        """(verts, faces) lists of the current geometry, for BVH environments."""
        self.bm.verts.index_update()
        return [v.co.copy() for v in self.bm.verts], [[v.index for v in f.verts] for f in self.bm.faces]

    def transform(self, M):
        for v in self.bm.verts:
            v.co = M @ v.co
        if M.determinant() < 0:
            for f in self.bm.faces:
                f.normal_flip()
        self.bm.normal_update()

    def tri_count(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)


# ───────────────────────────── environments for occlusion ─────────────────────────────


class Env:
    """Proxy polygons around an asset (neighbour walls, ledges, ground...) used only for ray casting."""

    def __init__(self):
        self.verts = []
        self.faces = []

    def add(self, verts, faces, M=None):
        base = len(self.verts)
        for v in verts:
            self.verts.append(M @ V(v) if M is not None else V(v))
        for f in faces:
            self.faces.append([base + i for i in f])
        return self

    def add_mb(self, mb, M=None):
        vs, fs = mb.polys()
        return self.add(vs, fs, M)

    def quad(self, a, b, c, d):
        return self.add([a, b, c, d], [[0, 1, 2, 3]])

    def box(self, lo, hi):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        vs = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        fs = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]]
        return self.add(vs, fs)


def _hemisphere(n):
    """Cosine-weighted hemisphere directions (Fibonacci spiral, deterministic)."""
    ga = math.pi * (3 - math.sqrt(5))
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        r = math.sqrt(u)
        phi = i * ga
        out.append(V((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1 - u)))))
    return out


def _occlusion(bvh, p, n, dirs, maxd):
    u, w = axis_basis(n)
    o = p + n * 0.0025
    occ = 0.0
    for d in dirs:
        ray = u * d.x + w * d.y + n * d.z
        hit = bvh.ray_cast(o, ray, maxd)
        if hit[0] is not None:
            occ += 1.0 - hit[3] / maxd
    return occ / len(dirs)


def warm_rgb(c):
    """Perceptual dirt value c (1 = clean) → linear RGBA multiplier; darker values drift warm/brown (grime).
    COLOR_0 is multiplied into the base colour in linear space, so c is converted with a 2.2 gamma."""
    c = clamp(c, 0.0, 1.0)
    lin = c ** 2.2
    return (lin, lin * (0.965 + 0.035 * c), lin * (0.90 + 0.10 * c), 1.0)


def bake_colours(mb, env=None, std_env=None, dirt=None, std_dirt=None, edge=(0.62, 0.98), rays=40, maxd=0.55,
                 strength=1.35, floor=0.38, wall_strength=1.1, wall_floor=0.52):
    """Fill the 'Col' corner attribute. dirt(p, n, tag) and std_dirt(p, n) return multipliers.

    T_WALL loops are sampled at a canonical point that depends only on the vertex position (clamped a few
    mm inside the wall band), so crease vertices shared by every module of a storey type (plinth top,
    ledge above/below, side edges) get identical values in every module; near the side edges they blend
    to the standard (std_env/std_dirt) result."""
    bm = mb.bm
    bm.normal_update()
    bm.verts.index_update()
    vs, fs = mb.polys()
    if env is not None:
        base = len(vs)
        vs = vs + env.verts
        fs = fs + [[base + i for i in f] for f in env.faces]
    bvh = BVHTree.FromPolygons(vs, fs, all_triangles=False)
    bvh_std = BVHTree.FromPolygons(std_env.verts, std_env.faces, all_triangles=False) if std_env else None
    dirs = _hemisphere(rays)
    col = bm.loops.layers.float_color.get("Col") or bm.loops.layers.float_color.new("Col")
    wall_z = [v.co.z for f in bm.faces if f[mb.l_tag] == T_WALL for v in f.verts]
    zlo, zhi = (min(wall_z), max(wall_z)) if wall_z else (0.0, 3.0)
    cache, cache_std = {}, {}
    for f in bm.faces:
        tag = f[mb.l_tag]
        centre = f.calc_center_median()
        for loop in f.loops:
            if tag == T_FLAT:
                loop[col] = (1.0, 1.0, 1.0, 1.0)
                continue
            if tag == T_PRESET:
                loop[col] = warm_rgb(loop[mb.l_pre])
                continue
            co = loop.vert.co
            n = (loop.vert.normal if f.smooth else f.normal).normalized()
            if tag == T_WALL:
                key = ("w", loop.vert.index)
                p = V((clamp(co.x, -0.996, 0.996), co.y, clamp(co.z, zlo + 0.006, zhi - 0.006)))
                st, fl = wall_strength, wall_floor
            else:
                key = (loop.vert.index, round(n.x, 3), round(n.y, 3), round(n.z, 3))
                to_c = centre - co
                p = co + to_c.normalized() * min(0.004, to_c.length * 0.5) if to_c.length > 1e-6 else co.copy()
                st, fl = strength, floor
            if key not in cache:
                occ = _occlusion(bvh, p, n, dirs, maxd)
                cache[key] = max(fl, 1.0 - st * occ)
            c = cache[key] * (dirt(co, n, tag) if dirt else 1.0)
            if tag == T_WALL and bvh_std is not None:
                wgt = smoothstep(edge[0], edge[1], abs(co.x))
                if wgt > 0:
                    if key not in cache_std:
                        occ = _occlusion(bvh_std, p, n, dirs, maxd)
                        cache_std[key] = max(fl, 1.0 - st * occ)
                    cs = cache_std[key] * (std_dirt(co, n) if std_dirt else 1.0)
                    c = lerp(c, cs, wgt)
            loop[col] = warm_rgb(c)


def box_uvs(mb, scale=1.0):
    """World-scale box-projected UVs (metres), for any procedural use at runtime."""
    bm = mb.bm
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            c = loop.vert.co
            if ax == 0:
                u, v = (c.y if n.x > 0 else -c.y), c.z
            elif ax == 1:
                u, v = (-c.x if n.y > 0 else c.x), c.z
            else:
                u, v = c.x, (c.y if n.z > 0 else -c.y)
            loop[uv].uv = (u * scale, v * scale)


def to_object(mb, collection, material_fn):
    """Create the mesh object (name = mb.name). material_fn(name) → bpy material."""
    bm = mb.bm
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.faces.layers.int.remove(mb.l_tag)
    bm.loops.layers.float.remove(mb.l_pre)
    old = bpy.data.objects.get(mb.name)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    mesh = bpy.data.meshes.get(mb.name)
    if mesh is not None:
        bpy.data.meshes.remove(mesh)
    mesh = bpy.data.meshes.new(mb.name)
    bm.to_mesh(mesh)
    bm.free()
    for m in mb.mats:
        mesh.materials.append(material_fn(m))
    if "Col" in mesh.color_attributes:
        attr = mesh.color_attributes["Col"]
        mesh.color_attributes.active_color = attr
        mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
    mesh.update()
    obj = bpy.data.objects.new(mb.name, mesh)
    collection.objects.link(obj)
    return obj
