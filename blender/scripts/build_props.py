"""HARNEST props kit (GAME_DESIGN.md §7.5): builds every prop of kit_props.glb from an empty scene.

Headless, from the repo root:
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
        --python blender/scripts/build_props.py [-- --renders all|singles|sheets|vignette|depot|none] [--only id,id]

Writes public/assets/models/kit_props.glb, blender/manifest/kit_props.json, blender/previews/prop_*.png
and blender/kit_props.blend. Deterministic: every random choice is seeded per prop (Blender may still order a
few triangles of the sphere-based parts differently from run to run; positions and the manifest do not change).

Origins: street / rooftop / depot props bottom centre; wall-mounted props bottom centre ON the wall plane (y = 0,
geometry toward -Y = the front); pipe_v at its bottom end; lantern at its top hook.
Depot props (district 3 rail stock) share one track convention: rails along Y (three.js Z) at x = +-GAUGE / 2,
rail heads RAIL_TOP high; see the depot section.
"""

import importlib
import json
import math
import os
import random
import struct
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

importlib.reload(common)
import geo_props  # noqa: E402

importlib.reload(geo_props)
from geo_props import Prop, V, bezier, dent, facing, helix, sag  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _opt(name, default=None):
    if name in ARGV:
        i = ARGV.index(name)
        return ARGV[i + 1] if i + 1 < len(ARGV) else default
    return default


RENDERS = _opt("--renders", "all")  # all | sheets | vignette | singles | none
ONLY = set(filter(None, (_opt("--only", "") or "").split(",")))
USE_AO = _opt("--ao", "1") == "1"

# New materials (not in the §7.6 palette): name -> (hex, metallic, roughness, emission, strength)
NEW_MATERIALS = {
    "M_WoodLight": ("#93704b", 0.0, 0.85, None, 0.0),  # fresh planks: crate boards, pallets, counter boards
    "M_Cardboard": ("#a5865a", 0.0, 0.95, None, 0.0),  # cardboard boxes and sheets
}


def material(name):
    if name in NEW_MATERIALS:
        m = common.make_material(name, *NEW_MATERIALS[name])
    else:
        m = common.mat(name)
    m.use_backface_culling = True  # three.js renders FrontSide: previews must show flipped faces too
    return m


# ═════════════════════════════ shared sub-assemblies ═════════════════════════════


def wood_crate(p, w=0.7, d=0.7, h=0.66, seed=0, label=True, brace=True, caps=True):
    """Slatted wooden crate standing on z = 0, centred. ~500 tris."""
    rng = random.Random(seed)
    t, ins, bt = 0.055, 0.012, 0.018
    tr = t - 0.006
    p.boxz((w - 2 * ins - 0.01, d - 2 * ins - 0.01, h - 0.026), z0=0.01, mat="M_Wood")  # dark core (gaps)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.boxz((t, t, h), x=sx * (w / 2 - t / 2), y=sy * (d / 2 - t / 2), mat="M_Wood", bevel=0.006)
    for z in (tr / 2 + 0.003, h - tr / 2 - 0.003):
        for sy in (-1, 1):
            p.box((w - 2 * t, tr, tr), at=(0, sy * (d / 2 - tr / 2 - 0.003), z), mat="M_Wood")
        for sx in (-1, 1):
            p.box((tr, d - 2 * t, tr), at=(sx * (w / 2 - tr / 2 - 0.003), 0, z), mat="M_Wood")
    nb, gap = 3, 0.012
    zb0, zb1 = tr + 0.006, h - tr - 0.006
    bh = (zb1 - zb0 - gap * (nb - 1)) / nb
    for i in range(nb):
        zc = zb0 + bh / 2 + i * (bh + gap)
        for sy in (-1, 1):
            j = rng.uniform(-0.003, 0.002)
            p.box((w - 2 * t, bt, bh), at=(0, sy * (d / 2 - ins - bt / 2 + j), zc), mat="M_WoodLight")
        for sx in (-1, 1):
            j = rng.uniform(-0.003, 0.002)
            p.box((bt, d - 2 * t, bh), at=(sx * (w / 2 - ins - bt / 2 + j), 0, zc), mat="M_WoodLight")
    ty0, tx0 = d / 2 - tr - 0.003, w / 2 - tr - 0.003
    tw = (2 * ty0 - gap * (nb - 1)) / nb
    for i in range(nb):
        yc = -ty0 + tw / 2 + i * (tw + gap)
        p.box((2 * tx0, tw, bt), at=(rng.uniform(-0.002, 0.002), yc, h - ins - bt / 2), mat="M_WoodLight")
    if brace:
        L = math.hypot(w - 2 * t, zb1 - zb0)
        ang = math.degrees(math.atan2(zb1 - zb0, w - 2 * t))
        p.box((L + 0.02, 0.016, 0.07), at=(0, -(d / 2 - 0.017), (zb0 + zb1) / 2), rot=(0, -ang, 0), mat="M_Wood")
    if label:
        p.box((0.005, 0.26, 0.12), at=(w / 2 - ins + 0.0045, rng.uniform(-0.05, 0.05), zb0 + bh * 1.5 + gap),
              mat="M_Paper")
        p.box((0.004, 0.2, 0.025), at=(w / 2 - ins + 0.008, 0.0, zb0 + bh * 1.5 + gap + 0.02), mat="M_MetalRed")
    if caps:
        c = t + 0.012
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.box((c, c, 0.05), at=(sx * (w / 2 - t / 2), sy * (d / 2 - t / 2), h - 0.022), mat="M_MetalDark")


def cardboard_box(p, w, d, h, label=True):
    p.boxz((w, d, h), mat="M_Cardboard", bevel=0.008)
    p.box((w + 0.006, 0.07, 0.003), at=(0, 0, h + 0.0015), mat="M_Paper")
    for sx in (-1, 1):
        p.box((0.003, 0.07, 0.1), at=(sx * (w / 2 + 0.0015), 0, h - 0.05), mat="M_Paper")
    if label:
        p.box((0.13, 0.003, 0.09), at=(w * 0.2, -d / 2 - 0.0015, h * 0.55), mat="M_Paper")


def trash_bag(p, at, size, rz=0.0, tilt=(0.0, 0.0), mat="M_Trash", seed=0, knot=True):
    """Lumpy plastic bag sitting on at.z: deformed UV sphere, flat bottom, pinched tied neck."""
    rng = random.Random(seed)
    sx, sy, sz = size
    vals = [rng.uniform(-1.0, 1.0) for _ in range(256)]
    base, zmin = -0.30, -0.42

    def deform(co, i):
        x, y, z = co.x / sx * 2, co.y / sy * 2, co.z / sz * 2
        r = 1.0 + 0.07 * vals[i % 256]
        x, y, z = x * r, y * r, z * r
        if z < 0:
            k = 1.0 + 0.14 * (-z)
            x, y = x * k, y * k
        if z < base:
            z = base + (z - base) * 0.15
        if z > 0.5:
            k = 1.0 - 0.6 * min(1.0, (z - 0.5) / 0.5)
            x, y = x * k, y * k
        return (x * sx / 2, y * sy / 2, (z - zmin) * sz / 2)

    top = (1.07 - zmin) * sz / 2
    with p.frame(at, (tilt[0], tilt[1], rz)):
        p.sphere(0.5, u=10, v=7, scale=(sx, sy, sz), deform=deform, mat=mat)
        if knot:  # tied neck: a small knot with two short, floppy ears lying sideways
            p.sphere(0.032, at=(0, 0, top - 0.014), u=6, v=4, scale=(1, 1, 0.75), mat=mat)
            for s in (-1, 1):
                p.cyl(0.019, 0.05, at=(s * 0.026, 0, top - 0.004), rot=(0, s * 74, rng.uniform(-30, 30)), r2=0.005,
                      n=5, mat=mat, soft=True)


def lantern_geo(p, top=(0.0, 0.0, 0.0), s=1.0, hook=True, tassel=True, nrib=5, n=12):
    """Paper lantern hanging from `top` (the top of its hook). Body M_LanternGlow with dark ribs."""
    with p.frame(top):
        if hook:
            p.torus(0.022 * s, 0.006 * s, at=(0, 0, -0.028 * s), rot=(90, 0, 0), mat="M_MetalDark", n=10, m=5)
            p.cylz(0.005 * s, -0.075 * s, -0.045 * s, mat="M_Cable", n=5)
        else:
            p.cylz(0.005 * s, -0.075 * s, 0.0, mat="M_Cable", n=5)
        p.cylz(0.058 * s, -0.098 * s, -0.07 * s, r2=0.04 * s, mat="M_PlasticDark", n=n, bevel=0.004 * s)
        zt, zb, rmax = -0.092 * s, -0.43 * s, 0.16 * s
        zc, hz = (zt + zb) / 2, (zt - zb) / 2 + 0.03 * s

        def rr(z):
            return max(0.05 * s, rmax * math.sqrt(max(0.0, 1.0 - ((z - zc) / hz) ** 2)))

        # alternating glowing panels and thin dark ribs, bottom -> top
        widths = []
        glow = ((zt - zb) - nrib * 0.012 * s) / (nrib + 1)
        for i in range(nrib + 1):
            widths.append((glow, "M_LanternGlow"))
            if i < nrib:
                widths.append((0.012 * s, "M_PlasticDark"))
        prof, bands = [(0.0, zb), (rr(zb), zb)], ["M_PlasticDark"]
        z = zb
        for wdt, m in widths:
            z2 = z + wdt
            bump = 0.004 * s if m == "M_PlasticDark" else 0.0
            if m == "M_LanternGlow":
                # two rings per panel so the silhouette stays round
                zm = (z + z2) / 2
                prof.append((rr(zm), zm))
                bands.append(m)
                prof.append((rr(z2) + (0.004 * s if z2 < zt - 1e-6 else 0.0), z2))
                bands.append(m)
            else:
                prof.append((rr(z2) + bump, z2))
                bands.append(m)
            z = z2
        prof.append((0.0, zt))
        bands.append("M_PlasticDark")
        p.lathe(prof, n=n, bands=bands, mat="M_LanternGlow")
        p.light((0.0, 0.0, zc), "lantern")
        p.cylz(0.052 * s, zb - 0.022 * s, zb + 0.006 * s, r2=0.045 * s, mat="M_PlasticDark", n=n, bevel=0.003 * s)
        if tassel:
            p.cylz(0.004 * s, zb - 0.06 * s, zb - 0.02 * s, mat="M_MetalRed", n=5)
            p.sphere(0.014 * s, at=(0, 0, zb - 0.065 * s), u=6, v=4, mat="M_MetalRed")
            p.cylz(0.012 * s, zb - 0.165 * s, zb - 0.07 * s, r2=0.006 * s, mat="M_MetalRed", n=8)
            p.cylz(0.024 * s, zb - 0.17 * s, zb - 0.16 * s, r2=0.013 * s, mat="M_MetalRed", n=8)


def bulb(p, at, r=0.045, socket=True):
    x, y, z = at
    if socket:
        p.cylz(r * 0.55, z + r * 0.6, z + r * 1.5, x=x, y=y, mat="M_MetalDark", n=8)
    p.sphere(r, at=(x, y, z), u=10, v=7, mat="M_LampWarm")
    p.light((x, y, z), "warm")


def glass_lamp(p, s=1.0, n=16, kind="street"):
    """Lantern-style lamp head hanging from local (0, 0, 0): teal enamel hood, glowing glass drum (M_LampWarm)
    behind four dark ribs, dark bottom cap and finial. The glass is vertical, so the 52 deg game camera sees it
    from any yaw (a downward shade hides its bulb from above). Height 0.345 * s."""
    pts = [(0.0, -0.345), (0.014, -0.335), (0.018, -0.312), (0.062, -0.300), (0.078, -0.284), (0.078, -0.268),
           (0.070, -0.262), (0.086, -0.225), (0.092, -0.180), (0.088, -0.135), (0.074, -0.098),
           (0.124, -0.094), (0.132, -0.078), (0.118, -0.068), (0.055, -0.028), (0.030, -0.018), (0.026, 0.0),
           (0.0, 0.0)]
    bands = (["M_MetalDark"] * 6 + ["M_LampWarm"] * 4 + ["M_PlasticLight"] + ["M_MetalTeal"] * 3
             + ["M_MetalDark"] * 3)
    # phase puts lathe vertices at 45 + 90k deg, so the ribs sit on vertex ridges (no gap over a flat facet)
    p.lathe([(r * s, z * s) for r, z in pts], n=n, bands=bands, phase=math.radians(45.0 % (360.0 / n)))
    glass = pts[6:11]
    for k in range(4):
        a = math.radians(45 + 90 * k)
        p.tube([V(((r + 0.0035) * s * math.cos(a), (r + 0.0035) * s * math.sin(a), z * s)) for r, z in glass],
               0.0055 * s, n=4, mat="M_MetalDark", soft=False)
    p.light((0.0, 0.0, -0.18 * s), kind)


def crt_tv(p, w, h, d, case="M_PlasticDark", lit=True, ears=False, knobs="right", seed=0):
    """Old CRT TV standing on z = 0, front (screen) at y = -d/2. Returns the screen faces."""
    rng = random.Random(seed)
    fd = 0.06 + 0.25 * d
    fy = -d / 2
    p.boxz((w, fd, h), y=fy + fd / 2, mat=case, bevel=0.02)
    L = d - fd
    p.box((w - 0.05, h - 0.05, L + 0.01), at=(0, fy + fd + L / 2 - 0.005, h / 2 + 0.005), rot=(-90, 0, 0),
          taper=(0.72, 0.74), mat=case, bevel=0.012)
    if knobs == "right":
        sx, sw = -w * 0.1, w * 0.64
        kx = w / 2 - w * 0.13
    else:
        sx, sw = 0.0, w * 0.76
        kx = None
    sz, sh = h * 0.53, h * 0.7
    recess = "M_Rubber" if case == "M_PlasticDark" else "M_PlasticDark"
    p.box((sw + 0.05, 0.006, sh + 0.05), at=(sx, fy - 0.003, sz), mat=recess, bevel=0.002)
    bul = min(sw, sh) * 0.06

    def scr(u, v):
        x = sx - sw / 2 + sw * u
        z = sz - sh / 2 + sh * v
        b = bul * math.sin(math.pi * u) * math.sin(math.pi * v)
        return (x, fy - 0.009 - b, z)

    faces = p.surface(4, 3, scr, mat="M_ScreenGlow" if lit else "M_Glass", up=(0, -1, 0))
    p.mark_screen(faces)
    if lit:
        p.light((sx, fy - 0.03, sz), "screen")
    if not lit:  # crack across a dead screen
        p.beam((sx - sw * 0.3, fy - 0.011 - bul * 0.6, sz + sh * 0.25), (sx + sw * 0.15, fy - 0.011 - bul * 0.9, sz - sh * 0.05),
               (0.006, 0.002), mat="M_PlasticLight")
        p.beam((sx + sw * 0.15, fy - 0.011 - bul * 0.9, sz - sh * 0.05), (sx + sw * 0.35, fy - 0.011 - bul * 0.5, sz - sh * 0.3),
               (0.005, 0.002), mat="M_PlasticLight")
    if kx is not None:
        for kz in (h * 0.72, h * 0.52):
            p.cyl(0.026 * min(1.0, h / 0.4), 0.024, at=(kx, fy - 0.012, kz), rot=(90, 0, 0), mat="M_MetalSteel", n=8,
                  bevel=0.003)
        for i in range(4):
            p.box((w * 0.15, 0.005, 0.01), at=(kx, fy - 0.0025, h * 0.18 + i * 0.022), mat=recess)
        p.box((0.014, 0.005, 0.014), at=(kx + w * 0.05, fy - 0.0025, h * 0.36),
              mat="M_NeonGreen" if lit else "M_NeonRed")
    if ears:
        p.sphere(0.045, at=(0, fy + fd * 0.6, h), u=8, v=5, scale=(1, 1, 0.6), mat="M_PlasticDark")
        for sgn in (-1, 1):
            tip = V((sgn * 0.2, fy + fd * 0.6 + 0.06, h + 0.36))
            p.tube([(sgn * 0.01, fy + fd * 0.6, h + 0.02), tip], 0.006, n=5, mat="M_MetalSteel")
            p.sphere(0.011, at=tip, u=6, v=4, mat="M_MetalSteel")
    return faces


def fan_guard(p, r, rings=(0.45, 0.85), spokes=2, z=0.0, mat="M_MetalDark", wire=0.0055, n=18):
    """Concentric wire rings + crossing spokes in the local XY plane at height z."""
    for k in rings:
        p.torus(r * k, wire, at=(0, 0, z), mat=mat, n=n, m=3)
    for i in range(spokes):
        p.box((2 * r * 0.95, 0.012, 0.008), at=(0, 0, z), rot=(0, 0, 45 + i * 180 / spokes), mat=mat)


def pallet(p, w=1.2, d=0.8, h=0.12):
    for x in (-w / 2 + 0.05, 0.0, w / 2 - 0.05):
        p.boxz((0.09, d, h - 0.022), x=x, mat="M_Wood")
    nb = 5
    for i in range(nb):
        y = -d / 2 + 0.06 + i * (d - 0.12) / (nb - 1)
        p.boxz((w, 0.11, 0.022), y=y, z0=h - 0.022, mat="M_WoodLight", bevel=0.003)


# ═════════════════════════════ street props ═════════════════════════════


def build_barrel():
    p = Prop("barrel", 11)
    n, R = 18, 0.286
    prof = [(0.0, 0.012), (0.262, 0.012), (0.270, 0.0), (0.288, 0.0), (0.297, 0.010), (0.297, 0.030),
            (R, 0.040), (R, 0.160), (R, 0.284), (0.301, 0.294), (0.301, 0.316), (R, 0.326),
            (R, 0.450), (R, 0.574), (0.301, 0.584), (0.301, 0.606), (R, 0.616), (R, 0.740), (R, 0.860),
            (0.297, 0.870), (0.297, 0.890), (0.288, 0.900), (0.272, 0.900), (0.266, 0.884), (0.0, 0.884)]
    body = p.lathe(prof, n=n, mat="M_MetalRed")
    a = math.radians(-20)
    dent(body, (R * math.cos(a), R * math.sin(a), 0.47), 0.15, 0.024)
    p.patch_cyl(R + 0.0025, 10, 12, n, 0.045, 0.2, mat="M_MetalRust", zj1=[0.03, 0.065, 0.0])
    p.patch_cyl(R + 0.0025, 3, 4, n, 0.64, 0.73, mat="M_MetalRust", zj0=[0.0, -0.03], zj1=[0.02, 0.0])
    p.patch_cyl(R + 0.0025, 12, 15, n, 0.38, 0.53, mat="M_MetalYellow")
    p.patch_cyl(R + 0.0065, 13, 14, n, 0.425, 0.485, thick=0.002, mat="M_PlasticDark")
    p.cylz(0.044, 0.880, 0.890, x=0.12, y=0.08, mat="M_MetalSteel", n=10)
    p.cylz(0.030, 0.885, 0.908, x=0.12, y=0.08, mat="M_MetalSteel", n=6, bevel=0.004)
    p.cylz(0.026, 0.880, 0.898, x=-0.15, y=-0.04, mat="M_MetalSteel", n=8, bevel=0.003)
    p.flat([(-0.08, -0.05), (0.02, -0.09), (0.1, -0.03), (0.06, 0.06), (-0.05, 0.07)], 0.003,
           at=(-0.02, -0.04, 0.884), mat="M_MetalRust")
    return p


