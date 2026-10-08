"""HARNEST — building kit generator: public/assets/models/kit_facades.glb (+ manifest, previews, .blend).

Headless (from the repo root):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
        --python blender/scripts/build_facades.py

Env options (iteration only): HN_PREVIEWS=all|assembly|none (default all), HN_NOAO=1 (skip the vertex AO bake).

Conventions (docs/GAME_DESIGN.md §7.4): facade modules are 2 m wide × 3 m high, origin bottom centre on the
wall plane, front = Blender -Y (three.js +Z). Wall face on y = 0, recesses behind (y > 0, ≤ 0.25),
details in front (y < 0, ≥ -0.30). Every facade module carries the same top ledge (z 2.86–3.0), ground
modules also the same plinth (z 0–0.32), so storeys stack and modules tile in any order.
"""

import math
import os
import random
import sys
import importlib
import time

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

importlib.reload(common)
import geo_facades as G  # noqa: E402

importlib.reload(G)

V = Vector
COLL = "Kit_Facades"
ASSETS = [
    "fac_g_plain", "fac_g_door", "fac_g_shutter", "fac_g_window", "fac_g_vent",
    "fac_u_plain", "fac_u_window", "fac_u_window_lit", "fac_u_balcony", "fac_u_ac", "fac_u_pipes",
    "fac_corner", "roof_cap", "roof_parapet", "low_barrier", "low_planter", "low_crates", "railing",
]
PREVIEWS = os.environ.get("HN_PREVIEWS", "all")
NOAO = os.environ.get("HN_NOAO") == "1"

# ───────────────────────────── shared trims ─────────────────────────────

LEDGE_Z0, LEDGE_Z1, LEDGE_D = 2.86, 3.0, 0.13
# (depth in front of the wall, z) — top slopes down outward so perpendicular ledges never share a plane
LEDGE_PROFILE = [(0.0, 3.0), (0.118, 2.979), (0.13, 2.968), (0.13, 2.872), (0.121, 2.86), (0.0, 2.86)]
PLINTH_Z = 0.32
PLINTH_PROFILE = [(0.0, PLINTH_Z), (0.014, PLINTH_Z), (0.025, PLINTH_Z - 0.011), (0.025, 0.0)]


def ledge_pre(co, n):
    d = G.clamp(-co.y / LEDGE_D)
    if n.z > 0.6:
        return 0.80 + 0.20 * d
    if n.z < -0.6:
        return 0.56 + 0.06 * d
    return 0.94 - 0.10 * G.clamp((2.968 - co.z) / 0.108)


def plinth_pre(co, n):
    if n.z > 0.6:
        return 0.86
    return 0.60 + 0.32 * G.smoothstep(0.0, 0.30, co.z)


def add_ledge(mb, x0=-1.0, x1=1.0, mat="M_Concrete"):
    mb.sweep(LEDGE_PROFILE, (x0, 0, 0), (x1, 0, 0), (0, 0, 1), mat, tag=G.T_PRESET, pre=ledge_pre)


def add_plinth(mb, x0, x1, cap0=False, cap1=False):
    mb.sweep(PLINTH_PROFILE, (x0, 0, 0), (x1, 0, 0), (0, 0, 1), "M_ConcreteDark", tag=G.T_PRESET, pre=plinth_pre)
    poly = [(0.0, 0.0)] + PLINTH_PROFILE[::-1]
    for x, on, nx in ((x0, cap0, -1), (x1, cap1, 1)):
        if on:
            mb.face([(x, -s, z) for s, z in poly], "M_ConcreteDark", normal=(nx, 0, 0), tag=G.T_PRESET, pre=plinth_pre)


# ───────────────────────────── detail helpers ─────────────────────────────


def blob_pts(cx, cz, rx, rz, rng, n=11, jitter=0.22):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.12, 0.12)
        k = 1 + rng.uniform(-jitter, jitter)
        pts.append((cx + math.cos(a) * rx * k, cz + math.sin(a) * rz * k))
    return pts


def rough_rect(x0, x1, z0, z1, rng, step=0.12, j=0.025):
    """Rectangle outline with jittered, roughly straight edges (CCW seen from the front)."""
    pts = []
    for (ax, az, bx, bz) in ((x0, z0, x1, z0), (x1, z0, x1, z1), (x1, z1, x0, z1), (x0, z1, x0, z0)):
        n = max(1, int(math.hypot(bx - ax, bz - az) / step))
        for i in range(n):
            t = i / n
            pts.append((ax + (bx - ax) * t + rng.uniform(-j, j), az + (bz - az) * t + rng.uniform(-j, j)))
    return pts


def sill(mb, x0, x1, ztop, out=0.075, th=0.06, mat="M_Concrete"):
    mb.box((x0, -out, ztop - th), (x1, 0.0, ztop), mat, skip="+y", chamfer=0.01, cham_keys={"-y", "+z"})


def hood(mb, x0, x1, z0, out=0.22, th=0.07, mat="M_Concrete"):
    mb.box((x0, -out, z0), (x1, 0.0, z0 + th), mat, skip="+y", chamfer=0.012, cham_keys={"-y", "+z", "-x", "+x"})


def glass(mb, x0, x1, z0, z1, y, mat="M_Glass"):
    mb.face_front([(x0, z0), (x1, z0), (x1, z1), (x0, z1)], y, mat, tag=G.T_FLAT)


def frame(mb, x0, x1, z0, z1, yf, yb, fw=0.045, mull_x=(), trans_z=(), mat="M_MetalDark"):
    """Window frame members in the slab yf..yb (yf < yb)."""
    mb.box((x0, yf, z0), (x0 + fw, yb, z1), mat, skip="+y")
    mb.box((x1 - fw, yf, z0), (x1, yb, z1), mat, skip="+y")
    mb.box((x0 + fw, yf, z1 - fw), (x1 - fw, yb, z1), mat, skip="+y -x +x")
    mb.box((x0 + fw, yf, z0), (x1 - fw, yb, z0 + fw), mat, skip="+y -x +x")
    w = fw * 0.8
    for x in mull_x:
        mb.box((x - w / 2, yf, z0 + fw), (x + w / 2, yb, z1 - fw), mat, skip="+y -z +z")
    for z in trans_z:
        mb.box((x0 + fw, yf, z - w / 2), (x1 - fw, yb, z + w / 2), mat, skip="+y -x +x")


def bolt(mb, x, z, y, s=0.018, mat="M_MetalSteel"):
    mb.box((x - s / 2, y - 0.008, z - s / 2), (x + s / 2, y, z + s / 2), mat, skip="+y")


def brick_patch(mb, cx, cz, w, h, rng, y=-0.0045, mortar="M_Concrete"):
    """Plaster broken off: brick courses (stepped outline) on a mortar bed, standing proud of the wall."""
    bw, bh, gap = 0.21, 0.064, 0.012
    rows = max(2, int(h / (bh + gap)))
    z = cz - rows * (bh + gap) / 2
    for r in range(rows):
        zc = z + r * (bh + gap) + bh / 2
        # row half-width from an irregular ellipse
        t = (zc - cz) / (h / 2)
        half = (w / 2) * math.sqrt(max(0.0, 1 - t * t)) * rng.uniform(0.75, 1.1)
        if half < bw * 0.45:
            continue
        off = (bw + gap) / 2 if r % 2 else 0.0
        xs = []
        k = -6
        while k < 7:
            xc = cx + k * (bw + gap) + off
            if abs(xc - cx) + bw * 0.3 < half:
                xs.append(xc)
            k += 1
        if not xs:
            continue
        lo_x, hi_x = xs[0] - bw / 2 - gap, xs[-1] + bw / 2 + gap
        mb.face_front([(lo_x, zc - bh / 2 - gap / 2), (hi_x, zc - bh / 2 - gap / 2), (hi_x, zc + bh / 2 + gap / 2),
                       (lo_x, zc + bh / 2 + gap / 2)], y, mortar)
        for xc in xs:
            if rng.random() < 0.08:
                continue  # a missing brick shows the mortar bed
            d = rng.uniform(0.005, 0.009)  # proud of the mortar bed
            yb = y - d
            x0, x1, z0, z1 = xc - bw / 2, xc + bw / 2, zc - bh / 2, zc + bh / 2
            mb.face([(x0, yb, z0), (x1, yb, z0), (x1, yb, z1), (x0, yb, z1)], "M_Brick", normal=(0, -1, 0))
            mb.face([(x0, yb, z1), (x1, yb, z1), (x1, y, z1), (x0, y, z1)], "M_Brick", normal=(0, 0, 1))


def crack(mb, pts, width=0.016, y=-0.002, mat="M_ConcreteDark"):
    """Jagged crack as a tapered strip through points (x, z)."""
    n = len(pts)
    left, right = [], []
    for i, (x, z) in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dz) or 1.0
        nx, nz = -dz / ln, dx / ln
        wi = width * (1.0 - 0.75 * i / max(1, n - 1)) / 2
        left.append((x + nx * wi, z + nz * wi))
        right.append((x - nx * wi, z - nz * wi))
    poly = left + right[::-1]
    # ensure CCW (front-facing) winding
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    if area < 0:
        poly.reverse()
    mb.face_front(poly, y, mat)


def streak_decal(mb, x, ztop, w, length, rng, mat="M_PlasterRust", y=-0.002):
    """Tapered run-off stain below a detail."""
    pts = [(x - w / 2, ztop), (x + w / 2, ztop)]
    steps = 4
    for i in range(1, steps + 1):
        t = i / steps
        pts.append((x + w / 2 * (1 - 0.8 * t) + rng.uniform(-0.01, 0.01), ztop - length * t))
    rights = pts[2:]
    lefts = [(x - (px - x) + rng.uniform(-0.01, 0.01), pz) for px, pz in rights]
    poly = [pts[0], pts[1]] + rights + lefts[::-1][1:]
    # order: top-left, top-right, down the right side, back up the left side → that is clockwise; reverse
    poly = [pts[0]] + lefts + rights[::-1] + [pts[1]]
    mb.face_front(poly, y, mat)


def poster(mb, cx, cz, w, h, deg, mat, y, rng, torn=False):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    if torn:
        pts = [(-w / 2, -h / 2 + 0.05), (-w / 6, -h / 2 + rng.uniform(0.0, 0.06)), (w / 5, -h / 2 + 0.09),
               (w / 2, -h / 2 + 0.03), (w / 2, h / 2), (-w / 2, h / 2)]
    mb.face_front([(cx + px * c - pz * s, cz + px * s + pz * c) for px, pz in pts], y, mat, tag=G.T_PRESET,
                  pre=lambda co, n: 0.8 - 0.12 * G.smoothstep(cz + h * 0.1, cz - h / 2, co.z))


def conduit(mb, pts, r, mat, seg=6):
    """Polyline pipe through 3D points; segments overlap a little at the joints."""
    for i in range(len(pts) - 1):
        a, b = V(pts[i]), V(pts[i + 1])
        d = (b - a).normalized()
        a2 = a - d * (r if i > 0 else 0)
        b2 = b + d * (r if i < len(pts) - 2 else 0)
        mb.cyl(a2, b2, r, mat, seg=seg, cap0=False, cap1=(i == len(pts) - 2))


def corrugated(mb, x0, x1, base0, base1, normal, amp, period, mat, tag=G.T_AO, pre=None):
    """Corrugated sheet: ridges run from base0 to base1 (3D offsets added to each x station)."""
    n = max(2, int(round((x1 - x0) / (period / 2))))
    nrm = V(normal)
    vs = []
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        o = nrm * (amp if i % 2 else -amp)
        vs.append((mb.bm.verts.new(V((x, 0, 0)) + V(base0) + o), mb.bm.verts.new(V((x, 0, 0)) + V(base1) + o)))
    for i in range(n):
        f = mb.bm.faces.new([vs[i][0], vs[i + 1][0], vs[i + 1][1], vs[i][1]])
        mb._finish(f, mat, nrm, False, tag, pre)


