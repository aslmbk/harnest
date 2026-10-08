"""HARNEST residents -> public/assets/models/npcs.glb  (docs/GAME_DESIGN.md §7.2).

Live Blender (MCP execute_blender_code):
    p = r"C:/Users/assay/projects/pet/harnest/blender/scripts/build_npcs.py"
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), {"__file__": p, "__name__": "__main__"})

Clears and rebuilds only the `HN_Npcs` collection. Roots npc_tall / npc_round / npc_drone (origin on the
ground). Hierarchy per NPC: root -> Body -> Head (pivot at the neck) -> Face (the M_NpcFace screen,
UV 0..1, u to the viewer's right, v up as seen from the front). The drone also has RotorL / RotorR
(children of Body, spin about the vertical axis). Main paint = M_NpcPaint (tinted per NPC at runtime).
"""

import math
import os
import sys
import importlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import common  # noqa: E402

importlib.reload(common)
import geo  # noqa: E402

importlib.reload(geo)
from geo import Builder, rrect, smooth_path  # noqa: E402

COLLECTION = "HN_Npcs"
LAYOUT = {"npc_tall": (2.2, 0.0, 0.0), "npc_round": (3.5, 0.0, 0.0), "npc_drone": (4.7, 0.0, 0.0)}


def tilt(pivot, deg):
    p = Vector(pivot)
    return Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, "X") @ Matrix.Translation(-p)


def ring(r, z, h=0.03, d=0.014):
    """Closed (r, h) profile of a rounded hoop of height h sticking out d from radius r at height z."""
    return [(r - 0.004, z - h / 2), (r + d * 0.7, z - h / 2 + 0.002), (r + d, z), (r + d * 0.7, z + h / 2 - 0.002), (r - 0.004, z + h / 2)]


def face_screen(coll, asset, head_obj, head_origin, w, h, centre, tilt_m, bulge=0.006):
    """Face node: the M_NpcFace screen (UV 0..1 upright), origin at the screen centre."""
    c_world = tilt_m @ Vector(centre)
    f = Builder(asset + "/Face", origin=c_world)
    f.groups[-1] = tilt_m
    f.screen(w, h, "M_NpcFace", loc=centre, nx=6, ny=4, bulge=bulge)
    return f.finish(coll, parent=head_obj, parent_origin=head_origin)


def rot_facing(normal, up=(0, 0, 1)):
    """Euler (degrees) turning the canonical front (-Y) toward `normal`."""
    n = Vector(normal).normalized()
    y_axis = -n
    z_axis = Vector(up) - y_axis * Vector(up).dot(y_axis)
    z_axis.normalize()
    x_axis = y_axis.cross(z_axis)
    m = Matrix((x_axis, y_axis, z_axis)).transposed()
    return tuple(math.degrees(a) for a in m.to_euler("XYZ"))


# ───────────────────────────── npc_tall ─────────────────────────────
# A lanky lamplighter: CRT-monitor head with a rice hat pushed back, rain poncho, lantern on a staff.

TALL_NECK = Vector((0.0, 0.0, 1.27))
TALL_TILT = -6.0  # head geometry looks up a little