def build_crate():
    p = Prop("crate", 21)
    wood_crate(p, 0.7, 0.7, 0.66, seed=3)
    return p


def build_crate_stack():
    p = Prop("crate_stack", 22)
    with p.frame((-0.38, 0.03, 0.0), (0, 0, 2)):
        wood_crate(p, 0.7, 0.7, 0.66, seed=1)
    with p.frame((0.38, -0.02, 0.0), (0, 0, -5)):
        wood_crate(p, 0.7, 0.7, 0.66, seed=2, label=False)
    with p.frame((0.02, 0.04, 0.66), (0, 0, 11)):
        wood_crate(p, 0.6, 0.6, 0.56, seed=4, brace=False)
    with p.frame((-0.04, 0.03, 1.22), (0, 0, -14)):
        cardboard_box(p, 0.44, 0.34, 0.26)
    return p


def build_trash_bags():
    p = Prop("trash_bags", 23)
    trash_bag(p, (-0.24, 0.08, 0.0), (0.62, 0.52, 0.56), rz=15, seed=1)
    trash_bag(p, (0.28, 0.12, 0.0), (0.56, 0.48, 0.5), rz=-30, seed=2)
    trash_bag(p, (0.02, -0.05, 0.25), (0.48, 0.42, 0.42), rz=60, tilt=(14, -8), seed=3)
    trash_bag(p, (0.5, -0.27, 0.0), (0.34, 0.3, 0.3), rz=10, mat="M_TarpBlue", seed=4)
    trash_bag(p, (-0.52, -0.24, 0.0), (0.3, 0.28, 0.26), rz=-20, seed=5)
    p.cyl(0.033, 0.115, at=(-0.16, -0.43, 0.033), rot=(90, 0, 35), mat="M_MetalRed", n=8, bevel=0.004)
    p.box((0.46, 0.012, 0.36), at=(0.05, 0.37, 0.177), rot=(18, 0, 4), mat="M_Cardboard")
    p.box((0.2, 0.14, 0.008), at=(0.22, -0.48, 0.004), rot=(0, 0, 25), mat="M_Paper")
    return p


def build_dumpster():
    p = Prop("dumpster", 31)
    W0, D0, W1, D1 = 1.64, 0.84, 1.74, 0.94
    z0, z1 = 0.17, 1.05
    H = z1 - z0

    def wx(z):
        return W0 + (W1 - W0) * (z - z0) / H

    def dy(z):
        return D0 + (D1 - D0) * (z - z0) / H

    ta = math.degrees(math.atan2((D1 - D0) / 2, H))
    sa = math.degrees(math.atan2((W1 - W0) / 2, H))
    p.tub((W0, D0), (W1, D1), z0, z1, 0.03, mat="M_MetalTeal", inner="M_MetalDark", floor=0.5, bevel=0.03)
    p.ring_frame(W1, D1, 0.035, 0.07, at=(0, 0, z1 - 0.035), mat="M_MetalTeal", bevel=0.006)
    for zr in (0.42, 0.74):
        for s in (-1, 1):
            p.box((wx(zr) - 0.24, 0.03, 0.06), at=(0, s * (dy(zr) / 2 + 0.012), zr), rot=(-s * ta, 0, 0),
                  mat="M_MetalTeal", bevel=0.008)
    zf = 0.62
    for s in (-1, 1):
        x = s * (wx(zf) / 2 + 0.03)
        p.box((0.07, dy(zf) + 0.12, 0.11), at=(x, 0, zf), rot=(0, s * sa, 0), mat="M_MetalDark", bevel=0.01)
        for sy in (-1, 1):
            p.box((0.046, 0.004, 0.08), at=(x, sy * ((dy(zf) + 0.12) / 2 + 0.002), zf), mat="M_Rubber")
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (W0 / 2 - 0.13), sy * (D0 / 2 - 0.12)
            p.box((0.12, 0.12, 0.014), at=(cx, cy, z0 - 0.004), mat="M_MetalDark")
            p.box((0.1, 0.05, 0.02), at=(cx, cy, z0 - 0.02), mat="M_MetalDark")
            for s2 in (-1, 1):
                p.box((0.012, 0.06, 0.12), at=(cx + s2 * 0.034, cy, 0.1), mat="M_MetalDark")
            p.cyl(0.066, 0.045, at=(cx, cy, 0.066), rot=(0, 90, 0), mat="M_Rubber", n=12, bevel=0.008)
            p.cyl(0.03, 0.062, at=(cx, cy, 0.066), rot=(0, 90, 0), mat="M_MetalSteel", n=8)
    lw, ld = W1 / 2 + 0.01, D1 + 0.06
    hy, hz = D1 / 2 + 0.045, z1 + 0.025

    def lid():
        p.box((lw - 0.01, ld, 0.045), at=(0, -ld / 2, 0.0), mat="M_PlasticDark", bevel=0.016)
        for gx in (-0.22, 0.0, 0.22):
            p.box((0.05, ld - 0.14, 0.02), at=(gx, -ld / 2 - 0.01, 0.028), mat="M_PlasticDark", bevel=0.006)
        p.box((0.2, 0.035, 0.03), at=(0, -ld + 0.004, 0.004), mat="M_PlasticDark", bevel=0.006)

    with p.frame((-lw / 2, hy, hz)):
        lid()
    with p.frame((lw / 2, hy, hz), (-34, 0, 0)):
        lid()
    for x in (-0.66, -0.22, 0.22, 0.66):
        p.cyl(0.018, 0.16, at=(x, hy, hz), rot=(0, 90, 0), mat="M_MetalDark", n=8)
    trash_bag(p, (0.3, -0.13, z1 - 0.3), (0.5, 0.42, 0.42), rz=20, seed=7)
    trash_bag(p, (0.56, 0.16, z1 - 0.33), (0.42, 0.4, 0.4), rz=-35, seed=8, mat="M_TarpBlue")
    p.beam((0.42, 0.12, 0.72), (0.62, -0.62, 1.32), (0.09, 0.022), mat="M_WoodLight", roll=10)
    zl = 0.62
    with p.frame((-0.45, -dy(zl) / 2, zl), (ta, 0, 0)):
        p.box((0.38, 0.004, 0.2), at=(0, -0.002, 0), mat="M_MetalYellow")
        for i, wbar in enumerate((0.27, 0.2, 0.24)):
            p.box((wbar, 0.003, 0.026), at=(-0.03 + (0.27 - wbar) / 2 * -1, -0.005, 0.05 - i * 0.048),
                  mat="M_PlasticDark")
    zr = 0.32
    with p.frame((0.52, -dy(zr) / 2, zr), (ta, 0, 0)):
        p.plate([(-0.2, -0.1), (0.05, -0.13), (0.22, -0.06), (0.25, 0.1), (0.06, 0.17), (-0.12, 0.07)], 0.003)
    with p.frame((wx(0.45) / 2, 0.12, 0.45), (0, sa, 0)):
        with p.frame((0, 0, 0), facing((1, 0, 0))):
            p.plate([(-0.15, -0.2), (0.12, -0.22), (0.18, 0.02), (0.02, 0.12), (-0.16, 0.05)], 0.003)
    with p.frame((-wx(0.7) / 2, -0.15, 0.7), (0, -sa, 0)):
        with p.frame((0, 0, 0), facing((-1, 0, 0))):
            p.plate([(-0.14, -0.18), (0.14, -0.18), (0.14, 0.18), (-0.14, 0.18)], 0.003, mat="M_Paper")
    return p


def build_vending():
    p = Prop("vending", 41)
    W, D, H = 1.0, 0.76, 1.86
    fy = -D / 2
    p.boxz((W, D, H - 0.05), z0=0.05, mat="M_PlasticLight", bevel=0.03)
    p.boxz((W - 0.06, D - 0.06, 0.06), mat="M_MetalDark", bevel=0.005)
    p.boxz((W + 0.03, D + 0.02, 0.04), z0=H - 0.005, mat="M_PlasticDark", bevel=0.012)
    zh0, zh1 = 1.62, 1.8
    p.box((W - 0.08, 0.05, zh1 - zh0), at=(0, fy - 0.02, (zh0 + zh1) / 2), mat="M_PlasticDark", bevel=0.01)
    p.box((W - 0.15, 0.01, zh1 - zh0 - 0.055), at=(0, fy - 0.045, (zh0 + zh1) / 2), mat="M_NeonPink")
    wx0, wx1, wz0, wz1 = -0.44, 0.22, 0.84, 1.56
    cx, cz, ow, oh = (wx0 + wx1) / 2, (wz0 + wz1) / 2, wx1 - wx0, wz1 - wz0
    p.ring_frame(ow, oh, 0.035, 0.07, at=(cx, fy - 0.035, cz), rot=(90, 0, 0), mat="M_PlasticDark", bevel=0.006)
    p.box((ow, 0.01, oh), at=(cx, fy - 0.003, cz), mat="M_ScreenGlow")
    p.light((cx, fy - 0.08, cz), "screen")
    p.light((0.0, fy - 0.08, (zh0 + zh1) / 2), "pink")
    can_mats = ["M_MetalRed", "M_MetalYellow", "M_MetalTeal", "M_PlasticLight", "M_MetalRed", "M_MetalGalv"]
    for row, zs in enumerate((0.875, 1.105, 1.335)):
        p.box((ow - 0.01, 0.055, 0.012), at=(cx, fy - 0.036, zs), mat="M_PlasticLight")
        for i in range(6):
            x = wx0 + 0.06 + i * (ow - 0.12) / 5
            p.cylz(0.03, zs + 0.006, zs + 0.126, x=x, y=fy - 0.036, mat=can_mats[(i + row * 2) % 6], n=8)
            p.box((0.022, 0.004, 0.008), at=(x, fy - 0.0655, zs), mat="M_NeonOrange")
    p.box((0.17, 0.012, 0.44), at=(0.36, fy - 0.006, 1.2), mat="M_PlasticDark", bevel=0.004)
    p.mark_screen(p.box((0.12, 0.006, 0.07), at=(0.36, fy - 0.014, 1.345), mat="M_ScreenGlow"))
    p.box((0.05, 0.008, 0.012), at=(0.36, fy - 0.016, 1.26), mat="M_MetalSteel")
    for r in range(3):
        for c in range(3):
            p.box((0.022, 0.006, 0.018), at=(0.33 + c * 0.03, fy - 0.015, 1.2 - r * 0.027), mat="M_PlasticLight")
    p.box((0.08, 0.03, 0.05), at=(0.36, fy - 0.02, 1.04), mat="M_MetalSteel", bevel=0.004)
    p.box((0.014, 0.005, 0.014), at=(0.43, fy - 0.015, 1.395), mat="M_NeonGreen")
    p.box((W - 0.07, 0.004, 0.07), at=(0, fy - 0.002, 0.74), mat="M_MetalRed")
    p.box((0.62, 0.012, 0.26), at=(-0.08, fy - 0.006, 0.3), mat="M_PlasticDark", bevel=0.006)
    p.box((0.54, 0.02, 0.17), at=(-0.08, fy - 0.018, 0.31), rot=(-12, 0, 0), mat="M_MetalDark", bevel=0.004)
    with p.frame((-W / 2, 0.06, 1.08), facing((-1, 0, 0))):
        with p.frame((0, 0, 0), (0, 3, 0)):
            p.plate([(-0.21, -0.3), (0.21, -0.3), (0.21, 0.22), (0.13, 0.3), (-0.21, 0.3)], 0.003, mat="M_Paper")
            p.plate([(-0.17, 0.04), (0.17, 0.04), (0.17, 0.24), (-0.17, 0.24)], 0.002, at=(0, -0.003, 0),
                    mat="M_MetalRed")
            for i in range(3):
                p.plate([(-0.16, -0.05 - i * 0.07), (0.1 - i * 0.04, -0.05 - i * 0.07),
                         (0.1 - i * 0.04, -0.02 - i * 0.07), (-0.16, -0.02 - i * 0.07)], 0.002, at=(0, -0.003, 0),
                        mat="M_PlasticDark")
    with p.frame((W / 2, 0.0, 0.0), facing((1, 0, 0))):
        for i in range(4):
            p.plate([(-0.25, 0.14 + i * 0.05), (0.05, 0.14 + i * 0.05), (0.05, 0.165 + i * 0.05),
                     (-0.25, 0.165 + i * 0.05)], 0.004, mat="M_PlasticDark")
        p.plate([(0.0, 0.5), (0.2, 0.46), (0.26, 0.7), (0.06, 0.78), (-0.04, 0.66)], 0.002, mat="M_PlasticDark")
    zt = H + 0.035
    p.box((0.42, 0.34, 0.012), at=(-0.2, 0.06, zt + 0.006), rot=(0, 0, 12), mat="M_Cardboard")
    p.torus(0.11, 0.018, at=(0.25, -0.05, zt + 0.018), mat="M_Cable", n=12, m=6)
    p.torus(0.085, 0.018, at=(0.27, -0.03, zt + 0.048), rot=(5, 0, 0), mat="M_Cable", n=12, m=6)
    p.tube(bezier((0.35, D / 2 - 0.01, 0.4), (0.35, D / 2 + 0.06, 0.3), (0.42, D / 2 + 0.04, 0.05),
                  (0.6, D / 2 - 0.05, 0.014), 7), 0.014, n=6, mat="M_Cable")
    return p


def build_streetlamp():
    p = Prop("streetlamp", 51)
    p.cylz(0.17, 0.0, 0.1, mat="M_ConcreteDark", n=8, bevel=0.015)
    p.boxz((0.24, 0.24, 0.022), z0=0.1, mat="M_MetalDark", bevel=0.005)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cylz(0.016, 0.115, 0.145, x=sx * 0.085, y=sy * 0.085, mat="M_MetalSteel", n=6)

    def shr(z):
        return 0.085 - 0.022 * (z - 0.12) / 0.48

    p.cylz(shr(0.12), 0.12, 0.6, r2=shr(0.6), mat="M_MetalDark", n=10, bevel=0.006)
    for zb in (0.24, 0.40):
        p.cylz(shr(zb) + 0.003, zb, zb + 0.08, r2=shr(zb + 0.08) + 0.003, mat="M_MetalYellow", n=10)
    p.cylz(0.05, 0.55, 2.9, mat="M_MetalDark", n=10)
    p.cylz(0.062, 2.84, 2.92, mat="M_MetalDark", n=10, bevel=0.008)
    p.cylz(0.058, 1.98, 2.04, mat="M_MetalDark", n=10)
    p.box((0.15, 0.1, 0.26), at=(0, -0.09, 1.2), mat="M_MetalGalv", bevel=0.01)
    p.box((0.12, 0.006, 0.22), at=(0, -0.142, 1.2), mat="M_MetalGalv", bevel=0.002)
    p.prism([(-0.035, -0.03), (0.035, -0.03), (0.0, 0.032)], 0.004, at=(0, -0.147, 1.25), mat="M_MetalYellow")
    p.tube(bezier((0, -0.09, 1.08), (0, -0.09, 0.95), (0, -0.07, 0.75), (0, -0.075, 0.6), 5), 0.012, n=6)
    p.patch_cyl(0.051, 6, 8, 10, 1.5, 1.72, thick=0.0025, mat="M_Paper", zj1=[0.0, 0.02, -0.01])
    p.patch_cyl(0.051, 8, 10, 10, 1.64, 1.82, thick=0.0025, mat="M_MetalYellow")
    p.patch_cyl(0.051, 2, 3, 10, 1.38, 1.5, thick=0.0025, mat="M_Paper")
    p.tube(helix((0, 0, 0), 0.064, 1.34, 2.82, 1.75, 30, phase=-math.pi / 2), 0.011, n=5)
    # gooseneck arm curling down into a collar; the lantern head hangs plumb from it (reads the same at any yaw)
    p.tube(bezier((0, 0, 2.8), (0, 0, 3.2), (0, -0.62, 3.3), (0, -0.8, 3.1), 10), 0.032, n=8, mat="M_MetalDark")
    p.tube(bezier((0, -0.04, 2.55), (0, -0.12, 2.76), (0, -0.3, 2.96), (0, -0.495, 3.185), 6), 0.014, n=6,
           mat="M_MetalDark")
    p.cylz(0.042, 3.03, 3.12, y=-0.8, mat="M_MetalDark", n=10, bevel=0.006)
    with p.frame((0, -0.8, 3.035)):
        glass_lamp(p, s=1.0, n=16, kind="street")
    return p


def build_bench():
    p = Prop("bench", 61)
    prof = [(-0.25, 0.0), (-0.18, 0.0), (-0.165, 0.36), (0.13, 0.36), (0.15, 0.0), (0.22, 0.0),
            (0.205, 0.38), (0.30, 0.84), (0.245, 0.855), (0.155, 0.45), (0.155, 0.415), (-0.235, 0.415)]
    for x in (-0.66, 0.66):
        p.side_prism(prof, 0.05, x=x, mat="M_MetalDark", bevel=0.006)
    for i, y in enumerate((-0.2, -0.105, -0.01, 0.085)):
        if i == 2:
            p.box((1.42, 0.085, 0.03), at=(0.06, y, 0.432), rot=(0, 0, 1.2), mat="M_Wood", bevel=0.004)
        else:
            p.box((1.6, 0.085, 0.032), at=(0, y, 0.431), mat="M_WoodLight", bevel=0.005)
    lean = math.degrees(math.atan2(0.09, 0.405))
    for z in (0.56, 0.68, 0.8):
        y = 0.155 + (z - 0.45) * 0.222 - 0.017
        p.box((1.6, 0.03, 0.085), at=(0, y, z), rot=(-lean, 0, 0), mat="M_WoodLight", bevel=0.005)
    p.box((0.32, 0.24, 0.012), at=(-0.35, -0.08, 0.452), rot=(0, 0, -14), mat="M_Paper")
    p.cylz(0.032, 0.447, 0.567, x=0.55, y=-0.12, mat="M_MetalTeal", n=8, bevel=0.004)
    return p