def cage(mb, x0, x1, z0, z1, depth, rng, roof_mat="M_MetalRust", bar="M_MetalDark", contents=True):
    """Protruding window guard ('bird cage'): floor plate, bars, sloped sheet roof, a few stored things."""
    yf = -depth
    t = 0.024
    mb.box((x0, yf, z0), (x1, -0.004, z0 + 0.022), bar, skip="+y", chamfer=0.004, cham_keys={"-y", "+z"})
    for x in (x0, x1 - t):
        mb.box((x, yf, z0 + 0.022), (x + t, yf + t, z1), bar, skip="-z +z")
    zm = z0 + (z1 - z0) * 0.42
    for z in (zm, z1 - t):
        mb.box((x0 + t, yf, z), (x1 - t, yf + t * 0.8, z + t * 0.8), bar, skip="-x +x")
        for x in (x0, x1 - t):
            mb.box((x, yf + t, z), (x + t, -0.004, z + t * 0.8), bar, skip="-y +y")
    n = max(4, round((x1 - x0) / 0.105))
    for i in range(1, n):
        x = x0 + (x1 - x0) * i / n
        mb.box((x - 0.0075, yf + 0.004, z0 + 0.022), (x + 0.0075, yf + 0.019, z1 - t), bar, skip="-z +z")
    for x in (x0 + 0.004, x1 - 0.019):
        for yy in (yf * 0.66, yf * 0.33):
            mb.box((x, yy - 0.0075, z0 + 0.022), (x + 0.015, yy + 0.0075, z1 - t), bar, skip="-z +z")
    # braces under the floor plate
    for x in (x0 + 0.06, x1 - 0.08):
        p0, p1 = V((x + 0.01, -0.004, z0 - 0.26)), V((x + 0.01, yf + 0.03, z0))
        mb.cyl(p0, p1, 0.011, bar, seg=4, cap0=False, cap1=False, smooth=False)
    # sloped corrugated roof
    zr0, zr1 = z1 + 0.11, z1 + 0.03
    corrugated(mb, x0 - 0.035, x1 + 0.035, (0, -0.004, zr0), (0, yf - 0.035, zr1), (0, 0.17, 1.0), 0.008, 0.07,
               roof_mat)
    mb.sweep([(0.0, zr0 - 0.016), (depth + 0.035, zr1 - 0.016), (depth + 0.035, zr1 - 0.008)],
             (x0 - 0.035, 0, 0), (x1 + 0.035, 0, 0), (0, 0, 1), roof_mat)
    if contents:
        # a potted plant and a box behind the bars
        px = x0 + (x1 - x0) * rng.uniform(0.62, 0.78)
        mb.cyl((px, yf * 0.5, z0 + 0.022), (px, yf * 0.5, z0 + 0.2), 0.075, "M_PlasticDark", seg=7, r1=0.09,
               cap1=False)
        mb.blob((px, yf * 0.5, z0 + 0.3), (0.13, 0.1, 0.15), "M_Plant", rng, rough=0.25)
        bx = x0 + (x1 - x0) * rng.uniform(0.12, 0.25)
        mb.box((bx, yf * 0.85, z0 + 0.022), (bx + 0.2, yf * 0.15, z0 + 0.17), "M_PlasticLight", skip="-z",
               chamfer=0.006)


# ───────────────────────────── environments + dirt ─────────────────────────────


def _env_mb():
    return G.MB("env")


def env_storey(kind):
    """Proxies around a facade module: neighbour walls/ledges, storey above/below, ground for 'ground'."""
    mb = _env_mb()
    for dz in (-3.0, 0.0, 3.0):
        mb.sweep([(s, z + dz) for s, z in LEDGE_PROFILE], (-3, 0, 0), (3, 0, 0), (0, 0, 1), "M_Concrete")
    e = G.Env().add_mb(mb)
    e.quad((-3, 0, 3), (3, 0, 3), (3, 0, 5.86), (-3, 0, 5.86))
    for xa, xb in ((-3, -1), (1, 3)):
        e.quad((xa, 0, 0), (xb, 0, 0), (xb, 0, 2.86), (xa, 0, 2.86))
    if kind == "ground":
        e.quad((-3, -5, 0), (3, -5, 0), (3, 0, 0), (-3, 0, 0))
        p = _env_mb()
        p.sweep(PLINTH_PROFILE, (-3, 0, 0), (3, 0, 0), (0, 0, 1), "M_ConcreteDark")
        e.add_mb(p)
    else:
        e.quad((-3, 0, -3), (3, 0, -3), (3, 0, -0.14), (-3, 0, -0.14))
    return e


def make_dirt(kind, streaks=(), blotches=(), damp=0.0):
    """Perceptual dirt multipliers for a facade module.

    std(co, n): shared by every module of the storey type (and used at the side edges, so seams match):
        ground: rising grime from the plinth; upper: splash above the ledge below; plus a seamless
        2 m-periodic mottling.
    dirt(co, n, tag): std × module-specific terms on the wall, faded out toward the side edges:
        streaks (x0, x1, ztop, length, strength), blotches (cx, cz, rx, rz, strength), damp (wavy
        rising-damp line height offset for ground modules, 0 = none)."""

    def std(co, n):
        z = co.z
        if kind == "ground":
            f = 0.66 + 0.18 * G.smoothstep(PLINTH_Z, 0.95, z) + 0.16 * G.smoothstep(0.95, 1.8, z)
        else:
            f = 0.84 + 0.16 * G.smoothstep(0.0, 0.6, z)
        f *= 1.0 - 0.06 * (0.5 + 0.5 * math.sin(math.pi * co.x + 1.7 + 1.9 * z) * math.cos(0.8 * z + 0.4))
        return f

    def dirt(co, n, tag):
        f = std(co, n)
        if tag != G.T_WALL:
            return f
        w = 1.0 - G.smoothstep(0.66, 0.92, abs(co.x))
        for x0, x1, ztop, length, s in streaks:
            if ztop - length - 1e-4 <= co.z <= ztop + 1e-4 and x0 - 1e-4 <= co.x <= x1 + 1e-4:
                mid, half = (x0 + x1) / 2, (x1 - x0) / 2
                ex = 1.0 - 0.65 * abs(co.x - mid) / half
                tz = G.clamp((ztop - co.z) / max(length, 1e-6))
                f *= 1.0 - s * G.clamp(ex) * (1.0 - tz) ** 1.4
        for cx, cz, rx, rz, s in blotches:
            d2 = ((co.x - cx) / rx) ** 2 + ((co.z - cz) / rz) ** 2
            f *= 1.0 - s * w * math.exp(-2.2 * d2)
        if damp:
            h = 0.95 + damp * (0.55 * math.sin(2.6 * co.x + 0.8) + 0.45 * math.sin(5.3 * co.x + 2.1))
            f *= 1.0 - 0.13 * w * (1.0 - G.smoothstep(h - 0.12, h + 0.06, co.z))
        return f

    return dirt, std


def streak_lines(streaks):
    xs, zs = [], []
    for x0, x1, ztop, length, _ in streaks:
        xs += [x0, (x0 + x1) / 2, x1]
        zs += [ztop, ztop - length * 0.5, ztop - length]
    return xs, zs


def finish(mb, kind, streaks=(), env=None, blotches=(), damp=0.0, dirt=None):
    """Bake vertex colours, UVs, return the object."""
    if not NOAO:
        if kind in ("ground", "upper"):
            e = env_storey(kind)
            d, std = make_dirt(kind, streaks, blotches, damp)
            G.bake_colours(mb, env=e, std_env=e, dirt=d, std_dirt=std)
        else:
            G.bake_colours(mb, env=env, std_env=None, dirt=dirt)
    G.box_uvs(mb)
    obj = G.to_object(mb, common.get_collection(COLL), material)
    return obj


def material(name):
    return common.mat(name)


def wall(mb, holes=(), z0=0.0, streaks=(), extra_x=(), extra_z=()):
    """Main wall face. Thin rows next to the creases (above the plinth / ledge below, under the ledge)
    keep the contact darkening a crisp band instead of a 0.28 m gradient."""
    sx, sz = streak_lines(streaks)
    crease = [z0 + 0.07, LEDGE_Z0 - 0.08]
    mb.wall_grid(-1.0, 1.0, z0, LEDGE_Z0, list(holes), extra_x=list(extra_x) + sx,
                 extra_z=list(extra_z) + sz + crease)


# ───────────────────────────── upper storey modules ─────────────────────────────


def build_u_plain():
    rng = random.Random(11)
    mb = G.MB("fac_u_plain")
    streaks = [(-0.66, -0.42, 2.22, 1.0, 0.30), (0.26, 0.64, 1.74, 0.8, 0.16), (-0.2, 0.15, 0.55, 0.55, 0.10),
               (0.1, 0.24, 2.86, 0.9, 0.16)]
    blotches = [(0.35, 0.95, 0.32, 0.28, 0.12), (-0.45, 2.45, 0.3, 0.22, 0.1)]
    wall(mb, [], streaks=streaks)
    add_ledge(mb)
    # paint peeled off: grey render showing through (rough-edged)
    mb.face_front(rough_rect(-0.72, 0.08, 0.62, 1.46, rng, j=0.035), -0.003, "M_Concrete")
    mb.face_front(rough_rect(-0.62, -0.3, 0.7, 1.0, rng, step=0.08, j=0.02), -0.0055, "M_ConcreteDark")
    brick_patch(mb, 0.45, 1.98, 0.5, 0.42, rng)
    crack(mb, [(0.3, 1.78), (0.24, 1.6), (0.27, 1.42), (0.18, 1.25), (0.2, 1.1)])
    crack(mb, [(-0.05, 2.84), (0.02, 2.66), (-0.03, 2.5)], width=0.012)
    # small exhaust grille with a hood + rust run-off
    gx, gz = -0.54, 2.33
    mb.box((gx - 0.13, -0.035, gz - 0.11), (gx + 0.13, 0.0, gz + 0.11), "M_MetalGalv", skip="+y", chamfer=0.006)
    for i in range(4):
        z = gz - 0.075 + i * 0.05
        mb.box((gx - 0.11, -0.05, z - 0.008), (gx + 0.11, -0.035, z + 0.008), "M_MetalDark", skip="+y")
    mb.box((gx - 0.15, -0.09, gz + 0.11), (gx + 0.15, 0.0, gz + 0.135), "M_MetalGalv", skip="+y", chamfer=0.004)
    streak_decal(mb, gx, gz - 0.115, 0.12, 0.55, rng)
    # riveted patch plate over an old hole
    mb.box((0.28, -0.007, 0.6), (0.68, 0.0, 0.92), "M_MetalRust", skip="+y", chamfer=0.003)
    for x, z in ((0.31, 0.63), (0.65, 0.63), (0.31, 0.89), (0.65, 0.89)):
        bolt(mb, x, z, -0.007, s=0.016)
    # conduit + junction box
    mb.box((-0.1, -0.055, 2.16), (0.04, 0.0, 2.3), "M_PlasticLight", skip="+y", chamfer=0.006)
    conduit(mb, [(-0.03, -0.028, 2.3), (-0.03, -0.028, 2.87)], 0.014, "M_PlasticLight")
    conduit(mb, [(-0.1, -0.028, 2.23), (-0.4, -0.028, 2.23), (-0.4, -0.028, 2.23 + 0.001)], 0.012, "M_PlasticLight")
    return finish(mb, "upper", streaks, blotches=blotches)


def window_unit(mb, rng, lit):
    x0, x1, z0, z1, dep = -0.45, 0.45, 0.95, 2.25, 0.16
    mb.reveal(x0, x1, z0, z1, dep, "M_Wall", sides="l r t")
    mb.face([(x0, 0, z0), (x1, 0, z0), (x1, dep, z0), (x0, dep, z0)], "M_Concrete", normal=(0, 0, 1))
    frame(mb, x0, x1, z0, z1, dep - 0.05, dep - 0.004, mull_x=(0.0,), trans_z=(1.93,))
    gy = dep - 0.002
    if lit:
        glass(mb, x0, x1, z0, z1, gy, "M_WindowLit")
        # light curtain drawn over the left pane + a valance
        mb.face_front([(x0, z0 + 0.05), (x0 + 0.3, z0 + 0.05), (x0 + 0.26, 1.92), (x0, 1.92)], gy - 0.006,
                      "M_Paper", tag=G.T_FLAT)
        mb.face_front([(x0, 1.86), (x1, 1.86), (x1, 1.93), (x0, 1.93)], gy - 0.0095, "M_TarpOrange", tag=G.T_FLAT)
    else:
        glass(mb, x0, x1, z0, z1, gy, "M_Glass")
        mb.face_front([(0.02, z0 + 0.04), (x1 - 0.02, z0 + 0.04), (x1 - 0.02, 1.9), (0.05, 1.9)], gy - 0.006,
                      "M_TarpBlue", tag=G.T_AO)
    sill(mb, -0.56, 0.56, z0, out=0.07)
    cage(mb, -0.57, 0.57, z0, 2.36, 0.25, rng, roof_mat=("M_MetalGalv" if lit else "M_MetalRust"))
    return [(-0.56, -0.38, z0 - 0.26, 0.75, 0.30), (0.36, 0.56, z0 - 0.26, 0.6, 0.22)]


def build_u_window(lit=False):
    rng = random.Random(23)
    mb = G.MB("fac_u_window_lit" if lit else "fac_u_window")
    streaks = window_unit(mb, rng, lit) + [(-0.2, 0.06, 2.86, 0.38, 0.16), (0.62, 0.74, 2.86, 1.1, 0.12)]
    blotches = [(0.68, 0.6, 0.22, 0.4, 0.12), (-0.7, 2.2, 0.2, 0.35, 0.08)]
    wall(mb, [(-0.45, 0.45, 0.95, 2.25)], streaks=streaks)
    add_ledge(mb)
    streak_decal(mb, -0.47, 0.68, 0.05, 0.42, rng)
    if lit:
        crack(mb, [(0.62, 0.62), (0.7, 0.45), (0.66, 0.3)])
    else:
        brick_patch(mb, 0.68, 0.42, 0.3, 0.26, rng)
    return finish(mb, "upper", streaks, blotches=blotches)