def build_tall(coll, at):
    A = "npc_tall"
    root = geo.empty(A, coll, location=at, size=0.3)
    b = Builder(A + "/Body", origin=(0, 0, 0))
    for s in (1, -1):
        x = 0.11 * s
        b.rbox((0.11, 0.21, 0.075), 0.035, "M_MetalDark", loc=(x, -0.035, 0.045), axis="X", bevel=0.01, segs=1)
        b.box((0.115, 0.215, 0.02), "M_Rubber", loc=(x, -0.035, 0.01), bevel=0.006, segs=1)
        b.cyl(0.022, 0.36, "M_MetalDark", loc=(x, 0, 0.26), axis="Z", segs=10)
        b.sphere(0.042, "M_MetalDark", loc=(x, 0, 0.45), segs=12, rings=6)
        b.rbox((0.062, 0.03, 0.085), 0.014, "M_NpcPaint", loc=(x, -0.04, 0.45), axis="Y", bevel=0.004, segs=1)
        b.cyl(0.044, 0.36, "M_NpcPaint", loc=(x, 0, 0.65), axis="Z", segs=12, bevel=0.006)
    b.rbox((0.30, 0.17, 0.10), 0.03, "M_MetalDark", loc=(0, 0, 0.84), axis="Y", bevel=0.01, segs=1)
    b.rbox((0.30, 0.20, 0.40), 0.06, "M_NpcPaint", loc=(0, 0.01, 1.05), axis="Z", bevel=0.01, segs=1)

    # rain poncho with folds and a wavy hem
    prof = [(0.30, 0.84), (0.285, 0.98), (0.25, 1.12), (0.19, 1.20), (0.12, 1.25), (0.095, 1.265), (0.085, 1.25), (0.17, 1.19), (0.23, 1.11), (0.265, 0.98), (0.28, 0.85)]
    with b.group(scale=(1.0, 0.82, 1.0)):
        b.lathe(prof, "M_TarpGreen", segs=24, closed=True)

    def folds(p):
        ang = math.atan2(p.y, p.x)
        f = max(0.0, min(1.0, (1.17 - p.z) / 0.3))
        k = 1 + 0.06 * math.sin(7 * ang + 0.6) * f
        return Vector((p.x * k, p.y * k, p.z - 0.018 * f * (1 + math.cos(7 * ang + 0.6))))

    b.deform(folds, material="M_TarpGreen")
    b.lathe([(0.088, 1.245), (0.112, 1.25), (0.118, 1.268), (0.104, 1.285), (0.084, 1.278)], "M_TarpGreen", segs=16, closed=True)
    # sewn-on patch on the poncho front
    b.box((0.08, 0.014, 0.07), "M_TarpOrange", loc=(0.104, -0.203, 1.036), rot=rot_facing((0.316, -0.917, 0.24)), bevel=0.003, segs=1)

    # left arm hangs out under the poncho
    sh, el, ha = Vector((0.2, 0.0, 1.12)), Vector((0.275, -0.01, 0.9)), Vector((0.285, -0.05, 0.71))
    b.sweep([sh, el], 0.027, "M_NpcPaint", segs=8)
    b.sphere(0.034, "M_MetalDark", loc=el, segs=10, rings=6)
    b.sweep([el, ha], 0.022, "M_MetalDark", segs=8)
    b.sphere(0.042, "M_NpcPaint", loc=ha + Vector((0, 0, -0.03)), segs=10, rings=6, scale=(0.8, 1.0, 1.15))
    for k in range(3):
        b.cyl(0.011, 0.05, "M_MetalDark", loc=ha + Vector((-0.012 + 0.012 * k, -0.02, -0.075)), axis="Z", segs=6)
    # right arm grips the lantern staff
    sx, sy = -0.34, -0.10
    sh, el, ha = Vector((-0.2, 0.0, 1.12)), Vector((-0.31, -0.02, 0.93)), Vector((sx + 0.005, sy + 0.02, 1.04))
    b.sweep([sh, el], 0.027, "M_NpcPaint", segs=8)
    b.sphere(0.034, "M_MetalDark", loc=el, segs=10, rings=6)
    b.sweep([el, ha], 0.022, "M_MetalDark", segs=8)
    b.sphere(0.04, "M_NpcPaint", loc=ha, segs=10, rings=6, scale=(1.0, 0.9, 1.2))
    b.cyl(0.018, 1.6, "M_Wood", loc=(sx, sy, 0.8), axis="Z", segs=8)
    b.cyl(0.022, 0.05, "M_MetalDark", loc=(sx, sy, 0.025), axis="Z", segs=8)
    hook = smooth_path([(sx, sy, 1.58), (sx, sy - 0.04, 1.64), (sx, sy - 0.12, 1.65), (sx, sy - 0.16, 1.6)], 4)
    b.sweep(hook, 0.011, "M_MetalDark", segs=6)
    lx, ly, lz = sx, sy - 0.16, 1.44  # lantern centre
    b.sweep(smooth_path([(lx, ly, 1.6), (lx, ly, 1.55)], 2), 0.005, "M_MetalDark", segs=6)
    b.lathe([(0.0, 0.0), (0.05, 0.0), (0.05, 0.012), (0.03, 0.03), (0.012, 0.05), (0.0, 0.05)], "M_MetalDark", loc=(lx, ly, lz + 0.055), segs=12)
    b.cyl(0.042, 0.1, "M_LanternGlow", loc=(lx, ly, lz), axis="Z", segs=12)
    b.cyl(0.05, 0.022, "M_MetalDark", loc=(lx, ly, lz - 0.06), axis="Z", segs=12, bevel=0.004)
    for k in range(4):
        ang = math.radians(45 + 90 * k)
        b.box((0.007, 0.007, 0.11), "M_MetalDark", loc=(lx + 0.045 * math.cos(ang), ly + 0.045 * math.sin(ang), lz))
    body = b.finish(coll, parent=root, parent_origin=(0, 0, 0))

    # head: CRT monitor with a rice hat
    h = Builder(A + "/Head", origin=TALL_NECK)
    t = tilt(TALL_NECK, TALL_TILT)
    h.groups[-1] = t
    nx, ny, nz = TALL_NECK
    h.cyl(0.034, 0.06, "M_MetalDark", loc=(0, 0, nz + 0.02), axis="Z", segs=12, bevel=0.004)
    hc = 1.435
    h.rbox((0.36, 0.20, 0.29), 0.045, "M_NpcPaint", loc=(0, -0.03, hc), axis="Y", n=3, bevel=0.012, segs=2)
    h.prism(rrect(0.30, 0.23, 0.05, 3), 0.12, "M_NpcPaint", loc=(0, 0.13, hc), axis="Y", taper=(0.72, 0.72), bevel=0.01, segs=1)
    h.frame(rrect(0.33, 0.26, 0.035, 3), rrect(0.27, 0.205, 0.025, 3), 0.02, "M_PlasticDark", loc=(0, -0.135, hc + 0.005), bevel=0.004, segs=1)
    for z in (hc - 0.05, hc + 0.03):
        h.cyl(0.02, 0.02, "M_PlasticDark", loc=(-0.185, -0.06, z), axis="X", segs=10, bevel=0.003)
    for k in range(4):
        h.box((0.2, 0.012, 0.012), "M_PlasticDark", loc=(0, 0.195, hc - 0.045 + 0.03 * k), bevel=0.002, segs=1)
    # stubby side antenna (stays under the hat brim)
    h.cyl(0.02, 0.02, "M_PlasticDark", loc=(0.185, 0.02, hc + 0.04), axis="X", segs=10, bevel=0.003)
    h.sweep([(0.19, 0.02, hc + 0.04), (0.235, 0.025, hc + 0.065), (0.27, 0.03, hc + 0.09)], 0.005, "M_MetalSteel", segs=6)
    h.sphere(0.014, "M_MetalSteel", loc=(0.275, 0.03, hc + 0.095), segs=10, rings=6)
    # patched plate on the casing
    h.box((0.07, 0.07, 0.008), "M_MetalRust", loc=(-0.07, 0.01, hc + 0.146), rot=(0, 0, 8), bevel=0.002, segs=1)
    with h.group(loc=(0, 0.075, hc + 0.147), rot=(-16, 0, 0)):
        h.lathe([(0.0, 0.0), (0.27, 0.0), (0.287, 0.008), (0.0, 0.122)], "M_PlasterOchre", segs=24)
        h.lathe([(0.098, 0.068), (0.11, 0.07), (0.11, 0.086), (0.098, 0.084)], "M_TarpBlue", segs=24, closed=True)
    head = h.finish(coll, parent=body, parent_origin=(0, 0, 0))
    face_screen(coll, A, head, TALL_NECK, 0.272, 0.207, (0, -0.1345, hc + 0.005), t, bulge=0.008)
    return root


