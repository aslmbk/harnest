"""HARNEST interactables -> public/assets/models/interactables.glb  (docs/GAME_DESIGN.md §7.3).

Live Blender (MCP execute_blender_code):
    p = r"C:/Users/assay/projects/pet/harnest/blender/scripts/build_interactables.py"
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), {"__file__": p, "__name__": "__main__"})

Clears and rebuilds only the `HN_Interactables` collection.
  terminal: root -> Kiosk (cabinet, keyboard, CRT, rain hood, cables) + Screen (M_TerminalScreen,
            UV 0..1 upright, origin at the screen centre). Origin on the ground, front -Y (three.js +Z).
  gate:     root -> GateFrame (pillars, beam, lamp M_GateLight), DoorL (at -X = screen-left seen from
            the front / the camera) and DoorR (+X). Doors run just behind the frame and slide apart
            along X. Origin: ground, centre of the 4 m x 3.2 m opening.
  chip:     root -> Cartridge. Origin at its centre.
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

COLLECTION = "HN_Interactables"
LAYOUT = {"terminal": (6.6, 0.0, 0.0), "chip": (7.8, 0.0, 0.5), "gate": (11.6, 0.0, 0.0)}

# terminal
SCREEN_W, SCREEN_H = 0.40, 0.30
SCREEN_TILT = 18.0  # degrees the screen faces up
CRT_C = Vector((0.0, 0.0, 1.16))  # CRT tilt pivot (centre of the front box)

# gate
OPEN_W, OPEN_H = 4.0, 3.2
PILLAR_W, FRAME_D = 0.6, 0.7
BEAM_H = 0.7
DOOR_W, DOOR_T = 2.0, 0.12
DOOR_Y = FRAME_D / 2 + 0.03 + DOOR_T / 2  # doors run just behind the frame
DOOR_SLIDE = 2.0


def clip_poly(poly, x0, x1, z0, z1):
    """Sutherland-Hodgman clip of a 2D polygon against an axis-aligned rectangle."""

    def clip(points, inside, intersect):
        out = []
        for i, cur in enumerate(points):
            prev = points[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(intersect(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(intersect(prev, cur))
        return out

    def ix(a, b, x):
        t = (x - a[0]) / (b[0] - a[0])
        return (x, a[1] + t * (b[1] - a[1]))

    def iz(a, b, z):
        t = (z - a[1]) / (b[1] - a[1])
        return (a[0] + t * (b[0] - a[0]), z)

    pts = list(poly)
    for inside, inter in (
        (lambda p: p[0] >= x0, lambda a, b: ix(a, b, x0)),
        (lambda p: p[0] <= x1, lambda a, b: ix(a, b, x1)),
        (lambda p: p[1] >= z0, lambda a, b: iz(a, b, z0)),
        (lambda p: p[1] <= z1, lambda a, b: iz(a, b, z1)),
    ):
        if not pts:
            break
        pts = clip(pts, inside, inter)
    return pts


def hazard_band(b, x0, x1, z0, z1, y, stripe=0.16, slant=0.7, depth=0.012, flip=False):
    """Yellow plate with black diagonal stripes on a wall whose front face is the plane y (facing -Y)."""
    b.box((x1 - x0, depth, z1 - z0), "M_MetalYellow", loc=((x0 + x1) / 2, y - depth / 2, (z0 + z1) / 2), bevel=0.004, segs=1)
    dx = (z1 - z0) * slant * (-1 if flip else 1)
    x = x0 - abs(dx) - 2 * stripe
    k = 0
    while x < x1 + abs(dx):
        if k % 2 == 0:
            pts = clip_poly([(x, z0), (x + stripe, z0), (x + stripe + dx, z1), (x + dx, z1)], x0 + 0.004, x1 - 0.004, z0 + 0.004, z1 - 0.004)
            if len(pts) >= 3 and abs(_area(pts)) > 1e-5:
                b.prism(pts, 0.004, "M_MetalDark", loc=(0, y - depth - 0.0015, 0), axis="Y")
        x += stripe
        k += 1


def _area(pts):
    return 0.5 * sum(pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1] for i in range(len(pts)))


# ───────────────────────────── terminal ─────────────────────────────


def build_terminal(coll, at):
    root = geo.empty("terminal", coll, location=at, size=0.3)
    b = Builder("Kiosk", origin=(0, 0, 0))
    # concrete footing with anchor bolts
    b.box((0.74, 0.56, 0.06), "M_ConcreteDark", loc=(0, 0.01, 0.03), bevel=0.012, segs=1)
    for x in (-0.32, 0.32):
        for y in (-0.22, 0.24):
            b.cyl(0.014, 0.02, "M_MetalSteel", loc=(x, y, 0.065), axis="Z", segs=6, start=0.0)
    # cabinet
    b.box((0.62, 0.44, 0.80), "M_MetalTeal", loc=(0, 0.02, 0.46), bevel=0.022, segs=2)
    b.box((0.64, 0.46, 0.04), "M_MetalDark", loc=(0, 0.02, 0.08), bevel=0.01, segs=1)
    b.box((0.64, 0.46, 0.03), "M_MetalDark", loc=(0, 0.02, 0.845), bevel=0.01, segs=1)
    # front service door: frame, handle, lock, card slot, speaker grille
    fy = -0.2
    b.frame(rrect(0.5, 0.5, 0.03, 2), rrect(0.46, 0.46, 0.02, 2), 0.012, "M_MetalDark", loc=(0, fy - 0.004, 0.42), bevel=0.002, segs=1)
    b.rbox((0.03, 0.03, 0.14), 0.012, "M_MetalSteel", loc=(0.19, fy - 0.02, 0.45), axis="Y", bevel=0.004, segs=1)
    b.cyl(0.018, 0.012, "M_MetalYellow", loc=(0.19, fy - 0.008, 0.36), axis="Y", segs=12, bevel=0.003)
    b.rbox((0.16, 0.016, 0.05), 0.01, "M_MetalDark", loc=(-0.1, fy - 0.006, 0.6), axis="Y", bevel=0.003, segs=1)
    b.box((0.11, 0.02, 0.008), "M_PlasticDark", loc=(-0.1, fy - 0.01, 0.6))
    for k in range(4):
        b.box((0.14, 0.012, 0.01), "M_MetalDark", loc=(-0.1, fy - 0.006, 0.28 + 0.025 * k))
    # rusty patch and an orange sticker
    b.box((0.14, 0.012, 0.1), "M_MetalRust", loc=(-0.2, fy - 0.004, 0.17), rot=(0, -4, 0), bevel=0.003, segs=1)
    b.box((0.09, 0.004, 0.065), "M_TarpOrange", loc=(0.16, fy - 0.012, 0.66), rot=(0, 7, 0))
    # side vents and paper notices
    for s in (1, -1):
        for k in range(5):
            b.box((0.012, 0.22, 0.014), "M_MetalDark", loc=(s * 0.312, 0.05, 0.5 + 0.035 * k))
    b.box((0.004, 0.13, 0.17), "M_Paper", loc=(-0.313, -0.05, 0.3), rot=(5, 0, 0))
    b.box((0.004, 0.05, 0.05), "M_Paper", loc=(-0.314, 0.11, 0.24), rot=(-9, 0, 0))
    # keyboard deck sloping toward the user, chunky keyboard
    deck = [(0.0, 0.0), (0.16, 0.0), (0.16, 0.035), (0.0, 0.085)]  # side profile, a = forward from the cabinet
    b.prism(deck, 0.6, "M_MetalDark", loc=(0, -0.2, 0.82), axis="X", bevel=0.006, segs=1)
    slope = math.degrees(math.atan2(0.05, 0.16))
    with b.group(loc=(0, -0.305, 0.889), rot=(slope, 0, 0)):
        b.rbox((0.5, 0.16, 0.03), 0.012, "M_PlasticLight", axis="Z", bevel=0.006, segs=1)
        for row in range(4):
            for col in range(11):
                if row == 3 and 3 <= col <= 7:
                    continue
                x = -0.2 + col * 0.04 + (row % 2) * 0.01
                b.box((0.032, 0.03, 0.014), "M_PlasticDark", loc=(x, -0.055 + row * 0.036, 0.018))
        b.box((0.17, 0.03, 0.014), "M_PlasticDark", loc=(0.005, 0.053, 0.018), bevel=0.003, segs=1)
    coil = [(0.27 + 0.012 * math.cos(t * 1.7), -0.21 + 0.012 * math.sin(t * 1.7), 0.9 - t * 0.012) for t in range(12)]
    b.sweep(smooth_path(coil, 2), 0.005, "M_Cable", segs=6)
    # swivel stand
    b.cyl(0.12, 0.03, "M_MetalDark", loc=(0, 0.06, 0.875), axis="Z", segs=20, bevel=0.006)
    b.cyl(0.05, 0.13, "M_MetalSteel", loc=(0, 0.04, 0.95), axis="Z", segs=14)
    # CRT monitor, tilted up toward the camera
    with b.group(pivot=CRT_C, rot=(-SCREEN_TILT, 0, 0)):
        cx, cy, cz = CRT_C
        b.rbox((0.56, 0.26, 0.46), 0.05, "M_PlasticLight", loc=(cx, cy - 0.04, cz), axis="Y", n=3, bevel=0.016, segs=2)
        b.prism(rrect(0.46, 0.38, 0.06, 3), 0.22, "M_PlasticLight", loc=(cx, cy + 0.2, cz + 0.01), axis="Y", taper=(0.62, 0.6), shift=(0, 0.01), bevel=0.012, segs=1)
        b.frame(rrect(0.47, 0.37, 0.05, 3), rrect(0.414, 0.312, 0.035, 3), 0.024, "M_PlasticDark", loc=(cx, cy - 0.172, cz + 0.02), bevel=0.004, segs=1)
        b.cyl(0.009, 0.01, "M_NeonGreen", loc=(cx + 0.22, cy - 0.172, cz - 0.19), axis="Y", segs=8)
        for k in range(2):
            b.cyl(0.016, 0.016, "M_PlasticDark", loc=(cx + 0.16 - 0.045 * k, cy - 0.172, cz - 0.19), axis="Y", segs=10, bevel=0.003)
        b.box((0.08, 0.006, 0.02), "M_MetalSteel", loc=(cx - 0.17, cy - 0.172, cz - 0.19), bevel=0.002, segs=1)
        for k in range(5):
            b.box((0.3, 0.014, 0.008), "M_PlasticDark", loc=(cx, cy + 0.0 + 0.03 * k, cz + 0.231))
        b.sweep(smooth_path([(0.09, 0.27, cz - 0.05), (0.13, 0.33, cz - 0.15), (0.14, 0.3, cz - 0.27)], 3), 0.014, "M_Cable", segs=8)
    b.sweep(smooth_path([(0.14, 0.33, 0.93), (0.14, 0.27, 0.88), (0.12, 0.2, 0.86)], 3), 0.014, "M_Cable", segs=8)
    b.sweep(smooth_path([(-0.1, 0.24, 1.05), (-0.17, 0.31, 0.95), (-0.2, 0.26, 0.87)], 3), 0.01, "M_Cable", segs=8)
    # ground conduit from the cabinet side into the footing
    b.sweep(smooth_path([(0.31, 0.12, 0.36), (0.345, 0.12, 0.27), (0.36, 0.12, 0.15), (0.36, 0.12, 0.05)], 3), 0.022, "M_Cable", segs=8)
    b.tube(0.03, 0.02, 0.03, "M_MetalSteel", loc=(0.315, 0.12, 0.36), rot=(0, 70, 0), axis="Z", segs=10)
    # rain hood: curved sheet on two struts, front lip clear of the screen's line of sight
    for s in (1, -1):
        b.rbox((0.03, 0.03, 0.66), 0.008, "M_MetalDark", loc=(s * 0.27, 0.215, 1.19), axis="Z", bevel=0.004, segs=1)
        b.box((0.06, 0.05, 0.05), "M_MetalDark", loc=(s * 0.27, 0.215, 0.885), bevel=0.008, segs=1)
    arc = []
    for i in range(11):
        th = math.radians(111 - 42 * i / 10)
        arc.append((-0.04 + 0.52 * math.cos(th), 1.03 + 0.52 * math.sin(th)))
    # side profile (a = forward, b = up): top surface then underside, plus a folded front lip
    lip = [(arc[-1][0] + 0.004, arc[-1][1] - 0.03), (arc[-1][0] - 0.012, arc[-1][1] - 0.03)]
    under = [(a, z - 0.016) for a, z in reversed(arc[:-1])]
    b.prism(arc + lip + under, 0.68, "M_MetalYellow", axis="X", bevel=0.004, segs=1)
    b.box((0.68, 0.012, 0.012), "M_MetalDark", loc=(0, -arc[-1][0], arc[-1][1] - 0.03), bevel=0.003, segs=1)
    # little antenna on the hood and a tin-can plant on the cabinet top
    b.cyl(0.012, 0.03, "M_MetalDark", loc=(-0.26, 0.15, 1.53), axis="Z", segs=8)
    b.sweep([(-0.26, 0.15, 1.54), (-0.264, 0.158, 1.61), (-0.272, 0.172, 1.67)], 0.004, "M_MetalSteel", segs=6)
    b.sphere(0.012, "M_ScreenGlow", loc=(-0.273, 0.173, 1.68), segs=8, rings=5, uv=(0.5, 0.5))
    # a tin-can plant someone keeps on the hood
    px, py, pz = 0.2, 0.03, 1.548 + 0.033
    b.cyl(0.034, 0.07, "M_MetalGalv", loc=(px, py, pz), axis="Z", segs=12, bevel=0.004)
    b.cyl(0.03, 0.006, "M_PlantDark", loc=(px, py, pz + 0.033), axis="Z", segs=12)
    for k, (ang, tilt, size) in enumerate(((20, 35, 0.045), (140, 40, 0.04), (260, 30, 0.05), (80, 12, 0.035))):
        a = math.radians(ang)
        b.sphere(size, "M_Plant", loc=(px + 0.024 * math.cos(a), py + 0.024 * math.sin(a), pz + 0.055 + 0.01 * k), rot=(tilt, 0, ang + 90), segs=8, rings=4, scale=(0.45, 1.0, 0.18))
    kiosk = b.finish(coll, parent=root, parent_origin=(0, 0, 0))

    # screen (separate node so the game can find / frame it); UV 0..1 upright
    t = Matrix.Translation(CRT_C) @ Matrix.Rotation(math.radians(-SCREEN_TILT), 4, "X") @ Matrix.Translation(-CRT_C)
    local_c = Vector((CRT_C.x, CRT_C.y - 0.1745, CRT_C.z + 0.02))  # 4.5 mm in front of the CRT face, inside the bezel
    sc = Builder("Screen", origin=t @ local_c)
    sc.groups[-1] = t
    sc.screen(SCREEN_W + 0.022, SCREEN_H + 0.02, "M_TerminalScreen", loc=local_c, nx=8, ny=6, bulge=0.01)
    screen = sc.finish(coll, parent=root, parent_origin=(0, 0, 0))
    normal = (t.to_3x3() @ Vector((0, -1, 0))).normalized()
    return root, {"screen_centre": [round(v, 4) for v in (t @ local_c)], "screen_normal": [round(v, 4) for v in normal]}


# ───────────────────────────── gate ─────────────────────────────


def build_gate(coll, at):
    root = geo.empty("gate", coll, location=at, size=0.6)
    f = Builder("GateFrame", origin=(0, 0, 0))
    half = OPEN_W / 2
    top = OPEN_H + BEAM_H
    fy = -FRAME_D / 2  # front plane of the frame
    for s in (1, -1):
        xc = s * (half + PILLAR_W / 2)
        f.box((PILLAR_W, FRAME_D, top), "M_ConcreteDark", loc=(xc, 0, top / 2), bevel=0.03, segs=1)
        f.box((PILLAR_W + 0.08, FRAME_D + 0.08, 0.2), "M_Concrete", loc=(xc, 0, 0.1), bevel=0.02, segs=1)
        # steel lining on the opening side, with bolts
        f.box((0.06, FRAME_D + 0.02, OPEN_H), "M_MetalDark", loc=(s * (half + 0.02), 0, OPEN_H / 2), bevel=0.01, segs=1)
        for z in (0.5, 1.3, 2.1, 2.9):
            for y in (-0.22, 0.22):
                f.cyl(0.022, 0.02, "M_MetalSteel", loc=(s * (half - 0.015), y, z), axis="X", segs=6, start=0.0)
        # hazard stripes on the pillar front, a pipe and a junction box
        hazard_band(f, xc - PILLAR_W / 2 + 0.06, xc + PILLAR_W / 2 - 0.06, 0.35, 1.45, fy, stripe=0.12, slant=0.5, flip=s < 0)
        f.box((0.24, 0.1, 0.3), "M_MetalGalv", loc=(xc + s * 0.05, fy - 0.05, 2.1), bevel=0.012, segs=1)
        f.box((0.06, 0.012, 0.04), "M_MetalYellow", loc=(xc + s * 0.05, fy - 0.105, 2.18))
        f.cyl(0.025, 0.95, "M_MetalGalv", loc=(xc + s * 0.05, fy - 0.035, 2.25 + 0.475), axis="Z", segs=10)
    # top beam with a hazard band and the door rail behind
    f.box((OPEN_W + 2 * PILLAR_W, FRAME_D, BEAM_H), "M_ConcreteDark", loc=(0, 0, OPEN_H + BEAM_H / 2), bevel=0.03, segs=1)
    f.box((OPEN_W + 0.04, FRAME_D + 0.02, 0.06), "M_MetalDark", loc=(0, 0, OPEN_H + 0.02), bevel=0.01, segs=1)
    hazard_band(f, -half + 0.1, half - 0.1, OPEN_H + 0.12, OPEN_H + 0.32, fy, stripe=0.16, slant=0.8)
    f.box((OPEN_W + 2 * PILLAR_W, 0.12, 0.1), "M_MetalSteel", loc=(0, DOOR_Y, OPEN_H + 0.11), bevel=0.01, segs=1)
    f.box((OPEN_W + 2 * PILLAR_W, 0.16, 0.025), "M_MetalSteel", loc=(0, DOOR_Y, 0.0125), bevel=0.006, segs=1)
    # signal lamp over the centre of the opening
    lz = OPEN_H + BEAM_H * 0.62
    f.rbox((0.42, 0.2, 0.3), 0.05, "M_MetalDark", loc=(0, fy - 0.08, lz), axis="Y", bevel=0.012, segs=1)
    f.cyl(0.16, 0.06, "M_MetalDark", loc=(0, fy - 0.2, lz), axis="Y", segs=24, bevel=0.01)
    f.lathe([(0.0, 0.0), (0.125, 0.0), (0.12, 0.02), (0.09, 0.045), (0.05, 0.058), (0.0, 0.062)], "M_GateLight", loc=(0, fy - 0.225, lz), axis="Y", segs=24, uv_planar=0.125)
    f.tube(0.15, 0.125, 0.03, "M_MetalSteel", loc=(0, fy - 0.24, lz), axis="Y", segs=24, bevel=0.004)
    hood = [(0.0, 0.0), (0.2, 0.0), (0.2, 0.012), (0.0, 0.012)]
    f.prism(hood, 0.36, "M_MetalDark", loc=(0, fy - 0.12, lz + 0.155), rot=(12, 0, 0), axis="X", bevel=0.003, segs=1)
    frame = f.finish(coll, parent=root, parent_origin=(0, 0, 0))

    doors = []
    for name, s in (("DoorL", -1), ("DoorR", 1)):
        origin = Vector((s * DOOR_W / 2, DOOR_Y, 0.0))
        d = Builder(name, origin=origin)
        x0, x1 = (-DOOR_W, 0.0) if s < 0 else (0.0, DOOR_W)
        xc = (x0 + x1) / 2
        dy = DOOR_Y
        front = dy - DOOR_T / 2
        h = OPEN_H - 0.01
        # panel with a steel border frame and horizontal ribs
        d.box((DOOR_W - 0.01, DOOR_T * 0.6, h), "M_MetalGalv", loc=(xc, dy, h / 2 + 0.005), bevel=0.01, segs=1)
        d.box((0.1, DOOR_T, h), "M_MetalDark", loc=(x0 + 0.055, dy, h / 2 + 0.005), bevel=0.012, segs=1)
        d.box((0.1, DOOR_T, h), "M_MetalDark", loc=(x1 - 0.055, dy, h / 2 + 0.005), bevel=0.012, segs=1)
        d.box((DOOR_W - 0.01, DOOR_T, 0.1), "M_MetalDark", loc=(xc, dy, h - 0.045), bevel=0.012, segs=1)
        d.box((DOOR_W - 0.01, DOOR_T, 0.08), "M_MetalDark", loc=(xc, dy, 0.045), bevel=0.012, segs=1)
        for k in range(9):
            z = 0.62 + k * 0.27
            d.box((DOOR_W - 0.2, 0.03, 0.09), "M_MetalGalv", loc=(xc, front + 0.012, z), bevel=0.012, segs=1)
        # hazard band along the bottom, rubber seal on the meeting edge, rivets
        hazard_band(d, x0 + 0.1, x1 - 0.1, 0.1, 0.46, front, stripe=0.18, slant=0.8, flip=s < 0)
        seal_x = x1 if s < 0 else x0
        d.box((0.03, DOOR_T * 0.8, h - 0.02), "M_Rubber", loc=(seal_x + s * -0.012, dy, h / 2 + 0.005), bevel=0.008, segs=1)
        for z in (0.7, 1.6, 2.5):
            for x in (x0 + 0.055, x1 - 0.055):
                d.cyl(0.014, 0.012, "M_MetalSteel", loc=(x, front - 0.004, z), axis="Y", segs=6)
        # handle and a small patched plate
        hx = x1 - 0.25 if s < 0 else x0 + 0.25
        d.rbox((0.05, 0.05, 0.4), 0.018, "M_MetalSteel", loc=(hx, front - 0.03, 1.1), axis="Y", bevel=0.006, segs=1)
        if s > 0:
            d.box((0.36, 0.014, 0.26), "M_MetalRust", loc=(x0 + 1.25, front - 0.004, 1.42), rot=(0, 3, 0), bevel=0.004, segs=1)
        # roller hangers into the top rail
        for x in (x0 + 0.35, x1 - 0.35):
            d.box((0.08, 0.06, 0.14), "M_MetalDark", loc=(x, dy, OPEN_H + 0.03), bevel=0.008, segs=1)
        doors.append(d.finish(coll, parent=root, parent_origin=(0, 0, 0)))
    return root


# ───────────────────────────── chip ─────────────────────────────


def build_chip(coll, at):
    root = geo.empty("chip", coll, location=at, size=0.2)
    b = Builder("Cartridge", origin=(0, 0, 0))
    W, T, H = 0.26, 0.055, 0.30
    # body with a clipped top corner
    prof = [(-W / 2, -H / 2), (W / 2, -H / 2), (W / 2, H / 2 - 0.05), (W / 2 - 0.05, H / 2), (-W / 2, H / 2)]
    b.prism(geo.fillet(prof, [0.015, 0.015, 0.01, 0.01, 0.015], 2, closed=True), T, "M_PlasticDark", loc=(0, 0, 0.02), axis="Y", bevel=0.008, segs=2)
    # glowing core window on both faces
    for side in (-1, 1):
        y = side * (T / 2 + 0.002)
        b.frame(rrect(0.15, 0.1, 0.02, 3), rrect(0.12, 0.072, 0.012, 3), 0.008, "M_MetalSteel", loc=(-0.01, y, 0.055), bevel=0.002, segs=1)
        b.rbox((0.124, 0.006, 0.076), 0.014, "M_ChipGlow", loc=(-0.01, y - side * 0.001, 0.055), axis="Y", n=3)
        # grip ribs and a label
        for k in range(3):
            b.box((0.14, 0.006, 0.008), "M_MetalDark", loc=(-0.02, y, 0.122 + 0.0 - 0.016 * k), bevel=0.002, segs=1)
        b.box((0.17, 0.004, 0.05), "M_Paper", loc=(0.0, y, -0.035))
        b.box((0.1, 0.005, 0.006), "M_PlasticDark", loc=(-0.02, y - side * 0.0005, -0.03))
    # edge light strip
    b.box((0.012, T * 0.6, 0.18), "M_ChipGlow", loc=(-W / 2 - 0.002, 0, 0.02))
    # connector edge with gold contacts
    b.box((0.2, 0.034, 0.05), "M_PlasticDark", loc=(0, 0, -H / 2 - 0.0), bevel=0.006, segs=1)
    for k in range(8):
        x = -0.084 + k * 0.024
        for side in (-1, 1):
            b.box((0.014, 0.004, 0.036), "M_MetalYellow", loc=(x, side * 0.018, -H / 2 - 0.004))
    chip = b.finish(coll, parent=root, parent_origin=(0, 0, 0))
    return root


# ───────────────────────────── assembly ─────────────────────────────


def build():
    geo.hide_startup_objects()
    common.clear_collection(COLLECTION)
    coll = common.get_collection(COLLECTION)
    terminal, info = build_terminal(coll, LAYOUT["terminal"])
    gate = build_gate(coll, LAYOUT["gate"])
    chip = build_chip(coll, LAYOUT["chip"])
    bpy.context.view_layer.update()
    out = {"terminal_screen": info}
    for root in (terminal, gate, chip):
        fam = [root] + common.descendants(root)
        lo, hi = common.bounds(fam, origin=root.matrix_world.translation)
        out[root.name] = {"tris": common.tri_count(fam), "size": [round(v, 3) for v in (hi - lo)], "min": [round(v, 3) for v in lo], "max": [round(v, 3) for v in hi], "nodes": [o.name for o in fam]}
    return out


def roots():
    return [bpy.data.objects[n] for n in ("terminal", "gate", "chip")]


def previews(views=("game", "three_quarter", "front", "side"), resolution=(900, 800)):
    out = []
    for root in roots():
        for view in views:
            out.append(common.render_preview([root], f"inter_{root.name}_{view}.png", view=view, resolution=resolution))
    return out


def export():
    return common.export_glb("interactables.glb", roots())


if __name__ == "__main__":
    RESULT = build()
    print(RESULT)