def build_u_balcony():
    rng = random.Random(31)
    mb = G.MB("fac_u_balcony")
    x0, x1, z0, z1, dep = -0.66, 0.66, 0.12, 2.32, 0.22
    streaks = [(-0.8, -0.68, 2.86, 0.7, 0.16), (0.68, 0.78, 2.86, 0.45, 0.12)]
    wall(mb, [(x0, x1, z0, z1)], streaks=streaks)
    add_ledge(mb)
    mb.reveal(x0, x1, z0, z1, dep, "M_Wall", sides="l r t")
    # loggia back wall with a door and a window
    dx0, dx1, dz1 = -0.56, -0.06, 2.12
    wx0, wx1, wz0, wz1 = 0.04, 0.56, 0.95, 1.98
    back = G.MB("tmp")
    back.wall_grid(x0, x1, z0, z1, [(dx0, dx1, z0, dz1), (wx0, wx1, wz0, wz1)], y=dep, step_x=0.33, step_z=0.4,
                   tag=G.T_AO)
    mb.merge(back.bm, "M_Wall")
    back.bm.free()
    mb.reveal(dx0, dx1, z0, dz1, 0.02, "M_Wall", sides="l r t", y0=dep)
    mb.reveal(wx0, wx1, wz0, wz1, 0.02, "M_Wall", sides="l r t b", y0=dep)
    yd = dep + 0.02
    mb.face_front([(dx0, z0), (dx1, z0), (dx1, dz1), (dx0, dz1)], yd, "M_MetalTeal")
    glass(mb, dx0 + 0.1, dx1 - 0.1, 1.35, 1.95, yd - 0.004)
    mb.box((dx1 - 0.09, yd - 0.03, 1.05), (dx1 - 0.06, yd, 1.17), "M_MetalSteel", skip="+y")
    mb.face_front([(dx0 + 0.04, z0 + 0.02), (dx0 + 0.2, z0 + 0.02), (dx0 + 0.16, 0.42), (dx0 + 0.04, 0.5)],
                  yd - 0.002, "M_MetalRust")
    glass(mb, wx0, wx1, wz0, wz1, yd)
    frame(mb, wx0, wx1, wz0, wz1, yd - 0.035, yd - 0.002, fw=0.035, mull_x=(0.30,))
    # balcony slab (floor of the loggia + projecting part)
    mb.box((-0.78, -0.285, 0.0), (0.78, dep, 0.12), "M_Concrete", skip="+y -z", chamfer=0.012,
           cham_keys={"-y", "-x", "+x"})
    # corrugated painted balustrade + side sheets + rail + posts
    yb = -0.268
    corrugated(mb, -0.75, 0.75, (0, yb, 0.12), (0, yb, 0.92), (0, -1, 0), 0.009, 0.075, "M_MetalTeal")
    for xs in (-0.76, 0.75):
        mb.box((xs, yb, 0.12), (xs + 0.01, -0.004, 0.92), "M_MetalTeal")
    for xs in (-0.775, 0.745):
        mb.box((xs, yb - 0.012, 0.12), (xs + 0.03, yb + 0.018, 2.02), "M_MetalDark", skip="-z")
    mb.cyl((-0.79, yb, 0.93), (0.79, yb, 0.93), 0.02, "M_MetalDark", seg=8, cap0=True)
    for xs in (-0.76, 0.76):
        mb.cyl((xs, yb, 0.93), (xs, -0.004, 0.93), 0.016, "M_MetalDark", seg=6, cap0=False, cap1=False)
    mb.face_front([(0.1, 0.25), (0.42, 0.21), (0.46, 0.55), (0.12, 0.6)], yb - 0.012, "M_MetalRust")
    # laundry pole and clothes
    yl = -0.2
    mb.cyl((-0.76, yl, 1.98), (0.76, yl, 1.98), 0.011, "M_MetalSteel", seg=6, cap0=False, cap1=False)
    for xs in (-0.76, 0.76):
        mb.cyl((xs, yb, 1.98), (xs, yl, 1.98), 0.011, "M_MetalSteel", seg=6, cap0=False, cap1=False)
    # shirt
    sx, top = -0.45, 1.97
    shirt = [(sx - 0.08, top), (sx + 0.08, top), (sx + 0.2, top - 0.08), (sx + 0.16, top - 0.15),
             (sx + 0.11, top - 0.12), (sx + 0.11, top - 0.52), (sx - 0.11, top - 0.52), (sx - 0.11, top - 0.12),
             (sx - 0.16, top - 0.15), (sx - 0.2, top - 0.08)]
    mb.face_front(shirt, yl - 0.004, "M_TarpOrange")
    mb.face_front([(-0.12, top), (0.12, top), (0.13, top - 0.62), (-0.11, top - 0.6)], yl + 0.003, "M_Paper")
    mb.face_front([(0.22, top), (0.5, top), (0.49, top - 0.44), (0.36, top - 0.44), (0.36, top - 0.2),
                   (0.34, top - 0.44), (0.23, top - 0.44)], yl - 0.002, "M_TarpBlue")
    # potted plant peeking over the balustrade
    mb.cyl((0.55, -0.12, 0.12), (0.55, -0.12, 0.55), 0.09, "M_PlasticDark", seg=8, r1=0.11, cap1=False)
    mb.blob((0.55, -0.12, 0.8), (0.17, 0.12, 0.3), "M_Plant", rng, rough=0.28)
    mb.blob((0.47, -0.1, 0.95), (0.09, 0.08, 0.16), "M_PlantDark", rng, rough=0.3)
    return finish(mb, "upper", streaks)


def build_u_ac():
    rng = random.Random(41)
    mb = G.MB("fac_u_ac")
    x0, x1, z0, z1, dep = -0.72, -0.14, 1.28, 2.18, 0.13
    streaks = [(0.6, 0.78, 0.94, 0.95, 0.34), (-0.8, -0.58, 1.22, 0.65, 0.22), (-0.5, -0.36, 2.86, 0.6, 0.14)]
    blotches = [(0.42, 0.75, 0.36, 0.3, 0.12), (-0.4, 0.6, 0.3, 0.35, 0.08)]
    wall(mb, [(x0, x1, z0, z1)], streaks=streaks)
    add_ledge(mb)
    mb.reveal(x0, x1, z0, z1, dep, "M_Wall", sides="l r t")
    mb.face([(x0, 0, z0), (x1, 0, z0), (x1, dep, z0), (x0, dep, z0)], "M_Concrete", normal=(0, 0, 1))
    glass(mb, x0, x1, z0, z1, dep - 0.002)
    mb.face_front([(x0 + 0.03, z0 + 0.03), (-0.43, z0 + 0.03), (-0.43, z1 - 0.03), (x0 + 0.03, z1 - 0.03)],
                  dep - 0.008, "M_PlasticLight", tag=G.T_AO)
    frame(mb, x0, x1, z0, z1, dep - 0.045, dep - 0.004, fw=0.04, mull_x=(-0.43,))
    sill(mb, -0.8, -0.06, z0, out=0.07)
    # flat bars in front of the window
    for i in range(1, 6):
        x = x0 + (x1 - x0) * i / 6
        mb.box((x - 0.008, -0.04, z0 + 0.01), (x + 0.008, -0.022, z1 - 0.01), "M_MetalDark", skip="-z +z")
    for z in (z0 + 0.04, (z0 + z1) / 2, z1 - 0.04):
        mb.box((x0 - 0.03, -0.05, z - 0.012), (x1 + 0.03, -0.04, z + 0.012), "M_MetalDark", skip="+y")
        for x in (x0 - 0.03, x1 + 0.02):
            mb.box((x, -0.04, z - 0.012), (x + 0.01, 0.0, z + 0.012), "M_MetalDark", skip="+y -y")
    # air conditioner on brackets
    ax0, ax1, az0, az1, ay0, ay1 = 0.02, 0.8, 0.96, 1.5, -0.285, -0.035
    mb.box((ax0, ay0, az0), (ax1, ay1, az1), "M_PlasticLight", skip="+y", chamfer=0.018)
    fx, fz, fr = 0.55, 1.23, 0.19
    pts = [(fx + math.cos(a) * fr, fz + math.sin(a) * fr) for a in [2 * math.pi * i / 16 for i in range(16)]]
    mb.face_front(pts, ay0 - 0.002, "M_PlasticDark")
    mb.face_front([(fx + math.cos(a) * 0.05, fz + math.sin(a) * 0.05) for a in [2 * math.pi * i / 8 for i in range(8)]],
                  ay0 - 0.012, "M_PlasticLight")
    for ang in (0.0, 90.0):
        c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        w, l = 0.012, fr * 0.98
        rect = [(-l, -w), (l, -w), (l, w), (-l, w)]
        mb.face_front([(fx + px * c - pz * s, fz + px * s + pz * c) for px, pz in rect], ay0 - 0.008, "M_PlasticLight")
    for i in range(6):
        z = 1.06 + i * 0.06
        mb.face_front([(0.08, z), (0.3, z), (0.3, z + 0.02), (0.08, z + 0.02)], ay0 - 0.002, "M_PlasticDark")
    mb.face([(0.1, ay0 + 0.04, az1 + 0.002), (0.32, ay0 + 0.04, az1 + 0.002), (0.3, ay0 + 0.16, az1 + 0.002),
             (0.12, ay0 + 0.17, az1 + 0.002)], "M_PlasterRust", normal=(0, 0, 1))
    for bx in (0.1, 0.7):
        mb.box((bx - 0.015, -0.29, az0 - 0.035), (bx + 0.015, 0.0, az0), "M_MetalRust", skip="+y")
        mb.cyl((bx, -0.004, az0 - 0.3), (bx, -0.27, az0 - 0.03), 0.012, "M_MetalRust", seg=4, cap0=False,
               cap1=False, smooth=False)
        mb.box((bx - 0.03, -0.012, az0 - 0.34), (bx + 0.03, 0.0, az0 - 0.25), "M_MetalRust", skip="+y")
    # refrigerant pipes into the wall + condensate drain
    conduit(mb, [(ax0 + 0.02, -0.15, 1.36), (-0.06, -0.15, 1.36), (-0.06, -0.15, 1.08), (-0.06, 0.0, 1.08)], 0.018,
            "M_PlasticLight")
    conduit(mb, [(0.72, -0.12, az0), (0.72, -0.12, 0.62)], 0.009, "M_PlasticDark")
    streak_decal(mb, 0.72, 0.6, 0.06, 0.5, rng)
    streak_decal(mb, 0.1, 0.6, 0.04, 0.3, rng)
    return finish(mb, "upper", streaks, blotches=blotches)