# ───────────────────────────── npc_round ─────────────────────────────
# A stout oil-barrel trader: barrel hoops, tool belt with tools, goggles pushed up, patched plates.

ROUND_NECK = Vector((0.0, 0.0, 0.80))
ROUND_TILT = -5.0


def build_round(coll, at):
    A = "npc_round"
    root = geo.empty(A, coll, location=at, size=0.3)
    b = Builder(A + "/Body", origin=(0, 0, 0))
    for s in (1, -1):
        x = 0.13 * s
        b.lathe([(0.0, 0.0), (0.095, 0.0), (0.1, 0.02), (0.085, 0.06), (0.05, 0.085), (0.0, 0.09)], "M_MetalDark", loc=(x, -0.02, 0.0), segs=14)
        b.cyl(0.04, 0.12, "M_MetalSteel", loc=(x, 0, 0.14), axis="Z", segs=10)
        b.tube(0.052, 0.03, 0.03, "M_MetalDark", loc=(x, 0, 0.11), axis="Z", segs=12, bevel=0.004)
    barrel = [(0.0, 0.18), (0.215, 0.18), (0.245, 0.2), (0.27, 0.3), (0.282, 0.45), (0.282, 0.55), (0.27, 0.68), (0.245, 0.77), (0.215, 0.79), (0.0, 0.79)]
    b.lathe(barrel, "M_NpcPaint", segs=28)
    for z in (0.3, 0.68):
        b.lathe(ring(0.27, z), "M_MetalDark", segs=28, closed=True)
    # tool belt with buckle, pouches and tools
    b.lathe([(0.278, 0.43), (0.293, 0.432), (0.296, 0.46), (0.293, 0.488), (0.278, 0.49)], "M_Wood", segs=28, closed=True)
    b.frame(rrect(0.07, 0.06, 0.01, 2), rrect(0.044, 0.036, 0.006, 2), 0.012, "M_MetalYellow", loc=(0, -0.298, 0.46), bevel=0.002, segs=1)
    for ang, mat in ((-55, "M_TarpGreen"), (-125, "M_Wood"), (150, "M_TarpGreen")):
        a = math.radians(ang)
        n = Vector((math.cos(a), math.sin(a), 0.0))
        p = n * 0.315 + Vector((0, 0, 0.44))
        b.rbox((0.09, 0.05, 0.085), 0.016, mat, loc=p, rot=(0, 0, ang + 90), axis="Y", bevel=0.006, segs=1)
        b.rbox((0.094, 0.054, 0.03), 0.012, mat, loc=p + Vector((0, 0, 0.035)) + n * 0.004, rot=(0, 0, ang + 90), axis="Y", bevel=0.005, segs=1)
    # wrench hanging on the right hip
    wa = math.radians(-160)
    wp = Vector((math.cos(wa) * 0.31, math.sin(wa) * 0.31, 0.38))
    with b.group(loc=wp, rot=(0, 0, -160 + 90)):
        b.rbox((0.022, 0.012, 0.16), 0.008, "M_MetalSteel", axis="Y", bevel=0.003, segs=1)
        b.frame(rrect(0.06, 0.06, 0.022, 3), rrect(0.03, 0.03, 0.01, 3), 0.012, "M_MetalSteel", loc=(0, 0, -0.095), bevel=0.002, segs=1)
    # screwdriver tucked in the belt (left)
    sa = math.radians(-20)
    sp = Vector((math.cos(sa) * 0.305, math.sin(sa) * 0.305, 0.5))
    b.cyl(0.013, 0.07, "M_MetalRed", loc=sp + Vector((0, 0, 0.03)), axis="Z", segs=8, bevel=0.003)
    b.cyl(0.005, 0.1, "M_MetalSteel", loc=sp + Vector((0, 0, -0.05)), axis="Z", segs=6)
    # patched plates
    pa = math.radians(-62)
    pn = Vector((math.cos(pa), math.sin(pa), 0.0))
    b.box((0.11, 0.012, 0.09), "M_MetalRust", loc=pn * 0.283 + Vector((0, 0, 0.585)), rot=(0, 6, -62 + 90), bevel=0.003, segs=1)
    for dx, dz in ((-0.04, -0.032), (0.04, -0.03), (-0.04, 0.032), (0.042, 0.03)):
        t_ = Vector((-pn.y, pn.x, 0.0))
        b.cyl(0.006, 0.006, "M_MetalSteel", loc=pn * 0.29 + t_ * dx + Vector((0, 0, 0.585 + dz)), rot=rot_facing(pn), segs=6)
    qa = math.radians(70)
    qn = Vector((math.cos(qa), math.sin(qa), 0.0))
    b.box((0.13, 0.012, 0.1), "M_MetalSteel", loc=qn * 0.284 + Vector((0, 0, 0.56)), rot=(0, -4, 70 + 90), bevel=0.003, segs=1)
    # stubby arms with mitts
    for s in (1, -1):
        sh, el, ha = Vector((0.27 * s, 0.0, 0.62)), Vector((0.335 * s, -0.02, 0.5)), Vector((0.335 * s, -0.13, 0.45))
        b.sphere(0.045, "M_MetalDark", loc=sh, segs=12, rings=6)
        b.sweep([sh, el], 0.035, "M_NpcPaint", segs=10)
        b.sphere(0.036, "M_MetalDark", loc=el, segs=10, rings=6)
        b.sweep([el, ha], 0.028, "M_MetalDark", segs=8)
        b.sphere(0.05, "M_NpcPaint", loc=ha + Vector((0, -0.02, 0)), segs=12, rings=6, scale=(0.85, 1.0, 0.95))
        b.sphere(0.022, "M_NpcPaint", loc=ha + Vector((-0.04 * s, -0.035, 0.02)), segs=8, rings=5)
    b.lathe([(0.12, 0.785), (0.15, 0.79), (0.152, 0.815), (0.12, 0.82)], "M_MetalDark", segs=20, closed=True)
    body = b.finish(coll, parent=root, parent_origin=(0, 0, 0))

    h = Builder(A + "/Head", origin=ROUND_NECK)
    t = tilt(ROUND_NECK, ROUND_TILT)
    h.groups[-1] = t
    dome = [(0.0, 0.81), (0.17, 0.81), (0.19, 0.83), (0.195, 0.92), (0.19, 0.96), (0.17, 1.0), (0.13, 1.04), (0.07, 1.065), (0.0, 1.072)]
    h.lathe(dome, "M_NpcPaint", segs=24)
    h.rbox((0.27, 0.06, 0.19), 0.035, "M_PlasticDark", loc=(0, -0.175, 0.915), axis="Y", bevel=0.007, segs=2)
    h.frame(rrect(0.252, 0.172, 0.026, 3), rrect(0.226, 0.146, 0.018, 3), 0.012, "M_PlasticDark", loc=(0, -0.208, 0.915), bevel=0.003, segs=1)
    # goggles pushed up on the forehead, with a strap
    h.lathe([(0.17, 0.985), (0.181, 0.988), (0.183, 1.005), (0.176, 1.02), (0.163, 1.02)], "M_Cable", segs=24, closed=True)
    for s in (1, -1):
        with h.group(loc=(0.058 * s, -0.152, 1.02), rot=(-38, 0, 8 * s)):
            h.tube(0.042, 0.03, 0.03, "M_MetalYellow", axis="Y", segs=16, bevel=0.004)
            h.cyl(0.032, 0.012, "M_Glass", loc=(0, -0.006, 0), axis="Y", segs=16)
    h.box((0.04, 0.02, 0.02), "M_MetalYellow", loc=(0, -0.168, 1.025), rot=(-38, 0, 0), bevel=0.004, segs=1)
    # ear vents and a little exhaust stack
    for s in (1, -1):
        h.cyl(0.045, 0.03, "M_MetalDark", loc=(0.19 * s, 0.0, 0.92), axis="X", segs=16, bevel=0.005)
        for k in range(3):
            h.box((0.012, 0.06, 0.008), "M_MetalSteel", loc=(0.207 * s, 0.0, 0.905 + 0.015 * k))
    h.cyl(0.022, 0.12, "M_MetalDark", loc=(-0.07, 0.11, 1.06), rot=(15, 0, 0), axis="Z", segs=10)
    h.cyl(0.03, 0.025, "M_MetalDark", loc=(-0.07, 0.126, 1.12), rot=(15, 0, 0), axis="Z", segs=10, bevel=0.004)
    head = h.finish(coll, parent=body, parent_origin=(0, 0, 0))
    face_screen(coll, A, head, ROUND_NECK, 0.232, 0.152, (0, -0.209, 0.915), t, bulge=0.004)
    return root


