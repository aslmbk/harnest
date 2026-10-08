"""HARNEST hero robot ХАРНИ (HRN-1) -> public/assets/models/robot.glb  (docs/GAME_DESIGN.md §7.1).

Live Blender (MCP execute_blender_code):
    p = r"C:/Users/assay/projects/pet/harnest/blender/scripts/build_robot.py"
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), {"__file__": p, "__name__": "__main__"})

Clears and rebuilds only the `HN_Robot` collection. Asset space = Blender axes relative to the root:
front = -Y, robot's left = +X, up = +Z, metres. Every node has identity rotation / unit scale; its
origin sits at its pivot. L / R = the robot's own left / right (L = +X).
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
from geo import Builder, fillet, rrect, smooth_path  # noqa: E402

COLLECTION = "HN_Robot"
DISPLAY_AT = (0.0, 0.0, 0.0)

# ── tracks ──
TRACK_X = 0.335  # belt centre |x|
BELT_W = 0.16  # belt width (x)
BELT_T = 0.025  # belt thickness
BELT_RI = 0.115  # belt inner radius around the end wheels
BELT_RO = BELT_RI + BELT_T  # outer radius (ground contact)
BELT_CHAMFER = 0.007
WHEEL_R = 0.112
AXLE_Z = BELT_RO
WHEEL_Y = (-0.335, 0.0, 0.335)  # 1 = front, 2 = middle, 3 = rear
INNER = TRACK_X - BELT_W / 2  # belt inboard edge |x|

# ── body ──
BODY_PIVOT = Vector((0.0, 0.0, 0.27))  # chassis top centre
SHELL_W, SHELL_D = 0.50, 0.44
SHELL_Z0, SHELL_Z1 = 0.31, 0.69
FRONT_Y = -SHELL_D / 2
TOP_TAPER = 0.90  # top depth / bottom depth: the front leans back, the back stays vertical
FRONT_SET = SHELL_D * (1 - TOP_TAPER)  # how far the front top edge sits back
FRONT_LEAN = math.degrees(math.atan2(FRONT_SET, SHELL_Z1 - SHELL_Z0))

SHOULDER = Vector((0.28, -0.07, 0.60))  # left; right is mirrored in x
ELBOW = Vector((0.34, -0.092, 0.448))
WRIST = Vector((0.34, -0.25, 0.448))
ANTENNA_BASE = Vector((0.16, 0.15, SHELL_Z1))
NECK_BASE = Vector((0.0, 0.09, SHELL_Z1))
NECK_TOP = Vector((0.0, 0.09, 0.85))

# ── head ──
EYE_C = Vector((0.15, -0.07, 0.95))  # left pod centre; right mirrored
EYE_TILT = 10.0  # pods look up a little (geometry tilt; node rotation stays identity)
POD = (0.27, 0.20, 0.24)
POD_R = 0.088
LENS_R = 0.082
LENS_Z = -0.004  # lens centre relative to the pod centre (pod-local, before tilt)
LAMP_C = Vector((0.0, 0.035, 1.095))
LAMP_TILT = 12.0  # lamp looks down a little


def mirror(v, s):
    return Vector((v.x * s, v.y, v.z))


def bolt(b, loc, axis="Y", r=0.008, h=0.006, material="M_MetalSteel"):
    b.cyl(r, h, material, loc=loc, axis=axis, segs=6, start=0.0)


# ───────────────────────────── chassis ─────────────────────────────


def build_track(coll, chassis, side):
    """Belt loop around the three wheels. UV: U along the loop (0->1 once around, increasing in the
    direction the belt travels when the robot drives forward), V across (0 inboard -> 1 outboard)."""
    s = 1 if side == "L" else -1
    origin = Vector((s * TRACK_X, 0.0, AXLE_Z))
    b = Builder("Track" + side, origin=origin)
    t = b._tmp()
    uv = t.loops.layers.uv.active
    idx = b.mi("M_Track")

    a = WHEEL_Y[2]
    R = BELT_RO
    zc = AXLE_Z
    samples = []  # (y, z, ny, nz) on the outer surface, starting mid-bottom, moving backward
    for i in range(2):
        samples.append((a * i / 2, zc - R, 0.0, -1.0))
    for i in range(16):
        th = math.radians(-90 + 180 * i / 16)
        samples.append((a + R * math.cos(th), zc + R * math.sin(th), math.cos(th), math.sin(th)))
    for i in range(4):
        samples.append((a - 2 * a * i / 4, zc + R, 0.0, 1.0))
    for i in range(16):
        th = math.radians(90 + 180 * i / 16)
        samples.append((-a + R * math.cos(th), zc + R * math.sin(th), math.cos(th), math.sin(th)))
    for i in range(2):
        samples.append((-a + a * i / 2, zc - R, 0.0, -1.0))
    n = len(samples)
    cum = [0.0]
    for i in range(n):
        y0, z0 = samples[i][:2]
        y1, z1 = samples[(i + 1) % n][:2]
        cum.append(cum[-1] + math.hypot(y1 - y0, z1 - z0))
    length = cum[-1]

    W, T, c = BELT_W, BELT_T, BELT_CHAMFER
    prof = [(-W / 2, -T), (-W / 2, -c), (-W / 2 + c, 0.0), (W / 2 - c, 0.0), (W / 2, -c), (W / 2, -T)]
    rings = []
    for y, z, ny, nz in samples:
        rings.append([t.verts.new((s * TRACK_X + s * w, y + ny * r, z + nz * r)) for w, r in prof])
    m = len(prof)
    for i in range(n):
        j = (i + 1) % n
        u0 = cum[i] / length
        u1 = cum[i + 1] / length
        for k in range(m):
            kk = (k + 1) % m
            f = t.faces.new((rings[i][k], rings[i][kk], rings[j][kk], rings[j][k]))
            f.material_index = idx
            v0 = (prof[k][0] + W / 2) / W
            v1 = (prof[kk][0] + W / 2) / W
            for loop, coord in zip(f.loops, ((u0, v0), (u0, v1), (u1, v1), (u1, v0))):
                loop[uv].uv = coord
    b._commit(t, Matrix.Identity(4), recalc=True, has_uv=True)
    obj = b.finish(coll, parent=chassis, parent_origin=(0, 0, 0))
    return obj, length


def build_wheel(coll, chassis, side, i):
    s = 1 if side == "L" else -1
    c = Vector((s * TRACK_X, WHEEL_Y[i], AXLE_Z))
    b = Builder(f"Wheel{side}{i + 1}", origin=c)
    with b.group(loc=c, scale=(s, 1, 1)):  # local +X = outboard
        prof = [
            (0.0, -0.06),
            (0.104, -0.06),
            (0.112, -0.052),
            (0.112, 0.050),
            (0.106, 0.058),
            (0.097, 0.060),
            (0.090, 0.055),
            (0.088, 0.046),
            (0.0, 0.046),
        ]
        b.lathe(prof, "M_MetalDark", axis="X", segs=20)
        b.cyl(0.046, 0.018, "M_HarniShell", loc=(0.054, 0, 0), axis="X", segs=16, bevel=0.005)
        for k in range(3):
            with b.group(rot=(90 + 120 * k, 0, 0)):
                b.box((0.014, 0.026, 0.05), "M_HarniShell", loc=(0.052, 0, 0.066), bevel=0.004, segs=1)
        b.cyl(0.019, 0.012, "M_MetalSteel", loc=(0.068, 0, 0), axis="X", segs=6, start=0.0)
    return b.finish(coll, parent=chassis, parent_origin=(0, 0, 0))


def build_chassis(coll, root):
    b = Builder("Chassis", origin=(0, 0, 0))
    for s in (1, -1):
        # inboard track frame, longitudinal beam, axle stubs with nuts
        b.rbox((0.022, 0.70, 0.15), 0.06, "M_MetalDark", loc=(s * (INNER - 0.014), 0, 0.14), axis="X", bevel=0.006, segs=1)
        b.rbox((0.03, 0.56, 0.035), 0.015, "M_MetalSteel", loc=(s * (INNER - 0.03), 0, 0.205), axis="X", bevel=0.005, segs=1)
        for y in WHEEL_Y:
            b.cyl(0.02, 0.05, "M_MetalSteel", loc=(s * (INNER + 0.01), y, AXLE_Z), axis="X", segs=10)
            b.cyl(0.03, 0.01, "M_MetalDark", loc=(s * (INNER - 0.028), y, AXLE_Z), axis="X", segs=6, start=0.0)
    # central tub with a sloped front plate and an ID plate
    b.box((2 * INNER - 0.06, 0.60, 0.17), "M_MetalDark", loc=(0, 0, 0.17), bevel=0.025, segs=2)
    with b.group(loc=(0, -0.29, 0.215), rot=(-38, 0, 0)):
        b.box((2 * INNER - 0.08, 0.016, 0.12), "M_MetalDark", bevel=0.005, segs=1)
        b.rbox((0.13, 0.008, 0.045), 0.008, "M_HarniCream", loc=(0, -0.0105, 0.008), axis="Y", bevel=0.002, segs=1)
        for x in (-0.048, -0.016, 0.016, 0.048):
            b.box((0.018, 0.004, 0.022), "M_MetalDark", loc=(x, -0.0155, 0.008))
    # turret base under the body
    b.cyl(0.2, 0.02, "M_MetalSteel", loc=(0, 0, 0.26), axis="Z", segs=28, bevel=0.005)
    # front bumper with hazard stripes, rear tow hook
    b.rbox((0.40, 0.05, 0.065), 0.022, "M_MetalYellow", loc=(0, -0.315, 0.13), axis="X", bevel=0.006, segs=1)
    for k in range(4):
        x = -0.135 + 0.09 * k
        b.box((0.026, 0.008, 0.07), "M_MetalDark", loc=(x, -0.3425, 0.13), rot=(0, 35, 0))
    b.tube(0.03, 0.017, 0.014, "M_MetalSteel", loc=(0, 0.33, 0.13), axis="X", segs=12, bevel=0.003)
    b.box((0.06, 0.04, 0.04), "M_MetalDark", loc=(0, 0.305, 0.13), bevel=0.008, segs=1)
    return b.finish(coll, parent=root, parent_origin=(0, 0, 0))


# ───────────────────────────── body ─────────────────────────────


def build_body(coll, root):
    b = Builder("Body", origin=BODY_PIVOT)
    zc = (SHELL_Z0 + SHELL_Z1) / 2
    # waist ring between chassis and shell
    b.cyl(0.165, 0.05, "M_MetalDark", loc=(0, 0, 0.29), axis="Z", segs=28, bevel=0.008)
    b.tube(0.176, 0.15, 0.012, "M_MetalSteel", loc=(0, 0, 0.30), axis="Z", segs=28, bevel=0.003)
    # shell: rounded box whose front leans back
    b.prism(
        rrect(SHELL_W, SHELL_D, 0.07, 4),
        SHELL_Z1 - SHELL_Z0,
        "M_HarniShell",
        loc=(0, 0, zc),
        axis="Z",
        bevel=0.024,
        segs=2,
        taper=(1.0, TOP_TAPER),
        shift=(0.0, -FRONT_SET / 2),
    )
    # a knock on the right side: real crater geometry (local edge loops + displacement)
    b.dent((-SHELL_W / 2, 0.03, 0.43), 0.065, 0.013, material="M_HarniShell", direction=(1, 0, 0), cuts=5)
    # small vent at the back of the right side
    b.rbox((0.012, 0.11, 0.065), 0.012, "M_MetalDark", loc=(-SHELL_W / 2 - 0.002, 0.13, 0.58), axis="X", bevel=0.003, segs=1)
    for z in (0.563, 0.58, 0.597):
        b.box((0.012, 0.095, 0.008), "M_HarniShellDark", loc=(-SHELL_W / 2 - 0.007, 0.13, z), bevel=0.002, segs=1)

    fy = FRONT_Y
    with b.group(pivot=(0, fy, SHELL_Z0), rot=(-FRONT_LEAN, 0, 0)):  # parts on the leaning front face
        b.rbox((0.36, 0.014, 0.25), 0.04, "M_HarniCream", loc=(0, fy - 0.003, 0.495), axis="Y", bevel=0.004, segs=2)
        py = fy - 0.010  # panel front
        b.frame(rrect(0.18, 0.09, 0.025, 3), rrect(0.15, 0.062, 0.014, 3), 0.014, "M_MetalDark", loc=(0, py - 0.005, 0.56), bevel=0.003, segs=1)
        b.screen(0.152, 0.066, "M_HarniScreen", loc=(0, py - 0.003, 0.56), nx=4, ny=2, bulge=0.003)
        b.rbox((0.20, 0.01, 0.062), 0.014, "M_MetalDark", loc=(0, py - 0.003, 0.445), axis="Y", bevel=0.003, segs=1)
        for z in (0.428, 0.445, 0.462):
            b.box((0.176, 0.012, 0.008), "M_HarniShellDark", loc=(0, py - 0.008, z), bevel=0.002, segs=1)
        for x in (-0.155, 0.155):
            for z in (0.39, 0.60):
                if x < 0 and z < 0.5:
                    continue  # under the rust plate
                bolt(b, (x, py - 0.002, z))
        # mismatched rusty replacement plate over the lower right corner (robot's right = -X)
        b.box((0.118, 0.018, 0.112), "M_MetalRust", loc=(-0.12, fy - 0.007, 0.39), rot=(0, 5, 0), bevel=0.003, segs=1)
        for x, z in ((-0.165, 0.35), (-0.075, 0.345), (-0.165, 0.432), (-0.072, 0.425)):
            bolt(b, (x, fy - 0.017, z), r=0.0075)
    # riveted steel patch on the left side
    b.rbox((0.012, 0.15, 0.10), 0.012, "M_MetalSteel", loc=(SHELL_W / 2 + 0.002, 0.07, 0.43), rot=(3, 0, 0), axis="X", bevel=0.003, segs=1)
    for y in (0.005, 0.07, 0.135):
        for z in (0.39, 0.47):
            b.cyl(0.006, 0.006, "M_MetalSteel", loc=(SHELL_W / 2 + 0.009, y, z), axis="X", segs=6)
    # shoulder sockets
    for s in (1, -1):
        b.tube(0.064, 0.048, 0.014, "M_MetalDark", loc=(s * (SHELL_W / 2 + 0.002), SHOULDER.y, SHOULDER.z), axis="X", segs=20, bevel=0.003)
    # back: battery pack with cooling fins and latches
    by = SHELL_D / 2
    b.rbox((0.32, 0.07, 0.22), 0.03, "M_MetalDark", loc=(0, by + 0.03, 0.495), axis="Y", bevel=0.008, segs=1)
    for k in range(6):
        b.box((0.014, 0.024, 0.18), "M_MetalSteel", loc=(-0.11 + 0.044 * k, by + 0.072, 0.495), bevel=0.003, segs=1)
    for x in (-0.13, 0.13):
        b.box((0.03, 0.03, 0.05), "M_HarniShellDark", loc=(x, by + 0.06, 0.62), bevel=0.006, segs=1)
    b.rbox((0.12, 0.008, 0.04), 0.008, "M_HarniCream", loc=(0, by + 0.068, 0.385), axis="Y", bevel=0.002, segs=1)
    # top: hatch, neck seat, carry handle
    tz = SHELL_Z1
    b.rbox((0.30, 0.13, 0.012), 0.03, "M_HarniShellDark", loc=(0, -0.075, tz + 0.002), axis="Z", bevel=0.004, segs=1)
    for x in (-0.13, 0.13):
        bolt(b, (x, -0.075, tz + 0.009), axis="Z")
    handle = [(-0.11, 0.17, tz), (-0.11, 0.17, tz + 0.04), (-0.09, 0.17, tz + 0.055), (0.05, 0.17, tz + 0.055), (0.07, 0.17, tz + 0.04), (0.07, 0.17, tz)]
    b.sweep(smooth_path(handle, 3), 0.009, "M_MetalSteel", segs=6)
    cable = [(0.15, by + 0.04, 0.6), (0.2, by + 0.05, 0.62), (0.235, by + 0.0, 0.58), (0.252, by - 0.06, 0.55)]
    b.sweep(smooth_path(cable, 4), 0.009, "M_Cable", segs=6)
    return b.finish(coll, parent=root, parent_origin=(0, 0, 0))


def build_arm(coll, body, side):
    s = 1 if side == "L" else -1
    sh = mirror(SHOULDER, s)
    b = Builder("Arm" + side, origin=sh)
    with b.group(scale=(s, 1, 1)):
        x = ELBOW.x
        b.cyl(0.05, 0.05, "M_MetalDark", loc=(0.275, SHOULDER.y, SHOULDER.z), axis="X", segs=16, bevel=0.006)
        b.cyl(0.04, 0.018, "M_HarniShell", loc=(0.309, SHOULDER.y, SHOULDER.z), axis="X", segs=16, bevel=0.005)
        b.rbox((0.048, 0.074, 0.19), 0.03, "M_HarniShell", loc=(x, -0.082, 0.525), rot=(-7, 0, 0), axis="X", bevel=0.008, segs=1)
        b.cyl(0.034, 0.062, "M_MetalDark", loc=ELBOW, axis="X", segs=14, bevel=0.005)
        b.cyl(0.017, 0.01, "M_MetalSteel", loc=(x + 0.034, ELBOW.y, ELBOW.z), axis="X", segs=6, start=0.0)
        b.rbox((0.054, 0.15, 0.06), 0.022, "M_HarniCream", loc=(x, (ELBOW.y + WRIST.y) / 2 - 0.004, ELBOW.z), axis="Y", bevel=0.006, segs=1)
    arm = b.finish(coll, parent=body, parent_origin=BODY_PIVOT)

    wr = mirror(WRIST, s)
    h = Builder("Hand" + side, origin=wr)
    with h.group(scale=(s, 1, 1)):
        x, y, z = WRIST
        h.cyl(0.035, 0.03, "M_MetalDark", loc=(x, y - 0.012, z), axis="Y", segs=14, bevel=0.005)
        h.rbox((0.06, 0.04, 0.066), 0.014, "M_MetalDark", loc=(x, y - 0.042, z), axis="Y", bevel=0.004, segs=1)
        jaw = fillet(
            [(0.0, 0.004), (0.022, 0.03), (0.052, 0.032), (0.078, 0.014), (0.084, -0.004), (0.072, 0.0), (0.052, 0.012), (0.026, 0.01), (0.004, -0.008)],
            [0, 0.01, 0.012, 0.01, 0.002, 0.003, 0.008, 0.006, 0],
            2,
            closed=True,
        )
        jaw = [(a * 1.25, bb * 1.25) for a, bb in jaw]
        for sign in (1, -1):
            prof = [(a, sign * bb) for a, bb in jaw]
            if sign < 0:
                prof.reverse()
            h.prism(prof, 0.028, "M_MetalSteel", loc=(x, y - 0.054, z + sign * 0.007), axis="X", bevel=0.004, segs=1)
        h.cyl(0.013, 0.064, "M_MetalDark", loc=(x, y - 0.064, z), axis="X", segs=10)
    hand = h.finish(coll, parent=arm, parent_origin=sh)
    return arm, hand


def build_antenna(coll, body):
    b = Builder("Antenna", origin=ANTENNA_BASE)
    x, y, z = ANTENNA_BASE
    b.lathe([(0.0, 0.0), (0.036, 0.0), (0.036, 0.012), (0.028, 0.026), (0.014, 0.034), (0.0, 0.034)], "M_MetalDark", loc=(x, y, z - 0.004), segs=14)
    for i in range(3):
        b.tube(0.013, 0.006, 0.006, "M_MetalSteel", loc=(x, y, z + 0.038 + i * 0.009), axis="Z", segs=10)
    pts = smooth_path([(x, y, z + 0.03), (x, y + 0.004, z + 0.16), (x + 0.006, y + 0.022, z + 0.31), (x + 0.012, y + 0.05, z + 0.44)], 3)
    b.sweep(pts, 0.0065, "M_MetalSteel", segs=6)
    b.cyl(0.0105, 0.03, "M_HarniCream", loc=Vector(pts[5]), axis="Z", segs=8, bevel=0.002)
    tip = Vector(pts[-1])
    b.cyl(0.011, 0.016, "M_MetalDark", loc=tip, axis="Z", segs=8, bevel=0.002)
    b.sphere(0.021, "M_HarniScreen", loc=tip + Vector((0.0, 0.002, 0.022)), segs=12, rings=7, uv=(0.5, 0.5))
    return b.finish(coll, parent=body, parent_origin=BODY_PIVOT)


def build_neck(coll, body):
    b = Builder("Neck", origin=NECK_BASE)
    x, y, z = NECK_BASE
    b.cyl(0.062, 0.022, "M_MetalDark", loc=(x, y, z + 0.008), axis="Z", segs=20, bevel=0.006)
    for k in range(4):
        ang = math.radians(45 + 90 * k)
        bolt(b, (x + 0.047 * math.cos(ang), y + 0.047 * math.sin(ang), z + 0.021), axis="Z", r=0.0065)
    b.cyl(0.026, NECK_TOP.z - z - 0.01, "M_MetalSteel", loc=(x, y, (z + NECK_TOP.z) / 2), axis="Z", segs=14)
    for zz in (z + 0.05, z + 0.11):
        b.cyl(0.034, 0.016, "M_MetalDark", loc=(x, y, zz), axis="Z", segs=14, bevel=0.004)
    b.cyl(0.009, 0.12, "M_MetalSteel", loc=(x, y + 0.04, z + 0.08), axis="Z", segs=8)
    b.cyl(0.013, 0.06, "M_MetalDark", loc=(x, y + 0.04, z + 0.05), axis="Z", segs=8, bevel=0.002)
    return b.finish(coll, parent=body, parent_origin=BODY_PIVOT)


def build_head(coll, neck):
    b = Builder("Head", origin=NECK_TOP)
    x, y, z = NECK_TOP
    bar_z = EYE_C.z
    b.sphere(0.04, "M_MetalDark", loc=NECK_TOP, segs=14, rings=7)
    b.cyl(0.03, bar_z - z, "M_MetalDark", loc=(x, y, (z + bar_z) / 2), axis="Z", segs=14)
    b.cyl(0.032, 2 * EYE_C.x + 0.01, "M_MetalDark", loc=(x, y, bar_z), axis="X", segs=16, bevel=0.006)
    for s in (1, -1):
        b.cyl(0.04, 0.03, "M_HarniShell", loc=(s * (EYE_C.x + 0.01), y, bar_z), axis="X", segs=16, bevel=0.007)
        b.cyl(0.022, 0.06, "M_MetalSteel", loc=(s * EYE_C.x, 0.06, bar_z), axis="Y", segs=12)
    # head lamp on a bracket
    b.prism(rrect(0.024, 0.13, 0.008, 2), 0.02, "M_MetalDark", loc=(0, 0.066, 1.022), rot=(34, 0, 0), axis="X", bevel=0.003, segs=1)
    with b.group(loc=LAMP_C, rot=(LAMP_TILT, 0, 0)):
        b.cyl(0.033, 0.07, "M_HarniCream", axis="Y", segs=18, bevel=0.008, bsegs=2)
        b.tube(0.035, 0.024, 0.01, "M_MetalDark", loc=(0, -0.037, 0), axis="Y", segs=18, bevel=0.003)
        b.lathe([(0.026, 0.0), (0.022, 0.004), (0.012, 0.007), (0.0, 0.008)], "M_LampWarm", loc=(0, -0.036, 0), axis="Y", segs=18, uv_planar=0.026)
        for s in (1, -1):
            b.box((0.008, 0.05, 0.008), "M_MetalDark", loc=(s * 0.034, 0.005, 0))
    return b.finish(coll, parent=neck, parent_origin=NECK_BASE)


def dome_profile(r, h, base, rings=5):
    R = (r * r + h * h) / (2 * h)
    th0 = math.asin(r / R)
    pts = []
    for i in range(rings + 1):
        th = th0 * (1 - i / rings)
        pts.append((R * math.sin(th), base + R * math.cos(th) - R * math.cos(th0)))
    pts[-1] = (0.0, pts[-1][1])
    return pts


def build_eye(coll, head, side):
    s = 1 if side == "L" else -1
    c = mirror(EYE_C, s)
    b = Builder("Eye" + side, origin=c)
    pw, pd, ph = POD
    with b.group(loc=c, rot=(-EYE_TILT, 0, 0)):
        b.rbox(POD, POD_R, "M_HarniShell", axis="Y", n=5, bevel=0.022, segs=2)
        fy = -pd / 2
        b.rbox((pw - 0.03, 0.014, ph - 0.032), POD_R - 0.013, "M_HarniCream", loc=(0, fy - 0.003, 0), axis="Y", n=5, bevel=0.005, segs=1)
        face = fy - 0.010
        k = LENS_R / 0.078
        bezel = [(0.091 * k, -0.004), (0.094 * k, 0.010), (0.090 * k, 0.018), (0.082 * k, 0.020), (0.0765 * k, 0.015), (0.0765 * k, -0.004)]
        b.lathe(bezel, "M_MetalDark", loc=(0, face, LENS_Z), axis="Y", segs=28, closed=True)
        b.lathe(dome_profile(LENS_R, 0.022, 0.004), "M_EyeGlow", loc=(0, face, LENS_Z), axis="Y", segs=28, uv_planar=LENS_R)
        # bearing plate on the back (roll axis), ear cap on the outer side
        b.cyl(0.046, 0.02, "M_MetalDark", loc=(0, pd / 2 + 0.006, 0), axis="Y", segs=16, bevel=0.005)
        b.cyl(0.056, 0.02, "M_MetalDark", loc=(s * (pw / 2 + 0.004), 0, 0), axis="X", segs=20, bevel=0.005)
        b.cyl(0.04, 0.012, "M_HarniCream", loc=(s * (pw / 2 + 0.016), 0, 0), axis="X", segs=20, bevel=0.004)
        if side == "R":
            # riveted steel patch on the top of the right pod
            b.rbox((0.09, 0.07, 0.008), 0.01, "M_MetalSteel", loc=(-0.005, 0.01, ph / 2 + 0.002), rot=(0, 0, 6), axis="Z", bevel=0.002, segs=1)
            for px, py in ((-0.04, -0.016), (0.027, -0.022), (-0.037, 0.04), (0.031, 0.034)):
                b.cyl(0.0055, 0.006, "M_MetalSteel", loc=(px, py, ph / 2 + 0.007), axis="Z", segs=6)
        else:
            b.rbox((0.11, 0.03, 0.01), 0.008, "M_HarniShellDark", loc=(0.0, -0.06, ph / 2 + 0.001), axis="Z", bevel=0.003, segs=1)
    return b.finish(coll, parent=head, parent_origin=NECK_TOP)


# ───────────────────────────── assembly ─────────────────────────────


def build():
    geo.hide_startup_objects()
    common.clear_collection(COLLECTION)
    coll = common.get_collection(COLLECTION)
    root = geo.empty("Harni", coll, location=DISPLAY_AT, size=0.4)
    chassis = build_chassis(coll, root)
    lengths = []
    for side in ("L", "R"):
        _, length = build_track(coll, chassis, side)
        lengths.append(length)
        for i in range(3):
            build_wheel(coll, chassis, side, i)
    body = build_body(coll, root)
    for side in ("L", "R"):
        build_arm(coll, body, side)
    build_antenna(coll, body)
    neck = build_neck(coll, body)
    head = build_head(coll, neck)
    for side in ("L", "R"):
        build_eye(coll, head, side)
    bpy.context.view_layer.update()
    family = [root] + common.descendants(root)
    lo, hi = common.bounds(family, origin=root.matrix_world.translation)
    return {
        "root": root.name,
        "nodes": len(family),
        "tris": common.tri_count(family),
        "per_node": {o.name: common.tri_count([o]) for o in family if o.type == "MESH"},
        "size_blender": [round(v, 3) for v in (hi - lo)],
        "min": [round(v, 3) for v in lo],
        "max": [round(v, 3) for v in hi],
        "belt_length": round(lengths[0], 4),
    }


def previews(prefix="robot", views=("game", "three_quarter", "front", "side", "three_quarter_back"), resolution=(1100, 800)):
    root = bpy.data.objects["Harni"]
    return [common.render_preview([root], f"{prefix}_{view}.png", view=view, resolution=resolution) for view in views]


def export():
    root = bpy.data.objects["Harni"]
    return common.export_glb("robot.glb", [root])


if __name__ == "__main__":
    RESULT = build()
    print(RESULT)