def build_u_pipes():
    rng = random.Random(53)
    mb = G.MB("fac_u_pipes")
    wx0, wx1, wz0, wz1, dep = 0.24, 0.72, 1.8, 2.36, 0.12
    streaks = [(-0.56, -0.36, 1.25, 0.8, 0.28), (0.22, 0.68, 0.72, 0.6, 0.2), (0.22, 0.74, 1.74, 0.4, 0.12),
               (-0.3, -0.14, 2.86, 0.5, 0.18)]
    blotches = [(-0.38, 2.0, 0.28, 0.6, 0.12), (0.5, 0.35, 0.3, 0.25, 0.1)]
    wall(mb, [(wx0, wx1, wz0, wz1)], streaks=streaks)
    add_ledge(mb)
    mb.reveal(wx0, wx1, wz0, wz1, dep, "M_Wall", sides="l r t")
    mb.face([(wx0, 0, wz0), (wx1, 0, wz0), (wx1, dep, wz0), (wx0, dep, wz0)], "M_Concrete", normal=(0, 0, 1))
    glass(mb, wx0, wx1, wz0, wz1, dep - 0.002)
    for i in range(5):  # louvre blades
        z = wz0 + 0.06 + i * 0.1
        mb.box((wx0 + 0.02, dep - 0.05, z), (wx1 - 0.02, dep - 0.02, z + 0.03), "M_MetalGalv", skip="-x +x",
               M=None)
    frame(mb, wx0, wx1, wz0, wz1, dep - 0.055, dep - 0.004, fw=0.035)
    sill(mb, wx0 - 0.06, wx1 + 0.06, wz0, out=0.06)
    for i in range(1, 4):
        x = wx0 + (wx1 - wx0) * i / 4
        mb.box((x - 0.008, -0.035, wz0 + 0.01), (x + 0.008, -0.019, wz1 - 0.01), "M_MetalDark", skip="-z +z")
    # main downpipe (galvanised) through the ledge, clamps, branch into the wall
    p1x, p1y, p1r = -0.46, -0.1, 0.062
    mb.cyl((p1x, p1y, 0.0), (p1x, p1y, 3.0), p1r, "M_MetalGalv", seg=10, cap1=True)
    for z in (0.45, 1.6, 2.6):
        mb.cyl((p1x, p1y, z), (p1x, p1y, z + 0.05), p1r + 0.008, "M_MetalDark", seg=10, cap0=True)
        mb.box((p1x - 0.02, -0.04, z + 0.005), (p1x + 0.02, 0.0, z + 0.045), "M_MetalDark", skip="+y")
    mb.cyl((p1x, p1y, 1.3), (p1x, 0.0, 1.3), 0.045, "M_MetalGalv", seg=8, cap0=False, cap1=False)
    mb.cyl((p1x, p1y + 0.03, 1.3), (p1x, 0.0, 1.3), 0.055, "M_MetalDark", seg=8, cap0=True, cap1=False)
    # second pipe (PVC) that turns into the wall below the ledge
    p2x, p2y, p2r = -0.22, -0.075, 0.042
    mb.cyl((p2x, p2y, 0.0), (p2x, p2y, 2.48), p2r, "M_PlasticLight", seg=8, cap1=False)
    mb.cyl((p2x, p2y - 0.006, 2.44), (p2x, p2y - 0.006, 2.56), p2r + 0.008, "M_PlasticLight", seg=8, cap0=True,
           cap1=True)
    mb.cyl((p2x, p2y, 2.5), (p2x, 0.0, 2.5), p2r, "M_PlasticLight", seg=8, cap0=False, cap1=False)
    for z in (0.9, 2.0):
        mb.cyl((p2x, p2y, z), (p2x, p2y, z + 0.04), p2r + 0.007, "M_MetalDark", seg=8, cap0=True)
    # two cables
    for cx in (-0.06, -0.03):
        mb.cyl((cx, -0.022, 0.0), (cx, -0.022, 2.86), 0.008, "M_Cable", seg=5, cap1=False)
    for z in (0.7, 1.7, 2.5):
        mb.box((-0.08, -0.034, z), (-0.01, 0.0, z + 0.025), "M_MetalDark", skip="+y")
    # meter box
    mb.box((0.25, -0.12, 0.72), (0.66, 0.0, 1.28), "M_MetalGalv", skip="+y", chamfer=0.01)
    mb.face_front([(0.452, 0.76), (0.458, 0.76), (0.458, 1.24), (0.452, 1.24)], -0.1225, "M_MetalDark")
    glass(mb, 0.3, 0.42, 1.08, 1.2, -0.1225)
    mb.box((0.6, -0.14, 0.98), (0.625, -0.12, 1.04), "M_MetalSteel", skip="+y")
    conduit(mb, [(0.33, -0.05, 0.72), (0.33, -0.05, 0.3), (0.33, 0.0, 0.3)], 0.016, "M_PlasticDark")
    conduit(mb, [(0.58, -0.05, 1.28), (0.58, -0.05, 1.62), (0.84, -0.05, 1.62), (0.84, 0.0, 1.62)], 0.014,
            "M_PlasticDark")
    streak_decal(mb, p1x, 1.24, 0.05, 0.55, rng)
    return finish(mb, "upper", streaks, blotches=blotches)


# ───────────────────────────── ground storey modules ─────────────────────────────


def build_g_plain():
    rng = random.Random(61)
    mb = G.MB("fac_g_plain")
    vx0, vx1, vz0, vz1 = -0.74, -0.46, 0.42, 0.62
    streaks = [(0.32, 0.68, 1.5, 0.75, 0.22), (-0.62, -0.1, 2.0, 0.5, 0.1)]
    wall(mb, [(vx0, vx1, vz0, vz1)], z0=PLINTH_Z, streaks=streaks)
    add_ledge(mb)
    add_plinth(mb, -1.0, 1.0)
    # low barred vent
    mb.reveal(vx0, vx1, vz0, vz1, 0.08, "M_ConcreteDark")
    mb.face_front([(vx0, vz0), (vx1, vz0), (vx1, vz1), (vx0, vz1)], 0.08, "M_Rubber", tag=G.T_FLAT)
    for i in range(1, 4):
        x = vx0 + (vx1 - vx0) * i / 4
        mb.box((x - 0.008, 0.0, vz0), (x + 0.008, 0.016, vz1), "M_MetalRust", skip="-z +z")
    # posters
    poster(mb, -0.42, 1.5, 0.34, 0.48, -3, "M_Paper", -0.0045, rng)
    poster(mb, -0.15, 1.42, 0.3, 0.42, 4, "M_TarpOrange", -0.0068, rng, torn=True)
    poster(mb, -0.5, 1.12, 0.28, 0.2, 2, "M_PlasticLight", -0.009, rng)
    poster(mb, -0.36, 1.75, 0.2, 0.12, -6, "M_MetalRed", -0.0112, rng)
    brick_patch(mb, -0.6, 2.32, 0.42, 0.3, rng)
    crack(mb, [(0.6, 0.93), (0.66, 1.1), (0.62, 1.22)])
    # corrugated sheet screwed over a hole in the wall, a little skewed
    sx0, sx1, sz0, sz1 = -0.34, 0.24, 0.36, 1.0
    Ms = Matrix.Translation(((sx0 + sx1) / 2, 0, (sz0 + sz1) / 2)) @ Matrix.Rotation(math.radians(-3), 4, "Y")
    sheet = G.MB("tmp")
    hw, hh = (sx1 - sx0) / 2, (sz1 - sz0) / 2
    corrugated(sheet, -hw, hw, (0, -0.02, -hh), (0, -0.02, hh), (0, -1, 0), 0.0075, 0.066, "M_MetalGalv")
    sheet.box((-hw, -0.03, hh - 0.012), (hw, -0.012, hh), "M_MetalGalv", skip="+y")
    mb.merge(sheet.bm, "M_MetalGalv", M=Ms)
    sheet.bm.free()
    rust = G.MB("tmp")
    rust.face_front([(-hw + 0.02, -hh), (0.05, -hh), (-0.02, -hh + 0.2), (-hw + 0.03, -hh + 0.3)], -0.031, "M_MetalRust")
    mb.merge(rust.bm, "M_MetalRust", M=Ms)
    rust.bm.free()
    for bx, bz in ((-hw + 0.04, -hh + 0.05), (hw - 0.04, -hh + 0.05), (-hw + 0.04, hh - 0.05), (hw - 0.04, hh - 0.05)):
        p = Ms @ V((bx, -0.03, bz))
        bolt(mb, p.x, p.z, -0.03, s=0.02)
    # electrical box, conduit up into the ledge, cable down
    mb.box((0.34, -0.09, 1.5), (0.66, 0.0, 1.92), "M_MetalDark", skip="+y", chamfer=0.01)
    mb.face_front([(0.38, 1.82), (0.48, 1.82), (0.48, 1.88), (0.38, 1.88)], -0.092, "M_MetalYellow")
    conduit(mb, [(0.42, -0.03, 1.92), (0.42, -0.03, 2.87)], 0.018, "M_PlasticDark")
    conduit(mb, [(0.58, -0.03, 1.92), (0.58, -0.03, 2.87)], 0.012, "M_MetalGalv")
    conduit(mb, [(0.5, -0.035, 1.5), (0.5, -0.035, 1.3), (0.85, -0.035, 1.3), (0.85, 0.0, 1.3)], 0.01, "M_Cable")
    return finish(mb, "ground", streaks, blotches=[(0.0, 2.3, 0.4, 0.3, 0.1)], damp=0.2)


def build_g_door():
    rng = random.Random(71)
    mb = G.MB("fac_g_door")
    x0, x1, z1, dep, zt = -0.5, 0.5, 2.5, 0.2, 0.12
    streaks = [(-0.74, -0.58, 2.555, 0.65, 0.22), (0.58, 0.74, 2.555, 0.55, 0.18)]
    wall(mb, [(x0, x1, 0.0, z1)], z0=PLINTH_Z, streaks=streaks)
    add_ledge(mb)
    add_plinth(mb, -1.0, x0, cap1=True)
    add_plinth(mb, x1, 1.0, cap0=True)
    mb.reveal(x0, x1, zt, z1, dep, "M_Wall", sides="l r t")
    mb.face([(x0, 0, zt), (x1, 0, zt), (x1, dep, zt), (x0, dep, zt)], "M_Concrete", normal=(0, 0, 1))
    # reveal sides below the threshold are hidden by the step; close them anyway
    mb.box((-0.62, -0.26, 0.0), (0.62, 0.0, zt), "M_Concrete", skip="+y -z", chamfer=0.012, cham_keys={"+z"})
    # frame, door leaf, transom
    fm = "M_MetalDark"
    mb.box((x0, dep - 0.05, zt), (x0 + 0.05, dep, z1), fm, skip="+y")
    mb.box((x1 - 0.05, dep - 0.05, zt), (x1, dep, z1), fm, skip="+y")
    mb.box((x0 + 0.05, dep - 0.05, 2.15), (x1 - 0.05, dep, 2.2), fm, skip="+y -x +x")
    mb.box((x0 + 0.05, dep - 0.05, z1 - 0.04), (x1 - 0.05, dep, z1), fm, skip="+y -x +x")
    yd = dep - 0.03
    dx0, dx1 = x0 + 0.05, x1 - 0.05
    mb.face_front([(dx0, zt), (dx1, zt), (dx1, 2.15), (dx0, 2.15)], yd, "M_MetalTeal")
    for (px0, px1, pz0, pz1) in ((dx0 + 0.07, dx1 - 0.07, 0.3, 1.0), (dx0 + 0.07, dx1 - 0.07, 1.12, 1.4)):
        t = 0.02
        for b in ((px0, px1, pz0, pz0 + t), (px0, px1, pz1 - t, pz1), (px0, px0 + t, pz0 + t, pz1 - t),
                  (px1 - t, px1, pz0 + t, pz1 - t)):
            mb.box((b[0], yd - 0.012, b[2]), (b[1], yd, b[3]), "M_MetalTeal", skip="+y")
    glass(mb, dx0 + 0.16, dx1 - 0.16, 1.55, 1.85, yd - 0.001)
    for i in range(1, 4):
        x = dx0 + 0.16 + (dx1 - dx0 - 0.32) * i / 4
        mb.box((x - 0.007, yd - 0.016, 1.55), (x + 0.007, yd, 1.85), fm, skip="+y -z +z")
    mb.box((dx1 - 0.1, yd - 0.05, 1.02), (dx1 - 0.07, yd, 1.1), "M_MetalSteel", skip="+y")
    mb.box((dx1 - 0.2, yd - 0.06, 1.05), (dx1 - 0.07, yd - 0.04, 1.075), "M_MetalSteel")
    mb.face_front([(dx0, zt), (dx1, zt), (dx1, zt + 0.18), (dx0, zt + 0.18)], yd - 0.003, "M_MetalSteel")
    mb.face_front([(dx0 + 0.02, zt + 0.19), (dx0 + 0.22, zt + 0.19), (dx0 + 0.12, 0.62), (dx0 + 0.02, 0.7)],
                  yd - 0.002, "M_MetalRust")
    mb.face_front([(dx1 - 0.18, 1.86), (dx1 - 0.02, 1.9), (dx1 - 0.02, 2.13), (dx1 - 0.25, 2.13)], yd - 0.002,
                  "M_MetalRust")
    glass(mb, x0 + 0.05, x1 - 0.05, 2.2, z1 - 0.04, dep - 0.004, "M_WindowLit")
    for i in range(1, 6):
        x = x0 + 0.05 + (x1 - x0 - 0.1) * i / 6
        mb.box((x - 0.008, dep - 0.04, 2.2), (x + 0.008, dep - 0.024, z1 - 0.04), fm, skip="+y -z +z")
    # concrete canopy over the door
    hood(mb, -0.74, 0.74, 2.56, out=0.28, th=0.08)
    for xs in (-0.6, 0.6):
        mb.box((xs - 0.015, -0.2, 2.47), (xs + 0.015, 0.0, 2.56), "M_MetalDark", skip="+y +z")
    # wall furniture: mailbox, intercom, number plate, meter cable
    mb.box((-0.84, -0.1, 1.0), (-0.62, 0.0, 1.3), "M_MetalRed", skip="+y", chamfer=0.008)
    mb.face_front([(-0.8, 1.22), (-0.66, 1.22), (-0.66, 1.24), (-0.8, 1.24)], -0.101, "M_MetalDark")
    mb.box((0.6, -0.035, 1.22), (0.74, 0.0, 1.46), "M_MetalSteel", skip="+y", chamfer=0.005)
    for z in (1.27, 1.31, 1.35):
        mb.face_front([(0.63, z), (0.71, z), (0.71, z + 0.02), (0.63, z + 0.02)], -0.0365, "M_PlasticDark")
    mb.box((-0.74, -0.012, 1.76), (-0.6, 0.0, 1.86), "M_PlasticLight", skip="+y", chamfer=0.003)
    conduit(mb, [(0.67, -0.02, 1.46), (0.67, -0.02, 2.48)], 0.009, "M_Cable")
    return finish(mb, "ground", streaks, damp=0.12)