# ───────────────────────────── npc_drone ─────────────────────────────
# A messenger drone: ducted rotors, TV head with a messenger cap, mail satchel, tail light.

DRONE_C = Vector((0.0, 0.0, 1.30))


def build_drone(coll, at):
    A = "npc_drone"
    root = geo.empty(A, coll, location=at, size=0.3)
    C = DRONE_C
    b = Builder(A + "/Body", origin=C)
    hull = [(0.0, -0.13), (0.09, -0.125), (0.15, -0.09), (0.175, -0.03), (0.175, 0.03), (0.15, 0.08), (0.1, 0.115), (0.0, 0.125)]
    b.lathe([(r, C.z + hh) for r, hh in hull], "M_NpcPaint", segs=24)
    b.lathe(ring(0.172, C.z, h=0.03, d=0.012), "M_MetalDark", segs=24, closed=True)
    duct_x = 0.25
    for s in (1, -1):
        b.rbox((0.12, 0.05, 0.03), 0.012, "M_MetalDark", loc=(s * 0.19, 0, C.z), axis="Y", bevel=0.004, segs=1)
        b.tube(0.085, 0.07, 0.055, "M_NpcPaint", loc=(s * duct_x, 0, C.z), axis="Z", segs=20, bevel=0.005)
        b.box((0.15, 0.012, 0.01), "M_MetalDark", loc=(s * duct_x, 0, C.z - 0.022))
        b.cyl(0.02, 0.035, "M_MetalDark", loc=(s * duct_x, 0, C.z - 0.012), axis="Z", segs=10)
    # tail: thruster and blinking light
    b.cyl(0.04, 0.05, "M_MetalDark", loc=(0, 0.17, C.z - 0.02), axis="Y", segs=12, bevel=0.005)
    b.tube(0.045, 0.03, 0.02, "M_MetalSteel", loc=(0, 0.2, C.z - 0.02), axis="Y", segs=12)
    b.sphere(0.016, "M_NeonRed", loc=(0, 0.13, C.z + 0.1), segs=10, rings=6)
    # mail satchel on a strap
    b.sweep(smooth_path([(0.16, -0.02, C.z - 0.03), (0.15, -0.03, C.z - 0.12), (0.1, -0.04, C.z - 0.19)], 3), 0.008, "M_Cable", segs=6)
    b.sweep(smooth_path([(-0.16, -0.02, C.z - 0.03), (-0.12, -0.03, C.z - 0.12), (-0.03, -0.04, C.z - 0.19)], 3), 0.008, "M_Cable", segs=6)
    b.rbox((0.17, 0.08, 0.12), 0.025, "M_Wood", loc=(0.04, -0.03, C.z - 0.25), axis="Y", bevel=0.008, segs=1)
    b.rbox((0.172, 0.084, 0.05), 0.02, "M_TarpOrange", loc=(0.04, -0.032, C.z - 0.205), axis="Y", bevel=0.006, segs=1)
    b.box((0.025, 0.01, 0.03), "M_MetalYellow", loc=(0.04, -0.075, C.z - 0.215), bevel=0.003, segs=1)
    for k, (dx, ang) in enumerate(((-0.02, -8), (0.03, 5), (0.075, -3))):
        b.box((0.06, 0.004, 0.05), "M_Paper", loc=(dx, -0.02 + 0.012 * k, C.z - 0.165), rot=(0, ang, 0))
    body = b.finish(coll, parent=root, parent_origin=(0, 0, 0))

    rotors = []
    for side, s in (("L", 1), ("R", -1)):
        pc = Vector((s * duct_x, 0, C.z + 0.004))
        r = Builder(A + "/Rotor" + side, origin=pc)
        r.cyl(0.018, 0.016, "M_MetalSteel", loc=pc, axis="Z", segs=10)
        for k in range(2):
            with r.group(loc=pc, rot=(0, 0, 180 * k + 20)):
                r.box((0.064, 0.022, 0.004), "M_PlasticDark", loc=(0.04, 0, 0), rot=(12, 0, 0), bevel=0.0015, segs=1)
        rotors.append(r.finish(coll, parent=body, parent_origin=C))

    neck = C + Vector((0, 0, 0.125))
    h = Builder(A + "/Head", origin=neck)
    h.cyl(0.032, 0.03, "M_MetalDark", loc=neck + Vector((0, 0, 0.01)), axis="Z", segs=12, bevel=0.004)
    hc = neck + Vector((0, -0.03, 0.105))
    h.rbox((0.22, 0.16, 0.165), 0.045, "M_NpcPaint", loc=hc, axis="Y", n=3, bevel=0.012, segs=2)
    h.frame(rrect(0.2, 0.145, 0.035, 3), rrect(0.168, 0.115, 0.025, 3), 0.016, "M_PlasticDark", loc=hc + Vector((0, -0.082, 0)), bevel=0.003, segs=1)
    # antenna with a glowing tip
    h.sweep([hc + Vector((0.07, 0.03, 0.08)), hc + Vector((0.09, 0.04, 0.16)), hc + Vector((0.1, 0.06, 0.2))], 0.004, "M_MetalSteel", segs=6)
    h.sphere(0.014, "M_ScreenGlow", loc=hc + Vector((0.1, 0.06, 0.212)), segs=10, rings=6, uv=(0.5, 0.5))
    # messenger cap worn backwards (the peak must not hide the face from the high camera), a little crooked
    with h.group(loc=hc + Vector((-0.005, 0.01, 0.075)), rot=(0, 6, 0)):
        h.lathe([(0.0, 0.0), (0.095, 0.0), (0.098, 0.01), (0.085, 0.04), (0.05, 0.06), (0.0, 0.065)], "M_TarpBlue", segs=20)
        h.prism(rrect(0.13, 0.07, 0.03, 3), 0.008, "M_TarpBlue", loc=(0, 0.11, 0.008), rot=(12, 0, 0), axis="Z", bevel=0.003, segs=1)
        h.sphere(0.012, "M_TarpBlue", loc=(0, 0, 0.066), segs=8, rings=5)
    head = h.finish(coll, parent=body, parent_origin=C)
    face_screen(coll, A, head, neck, 0.172, 0.119, hc + Vector((0, -0.0835, 0)), Matrix.Identity(4), bulge=0.004)
    return root