def build_stall():
    p = Prop("stall", 71)
    cx0, cx1, cy0, cy1, ch = -0.95, 0.95, -0.42, 0.28, 0.9
    ym = (cy0 + cy1) / 2
    p.boxz((cx1 - cx0 - 0.04, cy1 - cy0 - 0.04, ch - 0.04), y=ym, z0=0.02, mat="M_Wood")
    nb = 7
    bw = (cx1 - cx0) / nb
    for i in range(nb):
        p.boxz((bw - 0.01, 0.022, ch - 0.06), x=cx0 + bw * (i + 0.5), y=cy0 + 0.011 - (0.005 if i % 2 else 0.0),
               z0=0.02, mat="M_WoodLight")
    for sx in (-1, 1):
        for zc in (0.28, 0.62):
            p.box((0.022, cy1 - cy0 - 0.06, 0.26), at=(sx * (cx1 - 0.009), ym, zc), mat="M_WoodLight")
    p.boxz((cx1 - cx0 + 0.06, cy1 - cy0 + 0.08, 0.05), y=ym - 0.02, z0=ch - 0.04, mat="M_Wood", bevel=0.008)
    p.boxz((cx1 - cx0 + 0.04, cy1 - cy0 + 0.06, 0.008), y=ym - 0.02, z0=ch + 0.01, mat="M_MetalGalv")
    ct = ch + 0.018
    # hanging menu sign on the counter front
    p.box((0.56, 0.014, 0.3), at=(-0.36, cy0 - 0.03, 0.6), rot=(4, 0, 2), mat="M_Wood", bevel=0.004)
    with p.frame((-0.36, cy0 - 0.037, 0.6), (4, 0, 2)):
        p.plate([(-0.24, -0.11), (0.24, -0.11), (0.24, 0.11), (-0.24, 0.11)], 0.003, mat="M_Paper")
        for i, wbar in enumerate((0.36, 0.28, 0.32)):
            p.plate([(-0.18, 0.05 - i * 0.06), (-0.18 + wbar, 0.05 - i * 0.06), (-0.18 + wbar, 0.075 - i * 0.06),
                     (-0.18, 0.075 - i * 0.06)], 0.002, at=(0, -0.003, 0), mat="M_MetalRed" if i == 0 else "M_PlasticDark")
    for sx in (-0.56, -0.16):
        p.tube([(sx, cy0 - 0.03, 0.75), (sx, cy0 - 0.03, ct - 0.02)], 0.004, n=4)
    # frame: posts, rails
    py0, py1, hf, hb, px = -0.47, 0.47, 2.02, 2.3, 0.98
    slope = (hb - hf) / (py1 - py0)
    for sx in (-1, 1):
        x = sx * px
        for y, top in ((py0, hf), (py1, hb)):
            p.cylz(0.03, 0.0, top, x=x, y=y, mat="M_MetalDark", n=6)
            p.cylz(0.05, 0.0, 0.03, x=x, y=y, mat="M_MetalDark", n=6)
        p.tube([(x, py0 - 0.03, hf - 0.02 - 0.03 * slope), (x, py1 + 0.03, hb - 0.02 + 0.03 * slope)], 0.022, n=6,
               mat="M_MetalDark")
    p.tube([(-px - 0.03, py0, hf - 0.02), (px + 0.03, py0, hf - 0.02)], 0.022, n=6, mat="M_MetalDark")
    p.tube([(-px - 0.03, py1, hb - 0.02), (px + 0.03, py1, hb - 0.02)], 0.022, n=6, mat="M_MetalDark")
    p.tube([(0, py0, hf - 0.02), (0, py1, hb - 0.02)], 0.018, n=6, mat="M_MetalDark")
    # canopy cloth: stripes, sagging between the rails, drooping overhangs
    NS = 12  # stripes across (2 overhang columns + 10 between the posts)
    xs = [-1.12] + [-px + px * i / 5 for i in range(NS - 1)] + [1.12]
    yb, yf = py1 + 0.05, py0 - 0.14
    ys = [yb, py1] + [py1 + (py0 - py1) * k / 3 for k in range(1, 3)] + [py0, yf]

    def canopy(u, v):
        i, j = round(u * NS), round(v * 5)
        x, y = xs[i], ys[j]
        z = hf + (y - py0) * slope + 0.026
        ax = abs(x)
        if ax <= px and py0 <= y <= py1:  # belly between rafters and bars
            z -= 0.05 * math.sin(math.pi * ax / px) * math.sin(math.pi * (y - py0) / (py1 - py0))
        if ax > px:
            z -= (ax - px) * 0.7
        if y < py0:
            z -= (py0 - y) * 0.45
        if y > py1:
            z -= (y - py1) * 0.3
        return (x, y, z)

    stripe = ["M_TarpOrange", "M_Paper"]
    p.surface(NS, 5, canopy, thick=0.012, mat_fn=lambda i, j: stripe[i % 2])
    xv = []
    for i in range(NS):
        xv += [xs[i], (xs[i] + xs[i + 1]) / 2]
    xv.append(xs[NS])

    def valance(u, v):
        """Pennant valance under the front edge: one point per stripe, hanging lower at its middle."""
        i = round(u * 2 * NS)
        ii = i // 2
        if i % 2 == 0:
            topz = canopy(ii / NS, 1.0)[2]
        else:
            topz = (canopy(ii / NS, 1.0)[2] + canopy((ii + 1) / NS, 1.0)[2]) / 2
        bot = topz - (0.19 if i % 2 else 0.12)
        return (xv[i], yf - 0.006, topz + (bot - topz) * v)

    p.surface(2 * NS, 1, valance, thick=0.008, mat_fn=lambda i, j: stripe[(i // 2) % 2], up=(0, -1, 0))
    # goods: parts crate, noodle pot and bowls, battery tray, cash box
    with p.frame((-0.62, -0.1, ct), (0, 0, 4)):
        p.boxz((0.42, 0.32, 0.1), mat="M_WoodLight", bevel=0.004)
        p.boxz((0.38, 0.28, 0.04), z0=0.065, mat="M_Wood")
        rng = random.Random(5)
        for k in range(7):
            x, y = rng.uniform(-0.15, 0.15), rng.uniform(-0.1, 0.1)
            m = ("M_MetalSteel", "M_MetalYellow", "M_MetalDark", "M_MetalRed")[k % 4]
            if k % 3 == 0:
                p.cyl(0.03, 0.04, at=(x, y, 0.115), rot=(rng.uniform(-30, 30), rng.uniform(-30, 30), 0), mat=m, n=6)
            else:
                p.box((0.06, 0.04, 0.03), at=(x, y, 0.115), rot=(0, rng.uniform(-20, 20), rng.uniform(0, 90)), mat=m)
    p.cylz(0.13, ct, ct + 0.2, x=0.05, y=-0.04, mat="M_MetalSteel", n=12, bevel=0.01)
    p.cylz(0.135, ct + 0.2, ct + 0.22, x=0.05, y=-0.04, r2=0.1, mat="M_MetalDark", n=12)
    p.cylz(0.025, ct + 0.22, ct + 0.25, x=0.05, y=-0.04, mat="M_MetalDark", n=6)
    for k in range(2):
        p.lathe([(0.0, 0.0), (0.04, 0.0), (0.075, 0.05), (0.07, 0.053), (0.0, 0.02)], n=8, at=(0.33, -0.2, ct + k * 0.022),
                mat="M_PlasticLight")
    with p.frame((0.62, -0.12, ct), (0, 0, -6)):
        p.boxz((0.24, 0.2, 0.04), mat="M_PlasticDark", bevel=0.004)
        for a in range(2):
            for b in range(2):
                x, y = -0.05 + b * 0.1, -0.045 + a * 0.09
                p.cylz(0.03, 0.03, 0.12, x=x, y=y, mat="M_MetalGalv", n=6)
                p.cylz(0.021, 0.12, 0.132, x=x, y=y, mat="M_NeonGreen", n=6)
    p.boxz((0.2, 0.15, 0.1), x=0.58, y=0.15, z0=ct, mat="M_MetalRed", bevel=0.006)
    # hanging lights: a lantern on a bracket in front of the right post, a bare bulb under the front bar
    p.tube([(px, py0, hf - 0.1), (px, py0 - 0.27, hf - 0.1)], 0.012, n=6, mat="M_MetalDark")
    lantern_geo(p, (px, py0 - 0.25, hf - 0.112), s=0.8, hook=False, nrib=3, n=10)
    p.tube([(-0.25, py0, hf - 0.04), (-0.25, py0 - 0.06, 1.66)], 0.005, n=4)
    bulb(p, (-0.25, py0 - 0.07, 1.585), r=0.045)
    return p


def build_crt_stack():
    p = Prop("crt_stack", 81)
    with p.frame((0.0, 0.02, 0.0)):
        pallet(p, 1.3, 0.75, 0.12)
    tvs = [
        ((-0.32, -0.33, 0.12), 3, (0.62, 0.5, 0.5), "M_Wood", True, False),
        ((0.33, -0.31, 0.12), -5, (0.54, 0.44, 0.44), "M_PlasticLight", False, False),
        ((-0.3, -0.31, 0.62), 6, (0.5, 0.4, 0.42), "M_PlasticDark", True, False),
        ((0.3, -0.26, 0.56), -12, (0.4, 0.33, 0.36), "M_PlasticLight", True, False),
        ((-0.26, -0.25, 1.02), 12, (0.3, 0.25, 0.28), "M_MetalRed", True, True),
    ]
    for k, ((x, yfront, z), rz, (w, h, d), case, lit, ears) in enumerate(tvs):
        with p.frame((x, yfront + d / 2, z), (0, 0, rz)):
            crt_tv(p, w, h, d, case=case, lit=lit, ears=ears, knobs="right" if k != 4 else "none", seed=k)
    p.tube(bezier((-0.3, 0.2, 0.4), (-0.3, 0.42, 0.35), (-0.1, 0.45, 0.14), (0.1, 0.36, 0.13), 7), 0.012, n=5)
    p.tube(bezier((0.3, 0.12, 0.75), (0.32, 0.36, 0.7), (0.5, 0.42, 0.3), (0.62, 0.3, 0.012), 8), 0.012, n=5)
    p.tube(bezier((-0.26, 0.05, 1.12), (-0.05, 0.12, 1.15), (0.05, 0.12, 0.95), (0.12, 0.06, 0.9), 6), 0.009, n=5)
    return p


def build_plant_pot():
    p = Prop("plant_pot", 91)
    prof = [(0.0, 0.0), (0.15, 0.0), (0.16, 0.012), (0.205, 0.33), (0.2, 0.34), (0.235, 0.345), (0.24, 0.39),
            (0.225, 0.4), (0.2, 0.395), (0.195, 0.37), (0.0, 0.37)]
    p.lathe(prof, n=16, bands=["M_PlasterRust"] * 9 + ["M_RoofTar"])
    rng = p.rng
    # two tiers: 4 upright inner leaves, 7 shorter outer ones spilling over the rim
    tiers = [(i * 90 + 20, (0.62, 0.72), (0.03, 0.07), (0.25, 0.3), (0.35, 0.6)) for i in range(4)]
    tiers += [(i * 360 / 7, (0.47, 0.55), (0.11, 0.16), (0.3, 0.36), (0.1, 0.3)) for i in range(7)]
    for i, (deg, hr, rr, lr, tr) in enumerate(tiers):
        phi = math.radians(deg + rng.uniform(-12, 12))
        dirv = V((math.cos(phi), math.sin(phi), 0.0))
        side = V((-math.sin(phi), math.cos(phi), 0.0))
        hs, rs = rng.uniform(*hr), rng.uniform(*rr)
        base = V((dirv.x * 0.03, dirv.y * 0.03, 0.37))
        top = V((dirv.x * rs, dirv.y * rs, hs))
        rise = hs - 0.37
        p.tube(bezier(base, base + V((0, 0, rise * 0.55)), top - dirv * 0.04 - V((0, 0, rise * 0.2)), top, 5), 0.008,
               n=5, mat="M_PlantDark")
        L, tilt = rng.uniform(*lr), rng.uniform(*tr)
        Wd = L * 0.62

        def leaf(u, v, top=top, dirv=dirv, side=side, L=L, Wd=Wd, tilt=tilt):
            w = Wd * math.sin(math.pi * (u * 0.88 + 0.08)) ** 0.9 / 2
            s = (v - 0.5) * 2
            pos = V((top.x, top.y, 0.0)) + dirv * (L * u) + side * (s * w)
            z = top.z + L * (tilt * u - (0.5 + tilt) * u * u) - abs(s) * w * 0.35
            return (pos.x, pos.y, z)

        p.surface(6, 2, leaf, mat="M_Plant" if i % 2 == 0 else "M_PlantDark", thick=0.006)
    return p


def build_cable_spool():
    p = Prop("cable_spool", 101)
    Rf, wf, half = 0.48, 0.045, 0.32
    with p.frame((0, 0, Rf), (90, 0, 0)):  # drum axis along Y: a flange faces the street / camera
        for s in (-1, 1):
            p.cyl(Rf, wf, at=(0, 0, s * half), mat="M_WoodLight", n=20, bevel=0.008)
            zo = s * (half + wf / 2)
            p.box((0.07, 0.9, 0.014), at=(0, 0, zo + s * 0.007), mat="M_Wood")
            p.cyl(0.1, 0.02, at=(0, 0, zo + s * 0.012), mat="M_MetalDark", n=10)
            p.cyl(0.045, 0.024, at=(0, 0, zo + s * 0.016), mat="M_Rubber", n=10)
            for k in range(4):
                a = math.radians(45 + 90 * k)
                p.cyl(0.012, 0.03, at=(0.07 * math.cos(a), 0.07 * math.sin(a), zo + s * 0.02), mat="M_MetalSteel", n=6)
        zl0, zl1 = -(half - wf / 2) + 0.002, (half - wf / 2) - 0.002
        nw, Rw = 9, 0.36
        prof = [(0.17, zl0), (Rw, zl0)]
        for k in range(1, 2 * nw):
            prof.append((Rw + (0.014 if k % 2 else 0.0), zl0 + (zl1 - zl0) * k / (2 * nw)))
        prof += [(Rw, zl1), (0.17, zl1)]
        p.lathe(prof, n=18, mat="M_Cable", closed=False, cap0=False, cap1=False)
    for sx in (-1, 1):  # chocks wedged under both flanges (the drum would roll along X)
        p.boxz((0.07, 0.78, 0.07), x=sx * 0.25, mat="M_Wood", bevel=0.004)
    # loose end: over the top of the winding, down the right side between the flanges, out toward the street
    Rc = Rw + 0.014 + 0.016
    end = [V((Rc * math.cos(math.radians(a)), 0.12, Rf + Rc * math.sin(math.radians(a)))) for a in (115, 85, 55, 28, 0)]
    end += [V((Rc + 0.005, 0.12, 0.27)), V((Rc + 0.02, 0.11, 0.09)), V((Rc + 0.07, 0.07, 0.018)),
            V((Rc + 0.15, -0.08, 0.016)), V((Rc + 0.2, -0.3, 0.016)), V((Rc + 0.22, -0.5, 0.016))]
    p.tube(end, 0.016, n=6)
    p.box((0.05, 0.08, 0.035), at=(Rc + 0.224, -0.535, 0.0175), rot=(0, 0, 6), mat="M_PlasticLight", bevel=0.005)
    return p


def tyre(p, at, rot=None, R=0.31, w=0.21, n=18, rim=False):
    rc, hw, hh = R - 0.075, 0.075, w / 2
    prof = []
    m = 10
    for i in range(m):
        t = -math.pi / 2 + 2 * math.pi * (i + 0.5) / m
        c, s = math.cos(t), math.sin(t)
        rr = rc + hw * math.copysign(abs(c) ** (2 / 3.5), c)
        zz = hh + hh * math.copysign(abs(s) ** (2 / 3.5), s)
        prof.append((rr, zz))
    with p.frame(at, rot):
        faces = p.lathe(prof, n=n, closed=True, mat="M_Rubber")
        # tread: alternate outer blocks pushed in
        inv = p.M.inverted()
        for v in geo_props.verts_of(faces):
            lc = inv @ v.co
            r = math.hypot(lc.x, lc.y)
            if r > rc + 0.8 * hw and 0.1 * w < lc.z < 0.9 * w:
                k = round(math.atan2(lc.y, lc.x) / (2 * math.pi / n))
                if k % 2 == 0:
                    f = (r - 0.008) / r
                    lc.x *= f
                    lc.y *= f
                    v.co = p.M @ lc
        if rim:
            rp = [(0.0, 0.05), (0.2, 0.05), (0.215, 0.07), (0.215, 0.14), (0.2, 0.15), (0.17, 0.125), (0.08, 0.125),
                  (0.06, 0.135), (0.0, 0.135)]
            p.lathe(rp, n=n, mat="M_MetalRust")
            for k in range(5):
                a = 2 * math.pi * k / 5
                p.cylz(0.012, 0.13, 0.142, x=0.045 * math.cos(a), y=0.045 * math.sin(a), mat="M_MetalSteel", n=6)
    return faces


def build_tires():
    p = Prop("tires", 111)
    tyre(p, (0.0, 0.0, 0.0))
    tyre(p, (0.03, -0.02, 0.21), (0, 0, 10))
    tyre(p, (-0.02, 0.03, 0.42), (3, -2, 25), rim=True)
    # one standing on its tread in front, leaning back on the stack, its face turned to the street / camera
    lean = tyre(p, (0.1, -0.375, 0.29), (70, 0, 8))
    vs = geo_props.verts_of(lean)
    dz = min(v.co.z for v in vs)
    for v in vs:
        v.co.z -= dz
    return p


def build_steam_vent():
    p = Prop("steam_vent", 121)
    S, b, h = 0.9, 0.1, 0.06
    inner = S - 2 * b
    p.boxz((inner + 0.01, inner + 0.01, 0.008), mat="M_RoofTar")
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.boxz((b, b, h), x=sx * (S / 2 - b / 2), y=sy * (S / 2 - b / 2), mat="M_MetalYellow")
    nblk = 5
    bl = inner / nblk
    for k in range(nblk):
        m = "M_PlasticDark" if k % 2 == 0 else "M_MetalYellow"
        c = -inner / 2 + bl * (k + 0.5)
        for s in (-1, 1):
            p.boxz((bl, b, h), x=c, y=s * (S / 2 - b / 2), mat=m)
            p.boxz((b, bl, h), x=s * (S / 2 - b / 2), y=c, mat=m)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cylz(0.014, h, h + 0.008, x=sx * (S / 2 - b / 2), y=sy * (S / 2 - b / 2), mat="M_MetalDark", n=6)
    for y in (-0.18, 0.18):
        p.boxz((inner, 0.025, 0.025), y=y, z0=0.008, mat="M_MetalDark")
    for k in range(10):
        x = -inner / 2 + 0.035 + k * (inner - 0.07) / 9
        p.boxz((0.024, inner, 0.042), x=x, z0=0.008, mat="M_MetalDark")
    return p


def build_manhole():
    p = Prop("manhole", 131)
    p.lathe([(0.368, 0.0), (0.425, 0.0), (0.425, 0.012), (0.372, 0.018)], n=18, closed=True, mat="M_MetalSteel")
    prof = [(0.0, 0.002), (0.362, 0.002), (0.366, 0.016), (0.355, 0.021), (0.3, 0.021), (0.3, 0.027), (0.28, 0.027),
            (0.28, 0.021), (0.0, 0.021)]
    p.lathe(prof, n=18, mat="M_MetalDark")
    for a in (0, 90):
        p.box((0.5, 0.022, 0.006), at=(0, 0, 0.024), rot=(0, 0, a + 45), mat="M_MetalDark")
    for k in range(8):
        a = math.radians(k * 45)
        p.box((0.05, 0.02, 0.006), at=(0.33 * math.cos(a), 0.33 * math.sin(a), 0.024), rot=(0, 0, k * 45),
              mat="M_MetalDark")
    for sx in (-1, 1):
        p.cylz(0.016, 0.0205, 0.0235, x=sx * 0.2, y=0.0, mat="M_RoofTar", n=8)
    p.flat([(-0.1, -0.06), (0.06, -0.08), (0.12, 0.02), (0.02, 0.09), (-0.09, 0.05)], 0.0025, at=(0.12, -0.16, 0.021),
           mat="M_MetalRust")
    return p


# ═════════════════════════════ wall-mounted props (y <= 0, front = -Y) ═════════════════════════════


def build_ac_unit():
    p = Prop("ac_unit", 141)
    W, Dp, H = 0.86, 0.3, 0.56
    y0 = -0.045
    yc, fy = y0 - Dp / 2, y0 - Dp
    zb = 0.12
    zc = zb + H / 2
    p.box((W, Dp, H), at=(0, yc, zc), mat="M_PlasticLight", bevel=0.02)
    for x in (-0.3, 0.3):
        p.box((0.035, 0.012, 0.16), at=(x, -0.006, 0.08), mat="M_MetalDark")
        p.box((0.035, 0.33, 0.03), at=(x, -0.012 - 0.165, zb - 0.015), mat="M_MetalDark")
        p.beam((x, -0.014, 0.012), (x, -0.27, zb - 0.028), (0.03, 0.02), mat="M_MetalDark")
    fx, fz, fr = -0.13, zc, 0.205
    with p.frame((fx, fy, fz), (90, 0, 0)):
        p.lathe([(fr, 0.0), (fr + 0.026, 0.0), (fr + 0.026, 0.008), (fr + 0.012, 0.014), (fr, 0.008)], n=20, closed=True,
                mat="M_PlasticLight")
        p.cyl(fr, 0.006, at=(0, 0, 0.001), mat="M_PlasticDark", n=20)
        for i in range(3):
            a = math.radians(i * 120 + 15)
            p.box((0.16, 0.075, 0.006), at=(0.095 * math.cos(a), 0.095 * math.sin(a), 0.008),
                  rot=(math.degrees(0.35), 0, math.degrees(a)), mat="M_MetalGalv")
        p.cyl(0.04, 0.022, at=(0, 0, 0.012), mat="M_MetalDark", n=10)
        fan_guard(p, fr, rings=(0.45, 0.88), spokes=2, z=0.022, mat="M_MetalDark", n=18)
    p.box((0.3, 0.006, H - 0.1), at=(0.25, fy - 0.003, zc), mat="M_PlasticLight", bevel=0.003)
    p.box((0.1, 0.004, 0.05), at=(0.25, fy - 0.007, zc + 0.16), mat="M_MetalSteel")
    p.box((0.012, 0.005, 0.012), at=(0.34, fy - 0.0075, zc + 0.16), mat="M_NeonGreen")
    for i in range(4):
        p.box((0.24, 0.004, 0.014), at=(0.25, fy - 0.007, zc - 0.17 + i * 0.03), mat="M_PlasticDark")
    zt = zb + H
    for i in range(4):
        p.box((0.46, 0.024, 0.004), at=(-0.13, yc - 0.09 + i * 0.06, zt + 0.0015), mat="M_PlasticDark")
    p.box((0.21, 0.1, 0.065), at=(0.24, yc + 0.02, zt + 0.0325), rot=(0, 0, 18), mat="M_Brick", bevel=0.006)
    for zp, rp, m in ((zb + 0.1, 0.022, "M_PlasticDark"), (zb + 0.17, 0.016, "M_MetalGalv")):
        p.tube(bezier((W / 2 - 0.03, y0 - 0.07, zp), (W / 2 + 0.12, y0 - 0.07, zp), (W / 2 + 0.1, -0.03, zp),
                      (W / 2 + 0.1, -0.001, zp), 6), rp, n=8, mat=m)
    p.box((0.1, 0.012, 0.16), at=(W / 2 + 0.1, -0.006, zb + 0.135), mat="M_ConcreteDark", bevel=0.003)
    p.tube([(W / 2 - 0.12, yc - 0.06, zb + 0.004), (W / 2 - 0.12, yc - 0.06, zb - 0.05),
            (W / 2 - 0.09, -0.03, 0.03), (W / 2 - 0.07, -0.016, 0.006)], 0.008, n=5)
    with p.frame((-0.3, fy, zb + 0.08)):
        p.plate([(-0.08, -0.06), (0.1, -0.07), (0.12, 0.0), (0.02, 0.05), (-0.09, 0.02)], 0.003)
    return p


def build_pipe_v():
    p = Prop("pipe_v", 151)
    r, yax = 0.055, -0.11
    p.cylz(r, 0.0, 3.0, y=yax, mat="M_MetalGalv", n=10)
    p.cylz(r + 0.012, 0.0, 0.045, y=yax, mat="M_MetalGalv", n=10)
    p.cylz(r + 0.012, 2.955, 3.0, y=yax, mat="M_MetalGalv", n=10)
    p.cylz(r + 0.012, 1.46, 1.54, y=yax, mat="M_MetalGalv", n=10, bevel=0.004)
    for zc in (0.75, 2.25):
        p.cylz(r + 0.008, zc - 0.022, zc + 0.022, y=yax, mat="M_MetalDark", n=10)
        p.box((0.03, 0.04, 0.03), at=(0, -0.032, zc), mat="M_MetalDark")
        p.box((0.09, 0.012, 0.075), at=(0, -0.006, zc), mat="M_MetalDark", bevel=0.003)
        for sx in (-1, 1):
            p.cyl(0.009, 0.008, at=(sx * 0.03, -0.014, zc), rot=(90, 0, 0), mat="M_MetalSteel", n=6)
    p.cylz(r + 0.004, 1.92, 2.13, y=yax, mat="M_MetalRust", n=10)
    for i in range(3):
        p.cyl(r + 0.005, 0.032, at=(0, yax, 1.0 + i * 0.034), rot=(5 - 4 * i, 0, 0), mat="M_PlasticLight", n=10)
    return p


def build_pipe_h():
    p = Prop("pipe_h", 161)
    r, yax, zax = 0.055, -0.11, 0.075
    p.cyl(r, 2.0, at=(0, yax, zax), rot=(0, 90, 0), mat="M_MetalGalv", n=10)
    for x0, x1 in ((-1.0, -0.955), (0.955, 1.0)):
        p.cyl(r + 0.012, x1 - x0, at=((x0 + x1) / 2, yax, zax), rot=(0, 90, 0), mat="M_MetalGalv", n=10)
    for xc in (-0.5, 0.5):
        p.cyl(r + 0.008, 0.044, at=(xc, yax, zax), rot=(0, 90, 0), mat="M_MetalDark", n=10)
        p.box((0.03, 0.04, 0.03), at=(xc, -0.032, zax), mat="M_MetalDark")
        p.box((0.075, 0.012, 0.15), at=(xc, -0.006, 0.075), mat="M_MetalDark", bevel=0.003)
        for sz in (-1, 1):
            p.cyl(0.009, 0.008, at=(xc, -0.014, zax + sz * 0.05), rot=(90, 0, 0), mat="M_MetalSteel", n=6)
    p.cyl(r + 0.004, 0.24, at=(0.2, yax, zax), rot=(0, 90, 0), mat="M_MetalRust", n=10)
    p.cyl(0.018, 2.0, at=(0, -0.045, 0.215), rot=(0, 90, 0), mat="M_MetalDark", n=8)
    for xc in (-0.75, -0.25, 0.25, 0.75):
        p.box((0.026, 0.034, 0.05), at=(xc, -0.03, 0.215), mat="M_MetalDark")
    return p


def build_awning():
    p = Prop("awning", 171)
    W, P = 2.0, 0.92
    zb, zf = 0.66, 0.24
    lift = 0.025
    arms = (-0.94, 0.0, 0.94)

    def cloth_z(x, v):
        z = zb + (zf - zb) * v + lift
        ax = abs(x)
        if ax <= 0.94:
            z -= 0.04 * math.sin(math.pi * ax / 0.94) * math.sin(math.pi * v) ** 0.8
        return z

    def cloth(u, v):
        x = -W / 2 + W * u
        y = -0.03 - (P - 0.03) * v
        return (x, y, cloth_z(x, v))

    stripe = ["M_TarpGreen", "M_Paper"]
    p.surface(16, 4, cloth, thick=0.01, mat_fn=lambda i, j: stripe[(i // 2) % 2])

    def valance(u, v):
        """Scalloped valance: 4 columns per 0.25 m stripe, deepest at the stripe middle."""
        x = -W / 2 + W * u
        t = (round(u * 32) % 4) / 4.0
        top = cloth_z(x, 1.0)
        bot = top - (0.06 + 0.12 * math.sin(math.pi * t))
        return (x, -P - 0.006, top + (bot - top) * v)

    p.surface(32, 1, valance, thick=0.008, mat_fn=lambda i, j: stripe[(i // 4) % 2], up=(0, -1, 0))
    p.box((W - 0.04, 0.03, 0.04), at=(0, -0.015, zb - 0.02), mat="M_MetalDark", bevel=0.004)
    for x in arms:
        p.tube([(x, -0.03, zb - 0.018), (x, -P + 0.01, zf - 0.018)], 0.014, n=6, mat="M_MetalDark")
        if x != 0.0:
            p.box((0.05, 0.012, 0.1), at=(x, -0.006, zb - 0.4), mat="M_MetalDark", bevel=0.003)
            p.tube([(x, -0.012, zb - 0.4), (x, -P * 0.55, zb + (zf - zb) * 0.55 - 0.02)], 0.011, n=6, mat="M_MetalDark")
    p.tube([(-0.97, -P + 0.01, zf - 0.018), (0.97, -P + 0.01, zf - 0.018)], 0.014, n=6, mat="M_MetalDark")
    p.drop_to_ground()
    return p


def build_wall_lamp():
    p = Prop("wall_lamp", 181)
    zp = 0.33
    p.box((0.11, 0.02, 0.17), at=(0, -0.01, zp), mat="M_MetalDark", bevel=0.006)
    for sz in (-1, 1):
        p.cyl(0.008, 0.008, at=(0, -0.022, zp + sz * 0.06), rot=(90, 0, 0), mat="M_MetalSteel", n=6)
    p.cyl(0.03, 0.03, at=(0, -0.034, zp), rot=(90, 0, 0), mat="M_MetalDark", n=10)
    p.tube(bezier((0, -0.04, zp), (0, -0.2, zp + 0.08), (0, -0.34, zp + 0.06), (0, -0.38, zp - 0.03), 8), 0.016, n=6,
           mat="M_MetalDark")
    p.cylz(0.03, zp - 0.08, zp - 0.012, y=-0.38, mat="M_MetalDark", n=10, bevel=0.004)
    with p.frame((0, -0.38, zp - 0.076)):
        glass_lamp(p, s=0.72, n=12, kind="warm")
    p.tube([(0.035, -0.012, zp + 0.07), (0.04, -0.012, zp + 0.25), (0.06, -0.012, zp + 0.45)], 0.008, n=5)
    p.box((0.06, 0.03, 0.05), at=(0.06, -0.015, zp + 0.47), mat="M_MetalDark", bevel=0.003)
    p.drop_to_ground()
    return p


def build_fuse_box():
    p = Prop("fuse_box", 191)
    W, Dp, H = 0.46, 0.2, 0.62
    yc, fy = -Dp / 2, -Dp
    p.boxz((W, Dp, H), y=yc, mat="M_MetalGalv", bevel=0.012)
    p.boxz((W - 0.05, 0.008, H - 0.06), y=fy - 0.004, z0=0.03, mat="M_MetalGalv", bevel=0.003)
    for z in (0.14, 0.48):
        p.cylz(0.012, z - 0.04, z + 0.04, x=-(W - 0.05) / 2 - 0.004, y=fy - 0.008, mat="M_MetalDark", n=8)
    p.box((0.026, 0.024, 0.1), at=(0.16, fy - 0.02, 0.33), mat="M_MetalDark", bevel=0.005)
    with p.frame((0.0, fy - 0.008, 0.43)):
        p.plate([(-0.09, -0.075), (0.09, -0.075), (0.0, 0.085)], 0.004, mat="M_MetalYellow")
        p.plate([(-0.012, 0.05), (0.025, 0.05), (0.002, 0.0), (0.03, 0.0), (-0.025, -0.06), (-0.004, -0.008),
                 (-0.03, -0.008)], 0.002, at=(0, -0.004, 0), mat="M_PlasticDark")
    with p.frame((-0.06, fy - 0.008, 0.2), (0, 6, 0)):
        p.plate([(-0.08, -0.07), (0.08, -0.07), (0.08, 0.07), (-0.08, 0.07)], 0.002, mat="M_Paper")
        for i in range(3):
            p.plate([(-0.06, 0.03 - i * 0.03), (0.05, 0.03 - i * 0.03), (0.05, 0.04 - i * 0.03), (-0.06, 0.04 - i * 0.03)],
                    0.0015, at=(0, -0.002, 0), mat="M_PlasticDark")
    p.box((0.1, 0.004, 0.035), at=(0.12, fy - 0.01, 0.55), mat="M_PlasticDark")
    p.box((0.016, 0.004, 0.016), at=(0.095, fy - 0.0125, 0.55), mat="M_NeonGreen")
    p.box((0.016, 0.004, 0.016), at=(0.125, fy - 0.0125, 0.55), mat="M_NeonRed")
    for i in range(3):
        p.box((0.2, 0.01, 0.012), at=(0.06, fy - 0.012, 0.07 + i * 0.024), rot=(-25, 0, 0), mat="M_MetalDark")
    p.box((W + 0.06, Dp + 0.045, 0.024), at=(0, -(Dp + 0.045) / 2 - 0.005, H + 0.014), rot=(6, 0, 0),
          mat="M_MetalDark", bevel=0.004)
    for x, rr, top in ((-0.12, 0.022, H + 0.42), (0.1, 0.018, H + 0.38)):
        p.cylz(rr + 0.012, H - 0.005, H + 0.04, x=x, y=-0.07, mat="M_MetalDark", n=8)
        p.cylz(rr, H, top, x=x, y=-0.07, mat="M_MetalDark", n=8)
        p.box((0.05, 0.07, 0.02), at=(x, -0.035, top - 0.08), mat="M_MetalDark")
    p.tube(bezier((0.18, -0.06, H), (0.2, -0.08, H + 0.18), (0.16, -0.03, H + 0.3), (0.17, -0.012, H + 0.46), 6),
           0.009, n=5)
    return p


def build_vines():
    p = Prop("vines", 201)
    rng = p.rng
    stems = []
    for k in range(6):
        x = -0.36 + k * 0.144 + rng.uniform(-0.04, 0.04)
        top = rng.uniform(1.3, 2.3)
        pts = []
        z, xx = 0.0, x
        while z < top:
            pts.append(V((xx, -0.035 - 0.012 * math.sin(z * 5 + k), z)))
            xx += rng.uniform(-0.09, 0.09) + (0.025 if xx < -0.3 else -0.025 if xx > 0.3 else 0.0)
            z += 0.14
        pts.append(V((xx, -0.03, top)))
        stems.append(pts)
        radii = [0.013 - 0.008 * i / (len(pts) - 1) for i in range(len(pts))]
        p.tube(pts, 0.013, n=5, mat="M_Wood", radii=radii)
        for i in range(1, len(pts) - 1, 2):
            if rng.random() < 0.6:
                sgn = rng.choice((-1, 1))
                b0 = pts[i]
                b1 = b0 + V((sgn * rng.uniform(0.12, 0.22), -0.01, rng.uniform(0.05, 0.16)))
                b2 = b1 + V((sgn * rng.uniform(0.05, 0.12), 0.0, rng.uniform(0.02, 0.1)))
                p.tube([b0, b1, b2], 0.006, n=4, mat="M_Wood")
                stems.append([b0, b1, b2])
    leaves = []
    for pts in stems:
        for i in range(1, len(pts)):
            base = pts[i]
            cnt = 3 if base.z < 1.0 else 2
            for _ in range(cnt):
                leaves.append(base + V((rng.uniform(-0.06, 0.06), 0.0, rng.uniform(-0.06, 0.06))))
    for k, b in enumerate(leaves):
        ang = rng.uniform(0, 2 * math.pi)
        L = rng.uniform(0.1, 0.15) * (1.0 if b.z < 1.6 else 0.85)
        wdt = L * rng.uniform(0.55, 0.7)
        d = V((math.cos(ang), 0.0, math.sin(ang) * 0.8 - 0.25)).normalized()
        n = V((rng.uniform(-0.3, 0.3), -1.0, rng.uniform(0.3, 0.9))).normalized()
        d = (d - n * d.dot(n)).normalized()
        s = n.cross(d).normalized()
        base = V((b.x, min(b.y, -0.02), b.z))
        mid = base + d * (L * 0.45)
        tip = base + d * L
        left = mid + s * (wdt / 2) - n * 0.006
        right = mid - s * (wdt / 2) - n * 0.006
        ridge = mid + n * 0.01
        bm = bmesh.new()
        vb, vl, vt, vr, vc = (bm.verts.new(c) for c in (base, left, tip, right, ridge))
        for tri in ((vb, vc, vl), (vc, vt, vl), (vb, vr, vc), (vr, vt, vc)):
            bm.faces.new(tri)
        bm.normal_update()
        if sum((f.normal.dot(n) for f in bm.faces)) < 0:
            for f in bm.faces:
                f.normal_flip()
        mat = "M_PlantDark" if (b.z < 0.5 and k % 3) or k % 4 == 0 else "M_Plant"
        p.add(bm, mat, soft=True)
    for v in p.bm.verts:
        v.co.y = min(v.co.y, -0.002)
        v.co.z = max(v.co.z, 0.0)
    return p


# ═════════════════════════════ hanging ═════════════════════════════


def build_lantern():
    p = Prop("lantern", 211)
    lantern_geo(p, (0.0, 0.0, 0.0), s=1.0)
    return p


# ═════════════════════════════ rooftop ═════════════════════════════


def build_water_tank():
    p = Prop("water_tank", 221)
    hs = 0.36
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.boxz((0.06, 0.06, hs), x=sx * 0.4, y=sy * 0.4, mat="M_MetalDark", bevel=0.004)
            p.boxz((0.12, 0.12, 0.012), x=sx * 0.4, y=sy * 0.4, mat="M_MetalDark")
    p.ring_frame(0.74, 0.74, 0.06, 0.05, at=(0, 0, hs - 0.025), mat="M_MetalDark")
    for s in (-1, 1):
        p.beam((s * 0.4, -0.37, 0.03), (s * 0.4, 0.37, hs - 0.06), (0.025, 0.012), mat="M_MetalDark")
        p.beam((-0.37, s * 0.4, 0.03), (0.37, s * 0.4, hs - 0.06), (0.012, 0.025), mat="M_MetalDark")
    R, z0, n = 0.55, hs, 20
    prof = [(0.0, z0 + 0.005), (R - 0.03, z0 + 0.005), (R, z0 + 0.03), (R, z0 + 0.3), (R + 0.012, z0 + 0.31),
            (R + 0.012, z0 + 0.35), (R, z0 + 0.36), (R, z0 + 0.62), (R + 0.012, z0 + 0.63), (R + 0.012, z0 + 0.67),
            (R, z0 + 0.68), (R, z0 + 0.86), (R + 0.015, z0 + 0.87), (R + 0.015, z0 + 0.895), (R - 0.02, z0 + 0.9),
            (0.14, z0 + 1.02), (0.0, z0 + 1.03)]
    hoop = "M_MetalDark"
    bands = ["M_MetalGalv"] * 3 + [hoop] * 3 + ["M_MetalGalv"] + [hoop] * 3 + ["M_MetalGalv"] + [hoop] * 3 + ["M_MetalGalv"] * 2
    p.lathe(prof, n=n, bands=bands)
    p.patch_cyl(R + 0.0025, 13, 15, n, z0 + 0.04, z0 + 0.26, mat="M_MetalRust", zj1=[0.02, 0.05, -0.02])
    p.patch_cyl(R + 0.0025, 2, 4, n, z0 + 0.7, z0 + 0.84, mat="M_MetalRust", zj0=[0.02, -0.03, 0.0])
    p.patch_cyl(R + 0.0025, 16, 17, n, z0 + 0.42, z0 + 0.56, mat="M_MetalYellow")
    p.cylz(0.13, z0 + 0.99, z0 + 1.06, x=-0.05, y=-0.04, mat="M_MetalGalv", n=12, bevel=0.008)
    p.tube(bezier((-0.13, -0.04, z0 + 1.05), (-0.13, -0.04, z0 + 1.1), (0.03, -0.04, z0 + 1.1), (0.03, -0.04, z0 + 1.05), 4),
           0.008, n=5, mat="M_MetalDark")
    p.tube(bezier((0.3, 0.12, z0 + 0.92), (0.3, 0.12, z0 + 1.2), (0.44, 0.12, z0 + 1.24), (0.44, 0.12, z0 + 1.08), 6),
           0.025, n=8, mat="M_MetalGalv")
    p.tube([(0.22, -0.22, z0 + 0.01), (0.22, -0.22, 0.12), (0.22, -0.28, 0.06), (0.32, -0.62, 0.05), (0.32, -0.7, 0.05)],
           0.03, n=8, mat="M_MetalGalv")
    p.torus(0.07, 0.009, at=(0.22, -0.22, 0.24), mat="M_MetalRed", n=12, m=4)
    p.cylz(0.016, 0.22, 0.26, x=0.22, y=-0.22, mat="M_MetalRed", n=6)
    for x in (-0.15, 0.15):
        p.tube([(x, -R - 0.08, 0.0), (x, -R - 0.08, z0 + 0.92)], 0.014, n=6, mat="M_MetalDark")
    for i in range(6):
        z = 0.25 + i * 0.2
        p.tube([(-0.15, -R - 0.08, z), (0.15, -R - 0.08, z)], 0.011, n=5, mat="M_MetalDark")
    for z in (z0 + 0.2, z0 + 0.78):
        for x in (-0.15, 0.15):
            p.beam((x, -R - 0.08, z), (x, -R + 0.01, z), (0.02, 0.02), mat="M_MetalDark")
    return p


def build_roof_vent():
    p = Prop("roof_vent", 231)
    cx = -0.12
    p.boxz((0.62, 0.62, 0.12), x=cx, mat="M_ConcreteDark", bevel=0.012)
    p.boxz((0.66, 0.66, 0.03), x=cx, z0=0.12, mat="M_MetalGalv", bevel=0.006)
    p.boxz((0.42, 0.42, 0.42), x=cx, z0=0.15, mat="M_MetalGalv", bevel=0.01)
    p.boxz((0.5, 0.5, 0.26), x=cx, z0=0.57, mat="M_MetalGalv", bevel=0.01)
    for k in range(4):
        with p.frame((cx, 0.0, 0.0), (0, 0, 90 * k)):
            p.box((0.4, 0.006, 0.2), at=(0, -0.253, 0.7), mat="M_PlasticDark")
            for i in range(4):
                p.box((0.42, 0.012, 0.05), at=(0, -0.262, 0.62 + i * 0.054), rot=(35, 0, 0), mat="M_MetalGalv")
    p.boxz((0.6, 0.6, 0.1), x=cx, z0=0.83, taper=(0.5, 0.5), mat="M_MetalGalv", bevel=0.008)
    p.boxz((0.62, 0.62, 0.02), x=cx, z0=0.82, mat="M_MetalGalv", bevel=0.004)
    with p.frame((cx - 0.21, -0.1, 0.35)):
        with p.frame((0, 0, 0), facing((-1, 0, 0))):
            p.plate([(-0.12, -0.15), (0.1, -0.18), (0.14, 0.05), (0.0, 0.14), (-0.1, 0.06)], 0.003)
    p.cylz(0.11, 0.0, 0.04, x=0.33, y=0.12, mat="M_Rubber", n=12, r2=0.09)
    p.cylz(0.07, 0.0, 0.38, x=0.33, y=0.12, mat="M_MetalDark", n=10)
    p.cylz(0.13, 0.36, 0.42, x=0.33, y=0.12, r2=0.06, mat="M_MetalDark", n=12, bevel=0.005)
    p.cylz(0.05, 0.42, 0.45, x=0.33, y=0.12, mat="M_MetalDark", n=8)
    return p


def build_antenna():
    p = Prop("antenna", 241)
    p.boxz((0.32, 0.32, 0.12), mat="M_Concrete", bevel=0.012)
    p.boxz((0.2, 0.2, 0.015), z0=0.12, mat="M_MetalDark")
    p.cylz(0.024, 0.12, 2.85, mat="M_MetalGalv", n=8)
    for i in range(3):
        a = math.radians(90 + i * 120)
        c, s = math.cos(a), math.sin(a)
        p.tube([(0.02 * c, 0.02 * s, 0.78), (0.5 * c, 0.5 * s, 0.03)], 0.012, n=6, mat="M_MetalGalv")
        p.boxz((0.16, 0.12, 0.05), x=0.52 * c, y=0.52 * s, mat="M_Concrete", bevel=0.006)
    p.cylz(0.04, 0.74, 0.82, mat="M_MetalDark", n=8)
    for k, (zb, L, rz, ne) in enumerate(((2.2, 1.0, 0.0, 7), (2.6, 0.8, 35.0, 6))):
        with p.frame((0, 0, zb), (0, 0, rz)):
            p.cyl(0.012, L, rot=(90, 0, 0), mat="M_MetalGalv", n=6)
            p.box((0.06, 0.06, 0.07), mat="M_MetalDark")
            for e in range(ne):
                y = -L / 2 + 0.05 + e * (L - 0.1) / (ne - 1)
                p.cyl(0.0095, 0.56 - e * 0.045, at=(0, y, 0), rot=(0, 90, 0), mat="M_MetalSteel", n=5)
    p.cylz(0.03, 2.85, 2.9, mat="M_MetalDark", n=8)
    p.sphere(0.035, at=(0, 0, 2.925), u=8, v=6, mat="M_NeonRed")
    p.light((0, 0, 2.925), "red")
    p.tube([(0.034, 0.0, 2.32), (0.036, 0.004, 1.6), (0.034, 0.012, 0.9), (0.07, 0.06, 0.3), (0.16, 0.1, 0.13)], 0.008,
           n=5)
    return p


def build_dish():
    p = Prop("dish", 251)
    for sx in (-1, 1):
        p.boxz((0.06, 0.62, 0.05), x=sx * 0.24, mat="M_MetalDark", bevel=0.004)
        p.boxz((0.22, 0.4, 0.1), x=sx * 0.2, y=0.02, z0=0.05, mat="M_Concrete", bevel=0.01)
    p.boxz((0.54, 0.06, 0.05), y=-0.28, mat="M_MetalDark", bevel=0.004)
    p.boxz((0.54, 0.06, 0.05), y=0.28, mat="M_MetalDark", bevel=0.004)
    p.cylz(0.05, 0.05, 0.12, mat="M_MetalDark", n=8)
    p.cylz(0.035, 0.05, 0.76, mat="M_MetalGalv", n=8)
    p.boxz((0.09, 0.09, 0.1), z0=0.7, mat="M_MetalDark", bevel=0.006)
    f4 = 1.2
    back = [(0.0, -0.014)] + [(r, r * r / f4 - 0.014) for r in (0.1, 0.2, 0.3, 0.38, 0.42)]
    front = [(r, r * r / f4) for r in (0.4, 0.3, 0.2, 0.1)] + [(0.0, 0.0)]
    prof = back + [(0.43, 0.14), (0.425, 0.152)] + front
    # aimed up and to the east (+X): from the high south camera the dish reads in three-quarter profile with
    # its feed arm, not as a bowl seen from above
    with p.frame((0, -0.02, 0.8), (-50, 0, -100)):
        p.lathe(prof, n=20, mat="M_PlasticLight")
        p.box((0.14, 0.1, 0.08), at=(0, 0, -0.05), mat="M_MetalDark", bevel=0.006)
        p.tube([(0, -0.39, 0.13), (0, -0.2, 0.22), (0, -0.02, 0.29)], 0.012, n=6, mat="M_MetalDark")
        p.box((0.05, 0.05, 0.1), at=(0, 0, 0.31), mat="M_PlasticDark", bevel=0.006)
        p.cyl(0.03, 0.04, at=(0, 0, 0.255), mat="M_PlasticDark", n=10)
        p.box((0.012, 0.004, 0.012), at=(0, -0.027, 0.33), mat="M_NeonGreen")
    # feed cable from the receiver box behind the dish, clipped down the mast, over the frame to the roof
    p.tube([(-0.075, -0.02, 0.75), (-0.036, -0.022, 0.68), (-0.036, -0.022, 0.4), (-0.037, -0.024, 0.17),
            (-0.065, -0.08, 0.1), (-0.07, -0.2, 0.063), (-0.06, -0.33, 0.063), (-0.04, -0.42, 0.03),
            (-0.02, -0.5, 0.008)], 0.008, n=5)
    return p


def build_roof_ac():
    p = Prop("roof_ac", 261)
    W, D, H, zb = 1.35, 0.9, 0.82, 0.1
    for sy in (-1, 1):
        p.boxz((W + 0.1, 0.08, zb), y=sy * 0.32, mat="M_MetalDark", bevel=0.006)
    p.boxz((W, D, H), z0=zb, mat="M_MetalGalv", bevel=0.025)
    zt = zb + H
    for fx in (-0.33, 0.33):
        fr = 0.27
        with p.frame((fx, 0.0, zt)):
            p.lathe([(fr, 0.0), (fr + 0.04, 0.0), (fr + 0.04, 0.03), (fr + 0.012, 0.042), (fr, 0.03)], n=20, closed=True,
                    mat="M_MetalGalv")
            p.cyl(fr, 0.01, at=(0, 0, 0.0), mat="M_PlasticDark", n=20)
            for i in range(5):
                a = math.radians(i * 72)
                p.box((fr * 0.8, 0.09, 0.006), at=(fr * 0.45 * math.cos(a), fr * 0.45 * math.sin(a), 0.014),
                      rot=(22, 0, math.degrees(a)), mat="M_MetalGalv")
            p.cylz(0.055, 0.0, 0.035, mat="M_MetalDark", n=10)
            fan_guard(p, fr + 0.02, rings=(0.5, 0.95), spokes=2, z=0.045, mat="M_MetalDark", n=18)
    for sy in (-1, 1):
        with p.frame((0, sy * D / 2, zb + H / 2), (0, 0, 0 if sy < 0 else 180)):
            p.box((W - 0.16, 0.006, H - 0.2), at=(0, -0.003, 0), mat="M_PlasticDark")
            for i in range(9):
                z = -(H - 0.26) / 2 + i * (H - 0.26) / 8
                p.box((W - 0.18, 0.012, 0.022), at=(0, -0.012, z), rot=(25, 0, 0), mat="M_MetalGalv")
    with p.frame((W / 2, 0.0, zb + H / 2), facing((1, 0, 0))):
        p.plate([(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3)], 0.006, mat="M_MetalGalv")
        p.plate([(-0.08, 0.12), (0.08, 0.12), (0.08, 0.2), (-0.08, 0.2)], 0.003, at=(0, -0.006, 0), mat="M_PlasticLight")
        p.plate([(0.18, -0.06), (0.21, -0.06), (0.21, 0.06), (0.18, 0.06)], 0.012, at=(0, -0.006, 0), mat="M_MetalDark")
        p.plate([(0.1, 0.22), (0.12, 0.22), (0.12, 0.24), (0.1, 0.24)], 0.004, at=(0, -0.009, 0), mat="M_NeonRed")
    for k, (rr, m, yy) in enumerate(((0.028, "M_PlasticDark", 0.18), (0.018, "M_MetalGalv", 0.28))):
        p.tube(bezier((W / 2 - 0.02, yy, zb + 0.2), (W / 2 + 0.2, yy, zb + 0.2), (W / 2 + 0.16, yy, 0.03),
                      (W / 2 + 0.36, yy, rr), 7) + [V((W / 2 + 0.55, yy, rr))], rr, n=8, mat=m)
    with p.frame((-0.4, -D / 2, zb + 0.08)):
        p.plate([(-0.15, -0.06), (0.12, -0.07), (0.18, 0.04), (0.0, 0.1), (-0.12, 0.05)], 0.003)
    return p


# ═════════════════════════════ depot: rail stock (district 3) ═════════════════════════════
#
# One track convention for every depot prop: rails run along Y (three.js Z, north-south at rot 0), rail centres
# at x = +-GAUGE / 2, rail heads RAIL_TOP above the ground. The locomotive's wheels stand on that height and its
# buffers sit at BUFFER_Z, like the buffer stop's. The turntable's rails stand TABLE_RAIL_TOP high, so a
# locomotive placed on it goes up by TABLE_RAIL_TOP - RAIL_TOP.

GAUGE = 1.0
RAIL_TOP = 0.06
TABLE_RAIL_TOP = 0.112
BUFFER_Z = 0.55

# rail cross-section (x, z above the rail foot): rusty foot + web, polished head; RAIL_H high in all
RAIL_WEB = [(-0.04, 0.0), (0.04, 0.0), (0.04, 0.005), (0.009, 0.01), (0.009, 0.0205), (-0.009, 0.0205),
            (-0.009, 0.01), (-0.04, 0.005)]
RAIL_HEAD = [(-0.025, 0.0205), (0.025, 0.0205), (0.025, 0.028), (0.02, 0.032), (-0.02, 0.032), (-0.025, 0.028)]
RAIL_H = 0.032


def clip_rect(poly, x0, x1, z0, z1):
    """Convex polygon [(x, z), ...] clipped to the rectangle [x0, x1] x [z0, z1] (Sutherland-Hodgman)."""

    def cut(pts, keep, at):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            if keep(b):
                if not keep(a):
                    out.append(at(a, b))
                out.append(b)
            elif keep(a):
                out.append(at(a, b))
        return out

    def on_x(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def on_z(z):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]), z)

    pts = list(poly)
    for keep, at in ((lambda q: q[0] >= x0, on_x(x0)), (lambda q: q[0] <= x1, on_x(x1)),
                     (lambda q: q[1] >= z0, on_z(z0)), (lambda q: q[1] <= z1, on_z(z1))):
        if len(pts) < 3:
            return []
        pts = cut(pts, keep, at)
    out = []
    for q in pts:  # a stripe edge running exactly through a corner repeats it
        if not out or abs(q[0] - out[-1][0]) + abs(q[1] - out[-1][1]) > 1e-6:
            out.append(q)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) + abs(out[0][1] - out[-1][1]) <= 1e-6:
        out.pop()
    area = 0.5 * sum(out[i - 1][0] * out[i][1] - out[i][0] * out[i - 1][1] for i in range(len(out)))
    return out if len(out) >= 3 and abs(area) > 1e-6 else []


def hazard_block(p, size, at=(0.0, 0.0, 0.0), rot=None, stripe=0.15, slant=0.8, along="x",
                 mats=("M_MetalYellow", "M_PlasticDark"), phase=0.0):
    """Box size = (w, d, h) centred at `at`, cut into slanted stripes of alternating materials: diagonals on the
    +-Y faces, bands round the other faces. along='x': the stripes march across the width (bumpers, beams);
    'z': up the height (posts). ~12 tris per stripe."""
    w, d, h = size
    span, other = (w, h) if along == "x" else (h, w)
    reach = abs(slant) * other / 2
    with p.frame(at, rot):
        for k in range(math.floor((-span / 2 - reach - phase) / stripe), math.floor((span / 2 + reach - phase) / stripe) + 1):
            u0, u1 = phase + k * stripe, phase + (k + 1) * stripe
            if along == "x":  # boundaries x = u + slant * z
                quad = [(u0 - slant * h / 2, -h / 2), (u1 - slant * h / 2, -h / 2), (u1 + slant * h / 2, h / 2),
                        (u0 + slant * h / 2, h / 2)]
            else:  # boundaries z = u + slant * x
                quad = [(-w / 2, u0 - slant * w / 2), (w / 2, u0 + slant * w / 2), (w / 2, u1 + slant * w / 2),
                        (-w / 2, u1 - slant * w / 2)]
            poly = clip_rect(quad, -w / 2, w / 2, -h / 2, h / 2)
            if poly:
                p.prism(poly, d, mat=mats[k % 2])


def rail_bar(p, x, y0, y1, z0):
    """One rail along Y from y0 to y1, its foot on z = z0: rusty foot and web, a polished head (the bright line
    the game camera reads). ~50 tris."""
    yc, length = (y0 + y1) / 2, y1 - y0
    p.prism([(px, pz + z0) for px, pz in RAIL_WEB], length, at=(x, yc, 0.0), mat="M_MetalRust")
    p.prism([(px, pz + z0) for px, pz in RAIL_HEAD], length, at=(x, yc, 0.0), mat="M_MetalSteel")


def oriented_quad(p, pts, mat, outward):
    """A single quad from 4 points, wound so its normal agrees with `outward`."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new(V(q)) for q in pts])
    bm.normal_update()
    if face.normal.dot(V(outward)) < 0:
        face.normal_flip()
    return p.add(bm, mat)


def build_rail_straight():
    """2 m of track along Y (y in [-1, 1]): four sleepers (one a concrete replacement), tie plates, two rails and
    half fishplates at both ends, so segments laid end to end tile seamlessly and make whole joints."""
    p = Prop("rail_straight", 271)
    zs, zp = 0.022, 0.028  # sleeper top, tie plate top = rail foot (rail heads at zp + RAIL_H = RAIL_TOP)
    for k, (y, dx, rz) in enumerate(((-0.75, 0.012, 1.2), (-0.25, -0.016, -0.8), (0.25, 0.02, 0.0), (0.75, -0.008, 1.5))):
        p.box((1.44, 0.2, zs), at=(dx, y, zs / 2), rot=(0, 0, rz), mat="M_ConcreteDark" if k == 2 else "M_Wood",
              bevel=0.005, axes="x")
        for s in (-1, 1):
            p.box((0.17, 0.21, zp - zs), at=(s * GAUGE / 2, y, (zs + zp) / 2), mat="M_MetalDark")
    for s in (-1, 1):
        x = s * GAUGE / 2
        rail_bar(p, x, -1.0, 1.0, zp)
        for e in (-1, 1):
            p.box((0.034, 0.09, 0.011), at=(x, e * 0.955, zp + 0.0155), mat="M_MetalDark")
    return p


def build_rail_buffer():
    """Buffer stop over the last metre of a track: two braced frames clamped onto the rails, a hazard-striped
    buffer beam with two buffers at BUFFER_Z facing -Y (the oncoming train), a red / white end board and a red
    lamp on top. Footprint 1.5 x 1.0 m (y in [-0.5, 0.5]), 1.2 m high."""
    p = Prop("rail_buffer", 291)
    yb0, yb1 = -0.345, -0.145  # buffer beam front / back face
    zb0, zb1 = BUFFER_Z - 0.15, BUFFER_Z + 0.15
    for s in (-1, 1):
        x = s * GAUGE / 2
        for yc in (-0.25, 0.36):  # clamps over the rail (the rail runs through them)
            p.boxz((0.15, 0.26, 0.12), x=x, y=yc, mat="M_MetalDark", bevel=0.01)
        p.boxz((0.12, 0.12, zb0 - 0.12), x=x, y=-0.25, z0=0.12, mat="M_MetalDark", bevel=0.01)
        p.beam((x, yb1 - 0.03, zb1 - 0.07), (x, 0.42, 0.11), (0.11, 0.11), mat="M_MetalRust", bevel=0.008)
    p.beam((-GAUGE / 2, 0.12, 0.33), (GAUGE / 2, 0.12, 0.33), (0.08, 0.08), mat="M_MetalDark")
    hazard_block(p, (1.5, yb1 - yb0, zb1 - zb0), at=(0.0, (yb0 + yb1) / 2, BUFFER_Z), stripe=0.15, slant=0.9)
    p.box((1.54, 0.23, 0.03), at=(0.0, (yb0 + yb1) / 2, zb1 + 0.015), mat="M_MetalDark", bevel=0.006)
    for s in (-1, 1):
        x = s * 0.55
        p.cyl(0.075, 0.12, at=(x, yb0 - 0.06, BUFFER_Z), rot=(90, 0, 0), mat="M_MetalDark", n=10)
        p.cyl(0.13, 0.035, at=(x, -0.4825, BUFFER_Z), rot=(90, 0, 0), mat="M_MetalSteel", n=12, bevel=0.008)
    zt = zb1 + 0.03
    hazard_block(p, (0.6, 0.03, 0.28), at=(0.0, -0.24, zt + 0.15), stripe=0.1, slant=-0.9,
                 mats=("M_MetalRed", "M_PlasticLight"))
    zl = zt + 0.36
    p.box((0.17, 0.13, 0.13), at=(0.0, -0.22, zl), mat="M_MetalDark", bevel=0.015)
    p.cyl(0.045, 0.02, at=(0.0, -0.29, zl), rot=(90, 0, 0), mat="M_NeonRed", n=10)
    p.box((0.14, 0.07, 0.012), at=(0.0, -0.3, zl + 0.07), rot=(-15, 0, 0), mat="M_MetalDark")
    p.light((0.0, -0.4, zl), "red")
    with p.frame((0.42, yb0, zb0 + 0.06)):
        p.plate([(-0.16, -0.05), (0.06, -0.06), (0.14, 0.02), (0.02, 0.06), (-0.12, 0.04)], 0.003)
    return p


def build_rail_signal():
    """Semaphore signal, ~3.5 m: concrete footing, galvanised mast with a hazard sleeve at the foot, ladder and
    platform at the back, a two-aspect lamp head (red over green, both lit) on a dark target board facing -Y,
    and a red semaphore arm raised to 'clear' at the top, swinging out to +X above head height.
    Footprint 0.4 x 0.4 m."""
    p = Prop("rail_signal", 301)
    p.boxz((0.4, 0.4, 0.16), mat="M_ConcreteDark", bevel=0.015)
    p.boxz((0.24, 0.24, 0.02), z0=0.16, mat="M_MetalDark")
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.boxz((0.03, 0.03, 0.025), x=sx * 0.09, y=sy * 0.09, z0=0.18, mat="M_MetalSteel")
    zt = 3.05
    p.cylz(0.055, 0.18, zt, mat="M_MetalGalv", n=8)
    for i in range(4):
        z = 0.26 + i * 0.16
        p.cylz(0.059, z, z + 0.16, mat="M_MetalYellow" if i % 2 == 0 else "M_PlasticDark", n=8, caps=False)
    # ladder and platform behind the mast
    yl, zp = 0.1, 2.2
    for sx in (-1, 1):
        p.boxz((0.025, 0.025, zp - 0.2), x=sx * 0.13, y=yl, z0=0.2, mat="M_MetalDark")
    for i in range(7):
        p.box((0.26, 0.02, 0.02), at=(0.0, yl, 0.48 + i * 0.27), mat="M_MetalDark")
    for z in (0.7, 1.9):
        p.box((0.3, 0.1, 0.025), at=(0.0, 0.055, z), mat="M_MetalDark")
    p.boxz((0.5, 0.44, 0.035), y=0.07, z0=zp, mat="M_MetalDark", bevel=0.006)
    p.tube([(-0.24, 0.27, zp + 0.03), (-0.24, 0.27, zp + 0.42), (0.24, 0.27, zp + 0.42), (0.24, 0.27, zp + 0.03)],
           0.014, n=5, mat="M_MetalYellow", soft=False)
    # lamp head: dark target board, red over green, a visor over each lens
    zl = 2.55
    p.box((0.2, 0.15, 0.46), at=(0.0, -0.01, zl), mat="M_MetalDark", bevel=0.015)
    p.box((0.36, 0.035, 0.56), at=(0.0, -0.1, zl), mat="M_PlasticDark", bevel=0.03)
    for dz, m in ((0.12, "M_NeonRed"), (-0.12, "M_NeonGreen")):
        p.cyl(0.072, 0.02, at=(0.0, -0.125, zl + dz), rot=(90, 0, 0), mat=m, n=12)
        p.box((0.19, 0.11, 0.014), at=(0.0, -0.17, zl + dz + 0.085), rot=(-12, 0, 0), mat="M_MetalDark")
    p.light((0.0, -0.3, zl - 0.12), "green")
    # semaphore arm, raised 38 deg ('clear'): red blade with a white band, counterweight behind the pivot
    za = zt - 0.12
    p.cyl(0.05, 0.08, at=(0.0, -0.09, za), rot=(90, 0, 0), mat="M_MetalDark", n=10)
    with p.frame((0.0, -0.14, za), (0, -38, 0)):
        p.box((0.98, 0.025, 0.15), at=(0.55, 0.0, 0.0), mat="M_MetalRed", bevel=0.006)
        p.box((0.07, 0.029, 0.154), at=(0.86, 0.0, 0.0), mat="M_PlasticLight")
        p.box((0.16, 0.04, 0.09), at=(-0.07, 0.0, 0.0), mat="M_MetalDark")
    p.cylz(0.07, zt, zt + 0.04, mat="M_MetalDark", n=8)
    p.cylz(0.06, zt + 0.04, zt + 0.17, r2=0.012, mat="M_MetalDark", n=8)
    # cable from the relay box at the foot up to the lamp
    p.box((0.13, 0.1, 0.17), at=(-0.11, -0.04, 0.44), mat="M_MetalGalv", bevel=0.008)
    p.box((0.06, 0.004, 0.05), at=(-0.11, -0.092, 0.47), mat="M_MetalYellow")
    p.tube([(-0.075, -0.035, 0.52), (-0.064, -0.035, 1.1), (-0.064, -0.035, zl - 0.3), (-0.07, -0.02, zl - 0.2)],
           0.011, n=4)
    return p


def build_turntable():
    """Locomotive turntable, 5 m: concrete kerb ring, dark pit gap with the ring rail, a dark concrete deck with a
    slanted yellow / black rim, a plank bridge carrying the rails across (along Y at rot 0; rail heads at
    TABLE_RAIL_TOP), centre pivot and a flush drive hatch on the north end of the bridge. Walkable: nothing
    stands higher than the rail heads (~0.12 m)."""
    p = Prop("turntable", 281)
    n, R = 40, 2.2  # lathe segments, deck radius
    zd, zb = 0.072, 0.08  # deck top, plank top = rail foot
    p.lathe([(2.52, 0.0), (2.52, 0.045), (2.49, 0.06), (2.38, 0.06), (2.36, 0.004)], n=n, cap0=False, cap1=False,
            mat="M_Concrete")
    p.lathe([(2.36, 0.004), (R - 0.03, 0.004)], n=n, cap0=False, cap1=False, mat="M_RoofTar")
    p.lathe([(2.306, 0.004), (2.306, 0.024), (2.274, 0.024), (2.274, 0.004)], n=n, cap0=False, cap1=False,
            bands=["M_MetalRust", "M_MetalSteel", "M_MetalRust"])
    p.lathe([(1.96, zd), (0.0, zd)], n=n, mat="M_ConcreteDark")
    ns, skew, ri = 36, math.radians(6.0), 1.96
    for k in range(ns):
        a0, a1 = math.tau * k / ns, math.tau * (k + 1) / ns
        inner = [V((ri * math.cos(a), ri * math.sin(a), zd)) for a in (a0, a1)]
        outer = [V((R * math.cos(a + skew), R * math.sin(a + skew), zd)) for a in (a1, a0)]
        mid = (a0 + a1) / 2 + skew
        m = "M_MetalYellow" if k % 2 == 0 else "M_PlasticDark"
        oriented_quad(p, inner + outer, m, (0.0, 0.0, 1.0))
        oriented_quad(p, [outer[0], outer[1], outer[1] - V((0, 0, zd - 0.004)), outer[0] - V((0, 0, zd - 0.004))], m,
                      (math.cos(mid), math.sin(mid), 0.0))
    rng = p.rng
    npl, yp = 15, 1.9
    pitch = 2 * yp / npl
    for i in range(npl):
        y = -yp + pitch * (i + 0.5)
        end = i in (0, npl - 1)
        p.box((1.72, pitch - 0.026, zb - zd), at=(0.0 if end else rng.uniform(-0.012, 0.012), y, (zd + zb) / 2),
              mat="M_MetalYellow" if end else ("M_Wood" if i % 3 == 1 else "M_WoodLight"))
    ye = math.sqrt(R * R - (GAUGE / 2 + 0.04) ** 2) - 0.01
    for s in (-1, 1):
        x = s * GAUGE / 2
        rail_bar(p, x, -ye, ye, zb)
        for e in (-1, 1):
            p.box((0.16, ye - yp + 0.02, zb - zd), at=(x, e * (ye + yp) / 2, (zd + zb) / 2), mat="M_MetalDark")
    p.cylz(0.2, zb, zb + 0.022, mat="M_MetalSteel", n=12, bevel=0.006)
    p.cylz(0.09, zb + 0.022, zb + 0.034, mat="M_MetalDark", n=10)
    with p.frame((0.86, 1.6, zd)):  # drive hatch, top flush with the rail heads
        p.boxz((0.34, 0.4, TABLE_RAIL_TOP - zd), mat="M_MetalYellow", bevel=0.008)
        p.boxz((0.24, 0.28, 0.003), z0=TABLE_RAIL_TOP - zd, mat="M_PlasticDark")
        for i in range(3):
            p.boxz((0.2, 0.025, 0.004), y=-0.08 + i * 0.08, z0=TABLE_RAIL_TOP - zd, mat="M_MetalDark")
    return p


def build_locomotive():
    """Shunting locomotive 1.6 x 3.6 x 2.4 m, nose (long hood, headlamp) toward -Y: two bogies whose wheels stand
    on RAIL_TOP at the track gauge, hazard-striped buffer beams with buffers at BUFFER_Z, a walkway with yellow
    edges and handrails, the exhaust stack right in front of the cab, a cab with lit windows (M_WindowLit) and a
    pale roof (what the game camera sees most)."""
    p = Prop("locomotive", 311)
    rw = 0.21  # tread radius; the 10-sided wheel rests on a flat edge
    zw = RAIL_TOP + rw * math.cos(math.pi / 10)  # wheel centre
    for yb in (-0.95, 0.95):
        for ya in (-0.34, 0.34):
            for s in (-1, 1):
                p.cyl(rw, 0.09, at=(s * GAUGE / 2, yb + ya, zw), rot=(0, 90, 0), mat="M_MetalDark", n=10)
                p.box((0.1, 0.16, 0.16), at=(s * 0.67, yb + ya, zw), mat="M_MetalDark")
                p.boxz((0.06, 0.06, 0.47 - zw - 0.08), x=s * 0.67, y=yb + ya, z0=zw + 0.08, mat="M_MetalYellow")
        for s in (-1, 1):
            p.box((0.06, 1.12, 0.2), at=(s * 0.63, yb, zw + 0.02), mat="M_MetalDark")
        p.box((1.2, 0.3, 0.1), at=(0.0, yb, 0.42), mat="M_MetalDark")
    p.box((1.0, 0.7, 0.22), at=(0.0, 0.0, 0.34), mat="M_MetalDark", bevel=0.03)  # fuel tank
    for s in (-1, 1):
        p.cyl(0.09, 0.6, at=(s * 0.6, 0.0, 0.36), rot=(90, 0, 0), mat="M_MetalGalv", n=8)
    # frame, walkway with yellow edges, hazard-striped buffer beams with buffers, couplers and life guards
    zf0, zf1 = 0.46, 0.62
    zw1 = zf1 + 0.04
    p.boxz((1.4, 3.2, zf1 - zf0), z0=zf0, mat="M_MetalDark")
    p.boxz((1.6, 3.1, zw1 - zf1), z0=zf1, mat="M_MetalDark")
    for s in (-1, 1):
        p.boxz((0.025, 3.1, 0.052), x=s * 0.79, z0=zf1 - 0.005, mat="M_MetalYellow")
    for e in (-1, 1):
        with p.frame((0.0, e * 1.59, BUFFER_Z), (0, 0, 0 if e < 0 else 180)):
            hazard_block(p, (1.6, 0.12, 0.3), stripe=0.16, slant=0.9)
            for s in (-1, 1):
                p.cyl(0.07, 0.1, at=(s * 0.55, -0.11, 0.0), rot=(90, 0, 0), mat="M_MetalDark", n=8)
                p.cyl(0.12, 0.03, at=(s * 0.55, -0.175, 0.0), rot=(90, 0, 0), mat="M_MetalSteel", n=8)
                p.box((0.12, 0.02, 0.3), at=(s * GAUGE / 2, 0.035, -0.3), mat="M_MetalDark")
            p.box((0.14, 0.12, 0.1), at=(0.0, -0.11, -0.03), mat="M_MetalDark")
            p.box((0.05, 0.07, 0.05), at=(0.0, -0.2, -0.03), mat="M_MetalSteel")
    # long hood
    hy0, hy1, hz1 = -1.45, 0.25, 1.78
    p.box((1.1, hy1 - hy0, hz1 - zw1), at=(0.0, (hy0 + hy1) / 2, (zw1 + hz1) / 2), mat="M_MetalTeal", bevel=0.06,
          seg=2, axes="y")
    p.box((0.86, 0.012, 0.5), at=(0.0, hy0 - 0.006, 1.2), mat="M_PlasticDark")  # radiator grille
    for i in range(5):
        p.box((0.84, 0.026, 0.03), at=(0.0, hy0 - 0.018, 1.0 + i * 0.1), rot=(-25, 0, 0), mat="M_MetalDark")
    p.cyl(0.1, 0.08, at=(0.0, hy0 - 0.04, 1.6), rot=(90, 0, 0), mat="M_MetalDark", n=12)
    p.cyl(0.078, 0.012, at=(0.0, hy0 - 0.086, 1.6), rot=(90, 0, 0), mat="M_LampWarm", n=12)
    p.light((0.0, hy0 - 0.4, 1.6), "warm")
    p.box((0.32, 0.01, 0.1), at=(0.0, hy0 - 0.005, 0.8), mat="M_MetalYellow")
    for i in range(3):
        p.box((0.05, 0.004, 0.064), at=(-0.08 + i * 0.08, hy0 - 0.012, 0.8), mat="M_PlasticDark")
    for s in (-1, 1):
        for yc in (-0.95, -0.3):
            with p.frame((s * 0.55, yc, 1.28), facing((s, 0, 0))):
                p.plate([(-0.24, -0.2), (0.24, -0.2), (0.24, 0.2), (-0.24, 0.2)], 0.01, mat="M_PlasticDark")
                for i in range(2):
                    p.box((0.46, 0.022, 0.04), at=(0.0, -0.016, -0.08 + i * 0.16), rot=(-30, 0, 0), mat="M_MetalTeal")
    with p.frame((0.555, -0.62, 0.86), facing((1, 0, 0))):
        p.plate([(-0.2, -0.1), (0.08, -0.13), (0.22, -0.04), (0.16, 0.08), (-0.1, 0.06)], 0.003)
    with p.frame((-0.555, 0.02, 0.92), facing((-1, 0, 0))):
        p.plate([(-0.12, -0.12), (0.1, -0.14), (0.16, 0.0), (0.04, 0.1), (-0.14, 0.04)], 0.003)
    # hood top: radiator fan, sand fillers, a hatch, the exhaust stack just in front of the cab
    p.cylz(0.2, hz1 - 0.01, hz1 + 0.02, y=-1.0, mat="M_PlasticDark", n=12)
    for a in (45, 135):
        p.box((0.38, 0.024, 0.02), at=(0.0, -1.0, hz1 + 0.026), rot=(0, 0, a), mat="M_MetalDark")
    p.cylz(0.05, hz1, hz1 + 0.04, y=-1.0, mat="M_MetalDark", n=8)
    for s in (-1, 1):
        p.cylz(0.04, hz1 - 0.01, hz1 + 0.04, x=s * 0.38, y=-1.36, mat="M_MetalYellow", n=8)
    p.box((0.8, 0.34, 0.014), at=(0.0, -0.48, hz1 + 0.005), mat="M_MetalTeal", bevel=0.004)
    p.box((0.16, 0.03, 0.02), at=(0.0, -0.64, hz1 + 0.02), mat="M_MetalYellow")
    p.cylz(0.07, hz1 - 0.01, hz1 + 0.36, y=-0.08, mat="M_MetalDark", n=10)
    p.cylz(0.085, hz1 + 0.32, hz1 + 0.42, y=-0.08, mat="M_MetalRust", n=10)
    # handrails along the hood and across the nose
    for s in (-1, 1):
        x = s * 0.74
        for yc in (-1.48, -0.85, -0.2):
            p.cylz(0.016, zw1, 1.38, x=x, y=yc, mat="M_MetalYellow", n=5)
        p.tube([(x, -1.48, 1.38), (x, 0.2, 1.38)], 0.018, n=5, mat="M_MetalYellow")
    p.tube([(-0.74, -1.48, 1.12), (0.74, -1.48, 1.12)], 0.016, n=5, mat="M_MetalYellow")
    # cab: lit windows all round, doors with grab handles and steps, pale arched roof, horn
    cy0, cy1, cz1 = 0.25, 1.5, 2.2
    p.box((1.5, cy1 - cy0, cz1 - zw1), at=(0.0, (cy0 + cy1) / 2, (zw1 + cz1) / 2), mat="M_MetalTeal", bevel=0.03)
    arch = [(-0.8, 0.0), (0.8, 0.0), (0.8, 0.05), (0.62, 0.12), (0.32, 0.165), (0.0, 0.18), (-0.32, 0.165),
            (-0.62, 0.12), (-0.8, 0.05)]
    p.prism([(x, cz1 - 0.01 + z) for x, z in arch], cy1 - cy0 + 0.1, at=(0.0, (cy0 + cy1) / 2, 0.0),
            mat="M_PlasticLight")

    def window(centre, size, normal):
        w, h = size
        with p.frame(centre, facing(normal)):
            p.plate([(-w / 2 - 0.03, -h / 2 - 0.03), (w / 2 + 0.03, -h / 2 - 0.03), (w / 2 + 0.03, h / 2 + 0.03),
                     (-w / 2 - 0.03, h / 2 + 0.03)], 0.008, mat="M_PlasticDark")
            p.plate([(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)], 0.006, at=(0.0, -0.008, 0.0),
                    mat="M_WindowLit")

    for e, yf in ((-1, cy0), (1, cy1)):
        for s in (-1, 1):
            window((s * 0.34, yf, 1.84), (0.48, 0.42), (0, e, 0))
    for s in (-1, 1):
        xs = s * 0.75
        window((xs, 0.5, 1.84), (0.3, 0.42), (s, 0, 0))
        window((xs, 1.12, 1.84), (0.5, 0.42), (s, 0, 0))
        for yd in (0.31, 0.69):
            p.box((0.012, 0.018, 1.36), at=(xs + s * 0.006, yd, 1.38), mat="M_PlasticDark")
        p.box((0.012, 0.4, 0.018), at=(xs + s * 0.006, 0.5, 2.07), mat="M_PlasticDark")
        p.box((0.03, 0.08, 0.025), at=(xs + s * 0.02, 0.62, 1.32), mat="M_MetalYellow")
        p.cylz(0.015, 0.9, 1.8, x=s * 0.78, y=0.27, mat="M_MetalYellow", n=5)
        for zs in (0.3, 0.48):
            p.box((0.2, 0.34, 0.025), at=(s * 0.74, 0.5, zs), mat="M_MetalYellow")
        for yd in (0.32, 0.68):
            p.box((0.02, 0.02, 0.36), at=(s * 0.84, yd, 0.42), mat="M_MetalDark")
    with p.frame((0.75, 1.12, 1.28), facing((1, 0, 0))):
        p.plate([(-0.17, -0.07), (0.17, -0.07), (0.17, 0.07), (-0.17, 0.07)], 0.006, mat="M_MetalYellow")
        for i in range(3):
            p.plate([(-0.12 + i * 0.09, -0.04), (-0.07 + i * 0.09, -0.04), (-0.07 + i * 0.09, 0.04),
                     (-0.12 + i * 0.09, 0.04)], 0.003, at=(0.0, -0.006, 0.0), mat="M_PlasticDark")
    p.cyl(0.032, 0.24, at=(0.36, 0.62, 2.36), rot=(90, 0, 0), mat="M_MetalDark", n=8)
    p.box((0.3, 0.26, 0.06), at=(-0.3, 1.05, 2.345), mat="M_MetalGalv")
    return p


def build_gantry_crane():
    """Portal (gantry) crane over a 4 m lane (x in [-2, 2], footprint depth 1 m): two A-frame legs on wheeled sills
    with hazard-striped feet, a double box girder at ~4.4-4.9 m, a trolley with hoist drum, motor and amber
    beacon, the hook block on two cables (hook bottom ~3.3 m: a hung load clears the robot), a floodlight under
    the front girder, a festoon cable along the back. The span between the legs (|x| < 1.6) is open; the front
    face of the front girder is left clean for a neon sign."""
    p = Prop("gantry_crane", 321)
    lx, zg0, zg1 = 1.78, 4.42, 4.86  # leg centre, girder bottom / top
    zc0 = zg0 - 0.3  # bottom of the end carriage = top of the legs
    zf, yf, yt = 0.32, 0.36, 0.11  # post foot height, foot / top half-spread of the A-frame

    def post_y(z):
        return yf + (yt - yf) * (z - zf) / (zc0 - zf)

    for s in (-1, 1):
        x = s * lx
        p.boxz((0.34, 0.92, 0.2), x=x, z0=0.12, mat="M_MetalDark", bevel=0.02)
        for yw in (-0.28, 0.28):
            p.cyl(0.11, 0.12, at=(x, yw, 0.11 * math.cos(math.pi / 10)), rot=(0, 90, 0), mat="M_MetalDark", n=10)
        for e in (-1, 1):
            p.box((0.18, 0.05, 0.12), at=(x, e * 0.475, 0.22), mat="M_Rubber")
        for sy in (-1, 1):
            a, b = V((x, sy * yf, zf)), V((x, sy * yt, zc0))
            d = (b - a).normalized()
            rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
            hz = 1.05
            hazard_block(p, (0.16, 0.14, hz), at=a + d * (hz / 2), rot=rot, stripe=0.15, slant=0.7, along="z")
            p.beam(a + d * hz, b, (0.16, 0.14), mat="M_MetalYellow", bevel=0.01)
        for z in (1.6, 3.05):
            p.beam((x, -post_y(z), z), (x, post_y(z), z), (0.1, 0.1), mat="M_MetalYellow")
        p.beam((x, -post_y(1.6) + 0.06, 1.64), (x, post_y(3.05) - 0.06, 3.0), (0.08, 0.08), mat="M_MetalYellow")
        p.boxz((0.38, 0.96, zg0 - zc0), x=x, z0=zc0, mat="M_MetalYellow", bevel=0.02)
    # double box girder with trolley rails and end stops
    for sy in (-1, 1):
        p.box((4.0, 0.2, zg1 - zg0), at=(0.0, sy * 0.26, (zg0 + zg1) / 2), mat="M_MetalYellow", bevel=0.015)
        p.box((3.84, 0.06, 0.025), at=(0.0, sy * 0.26, zg1 + 0.0125), mat="M_MetalSteel")
        for e in (-1, 1):
            p.box((0.08, 0.14, 0.1), at=(e * 1.94, sy * 0.26, zg1 + 0.05), mat="M_Rubber")
    for xr in (-1.2, -0.4, 0.4, 1.2):
        p.box((0.05, 0.03, zg1 - zg0 - 0.04), at=(xr, 0.375, (zg0 + zg1) / 2), mat="M_MetalYellow")
    # trolley: frame on the rails, hoist drum, motor + gearbox, amber beacon
    tx, zt = 0.35, zg1 + 0.025
    p.boxz((0.78, 0.86, 0.1), x=tx, z0=zt, mat="M_MetalDark", bevel=0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.boxz((0.13, 0.08, 0.1), x=tx + sx * 0.3, y=sy * 0.44, z0=zt - 0.04, mat="M_MetalDark")
    zd = zt + 0.1 + 0.14
    p.cyl(0.14, 0.44, at=(tx - 0.08, 0.0, zd), rot=(0, 90, 0), mat="M_MetalSteel", n=12)
    p.cyl(0.143, 0.3, at=(tx - 0.08, 0.0, zd), rot=(0, 90, 0), mat="M_Cable", n=12, caps=False)
    for e in (-1, 1):
        p.cyl(0.17, 0.025, at=(tx - 0.08 + e * 0.23, 0.0, zd), rot=(0, 90, 0), mat="M_MetalDark", n=12)
    p.boxz((0.24, 0.26, 0.22), x=tx + 0.26, y=0.17, z0=zt + 0.1, mat="M_MetalYellow", bevel=0.02)
    p.boxz((0.16, 0.2, 0.17), x=tx + 0.26, y=-0.13, z0=zt + 0.1, mat="M_MetalDark", bevel=0.012)
    zb = zt + 0.32
    p.cylz(0.06, zb, zb + 0.025, x=tx + 0.26, y=0.17, mat="M_MetalDark", n=8)
    p.cylz(0.045, zb + 0.025, zb + 0.11, x=tx + 0.26, y=0.17, mat="M_NeonOrange", n=8)
    p.cylz(0.05, zb + 0.11, zb + 0.13, x=tx + 0.26, y=0.17, mat="M_MetalDark", n=8)
    # hook: two cables down between the girders, striped block with sheaves, shank, hook
    hx, zh = tx - 0.08, 3.78
    for dx in (-0.05, 0.05):
        p.cylz(0.011, zh + 0.16, zd - 0.05, x=hx + dx, mat="M_Cable", n=5)
    hazard_block(p, (0.26, 0.16, 0.34), at=(hx, 0.0, zh), stripe=0.12, slant=0.9)
    for e in (-1, 1):
        p.cyl(0.1, 0.03, at=(hx + e * 0.145, 0.0, zh + 0.04), rot=(0, 90, 0), mat="M_MetalDark", n=10)
    zs = zh - 0.17 - 0.16
    p.cylz(0.045, zh - 0.21, zh - 0.17, x=hx, mat="M_MetalDark", n=8)
    p.cylz(0.028, zs, zh - 0.21, x=hx, mat="M_MetalDark", n=8)
    p.torus(0.085, 0.024, at=(hx + 0.085, 0.0, zs), rot=(90, 0, 0), mat="M_MetalSteel", n=10, m=6, arc=(180, 400))
    # floodlight under the front girder, tilted down toward the lane
    lxp = -0.85
    p.box((0.06, 0.06, 0.16), at=(lxp, -0.26, zg0 - 0.08), mat="M_MetalDark")
    with p.frame((lxp, -0.3, zg0 - 0.24), (15, 0, 0)):
        p.box((0.3, 0.16, 0.18), mat="M_MetalDark", bevel=0.02)
        p.box((0.25, 0.012, 0.13), at=(0.0, -0.085, 0.0), mat="M_LampWarm")
        p.box((0.32, 0.1, 0.014), at=(0.0, -0.1, 0.1), mat="M_MetalDark")
    p.light((lxp, -0.6, zg0 - 0.4), "flood")
    # festoon cable along the back girder to the trolley
    xs = [-1.72 + i * (tx - 0.42 + 1.72) / 3 for i in range(4)]
    yc = 0.385
    p.tube([(-1.76, yc, zg0 - 0.012), (tx - 0.36, yc, zg0 - 0.012)], 0.006, n=4, mat="M_MetalDark")
    for i in range(3):
        p.tube(sag((xs[i], yc, zg0 - 0.03), (xs[i + 1], yc, zg0 - 0.03), 0.26, 6), 0.016, n=4, mat="M_Cable")
    for x in xs:
        p.box((0.05, 0.05, 0.05), at=(x, yc, zg0 - 0.03), mat="M_MetalDark")
    # control box on the east leg, above the hazard band
    zcb = 1.95
    p.box((0.22, 0.12, 0.3), at=(lx, -post_y(zcb) - 0.12, zcb), mat="M_MetalGalv", bevel=0.01)
    p.box((0.035, 0.008, 0.035), at=(lx + 0.05, -post_y(zcb) - 0.184, zcb + 0.08), mat="M_NeonGreen")
    p.box((0.12, 0.006, 0.08), at=(lx - 0.03, -post_y(zcb) - 0.183, zcb - 0.04), mat="M_MetalYellow")
    return p


# ═════════════════════════════ catalogue ═════════════════════════════

ASSETS = [
    ("barrel", "street", build_barrel),
    ("crate", "street", build_crate),
    ("crate_stack", "street", build_crate_stack),
    ("trash_bags", "street", build_trash_bags),
    ("dumpster", "street", build_dumpster),
    ("vending", "street", build_vending),
    ("streetlamp", "street", build_streetlamp),
    ("bench", "street", build_bench),
    ("stall", "street", build_stall),
    ("crt_stack", "street", build_crt_stack),
    ("plant_pot", "street", build_plant_pot),
    ("cable_spool", "street", build_cable_spool),
    ("tires", "street", build_tires),
    ("steam_vent", "street", build_steam_vent),
    ("manhole", "street", build_manhole),
    ("ac_unit", "wall", build_ac_unit),
    ("pipe_v", "wall", build_pipe_v),
    ("pipe_h", "wall", build_pipe_h),
    ("awning", "wall", build_awning),
    ("wall_lamp", "wall", build_wall_lamp),
    ("fuse_box", "wall", build_fuse_box),
    ("vines", "wall", build_vines),
    ("lantern", "hanging", build_lantern),
    ("water_tank", "roof", build_water_tank),
    ("roof_vent", "roof", build_roof_vent),
    ("antenna", "roof", build_antenna),
    ("dish", "roof", build_dish),
    ("roof_ac", "roof", build_roof_ac),
    ("rail_straight", "depot", build_rail_straight),
    ("rail_buffer", "depot", build_rail_buffer),
    ("rail_signal", "depot", build_rail_signal),
    ("turntable", "depot", build_turntable),
    ("locomotive", "depot", build_locomotive),
    ("gantry_crane", "depot", build_gantry_crane),
]

GROUPS = [
    ("street_a", ["barrel", "crate", "crate_stack", "trash_bags", "dumpster"]),
    ("street_b", ["vending", "streetlamp", "bench", "stall"]),
    ("street_c", ["crt_stack", "plant_pot", "cable_spool", "tires", "steam_vent", "manhole"]),
    ("wall", ["ac_unit", "pipe_v", "pipe_h", "awning", "wall_lamp", "fuse_box", "vines"]),
    ("roof", ["lantern", "water_tank", "roof_vent", "antenna", "dish", "roof_ac"]),
    ("depot", ["rail_straight", "rail_buffer", "rail_signal", "turntable", "locomotive", "gantry_crane"]),
]

COLLECTIONS = {"street": "Props_Street", "wall": "Props_Wall", "hanging": "Props_Hanging", "roof": "Props_Rooftop",
               "depot": "Props_Depot"}
AO = {
    "street": dict(ground=True, wall=False, strength=0.5),
    "wall": dict(ground=False, wall=True, strength=0.45),
    "hanging": None,
    "roof": dict(ground=True, wall=False, strength=0.5),
    "depot": dict(ground=True, wall=False, strength=0.5),
}
# triangle budget per category (default: the design doc's 300..2500 for props); track pieces repeat, so they
# may be lighter, set pieces (crane, locomotive) a little heavier
TRIS = {"depot": (150, 3000)}
# lowest point above the ground when not 0: the locomotive's wheels stand on the rail heads
LIFT = {"locomotive": RAIL_TOP}


# ═════════════════════════════ scene, layout, renders ═════════════════════════════


def reset_scene():
    if bpy.app.background:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    else:
        for name in list(COLLECTIONS.values()) + ["Preview_Helpers", "Vignette"]:
            common.clear_collection(name)


def local_bounds(obj):
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    return V((min(xs), min(ys), min(zs))), V((max(xs), max(ys), max(zs)))


def helper_box(name, size, loc, mat_name, col):
    import bmesh

    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = V((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material(mat_name))
    obj = bpy.data.objects.new(name, me)
    obj.location = loc
    col.objects.link(obj)
    return obj


WALL_DISPLAY_Z = {"ac_unit": 1.6, "pipe_h": 2.4, "awning": 2.0, "wall_lamp": 2.0, "fuse_box": 0.9}  # sheet only


def layout(objs):
    """Display grid: one row per contact-sheet group. Returns {group: [objects + helpers]}."""
    helpers = common.get_collection("Preview_Helpers")
    rows = {}
    for r, (gname, ids) in enumerate(GROUPS):
        y = r * 7.0
        widths = []
        for i in ids:
            lo, hi = local_bounds(objs[i])
            widths.append((lo.x, hi.x))
        gap = 0.55
        total = sum(hx - lx for lx, hx in widths) + gap * (len(ids) - 1)
        x = -total / 2
        members = []
        for i, (lx, hx) in zip(ids, widths):
            o = objs[i]
            z = 1.95 if i == "lantern" else WALL_DISPLAY_Z.get(i, 0.0)
            o.location = (x - lx, y, z)
            x += (hx - lx) + gap
            members.append(o)
        if gname == "wall":
            members.append(helper_box("PH_Wall", (total + 0.8, 0.12, 3.3), (0, y + 0.06, 1.65), "M_Wall", helpers))
        if gname == "roof":
            lx = objs["lantern"].location.x
            members.append(helper_box("PH_Post", (0.06, 0.06, 2.0), (lx - 0.3, y, 1.0), "M_MetalDark", helpers))
            members.append(helper_box("PH_Arm", (0.36, 0.04, 0.04), (lx - 0.14, y, 1.97), "M_MetalDark", helpers))
        rows[gname] = members
    return rows


def linked_copy(obj, loc, rz=0.0, col=None):
    c = obj.copy()
    c.location = loc
    c.rotation_euler = (0.0, 0.0, math.radians(rz))
    (col or common.get_collection("Vignette")).objects.link(c)
    return c


LIGHT_KINDS = {  # preview point lights for the night vignette: colour, watts
    "street": ((1.0, 0.78, 0.5), 150.0),
    "warm": ((1.0, 0.78, 0.5), 35.0),
    "lantern": ((1.0, 0.55, 0.25), 8.0),
    "screen": ((0.25, 0.9, 0.8), 12.0),
    "pink": ((1.0, 0.2, 0.55), 12.0),
    "red": ((1.0, 0.2, 0.15), 2.0),
    "green": ((0.35, 1.0, 0.45), 10.0),
    "flood": ((1.0, 0.85, 0.45), 160.0),
}
VIGNETTE_CENTRE = (0.0, -12.0)
DEPOT_CENTRE = (0.0, -30.0)


def build_vignette(objs, lights):
    """6 x 4 m street slab with a 3 m wall behind, dressed like a level would. Returns (objects, lamps)."""
    col = common.get_collection("Vignette")
    ox, oy = VIGNETTE_CENTRE
    out = [helper_box("VG_Slab", (6.0, 4.0, 0.12), (ox, oy, -0.06), "M_ConcreteDark", col),
           helper_box("VG_Wall", (6.0, 0.25, 3.0), (ox, oy + 2.125, 1.5), "M_PlasterTeal", col),
           helper_box("VG_Robot", (0.85, 0.95, 1.15), (ox + 0.55, oy - 0.55, 0.575), "M_HarniShell", col)]
    lamps = []
    wy = oy + 2.0

    def put(i, x, y, z=0.0, rz=0.0):
        c = linked_copy(objs[i], (ox + x, y, z), rz, col)
        out.append(c)
        rot = Matrix.Rotation(math.radians(rz), 4, "Z")
        for pos, kind in lights.get(i, []):
            colour, watts = LIGHT_KINDS[kind]
            lamps.append((Vector((ox + x, y, z)) + (rot @ pos), colour, watts))

    put("stall", -1.75, wy - 0.52)
    put("vending", 0.0, wy - 0.4)
    put("trash_bags", 1.05, wy - 0.55, rz=8)
    put("barrel", 1.6, wy - 1.2, rz=30)
    put("crate_stack", 2.25, wy - 0.5, rz=-4)
    put("crate", -0.5, wy - 1.3, rz=22)
    put("manhole", -0.9, oy - 0.9)
    put("steam_vent", 2.1, oy - 1.2)
    put("streetlamp", -2.65, oy - 1.55, rz=180)
    put("pipe_v", -2.95, wy)
    put("pipe_h", -1.75, wy, z=2.68)
    put("ac_unit", 2.3, wy, z=2.0)
    put("awning", 0.45, wy, z=2.02)
    put("wall_lamp", 1.62, wy, z=2.1)
    put("fuse_box", 0.95, wy, z=0.95)
    # lantern string across the street
    a, b = V((ox - 3.0, oy + 0.6, 3.05)), V((ox + 3.0, oy + 0.6, 3.05))
    pts = sag(a, b, 0.45, 16)
    cable = Prop("VG_Cable")
    cable.tube(pts, 0.01, n=5)
    out.append(cable.finish(col, material, weighted=False))
    for t in (0.18, 0.34, 0.5, 0.66, 0.82):
        pnt = pts[round(t * 16)]
        out.append(linked_copy(objs["lantern"], (pnt.x, pnt.y, pnt.z - 0.01), 0.0, col))
        for pos, kind in lights["lantern"]:
            colour, watts = LIGHT_KINDS[kind]
            lamps.append((Vector((pnt.x, pnt.y, pnt.z - 0.01)) + pos, colour, watts))
    return out, lamps


def build_depot_vignette(objs, lights):
    """A 15 x 13 m depot laid out like a level would: track A under the gantry crane with the locomotive and a
    buffer stop at its north end; track B past the signal into the turntable. Returns (objects, lamps)."""
    col = common.get_collection("Vignette")
    ox, oy = DEPOT_CENTRE
    out = [helper_box("VD_Slab", (15.0, 13.0, 0.12), (ox, oy, -0.06), "M_ConcreteDark", col),
           helper_box("VD_Robot", (0.85, 0.95, 1.15), (ox - 0.9, oy - 2.4, 0.575), "M_HarniShell", col)]
    lamps = []

    def put(i, x, y, z=0.0, rz=0.0):
        out.append(linked_copy(objs[i], (ox + x, oy + y, z), rz, col))
        rot = Matrix.Rotation(math.radians(rz), 4, "Z")
        for pos, kind in lights.get(i, []):
            colour, watts = LIGHT_KINDS[kind]
            lamps.append((Vector((ox + x, oy + y, z)) + (rot @ pos), colour, watts))

    xa, xb = -3.0, 3.2
    for k in range(6):
        put("rail_straight", xa, -5.0 + 2.0 * k)
    put("rail_buffer", xa, 5.5)
    put("gantry_crane", xa, 1.4)
    put("locomotive", xa, -2.4)
    for k in range(3):
        put("rail_straight", xb, -5.0 + 2.0 * k)
    put("turntable", xb, 2.52)
    put("rail_signal", xb - 1.25, -3.4)
    return out, lamps


def _isolate_render(objects, camera, filename, res):
    scene = bpy.context.scene
    prev_cam = scene.camera
    scene.camera = camera
    keep = {o.name for o in objects}
    hidden = []
    for o in scene.objects:
        if o.name not in keep and o.type not in {"LIGHT", "CAMERA"} and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    r = scene.render
    prev = (r.resolution_x, r.resolution_y, r.filepath)
    path = os.path.join(common.PREVIEW_DIR, filename)
    try:
        r.engine = "BLENDER_EEVEE"
        r.resolution_x, r.resolution_y = res
        r.resolution_percentage = 100
        r.image_settings.file_format = "PNG"
        r.filepath = path
        bpy.ops.render.render(write_still=True)
    finally:
        r.resolution_x, r.resolution_y, r.filepath = prev
        scene.camera = prev_cam
        for o in hidden:
            o.hide_render = False
    return path


def render_sheet(objects, filename, view="three_quarter", res=(1800, 800), margin=1.06, dist_factor=3.2):
    """Contact sheet: perspective camera along common.VIEWS[view], FOV and lens shift fitted to the projected
    bounding boxes (render_preview fits a sphere, which leaves wide rows tiny)."""
    common._preview_rig()
    scene = bpy.context.scene
    cam = bpy.data.objects.get("HN_SheetCam")
    if cam is None:
        cam = bpy.data.objects.new("HN_SheetCam", bpy.data.cameras.new("HN_SheetCam"))
        scene.collection.objects.link(cam)
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in objects if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre, radius = (lo + hi) / 2, (hi - lo).length / 2
    d = Vector(common.VIEWS[view]).normalized()
    cam.location = centre + d * radius * dist_factor
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    us, vs = [], []
    for p in pts:
        q = inv @ p
        us.append(q.x / -q.z)
        vs.append(q.y / -q.z)
    aspect = res[0] / res[1]
    half = max((max(us) - min(us)) / 2, (max(vs) - min(vs)) / 2 * aspect) * margin
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.angle = 2 * math.atan(half)
    cam.data.shift_x = ((max(us) + min(us)) / 2) / (2 * half)
    cam.data.shift_y = ((max(vs) + min(vs)) / 2) / (2 * half)
    cam.data.clip_start, cam.data.clip_end = 0.05, 500
    return _isolate_render(objects, cam, filename, res)


def render_game_camera(objects, filename, target, distance=17.0, res=(1600, 900), rig=True):
    """Exact in-game framing: FOV 35 deg vertical, pitched 52 deg, looking north (+Y), from `distance`.
    rig=False keeps the current lights / world (the night pass), since _preview_rig() resets them."""
    scene = bpy.context.scene
    if rig:
        common._preview_rig()
    cam = bpy.data.objects.get("HN_GameCam")
    if cam is None:
        cam = bpy.data.objects.new("HN_GameCam", bpy.data.cameras.new("HN_GameCam"))
        scene.collection.objects.link(cam)
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(35)
    cam.data.clip_start, cam.data.clip_end = 0.1, 200
    d = Vector(common.VIEWS["game"]).normalized()
    cam.location = Vector(target) + d * distance
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    return _isolate_render(objects, cam, filename, res)


def night_setup(enable, lamp_points=()):
    """Night look for the vignette: dark teal world, dim moon, a few practical lights, bloom."""
    scene = bpy.context.scene
    common._preview_rig()  # make sure the suns and world exist, then dim them
    world = scene.world
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    key, fill = bpy.data.objects.get("HN_PreviewKey"), bpy.data.objects.get("HN_PreviewFill")
    if enable:
        bg.inputs["Color"].default_value = (0.012, 0.03, 0.045, 1.0)
        key.data.energy, key.data.color = 0.35, (0.55, 0.7, 1.0)
        fill.data.energy = 0.15
        for i, (loc, colour, power) in enumerate(lamp_points):
            ld = bpy.data.lights.new(f"VG_Light{i}", "POINT")
            ld.energy, ld.color, ld.shadow_soft_size = power, colour, 0.08
            lo = bpy.data.objects.new(f"VG_Light{i}", ld)
            lo.location = loc
            common.get_collection("Vignette").objects.link(lo)
        ng = bpy.data.node_groups.get("HN_Bloom") or bpy.data.node_groups.new("HN_Bloom", "CompositorNodeTree")
        ng.nodes.clear()
        if not ng.interface.items_tree:
            ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        rl = ng.nodes.new("CompositorNodeRLayers")
        gl = ng.nodes.new("CompositorNodeGlare")
        gl.inputs["Type"].default_value = "Bloom"
        gl.inputs["Threshold"].default_value = 1.0
        gl.inputs["Strength"].default_value = 0.6
        gl.inputs["Size"].default_value = 0.6
        out = ng.nodes.new("NodeGroupOutput")
        ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
        ng.links.new(gl.outputs["Image"], out.inputs[0])
        scene.compositing_node_group = ng
    else:
        bg.inputs["Color"].default_value = (0.035, 0.05, 0.065, 1.0)
        key.data.energy, key.data.color = 3.2, (1.0, 0.93, 0.85)
        fill.data.energy = 1.0
        for o in [o for o in bpy.data.objects if o.name.startswith("VG_Light")]:
            bpy.data.objects.remove(o, do_unlink=True)
        scene.compositing_node_group = None


class AOPreview:
    """Renders only: multiply the baked 'Col' attribute into every material's base colour, the way the game
    multiplies COLOR_0. Meshes without one (helpers, the lantern) get a temporary white 'Col'. All of it is
    removed again on exit, before the .blend is saved."""

    def __init__(self, enable):
        self.enable = enable
        self.nodes, self.attrs = [], []

    def __enter__(self):
        if not self.enable:
            return self
        for me in bpy.data.meshes:
            if me.users and "Col" not in me.color_attributes:
                a = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
                for d in a.data:
                    d.color = (1.0, 1.0, 1.0, 1.0)
                self.attrs.append(me.name)
        for m in bpy.data.materials:
            nt = m.node_tree if m.use_nodes else None
            bsdf = nt and next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if not bsdf or bsdf.inputs["Base Color"].is_linked:
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
            self.nodes.append((m, [rgb, attr, mul]))
        return self

    def __exit__(self, *exc):
        for m, nodes in self.nodes:
            for n in nodes:
                m.node_tree.nodes.remove(n)
        for name in self.attrs:
            me = bpy.data.meshes.get(name)
            if me and "Col" in me.color_attributes:
                me.color_attributes.remove(me.color_attributes["Col"])
        return False


# ═════════════════════════════ validation ═════════════════════════════

WALL = {"ac_unit", "pipe_v", "pipe_h", "awning", "wall_lamp", "fuse_box", "vines"}


def glb_root_names(path):
    with open(path, "rb") as fh:
        data = fh.read()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + length].decode("utf-8"))
    scene = gltf["scenes"][gltf.get("scene", 0)]
    return [gltf["nodes"][i]["name"] for i in scene["nodes"]], gltf


def validate(manifest_path, glb_path):
    with open(manifest_path, encoding="utf-8") as fh:
        man = json.load(fh)
    ids = [a[0] for a in ASSETS]
    found = {m["id"]: m for m in man}
    problems = []
    for i in ids:
        if i not in found:
            problems.append(f"{i}: missing from manifest")
    for m in man:
        i, mn, mx, tris = m["id"], m["min"], m["max"], m["tris"]
        cat = dict((a[0], a[1]) for a in ASSETS)[i]
        lo, hi = TRIS.get(cat, (300, 2500))
        if not lo <= tris <= hi:
            problems.append(f"{i}: {tris} tris outside {lo}..{hi}")
        if cat in ("street", "roof", "depot") and abs(mn[1] - LIFT.get(i, 0.0)) > 0.003:
            problems.append(f"{i}: min y {mn[1]} (should sit on {LIFT.get(i, 0.0)})")
        if cat == "wall":
            if mn[2] < -0.0005:
                problems.append(f"{i}: geometry behind the wall plane (min z {mn[2]})")
            if mn[2] > 0.003:
                problems.append(f"{i}: does not touch the wall plane (min z {mn[2]})")
            if abs(mn[1]) > 0.003:
                problems.append(f"{i}: min y {mn[1]} (bottom should be 0)")
        if cat == "hanging" and abs(mx[1]) > 0.003:
            problems.append(f"{i}: max y {mx[1]} (hook should be at 0)")
        if len(m["nodes"]) != 1:
            problems.append(f"{i}: {len(m['nodes'])} nodes (expected one mesh)")
    pv, ph = found.get("pipe_v"), found.get("pipe_h")
    if pv and (abs(pv["min"][1]) > 1e-3 or abs(pv["max"][1] - 3.0) > 1e-3):
        problems.append(f"pipe_v: y range {pv['min'][1]}..{pv['max'][1]} (want 0..3)")
    if ph and (abs(ph["min"][0] + 1.0) > 1e-3 or abs(ph["max"][0] - 1.0) > 1e-3):
        problems.append(f"pipe_h: x range {ph['min'][0]}..{ph['max'][0]} (want -1..1)")
    rs, gc = found.get("rail_straight"), found.get("gantry_crane")
    if rs and (abs(rs["min"][2] + 1.0) > 1e-3 or abs(rs["max"][2] - 1.0) > 1e-3 or abs(rs["max"][1] - RAIL_TOP) > 1e-3):
        problems.append(f"rail_straight: z {rs['min'][2]}..{rs['max'][2]}, top {rs['max'][1]} (want -1..1, {RAIL_TOP})")
    if gc and (abs(gc["min"][0] + 2.0) > 1e-3 or abs(gc["max"][0] - 2.0) > 1e-3 or max(abs(gc["min"][2]), gc["max"][2]) > 0.5):
        problems.append(f"gantry_crane: x {gc['min'][0]}..{gc['max'][0]}, z {gc['min'][2]}..{gc['max'][2]} (want 4 x 1 m)")
    tt = found.get("turntable")
    if tt and tt["max"][1] > TABLE_RAIL_TOP + 0.01:
        problems.append(f"turntable: top {tt['max'][1]} (walkable: want <= {TABLE_RAIL_TOP + 0.01:.3f})")
    roots, gltf = glb_root_names(glb_path)
    if sorted(roots) != sorted(ids):
        problems.append(f"GLB roots differ: extra {sorted(set(roots) - set(ids))}, missing {sorted(set(ids) - set(roots))}")
    for node in gltf["nodes"]:
        if any(abs(t) > 1e-6 for t in node.get("translation", [0, 0, 0])) or node.get("rotation") or node.get("scale"):
            problems.append(f"GLB node {node['name']} has a transform {node.get('translation')} {node.get('rotation')} {node.get('scale')}")
    return man, roots, problems


# ═════════════════════════════ main ═════════════════════════════


def render_all(objs, rows, vignette, lamps, depot, depot_lamps):
    """RENDERS: all | singles | sheets | vignette | depot (only the depot props: singles, sheet, vignette) | none."""
    only_depot = RENDERS == "depot"
    if RENDERS in ("all", "singles", "depot"):
        for aid, cat, _fn in ASSETS:
            if (ONLY and aid not in ONLY) or (only_depot and cat != "depot"):
                continue
            common.render_preview([objs[aid]], f"prop_{aid}.png", view="three_quarter", resolution=(900, 700))
            if cat == "depot":  # set pieces: also as the game camera sees them
                common.render_preview([objs[aid]], f"prop_{aid}_game.png", view="game", resolution=(900, 700))
    if RENDERS in ("all", "sheets", "depot"):
        for gname, members in rows.items():
            if (ONLY and gname not in ONLY) or (only_depot and gname != "depot"):
                continue
            render_sheet(members, f"prop_sheet_{gname}.png", view="three_quarter")
            render_sheet(members, f"prop_sheet_{gname}_game.png", view="game")
    if RENDERS in ("all", "vignette", "sheets"):
        target = (VIGNETTE_CENTRE[0], VIGNETTE_CENTRE[1], 0.5)
        common.render_preview(vignette, "prop_vignette_game.png", view="game", resolution=(1600, 1000), margin=0.92)
        render_game_camera(vignette, "prop_vignette_gamecam.png", target=target)
        night_setup(True, lamps)
        try:
            render_game_camera(vignette, "prop_vignette_night.png", target=target, rig=False)
        finally:
            night_setup(False)
    if RENDERS in ("all", "vignette", "sheets", "depot"):
        target = (DEPOT_CENTRE[0], DEPOT_CENTRE[1], 0.5)
        render_game_camera(depot, "prop_depot_gamecam.png", target=target)
        night_setup(True, depot_lamps)
        try:
            render_game_camera(depot, "prop_depot_night.png", target=target, rig=False)
        finally:
            night_setup(False)


def main():
    t0 = time.time()
    reset_scene()
    for name in NEW_MATERIALS:
        material(name)
    objs, roots, lights = {}, [], {}
    for aid, cat, fn in ASSETS:
        p = fn()
        assert p.name == aid, (p.name, aid)
        col = common.get_collection(COLLECTIONS[cat])
        ao = AO[cat] if USE_AO else None
        lights[aid] = list(p.lights)
        obj = p.finish(col, material, ao=ao)
        objs[aid] = obj
        roots.append(obj)
    print(f"[props] built {len(roots)} assets in {time.time() - t0:.1f}s")
    for aid, pts in lights.items():
        for pos, kind in pts:
            print(f"  light {aid:<11} {kind:<8} blender ({pos.x:6.3f}, {pos.y:6.3f}, {pos.z:6.3f})"
                  f"  three ({pos.x:6.3f}, {pos.z:6.3f}, {-pos.y:6.3f})")
    rows = layout(objs)
    vignette, lamps = build_vignette(objs, lights)
    depot, depot_lamps = build_depot_vignette(objs, lights)
    bpy.context.view_layer.update()

    res = common.export_glb("kit_props.glb", roots)
    man, glb_roots, problems = validate(res["manifest"], res["glb"])
    print(f"[props] export {res['glb']} ({res['bytes'] / 1024:.0f} KiB), {res['assets']} assets")
    for m in man:
        print(f"  {m['id']:<12} size {m['size'][0]:5.2f} x {m['size'][2]:5.2f} x {m['size'][1]:5.2f} (w x d x h)"
              f"  tris {m['tris']:5d}  mats {len(m['materials'])}: {' '.join(m['materials'])}")
    print("[props] GLB roots:", len(glb_roots))
    print("[props] PROBLEMS:" if problems else "[props] validation OK", *problems, sep="\n  ")

    with AOPreview(USE_AO and RENDERS != "none"):
        render_all(objs, rows, vignette, lamps, depot, depot_lamps)
    common.save_blend("kit_props.blend")
    print(f"[props] done in {time.time() - t0:.1f}s")


main()