def build_g_shutter():
    rng = random.Random(83)
    mb = G.MB("fac_g_shutter")
    x0, x1, z1 = -0.78, 0.78, 2.3
    streaks = []
    wall(mb, [(x0, x1, 0.0, z1)], z0=PLINTH_Z)
    add_ledge(mb)
    add_plinth(mb, -1.0, x0, cap1=True)
    add_plinth(mb, x1, 1.0, cap0=True)
    mb.reveal(x0, x1, 0.0, z1, 0.11, "M_Wall", sides="l r t")
    mb.face([(x0, 0, 0.012), (x1, 0, 0.012), (x1, 0.11, 0.012), (x0, 0.11, 0.012)], "M_ConcreteDark", normal=(0, 0, 1))
    # rails
    for xa in (x0, x1 - 0.045):
        mb.box((xa, 0.035, 0.0), (xa + 0.045, 0.11, z1), "M_MetalDark", skip="+y -z +z")
    # slats: shallow V profile, a few replaced/rusted
    ys, n, zb = 0.095, 24, 0.075
    hgt = (z1 - zb) / n
    special = {0: "M_MetalRust", 1: "M_MetalRust", 3: "M_MetalRust", 9: "M_MetalSteel", 17: "M_MetalRust"}
    for i in range(n):
        za = zb + i * hgt
        m = special.get(i, "M_MetalGalv")
        mb.sweep([(-ys, za), (-ys + 0.014, za + hgt * 0.5), (-ys, za + hgt)], (x0 + 0.045, 0, 0), (x1 - 0.045, 0, 0),
                 (0, 0, 1), m, normals=[(0.8, -0.6), (0.8, 0.6)])
    mb.box((x0 + 0.045, 0.06, 0.012), (x1 - 0.045, 0.1, zb), "M_MetalDark", skip="+y -z", chamfer=0.005)
    for hx in (-0.5, 0.5):
        mb.box((hx - 0.05, 0.035, 0.035), (hx + 0.05, 0.06, 0.06), "M_MetalSteel", skip="+y")
    mb.box((-0.04, 0.02, 0.0), (0.04, 0.05, 0.075), "M_MetalSteel", skip="-z", chamfer=0.006)
    mb.box((-0.025, 0.035, 0.075), (0.025, 0.045, 0.1), "M_MetalSteel", skip="-z")
    # a torn notice on the shutter, a small painted tag
    ysf = 0.095 - 0.0145
    poster(mb, 0.42, 1.28, 0.22, 0.3, 3, "M_Paper", ysf - 0.003, rng, torn=True)
    for (ax, az, bx, bz) in ((-0.58, 0.42, -0.36, 0.5), (-0.52, 0.36, -0.44, 0.58)):
        dx, dz = bx - ax, bz - az
        ln = math.hypot(dx, dz)
        nx, nz = -dz / ln * 0.014, dx / ln * 0.014
        mb.face_front([(ax - nx, az - nz), (bx - nx, bz - nz), (bx + nx, bz + nz), (ax + nx, az + nz)], ysf - 0.004,
                      "M_MetalRed")
    # coil housing
    prof = [(0.0, 2.68), (0.155, 2.68), (0.175, 2.66), (0.175, 2.43), (0.125, 2.3), (0.0, 2.3)]
    mb.sweep(prof, (-0.86, 0, 0), (0.86, 0, 0), (0, 0, 1), "M_MetalGalv")
    for xs, nx in ((-0.86, -1), (0.86, 1)):
        mb.face([(xs, -s, z) for s, z in prof], "M_MetalGalv", normal=(nx, 0, 0))
    mb.face([(-0.7, -0.08, 2.682), (-0.3, -0.06, 2.682), (-0.35, -0.01, 2.682), (-0.72, -0.02, 2.682)],
            "M_MetalRust", normal=(0, 0, 1))
    return finish(mb, "ground", streaks, damp=0.1)


def build_g_window():
    mb = G.MB("fac_g_window")
    x0, x1, z0, z1, dep = -0.7, 0.7, 0.78, 2.2, 0.14
    streaks = [(-0.8, -0.6, 0.72, 0.4, 0.26), (0.55, 0.8, 0.72, 0.4, 0.2), (-0.82, -0.66, 2.3, 0.5, 0.2)]
    wall(mb, [(x0, x1, z0, z1)], z0=PLINTH_Z, streaks=streaks)
    add_ledge(mb)
    add_plinth(mb, -1.0, 1.0)
    mb.reveal(x0, x1, z0, z1, dep, "M_Wall", sides="l r t")
    mb.face([(x0, 0, z0), (x1, 0, z0), (x1, dep, z0), (x0, dep, z0)], "M_Concrete", normal=(0, 0, 1))
    # lit shop interior: back light, one shelf of big boxes, a counter, a roller blind two-thirds up
    # (few large silhouettes: many small goods behind a grille read as barcode noise from the camera)
    glass(mb, x0, x1, z0, z1, dep, "M_WindowLitCool")
    zs = 1.24
    mb.box((x0, 0.095, zs - 0.025), (x1, dep - 0.002, zs), "M_Wood", skip="+y -x +x")
    for xa, w, h, m in ((-0.64, 0.3, 0.3, "M_Wood"), (-0.3, 0.18, 0.22, "M_PlasticDark"),
                        (0.0, 0.26, 0.16, "M_MetalRed"), (0.34, 0.26, 0.28, "M_PlasticDark")):
        mb.box((xa, 0.1, zs), (xa + w, dep - 0.006, zs + h), m, skip="+y -z", chamfer=0.008)
    mb.box((x0, 0.088, 0.9), (x1, dep - 0.002, 0.97), "M_PlasticDark", skip="+y -x +x")
    for xa, w, h, m in ((-0.5, 0.2, 0.12, "M_PlasticLight"), (0.12, 0.16, 0.1, "M_TarpBlue")):
        mb.box((xa, 0.1, 0.97), (xa + w, dep - 0.006, 0.97 + h), m, skip="+y -z", chamfer=0.006)
    zb = 1.74
    mb.face_front([(x0, zb), (x1, zb), (x1, z1), (x0, z1)], 0.082, "M_PlasticLight")
    for z in (1.86, 1.98, 2.1):
        mb.box((x0, 0.0795, z - 0.006), (x1, 0.082, z), "M_Concrete", skip="-x +x +y")
    mb.box((x0, 0.074, zb - 0.03), (x1, 0.092, zb), "M_MetalDark", skip="-x +x +y")
    frame(mb, x0, x1, z0, z1, 0.05, 0.074, fw=0.045, mull_x=(0.0,))
    sill(mb, -0.82, 0.82, z0, out=0.08)
    # flat-bar grille: few bars, two rails
    n = 7
    for i in range(1, n):
        x = x0 + (x1 - x0) * i / n
        mb.box((x - 0.008, -0.04, z0 + 0.02), (x + 0.008, -0.026, z1 - 0.02), "M_MetalDark", skip="-z +z")
    for z in (z0 + 0.08, z1 - 0.08):
        mb.box((x0 - 0.04, -0.05, z - 0.013), (x1 + 0.04, -0.04, z + 0.013), "M_MetalDark", skip="+y")
        for x in (x0 - 0.04, x1 + 0.03):
            mb.box((x, -0.04, z - 0.013), (x + 0.01, 0.0, z + 0.013), "M_MetalDark", skip="+y -y")
    hood(mb, -0.84, 0.84, 2.3, out=0.24, th=0.07)
    return finish(mb, "ground", streaks, damp=0.15)


def build_g_vent():
    rng = random.Random(101)
    mb = G.MB("fac_g_vent")
    lx0, lx1, lz0, lz1 = -0.74, -0.08, 1.24, 2.24
    streaks = [(-0.72, -0.1, 1.2, 0.7, 0.26), (0.12, 0.72, 0.44, 0.12, 0.1)]
    wall(mb, [(lx0, lx1, lz0, lz1)], z0=PLINTH_Z, streaks=streaks)
    add_ledge(mb)
    add_plinth(mb, -1.0, 1.0)
    # louvre vent
    mb.reveal(lx0, lx1, lz0, lz1, 0.07, "M_ConcreteDark")
    mb.face_front([(lx0, lz0), (lx1, lz0), (lx1, lz1), (lx0, lz1)], 0.07, "M_Rubber", tag=G.T_FLAT)
    fw = 0.04
    for b in ((lx0 - fw, lx1 + fw, lz0 - fw, lz0), (lx0 - fw, lx1 + fw, lz1, lz1 + fw), (lx0 - fw, lx0, lz0, lz1),
              (lx1, lx1 + fw, lz0, lz1)):
        mb.box((b[0], -0.03, b[2]), (b[1], 0.0, b[3]), "M_MetalGalv", skip="+y", chamfer=0.005)
    nsl = 9
    for i in range(nsl):
        zc = lz0 + (lz1 - lz0) * (i + 0.5) / nsl
        M = Matrix.Translation((0, 0.02, zc)) @ Matrix.Rotation(math.radians(-40), 4, "X")
        mb.box((lx0, -0.05, -0.006), (lx1, 0.05, 0.006), "M_MetalGalv", skip="-x +x", M=M)
    zr = lz1 + fw + 0.0025
    mb.face([(lx0 + 0.05, -0.03, zr), (lx0 + 0.3, -0.03, zr), (lx0 + 0.3, -0.0, zr), (lx0 + 0.05, 0.0, zr)],
            "M_MetalRust", normal=(0, 0, 1))
    streak_decal(mb, -0.5, lz0 - fw, 0.14, 0.62, rng)
    streak_decal(mb, -0.22, lz0 - fw, 0.07, 0.4, rng)
    # meter cabinet with doors, vents, warning plate, lock
    cx0, cx1, cz0, cz1 = 0.12, 0.72, 0.46, 1.56
    mb.box((cx0, -0.2, cz0), (cx1, 0.0, cz1), "M_MetalGalv", skip="+y", chamfer=0.012)
    yf = -0.2025
    mb.face_front([(0.417, cz0 + 0.03), (0.423, cz0 + 0.03), (0.423, cz1 - 0.03), (0.417, cz1 - 0.03)], yf,
                  "M_MetalDark")
    for i in range(4):
        z = cz0 + 0.08 + i * 0.04
        for xa in (0.17, 0.47):
            mb.face_front([(xa, z), (xa + 0.2, z), (xa + 0.2, z + 0.015), (xa, z + 0.015)], yf, "M_MetalDark")
    mb.face_front([(0.2, 1.3), (0.34, 1.3), (0.34, 1.44), (0.2, 1.44)], yf, "M_MetalYellow")
    mb.face_front([(0.225, 1.32), (0.315, 1.32), (0.27, 1.41)], yf - 0.0025, "M_Rubber")
    mb.box((0.38, -0.225, 1.0), (0.4, -0.2, 1.08), "M_MetalSteel", skip="+y")
    mb.box((0.44, -0.225, 1.0), (0.46, -0.2, 1.08), "M_MetalSteel", skip="+y")
    mb.face([(0.2, -0.17, cz1 + 0.0025), (0.5, -0.15, cz1 + 0.0025), (0.46, -0.03, cz1 + 0.0025),
             (0.18, -0.04, cz1 + 0.0025)], "M_MetalRust", normal=(0, 0, 1))
    for cx, r, m in ((0.22, 0.02, "M_PlasticDark"), (0.32, 0.016, "M_PlasticDark"), (0.62, 0.024, "M_MetalGalv")):
        conduit(mb, [(cx, -0.06, cz1), (cx, -0.06, 2.87)], r, m)
    mb.cyl((0.5, -0.07, 0.0), (0.5, -0.07, cz0), 0.03, "M_MetalGalv", seg=8, cap1=False)
    mb.cyl((0.6, -0.06, 0.0), (0.6, -0.06, cz0), 0.018, "M_PlasticDark", seg=6, cap1=False)
    return finish(mb, "ground", streaks, blotches=[(-0.4, 0.7, 0.35, 0.3, 0.12)], damp=0.2)


# ───────────────────────────── corner, roof ─────────────────────────────