# ───────────────────────────── assembly ─────────────────────────────


def build():
    geo.hide_startup_objects()
    common.clear_collection(COLLECTION)
    coll = common.get_collection(COLLECTION)
    roots = [build_tall(coll, LAYOUT["npc_tall"]), build_round(coll, LAYOUT["npc_round"]), build_drone(coll, LAYOUT["npc_drone"])]
    bpy.context.view_layer.update()
    out = {}
    for root in roots:
        fam = [root] + common.descendants(root)
        lo, hi = common.bounds(fam, origin=root.matrix_world.translation)
        out[root.name] = {
            "tris": common.tri_count(fam),
            "size": [round(v, 3) for v in (hi - lo)],
            "min": [round(v, 3) for v in lo],
            "max": [round(v, 3) for v in hi],
            "nodes": [o.name for o in fam],
        }
    return out


def roots():
    return [bpy.data.objects[n] for n in ("npc_tall", "npc_round", "npc_drone")]


def previews(views=("game", "three_quarter", "front", "side"), resolution=(900, 800)):
    out = []
    for root in roots():
        short = root.name.replace("npc_", "")
        for view in views:
            out.append(common.render_preview([root], f"npc_{short}_{view}.png", view=view, resolution=resolution))
    return out


def export():
    res = common.export_glb("npcs.glb", roots())
    res["renamed"] = geo.strip_name_prefixes(res["glb"], res["manifest"])
    return res


if __name__ == "__main__":
    RESULT = build()
    print(RESULT)