def build_corner():
    """Convex corner: +Z(three)/-Y(blender) wall runs toward -X, +X wall runs toward +Y; origin on the edge."""
    rng = random.Random(113)
    mb = G.MB("fac_corner")
    plan = [(-0.16, 0.0), (-0.16, -0.045), (0.03, -0.045), (0.045, -0.03), (0.045, 0.16), (0.0, 0.16)]
    zs = [0.0, 0.5, 1.0, 1.5, 2.0, 2.45, LEDGE_Z0]
    for i in range(len(plan) - 1):
        (ax, ay), (bx, by) = plan[i], plan[i + 1]
        n = V((by - ay, -(bx - ax), 0)).normalized()  # right-hand → outward for this winding
        for j in range(len(zs) - 1):
            mb.face([(ax, ay, zs[j]), (bx, by, zs[j]), (bx, by, zs[j + 1]), (ax, ay, zs[j + 1])], "M_Concrete",
                    normal=n)
    # ledge return: the ledge profile mitred round the corner (front frame d=-y, side frame d=x)
    side = lambda co, n: ledge_pre(V((co.y, -co.x, co.z)), V((n.y, -n.x, n.z)))  # noqa: E731
    prof = LEDGE_PROFILE
    for k in range(len(prof) - 1):
        (d0, z0), (d1, z1) = prof[k], prof[k + 1]
        fa = [(0, -d0, z0), (d0, -d0, z0), (d1, -d1, z1), (0, -d1, z1)]
        sa = [(d0, -d0, z0), (d0, 0, z0), (d1, 0, z1), (d1, -d1, z1)]
        for pts, pre, nrm in ((fa, ledge_pre, None), (sa, side, None)):
            uniq = []
            for p in pts:
                if not any((V(p) - V(q)).length < 1e-7 for q in uniq):
                    uniq.append(p)
            if len(uniq) < 3:
                continue
            f = mb.face(uniq, "M_Concrete", tag=G.T_PRESET, pre=pre)
            # outward: away from the corner block centre
            c = f.calc_center_median()
            ref = V((0.06, -0.06, 2.93))
            if (c - ref).dot(f.normal) < 0:
                f.normal_flip()
                f.normal_update()
                for loop in f.loops:
                    loop[mb.l_pre] = pre(loop.vert.co, f.normal)
    # wear: chipped arris showing brick, a stain run
    brick_patch(mb, -0.07, 1.25, 0.16, 0.3, rng, y=-0.0475)
    mb.face([(0.0475, 0.03, 0.4), (0.0475, 0.12, 0.38), (0.0475, 0.11, 0.62), (0.0475, 0.04, 0.66)],
            "M_ConcreteDark", normal=(1, 0, 0))
    env = G.Env()
    e = _env_mb()
    for dz in (-3.0, 0.0, 3.0):
        e.sweep([(s, z + dz) for s, z in LEDGE_PROFILE], (-3, 0, 0), (0, 0, 0), (0, 0, 1), "M_Concrete")
        e.sweep([(s, z + dz) for s, z in LEDGE_PROFILE], (0, 3, 0), (0, 0, 0), (0, 0, 1), "M_Concrete")
    env.add_mb(e)
    env.quad((-3, 0, -3), (0, 0, -3), (0, 0, 6), (-3, 0, 6))
    env.quad((0, 0, -3), (0, 3, -3), (0, 3, 6), (0, 0, 6))
    return finish(mb, "corner", env=env,
                  dirt=lambda co, n, tag: 0.82 + 0.18 * G.smoothstep(0.0, 0.5, co.z) - 0.06 * G.smoothstep(2.4, 2.86, co.z))


def build_roof_cap():
    rng = random.Random(127)
    mb = G.MB("roof_cap")
    zt = 0.12
    s = 0.99
    for (a, b, nrm) in (((-s, -s), (s, -s), (0, -1, 0)), ((s, -s), (s, s), (1, 0, 0)), ((s, s), (-s, s), (0, 1, 0)),
                        ((-s, s), (-s, -s), (-1, 0, 0))):
        mb.face([(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], zt), (a[0], a[1], zt)], "M_ConcreteDark",
                normal=nrm, tag=G.T_PRESET, pre=0.7)
    mb.face([(-1, -1, zt), (1, -1, zt), (1, 1, zt), (-1, 1, zt)], "M_RoofTar", normal=(0, 0, 1), tag=G.T_PRESET,
            pre=0.5)
    # four 1 m cast slabs with tar-filled joints (half joints on the tile edge → any rotation tiles)
    hj = 0.011
    tops = {0: 0.1435, 1: 0.1405, 2: 0.142, 3: 0.139}
    tones = {0: 0.92, 1: 0.97, 2: 0.8, 3: 0.89}  # one damp, darker slab per cap breaks up the field
    rects = {0: (-1, 0, -1, 0), 1: (0, 1, -1, 0), 2: (-1, 0, 0, 1), 3: (0, 1, 0, 1)}

    def slab_pre(tone):
        def pre(co, n):
            if n.z > 0.95:
                return tone
            if n.z > 0.3:
                return tone * 0.93
            return tone * 0.55 + 0.25 * G.smoothstep(zt, zt + 0.02, co.z) * tone
        return pre

    for k, (x0, x1, y0, y1) in rects.items():
        x0, x1, y0, y1 = x0 + hj, x1 - hj, y0 + hj, y1 - hj
        if k == 2:
            # broken corner near the tile centre, gravel underneath
            poly = [(x0, y0), (x1 - 0.34, y0), (x1 - 0.22, y0 + 0.09), (x1 - 0.14, y0 + 0.13), (x1, y0 + 0.3),
                    (x1, y1), (x0, y1)]
        else:
            poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        mb.prism(poly, zt - 0.01, tops[k], "M_Concrete", chamfer=0.007, tag=G.T_PRESET, pre=slab_pre(tones[k]))
    gx0, gy0 = -0.01 - 0.42, 0.0
    mb.grid_surface((gx0, gy0, zt), (0.42, 0, 0), (0, 0.36, 0), 7, 6, "M_ConcreteDark",
                    disp=lambda u, v: 0.003 + rng.uniform(0.0, 0.012), normal=(0, 0, 1), smooth=False)
    for _ in range(5):  # loose broken pieces on the gravel
        px, py = rng.uniform(gx0 + 0.18, gx0 + 0.4), rng.uniform(0.02, 0.2)
        M = Matrix.Translation((px, py, zt + 0.004)) @ Matrix.Rotation(rng.uniform(0, 3.1), 4, "Z")
        s = rng.uniform(0.03, 0.06)
        mb.box((-s, -s * 0.7, 0), (s, s * 0.7, 0.018), "M_Concrete", skip="-z", chamfer=0.004, M=M, tag=G.T_PRESET,
               pre=0.8)
    # a tar-filled crack and one sealed joint: few, linear, low-key features, so a field of randomly
    # turned caps does not read as a pattern (compact dark blobs read as a polka-dot grid from above)
    for k, crack_xy in ((0, [(-0.93, -0.36), (-0.78, -0.42), (-0.7, -0.52), (-0.56, -0.57), (-0.47, -0.69),
                             (-0.36, -0.74)]),
                        (3, [(0.3, 0.95), (0.38, 0.8), (0.5, 0.74), (0.58, 0.6), (0.72, 0.55)])):
        left, right = [], []
        for i, (x, y) in enumerate(crack_xy):
            a, b = crack_xy[max(0, i - 1)], crack_xy[min(len(crack_xy) - 1, i + 1)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy) or 1.0
            w = 0.012 * (1.0 - 0.65 * abs(2 * i / (len(crack_xy) - 1) - 1))
            left.append((x - dy / ln * w, y + dx / ln * w))
            right.append((x + dy / ln * w, y - dx / ln * w))
        mb.face([(x, y, tops[k] + 0.0025) for x, y in left + right[::-1]], "M_RoofTar", normal=(0, 0, 1),
                tag=G.T_PRESET, pre=0.9)
    seam_top = max(tops[0], tops[1]) + 0.004
    mb.prism([(-0.045, -0.86), (0.045, -0.86), (0.045, -0.2), (-0.045, -0.2)], zt, seam_top, "M_RoofTar",
             chamfer=0.003, tag=G.T_PRESET, pre=0.72)
    if not NOAO:
        env = G.Env()
        vs, fs = mb.polys()
        for dx in (-2, 0, 2):
            for dy in (-2, 0, 2):
                if dx or dy:
                    env.add(vs, fs, Matrix.Translation((dx, dy, 0)))
        G.bake_colours(mb, env=env, maxd=0.2, strength=1.4, floor=0.45)
    G.box_uvs(mb)
    return G.to_object(mb, common.get_collection(COLL), material)


def par_outer(z):
    return 0.84 + 0.16 * G.smoothstep(0.0, 0.16, z) - 0.12 * G.smoothstep(0.24, 0.34, z)


def par_inner(z):
    return 0.6 + 0.34 * G.smoothstep(0.13, 0.3, z) - 0.08 * G.smoothstep(0.26, 0.34, z)


def build_parapet():
    mb = G.MB("roof_parapet")
    zs = [0.0, 0.1, 0.18, 0.26, 0.34]
    t = 0.2
    for j in range(len(zs) - 1):
        za, zb = zs[j], zs[j + 1]
        mb.face([(-1, 0, za), (1, 0, za), (1, 0, zb), (-1, 0, zb)], "M_Wall", normal=(0, -1, 0), tag=G.T_PRESET,
                pre=lambda co, n: par_outer(co.z))
        mb.face([(-1, t, za), (1, t, za), (1, t, zb), (-1, t, zb)], "M_Wall", normal=(0, 1, 0), tag=G.T_PRESET,
                pre=lambda co, n: par_inner(co.z))
        for x, nx in ((-1, -1), (1, 1)):
            mb.face([(x, 0, za), (x, t, za), (x, t, zb), (x, 0, zb)], "M_Wall", normal=(nx, 0, 0), tag=G.T_PRESET,
                    pre=lambda co, n: par_outer(co.z))
    # coping: slopes toward the roof, overhangs 3 cm both sides
    prof = [(-0.23, 0.34), (-0.23, 0.382), (0.018, 0.4), (0.03, 0.39), (0.03, 0.34)]

    def cop(co, n):
        if n.z > 0.6:
            return 1.0
        return 0.9

    mb.sweep(prof, (-1, 0, 0), (1, 0, 0), (0, 0, 1), "M_Concrete", tag=G.T_PRESET, pre=cop)
    poly = prof + [(-0.23, 0.34)]
    for x, nx in ((-1, -1), (1, 1)):
        mb.face([(x, -s, z) for s, z in prof], "M_Concrete", normal=(nx, 0, 0), tag=G.T_PRESET, pre=0.9)
    mb.face([(-1, -0.03, 0.34), (1, -0.03, 0.34), (1, 0.0, 0.34), (-1, 0.0, 0.34)], "M_Concrete", normal=(0, 0, -1),
            tag=G.T_PRESET, pre=0.6)
    mb.face([(-1, t, 0.34), (1, t, 0.34), (1, 0.23, 0.34), (-1, 0.23, 0.34)], "M_Concrete", normal=(0, 0, -1),
            tag=G.T_PRESET, pre=0.6)
    G.box_uvs(mb)
    if not NOAO:
        G.bake_colours(mb)
    return G.to_object(mb, common.get_collection(COLL), material)


# ───────────────────────────── low blocks, railing ─────────────────────────────


def ground_env():
    return G.Env().quad((-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0))


def low_finish(mb):
    if not NOAO:
        def dirt(co, n, tag):
            return 0.78 + 0.22 * G.smoothstep(0.0, 0.45, co.z)
        G.bake_colours(mb, env=ground_env(), dirt=dirt, maxd=0.45)
    G.box_uvs(mb)
    return G.to_object(mb, common.get_collection(COLL), material)


JERSEY = [(-0.3, 0.0), (-0.3, 0.08), (-0.2, 0.25), (-0.085, 0.8), (-0.06, 0.83), (0.06, 0.83), (0.085, 0.8),
          (0.2, 0.25), (0.3, 0.08), (0.3, 0.0)]


def build_low_barrier():
    rng = random.Random(131)
    mb = G.MB("low_barrier")
    # two jersey barriers (profile across y, swept along x)
    for yc, m in ((-0.64, "M_Concrete"), (0.62, "M_ConcreteDark")):
        prof = [(-(yy), z) for yy, z in JERSEY]  # s = -y offset
        mb.sweep(prof, (-0.97, yc, 0), (0.97, yc, 0), (0, 0, 1), m, closed=False)
        for x, nx in ((-0.97, -1), (0.97, 1)):
            mb.face([(x, yc + yy, z) for yy, z in JERSEY], m, normal=(nx, 0, 0))
    # hazard stripes on the front barrier's steep face
    ya, za, yb, zb = -0.64 - 0.2, 0.25, -0.64 - 0.085, 0.8
    nrm = V((0, -(zb - za), (yb - ya))).normalized()
    for k in range(6):
        xa = -0.9 + k * 0.33
        quad = []
        for (fx, ft) in ((0, 0), (0.14, 0), (0.14 + 0.18, 1), (0.18, 1)):
            p = V((xa + fx, ya + (yb - ya) * ft, za + (zb - za) * ft)) + nrm * 0.003
            quad.append(p)
        if quad[2].x > 0.96:
            continue
        mb.face(quad, "M_MetalYellow", normal=nrm)
    # sandbag fill between the barriers
    for layer in range(2):
        z0 = layer * 0.15
        for row, yc in enumerate((-0.2, 0.15)):
            off = 0.12 if (layer + row) % 2 else 0.0
            x = -0.94 + off
            while x < 0.9:
                w = 0.44
                x1 = min(0.95, x + w)
                if x1 - x > 0.2:
                    m = "M_Plaster" if rng.random() < 0.75 else "M_TarpGreen"
                    M = Matrix.Translation(((x + x1) / 2, yc + rng.uniform(-0.02, 0.02), z0)) @ Matrix.Rotation(
                        math.radians(rng.uniform(-4, 4)), 4, "Z")
                    mb.box((-(x1 - x) / 2 + 0.01, -0.15, 0.0), ((x1 - x) / 2 - 0.01, 0.15, 0.15), m, skip="-z",
                           chamfer=0.045, M=M)
                x = x1 + 0.01
    for xs in (-0.55, 0.1, 0.62):
        M = Matrix.Translation((xs, -0.02, 0.3)) @ Matrix.Rotation(math.radians(rng.uniform(-10, 10)), 4, "Z")
        mb.box((-0.21, -0.14, 0.0), (0.21, 0.14, 0.14), "M_Plaster", skip="-z", chamfer=0.045, M=M)
    # striped boom on posts above the back barrier
    for xs in (-0.78, 0.78):
        mb.box((xs - 0.03, 0.59, 0.83), (xs + 0.03, 0.65, 1.12), "M_MetalDark", skip="-z")
    n = 7
    for k in range(n):
        xa = -0.92 + 1.84 * k / n
        xb = -0.92 + 1.84 * (k + 1) / n
        mb.cyl((xa, 0.62, 1.15), (xb, 0.62, 1.15), 0.045, "M_MetalRed" if k % 2 else "M_PlasticLight", seg=8,
               cap0=(k == 0), cap1=(k == n - 1))
    return low_finish(mb)


def build_low_planter():
    rng = random.Random(137)
    mb = G.MB("low_planter")
    o, i_, h = 0.97, 0.85, 0.55
    # walls (outer + inner faces), coping on top
    for (a, b, nrm) in (((-o, -o), (o, -o), (0, -1, 0)), ((o, -o), (o, o), (1, 0, 0)), ((o, o), (-o, o), (0, 1, 0)),
                        ((-o, o), (-o, -o), (-1, 0, 0))):
        for za, zb in ((0.0, 0.2), (0.2, h)):
            mb.face([(a[0], a[1], za), (b[0], b[1], za), (b[0], b[1], zb), (a[0], a[1], zb)], "M_Brick", normal=nrm)
    for (a, b, nrm) in (((-i_, -i_), (i_, -i_), (0, 1, 0)), ((i_, -i_), (i_, i_), (-1, 0, 0)),
                        ((i_, i_), (-i_, i_), (0, -1, 0)), ((-i_, i_), (-i_, -i_), (1, 0, 0))):
        mb.face([(a[0], a[1], 0.4), (b[0], b[1], 0.4), (b[0], b[1], h), (a[0], a[1], h)], "M_Brick", normal=nrm)
    c = 0.015
    for lo, hi in (((-o - c, -o - c), (o + c, -i_ + c)), ((-o - c, i_ - c), (o + c, o + c)),
                   ((-o - c, -i_ + c), (-i_ + c, i_ - c)), ((i_ - c, -i_ + c), (o + c, i_ - c))):
        mb.box((lo[0], lo[1], h), (hi[0], hi[1], h + 0.06), "M_Concrete", skip="-z", chamfer=0.01, cham_keys={"+z"})
    mb.grid_surface((-i_, -i_, 0.44), (2 * i_, 0, 0), (0, 2 * i_, 0), 6, 6, "M_Trash",
                    disp=lambda u, v: 0.03 * math.sin(math.pi * u) * math.sin(math.pi * v) + rng.uniform(0, 0.015),
                    normal=(0, 0, 1))
    # two round shrubs + two leafy frond plants
    for (x, y, rx, rz, m) in ((0.36, -0.34, 0.36, 0.3, "M_PlantDark"), (-0.4, 0.42, 0.34, 0.28, "M_PlantDark")):
        mb.blob((x, y, 0.47 + rz * 0.7), (rx, rx * 0.9, rz), m, rng, rough=0.25, subdiv=2,
                flat_bottom=0.44 - 0.47 - rz * 0.7)
    fronds(mb, (-0.36, -0.3, 0.46), 9, 0.62, rng, "M_Plant")
    fronds(mb, (0.34, 0.36, 0.46), 8, 0.55, rng, "M_Plant")
    fronds(mb, (0.05, 0.02, 0.46), 6, 0.42, rng, "M_PlantDark")
    mb.cyl((0.62, -0.62, 0.47), (0.5, -0.7, 0.5), 0.035, "M_PlasticLight", seg=6, cap0=True)
    return low_finish(mb)


def fronds(mb, base, n, length, rng, mat):
    """Arching leaves radiating from `base` (single-sided, top faces up)."""
    base = V(base)
    for k in range(n):
        a = 2 * math.pi * (k + rng.uniform(-0.25, 0.25)) / n
        el = math.radians(rng.uniform(42, 68))
        L = length * rng.uniform(0.8, 1.1)
        h = V((math.cos(a), math.sin(a), 0.0))
        side = V((-math.sin(a), math.cos(a), 0.0))
        g = rng.uniform(0.7, 1.0)
        segs = 4
        left, right = [], []
        for i in range(segs + 1):
            t = i / segs
            p = base + h * (L * t * math.cos(el)) + V((0, 0, L * t * math.sin(el) - 0.55 * g * L * t * t))
            w = 0.075 * math.sin(math.pi * min(0.98, 0.12 + 0.88 * t)) ** 0.7
            left.append(mb.bm.verts.new(p + side * w))
            right.append(mb.bm.verts.new(p - side * w))
        bl = [mb.bm.verts.new(v.co) for v in left]
        br = [mb.bm.verts.new(v.co) for v in right]
        for i in range(segs):
            f = mb.bm.faces.new([left[i], right[i], right[i + 1], left[i + 1]])
            mb._finish(f, mat, (0, 0, 1), True, G.T_AO, None)
            b = mb.bm.faces.new([bl[i + 1], br[i + 1], br[i], bl[i]])  # back side (no culling holes)
            mb._finish(b, mat, -f.normal, True, G.T_AO, None)


def crate(mb, x, y, z, w, d, h, deg, rng, kind, boards=True):
    M = Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.radians(deg), 4, "Z")
    if kind == "wood":
        mb.box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), "M_Wood", skip="-z", chamfer=0.01, M=M)
        # frame boards proud on the visible sides + top
        t, e = 0.05, 0.012
        for sy in ((-1, 1) if boards else ()):
            yy = sy * (d / 2 + e / 2)
            for (bx0, bx1, bz0, bz1) in ((-w / 2, w / 2, 0.0, t), (-w / 2, w / 2, h - t, h), (-w / 2, -w / 2 + t, t, h - t),
                                         (w / 2 - t, w / 2, t, h - t)):
                mb.box((bx0, yy - e / 2, bz0), (bx1, yy + e / 2, bz1), "M_Wood", skip="-z" if bz0 == 0 else "", M=M)
        for k in range(3):
            xa = -w / 2 + 0.04 + k * (w - 0.08) / 3
            mb.face([(xa + 0.005, -d / 2 + 0.03, h + 0.002), (xa + 0.012, -d / 2 + 0.03, h + 0.002),
                     (xa + 0.012, d / 2 - 0.03, h + 0.002), (xa + 0.005, d / 2 - 0.03, h + 0.002)], "M_Trash",
                    normal=(0, 0, 1), M=M)
    else:
        m = kind
        mb.box((-w / 2, -d / 2, 0), (w / 2, d / 2, h), m, skip="-z", chamfer=0.012, M=M)
        for sy in (-1, 1):
            yy = sy * (d / 2 + 0.001)
            nrm = (0, sy, 0)
            mb.face([(-w * 0.18, yy, h - 0.09), (w * 0.18, yy, h - 0.09), (w * 0.18, yy, h - 0.05),
                     (-w * 0.18, yy, h - 0.05)], "M_Trash", normal=nrm, M=M)
            for k in range(4):
                xa = -w / 2 + 0.06 + k * (w - 0.12) / 4 + 0.03
                mb.face([(xa, yy, 0.05), (xa + 0.05, yy, 0.05), (xa + 0.05, yy, h - 0.14), (xa, yy, h - 0.14)],
                        "M_Trash", normal=nrm, M=M)


def build_low_crates():
    rng = random.Random(149)
    mb = G.MB("low_crates")
    bottom = [(-0.62, -0.6, "wood"), (0.02, -0.64, "M_TarpBlue"), (0.64, -0.58, "wood"), (-0.6, 0.06, "wood"),
              (0.05, 0.02, "wood"), (0.63, 0.05, "M_PlasticDark"), (-0.62, 0.66, "M_PlasticDark"), (0.02, 0.64, "wood"),
              (0.62, 0.66, "wood")]
    for (x, y, k) in bottom:
        if k == "wood":
            # the centre crate is boxed in on all four sides: no frame boards (saves ~90 hidden tris)
            crate(mb, x, y, 0.0, 0.58, 0.58, 0.58, rng.uniform(-4, 4), rng, k, boards=(x, y) != (0.05, 0.02))
        else:
            crate(mb, x, y, 0.0, 0.56, 0.4, 0.3, rng.uniform(-6, 6), rng, k)
            crate(mb, x + 0.01, y, 0.3, 0.56, 0.4, 0.28, rng.uniform(-6, 6), rng, k)
    top = [(0.36, 0.36, "wood", 0.58), (0.35, -0.3, "M_TarpBlue", 0.0), (-0.45, -0.38, "M_PlasticDark", 0.0)]
    for (x, y, k, s) in top:
        if k == "wood":
            crate(mb, x, y, 0.585, 0.58, 0.58, 0.56, rng.uniform(-8, 8), rng, k)
        else:
            crate(mb, x, y, 0.585, 0.56, 0.4, 0.3, rng.uniform(-10, 10), rng, k)
    crate(mb, 0.1, 0.32, 1.145, 0.46, 0.4, 0.22, 12, rng, "M_MetalRed")
    # back-left top crate under a tarp tied down over its edges
    tx, ty, tdeg, ts, th = -0.32, 0.32, 5.0, 0.58, 0.56
    crate(mb, tx, ty, 0.585, ts, ts, th, tdeg, rng, "wood")
    M = Matrix.Translation((tx, ty, 0.585 + th + 0.012)) @ Matrix.Rotation(math.radians(tdeg), 4, "Z")
    half = ts / 2 + 0.012
    cs = [-half - 0.03, -half, -0.12, 0.0, 0.12, half, half + 0.03]
    vs = {}
    for i, u in enumerate(cs):
        for j, v in enumerate(cs):
            edge_u = max(0.0, abs(u) - half) / 0.03
            edge_v = max(0.0, abs(v) - half) / 0.03
            droop = 0.26 * max(edge_u, edge_v) + 0.05 * edge_u * edge_v
            bulge = 0.025 * (1 - min(1, abs(u) / half)) * (1 - min(1, abs(v) / half))
            wob = 0.02 * math.sin(9 * u + 5 * v) * max(edge_u, edge_v)
            vs[i, j] = mb.bm.verts.new(M @ V((u * (1 + 0.02 * max(edge_u, edge_v)), v, bulge - droop + wob)))
    for i in range(len(cs) - 1):
        for j in range(len(cs) - 1):
            f = mb.bm.faces.new([vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]])
            mb._finish(f, "M_TarpBlue", (0, 0, 1), True, G.T_AO, None)
    return low_finish(mb)


def build_railing():
    rng = random.Random(151)
    mb = G.MB("railing")
    mb.box((-0.03, -0.03, 0.012), (0.03, 0.03, 0.95), "M_MetalDark", skip="-z", chamfer=0.006, cham_keys={"+z"})
    mb.box((-0.07, -0.07, 0.0), (0.07, 0.07, 0.012), "M_MetalDark", skip="-z", chamfer=0.003)
    for x, y in ((-0.05, -0.05), (0.05, -0.05), (-0.05, 0.05), (0.05, 0.05)):
        mb.box((x - 0.008, y - 0.008, 0.012), (x + 0.008, y + 0.008, 0.024), "M_MetalSteel", skip="-z")
    mb.cyl((-1, 0, 0.975), (1, 0, 0.975), 0.025, "M_MetalYellow", seg=8, cap0=True, cap1=True)
    mb.cyl((-0.72, 0, 0.975), (-0.5, 0, 0.975), 0.0268, "M_MetalRust", seg=8, cap0=True, cap1=True)
    mb.cyl((0.34, 0, 0.975), (0.42, 0, 0.975), 0.0268, "M_MetalRust", seg=8, cap0=True, cap1=True)
    for z in (0.52, 0.1):
        mb.cyl((-1, 0, z), (1, 0, z), 0.016, "M_MetalDark", seg=6, cap0=True, cap1=True)
    for k in range(16):
        x = -0.9375 + k * 0.125
        mb.box((x - 0.007, -0.007, 0.1), (x + 0.007, 0.007, 0.975), "M_MetalDark", skip="-z +z")
    return low_finish(mb)


# ───────────────────────────── build everything ─────────────────────────────


def clean_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for item in list(block):
            block.remove(item)


def build_all():
    t0 = time.time()
    builders = {
        "fac_g_plain": build_g_plain, "fac_g_door": build_g_door, "fac_g_shutter": build_g_shutter,
        "fac_g_window": build_g_window, "fac_g_vent": build_g_vent,
        "fac_u_plain": build_u_plain, "fac_u_window": lambda: build_u_window(False),
        "fac_u_window_lit": lambda: build_u_window(True), "fac_u_balcony": build_u_balcony, "fac_u_ac": build_u_ac,
        "fac_u_pipes": build_u_pipes, "fac_corner": build_corner, "roof_cap": build_roof_cap,
        "roof_parapet": build_parapet, "low_barrier": build_low_barrier, "low_planter": build_low_planter,
        "low_crates": build_low_crates, "railing": build_railing,
    }
    kit = {}
    for name in ASSETS:
        t = time.time()
        kit[name] = builders[name]()
        print(f"[facades] {name}: {len(kit[name].data.polygons)} faces in {time.time() - t:.2f}s")
    # display grid in the .blend (export moves each root to the origin)
    for i, name in enumerate(ASSETS):
        kit[name].location = ((i % 6) * 3.0, -(i // 6) * 4.0, 0.0)
    print(f"[facades] built {len(kit)} assets in {time.time() - t0:.1f}s")
    return kit


# ───────────────────────────── assembly test (same rules the game builder uses) ─────────────────────────────

WEIGHTS_G = {"fac_g_plain": 3, "fac_g_door": 2, "fac_g_shutter": 3, "fac_g_window": 1.5, "fac_g_vent": 1}
WEIGHTS_U = {"fac_u_plain": 2, "fac_u_window": 3, "fac_u_window_lit": 1.5, "fac_u_balcony": 1.5, "fac_u_ac": 2,
             "fac_u_pipes": 1.2}
TEST_TINTS = {"A": "#d6b98f", "B": "#86a9a3", "C": "#c28b80", "D": "#9fa6bf"}


def assemble(kit, layout, heights, seed, coll_name):
    """Build test buildings from the kit following the game's placement rules.

    layout rows run north → south; letters = building ids, '.' floor, 'o' low block, ' ' void.
    Tile (c, r) centre: x = 2c, y = -2r (Blender; north = +Y). Facade on every exposed face per storey,
    fac_corner on convex corners, roof_cap per roof tile (random 90° turns), roof_parapet on roof edges
    whose neighbour is lower, low blocks on 'o', railing on floor/void edges.
    """
    rng = random.Random(seed)
    coll = common.get_collection(coll_name)
    objs = []
    rows, cols = len(layout), len(layout[0])
    tints = {}

    def tile(c, r):
        if 0 <= r < rows and 0 <= c < cols:
            return layout[r][c]
        return " "

    def storeys(ch):
        return heights.get(ch, 0) if ch.isalpha() else 0

    def wall_mat(ch):
        if ch not in tints:
            m = bpy.data.materials.get("M_Wall").copy()
            m.name = f"T_Wall_{ch}"
            base = common.hex_rgba("#9a968f")
            tint = common.hex_rgba(TEST_TINTS.get(ch, "#ffffff"))
            col = tuple(base[i] * tint[i] for i in range(3)) + (1.0,)
            for node in m.node_tree.nodes:
                if node.type == "BSDF_PRINCIPLED":
                    node.inputs["Base Color"].default_value = col
            m.diffuse_color = col
            tints[ch] = m
        return tints[ch]

    def inst(name, loc, deg, ch=None):
        o = bpy.data.objects.new(f"asm_{name}", kit[name].data)
        o.location = loc
        o.rotation_euler = (0.0, 0.0, math.radians(deg))
        coll.objects.link(o)
        if ch is not None:
            for slot in o.material_slots:
                if slot.material and slot.material.name == "M_Wall":
                    slot.link = "OBJECT"
                    slot.material = wall_mat(ch)
        objs.append(o)
        return o

    def pick(weights):
        names = list(weights)
        return rng.choices(names, weights=[weights[n] for n in names])[0]

    # (dc, dr, outward Blender normal deg rotation, offset to wall plane)
    sides = {"S": (0, 1, 0.0, (0, -1)), "E": (1, 0, 90.0, (1, 0)), "W": (-1, 0, -90.0, (-1, 0)),
             "N": (0, -1, 180.0, (0, 1))}
    corner_rot = {("S", "E"): 0.0, ("S", "W"): -90.0, ("N", "W"): 180.0, ("N", "E"): 90.0}
    for r in range(rows):
        for c in range(cols):
            ch = tile(c, r)
            x, y = 2.0 * c, -2.0 * r
            if ch == "o":
                inst(rng.choice(["low_barrier", "low_planter", "low_crates"]), (x, y, 0.0), rng.choice([0, 90, 180, 270]))
                continue
            if ch in ".,=":
                for sd, (dc, dr, deg, (ox, oy)) in sides.items():
                    if tile(c + dc, r + dr) == " ":
                        inst("railing", (x + ox, y + oy, 0.0), deg)
                continue
            if not ch.isalpha():
                continue
            h = storeys(ch)
            exposed = {}
            for sd, (dc, dr, deg, (ox, oy)) in sides.items():
                nb = tile(c + dc, r + dr)
                lo = storeys(nb) if nb.isalpha() else 0
                exposed[sd] = lo
                if sd == "N":
                    continue  # never seen by the camera; skipped in the test
                for s in range(lo, h):
                    name = pick(WEIGHTS_G if s == 0 else WEIGHTS_U)
                    inst(name, (x + ox, y + oy, 3.0 * s), deg, ch)
            for (a, b), deg in corner_rot.items():
                for s in range(max(exposed[a], exposed[b]), h):
                    ox = 1.0 if b == "E" else -1.0
                    oy = -1.0 if a == "S" else 1.0
                    inst("fac_corner", (x + ox, y + oy, 3.0 * s), deg)
            inst("roof_cap", (x, y, 3.0 * h), rng.choice([0, 90, 180, 270]))
            for sd, (dc, dr, deg, (ox, oy)) in sides.items():
                if exposed[sd] < h:
                    inst("roof_parapet", (x + ox, y + oy, 3.0 * h), deg, ch)
    # ground slab under everything that is not void
    gm = bpy.data.materials.get("HN_TestGround") or common.make_material("HN_TestGround", "#2a2e33", 0.1, 0.35)
    import bmesh
    bm = bmesh.new()
    for r in range(rows):
        for c in range(cols):
            if tile(c, r) != " ":
                x, y = 2.0 * c, -2.0 * r
                vs = [bm.verts.new((x + dx, y + dy, 0.0)) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                bm.faces.new(vs)
                if tile(c, r + 1) == " ":
                    vs = [bm.verts.new((x + dx, y - 1, z)) for dx, z in ((-1, -0.6), (1, -0.6), (1, 0.0), (-1, 0.0))]
                    bm.faces.new(vs)
    me = bpy.data.meshes.new("asm_ground")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(gm)
    g = bpy.data.objects.new("asm_ground", me)
    coll.objects.link(g)
    objs.append(g)
    return objs


TEST_LAYOUT = [
    "AAAAABB",
    "AAAAABB",
    "CC.....",
    "o.o...o",
    ".......",
    "       ",
]
TEST_HEIGHTS = {"A": 3, "B": 2, "C": 1}

TEST_LAYOUT2 = [
    "DDDAAABBB",
    "DDDAAABBB",
    "DD..C..BB",
    "...oC....",
    "........o",
    "         ",
]
TEST_HEIGHTS2 = {"D": 2, "A": 3, "B": 1, "C": 1}


# ───────────────────────────── previews ─────────────────────────────


class VertexColourPreview:
    """Temporarily multiply the 'Col' attribute into every kit material's base colour (renders only)."""

    def __init__(self, materials):
        self.materials = [m for m in materials if m and m.use_nodes]
        self.added = []

    def __enter__(self):
        for m in self.materials:
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf is None or bsdf.inputs["Base Color"].is_linked:
                continue
            rgb = nt.nodes.new("ShaderNodeRGB")
            rgb.outputs[0].default_value = bsdf.inputs["Base Color"].default_value
            attr = nt.nodes.new("ShaderNodeVertexColor")
            attr.layer_name = "Col"
            mul = nt.nodes.new("ShaderNodeVectorMath")
            mul.operation = "MULTIPLY"
            nt.links.new(rgb.outputs[0], mul.inputs[0])
            nt.links.new(attr.outputs["Color"], mul.inputs[1])
            nt.links.new(mul.outputs[0], bsdf.inputs["Base Color"])
            self.added.append((m, [rgb, attr, mul]))
        return self

    def __exit__(self, *exc):
        for m, nodes in self.added:
            for n in nodes:
                m.node_tree.nodes.remove(n)
        return False


def render_game_cam(objs, filename, target, dist=17.0, resolution=(1600, 900)):
    """Render like the in-game camera: perspective, 35° vertical FOV, looking north, pitched 52° down."""
    scene = bpy.context.scene
    camera = common._preview_rig()
    keep = {o.name for o in objs}
    hidden = []
    for o in scene.objects:
        if o.name not in keep and o.type not in {"LIGHT", "CAMERA"} and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    d = V((0.0, -math.cos(math.radians(52)), math.sin(math.radians(52))))
    camera.location = V(target) + d * dist
    camera.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    camera.data.sensor_fit = "VERTICAL"
    camera.data.angle = math.radians(35)
    scene.camera = camera
    render = scene.render
    prev = (render.resolution_x, render.resolution_y, render.filepath)
    path = os.path.join(common.PREVIEW_DIR, filename)
    try:
        render.engine = "BLENDER_EEVEE"
        render.resolution_x, render.resolution_y = resolution
        render.resolution_percentage = 100
        render.image_settings.file_format = "PNG"
        render.filepath = path
        bpy.ops.render.render(write_still=True)
    finally:
        render.resolution_x, render.resolution_y, render.filepath = prev
        camera.data.sensor_fit = "AUTO"
        for o in hidden:
            o.hide_render = False
    return path


def main():
    t0 = time.time()
    clean_scene()
    kit = build_all()
    asm1 = assemble(kit, TEST_LAYOUT, TEST_HEIGHTS, 7, "Assembly_Test")
    asm2 = assemble(kit, TEST_LAYOUT2, TEST_HEIGHTS2, 19, "Assembly_Test2")
    off1, off2 = V((0, 16.0, 0)), V((0, 34.0, 0))
    for o in asm1:
        o.location += off1
    for o in asm2:
        o.location += off2
    bpy.context.view_layer.update()
    info = common.export_glb("kit_facades.glb", [kit[n] for n in ASSETS])
    print(f"[facades] exported {info}")
    if PREVIEWS != "none":
        mats = {slot.material for o in kit.values() for slot in o.material_slots}
        mats |= {m for m in bpy.data.materials if m.name.startswith("T_Wall_")}
        with VertexColourPreview(mats):
            if PREVIEWS == "all":
                for name in ASSETS:
                    view = "game" if name.startswith("fac_") and name != "fac_corner" else "three_quarter"
                    common.render_preview([kit[name]], f"{name}.png", view=view, resolution=(720, 720), margin=1.1)
            # street tile in front of the buildings = where the robot would stand
            render_game_cam(asm1, "fac_assembly_game.png", off1 + V((6.0, -7.0, 0.5)), dist=17.0)
            render_game_cam(asm1, "fac_assembly_close.png", off1 + V((4.0, -5.0, 0.5)), dist=12.0)
            common.render_preview(asm1, "fac_assembly_three_quarter.png", view="three_quarter", resolution=(1600, 1050),
                                  margin=0.82)
            common.render_preview(asm1, "fac_assembly_game_full.png", view="game", resolution=(1600, 1050), margin=0.8)
            render_game_cam(asm2, "fac_assembly2_game.png", off2 + V((8.0, -7.0, 0.5)), dist=17.0)
            common.render_preview(asm2, "fac_assembly2_three_quarter.png", view="three_quarter",
                                  resolution=(1600, 1050), margin=0.82)
    path = common.save_blend("kit_facades.blend")
    print(f"[facades] saved {path} — total {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
