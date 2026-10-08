"""Shared helpers for HARNEST asset generator scripts (Blender 5.1).

The contract parts every generator must share: material palette, GLB export, manifest, preview renders.
Geometry helpers are up to each generator.

Headless:
    blender --background --factory-startup --python blender/scripts/build_xxx.py

Live Blender (MCP execute_blender_code) — run a generator file from the repo:
    p = r"C:/Users/assay/projects/pet/harnest/blender/scripts/build_xxx.py"
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), {"__file__": p, "__name__": "__main__"})

In a generator:
    import os, sys, importlib
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import common; importlib.reload(common)
"""

import json
import math
import os

import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS_DIR = os.path.join(REPO, "public", "assets", "models")
MANIFEST_DIR = os.path.join(REPO, "blender", "manifest")
PREVIEW_DIR = os.path.join(REPO, "blender", "previews")
BLEND_DIR = os.path.join(REPO, "blender")

# name: (hex colour, metallic, roughness, emission hex or None, emission strength)
# Keep in sync with docs/GAME_DESIGN.md §7.6. The runtime picks its TSL material by these names.
PALETTE = {
    "M_Wall": ("#9a968f", 0.0, 0.90, None, 0.0),  # tintable: the runtime multiplies it by a per-building colour
    "M_NpcPaint": ("#8a9496", 0.30, 0.60, None, 0.0),  # tintable: the runtime multiplies it by a per-NPC colour
    "M_Concrete": ("#6c7074", 0.0, 0.92, None, 0.0),
    "M_ConcreteDark": ("#3b3e42", 0.0, 0.95, None, 0.0),
    "M_Plaster": ("#8c8377", 0.0, 0.90, None, 0.0),
    "M_PlasterTeal": ("#3d6763", 0.0, 0.88, None, 0.0),
    "M_PlasterRust": ("#8a4a36", 0.0, 0.90, None, 0.0),
    "M_PlasterOchre": ("#a8843f", 0.0, 0.90, None, 0.0),
    "M_Brick": ("#6b4335", 0.0, 0.95, None, 0.0),
    "M_RoofTar": ("#26282b", 0.0, 0.85, None, 0.0),
    "M_MetalDark": ("#2c3035", 0.85, 0.50, None, 0.0),
    "M_MetalSteel": ("#7d858c", 0.90, 0.40, None, 0.0),
    "M_MetalGalv": ("#8f979c", 0.80, 0.50, None, 0.0),
    "M_MetalRust": ("#7b4b2c", 0.35, 0.85, None, 0.0),
    "M_MetalYellow": ("#c9a227", 0.30, 0.60, None, 0.0),
    "M_MetalRed": ("#9c3327", 0.30, 0.60, None, 0.0),
    "M_MetalTeal": ("#2f6f73", 0.30, 0.60, None, 0.0),
    "M_Rubber": ("#19191b", 0.0, 0.95, None, 0.0),
    "M_PlasticDark": ("#202327", 0.0, 0.60, None, 0.0),
    "M_PlasticLight": ("#c9c4b8", 0.0, 0.55, None, 0.0),
    "M_Wood": ("#6a4a30", 0.0, 0.85, None, 0.0),
    "M_TarpBlue": ("#2c4d78", 0.0, 0.80, None, 0.0),
    "M_TarpOrange": ("#c2672c", 0.0, 0.80, None, 0.0),
    "M_TarpGreen": ("#3d6b4f", 0.0, 0.80, None, 0.0),
    "M_Paper": ("#d9cfbd", 0.0, 0.90, None, 0.0),
    "M_Plant": ("#3c7a3b", 0.0, 0.80, None, 0.0),
    "M_PlantDark": ("#24512b", 0.0, 0.85, None, 0.0),
    "M_Trash": ("#1e2126", 0.0, 0.50, None, 0.0),
    "M_Cable": ("#121214", 0.0, 0.70, None, 0.0),
    "M_Glass": ("#0f1a22", 0.0, 0.08, None, 0.0),
    "M_WindowLit": ("#ffb866", 0.0, 0.50, "#ffb866", 4.0),
    "M_WindowLitCool": ("#8fd8ff", 0.0, 0.50, "#8fd8ff", 3.0),
    "M_LampWarm": ("#ffd9a3", 0.0, 0.50, "#ffd9a3", 12.0),
    "M_LanternGlow": ("#ff9440", 0.0, 0.70, "#ff9440", 6.0),
    "M_ScreenGlow": ("#37e6c8", 0.0, 0.30, "#37e6c8", 3.0),
    "M_NeonPink": ("#ff2e88", 0.0, 0.40, "#ff2e88", 10.0),
    "M_NeonCyan": ("#19e3ff", 0.0, 0.40, "#19e3ff", 10.0),
    "M_NeonOrange": ("#ff8a1f", 0.0, 0.40, "#ff8a1f", 10.0),
    "M_NeonGreen": ("#5dff7a", 0.0, 0.40, "#5dff7a", 8.0),
    "M_NeonYellow": ("#ffe14a", 0.0, 0.40, "#ffe14a", 8.0),
    "M_NeonViolet": ("#a66bff", 0.0, 0.40, "#a66bff", 10.0),
    "M_NeonRed": ("#ff3b30", 0.0, 0.40, "#ff3b30", 10.0),
    "M_HarniShell": ("#d97757", 0.20, 0.55, None, 0.0),
    "M_HarniShellDark": ("#8f4a33", 0.20, 0.65, None, 0.0),
    "M_HarniCream": ("#e8dcc6", 0.10, 0.60, None, 0.0),
    "M_Track": ("#1a1a1c", 0.0, 0.90, None, 0.0),
    "M_EyeGlow": ("#ffe9c4", 0.0, 0.20, "#ffe9c4", 6.0),
    "M_HarniScreen": ("#19e3ff", 0.0, 0.30, "#19e3ff", 3.0),
    "M_TerminalScreen": ("#ff9a3c", 0.0, 0.30, "#ff9a3c", 2.5),
    "M_NpcFace": ("#37e6c8", 0.0, 0.30, "#37e6c8", 2.0),
    "M_GateLight": ("#ff3b30", 0.0, 0.40, "#ff3b30", 6.0),
    "M_ChipGlow": ("#5dff7a", 0.0, 0.40, "#5dff7a", 6.0),
}


# ───────────────────────────── materials ─────────────────────────────


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_colour):
    """'#rrggbb' (sRGB) → linear RGBA tuple for Blender colour inputs."""
    h = hex_colour.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def _principled(material):
    material.use_nodes = True
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    raise RuntimeError(f"{material.name}: no Principled BSDF node")


def make_material(name, colour, metallic=0.0, roughness=0.8, emission=None, strength=0.0):
    """Create or update a Principled material. Use `mat(name)` for palette materials."""
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    node = _principled(material)
    rgba = hex_rgba(colour)
    node.inputs["Base Color"].default_value = rgba
    node.inputs["Metallic"].default_value = metallic
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Emission Color"].default_value = hex_rgba(emission) if emission else (0.0, 0.0, 0.0, 1.0)
    node.inputs["Emission Strength"].default_value = strength if emission else 0.0
    material.diffuse_color = rgba  # solid-viewport colour
    material.metallic = metallic
    material.roughness = roughness
    return material


def mat(name):
    """Palette material by its contract name (see PALETTE)."""
    if name not in PALETTE:
        raise KeyError(f"{name} is not in PALETTE; use make_material() for a new material and report it")
    colour, metallic, roughness, emission, strength = PALETTE[name]
    return make_material(name, colour, metallic, roughness, emission, strength)


# ───────────────────────────── scene helpers ─────────────────────────────


def get_collection(name):
    """Collection linked to the current scene (created when missing)."""
    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
    if collection.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(collection)
    return collection


def clear_collection(name):
    """Delete every object in the collection (for re-running a generator). Other objects are untouched."""
    collection = bpy.data.collections.get(name)
    if collection is None:
        return
    for obj in list(collection.all_objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if isinstance(data, bpy.types.Mesh) and data.users == 0:
            bpy.data.meshes.remove(data)


def descendants(obj):
    out = []
    for child in obj.children:
        out.append(child)
        out.extend(descendants(child))
    return out


def tri_count(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    return total


def bounds(objects, origin=Vector((0.0, 0.0, 0.0))):
    """World-space AABB of evaluated meshes, relative to `origin`. Returns (min, max) Vectors (Blender axes)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        world = evaluated.matrix_world
        for vertex in mesh.vertices:
            p = world @ vertex.co - origin
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
        evaluated.to_mesh_clear()
    return lo, hi


# ───────────────────────────── export ─────────────────────────────


def _three_axes(v):
    """Blender (x, y, z) → three.js / glTF (x, z, -y)."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def export_glb(filename, roots):
    """Export asset roots to public/assets/models/<filename> and write blender/manifest/<name>.json.

    Each root object (with all its descendants) is one asset; the root's name is the asset id.
    Roots may sit anywhere in the .blend (display grid): they are exported at the origin.
    Modifiers are applied. The active colour attribute, if a mesh has one, is exported as COLOR_0.
    """
    os.makedirs(MODELS_DIR, exist_ok=True)
    os.makedirs(MANIFEST_DIR, exist_ok=True)
    path = os.path.join(MODELS_DIR, filename)
    view_layer = bpy.context.view_layer
    saved = [(root, root.location.copy()) for root in roots]

    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in view_layer.objects:
        obj.select_set(False)

    manifest = []
    try:
        for root in roots:
            root.location = (0.0, 0.0, 0.0)
        view_layer.update()
        for root in roots:
            family = [root] + descendants(root)
            for obj in family:
                obj.select_set(True)
            lo, hi = bounds(family)
            lo3, hi3 = _three_axes(lo), _three_axes(hi)
            mins = [min(a, b) for a, b in zip(lo3, hi3)]
            maxs = [max(a, b) for a, b in zip(lo3, hi3)]
            materials = sorted(
                {slot.material.name for obj in family if obj.type == "MESH" for slot in obj.material_slots if slot.material}
            )
            manifest.append(
                {
                    "id": root.name,
                    "size": [round(b - a, 4) for a, b in zip(mins, maxs)],
                    "min": mins,
                    "max": maxs,
                    "tris": tri_count(family),
                    "materials": materials,
                    "nodes": [obj.name for obj in family],
                }
            )
        view_layer.objects.active = roots[0]
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_materials="EXPORT",
            export_vertex_color="ACTIVE",
            export_all_vertex_colors=False,
            export_active_vertex_color_when_no_material=True,
            export_animations=False,
            export_cameras=False,
            export_lights=False,
            export_extras=False,
        )
    finally:
        for root, location in saved:
            root.location = location
        view_layer.update()

    manifest_path = os.path.join(MANIFEST_DIR, os.path.splitext(filename)[0] + ".json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=1)
    return {"glb": path, "manifest": manifest_path, "assets": len(manifest), "bytes": os.path.getsize(path)}


def save_blend(filename):
    """Save the current file as blender/<filename>."""
    path = os.path.join(BLEND_DIR, filename)
    bpy.ops.wm.save_as_mainfile(filepath=path, check_existing=False)
    return path


# ───────────────────────────── preview renders ─────────────────────────────

# Unit vectors from the subject toward the camera (Blender axes; the asset front is -Y).
VIEWS = {
    "game": (0.0, -math.cos(math.radians(52)), math.sin(math.radians(52))),  # the in-game camera
    "three_quarter": (-0.62, -0.72, 0.42),
    "three_quarter_back": (0.62, 0.72, 0.42),
    "front": (0.0, -1.0, 0.12),
    "side": (-1.0, 0.0, 0.12),
    "top": (0.0, -0.001, 1.0),
}


def _preview_rig():
    scene = bpy.context.scene
    camera = bpy.data.objects.get("HN_PreviewCam")
    if camera is None:
        camera = bpy.data.objects.new("HN_PreviewCam", bpy.data.cameras.new("HN_PreviewCam"))
        scene.collection.objects.link(camera)
    camera.data.lens = 60
    camera.data.clip_start = 0.05
    camera.data.clip_end = 500

    def sun(name, energy, colour, rotation):
        light = bpy.data.objects.get(name)
        if light is None:
            light = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
            scene.collection.objects.link(light)
        light.data.energy = energy
        light.data.color = colour
        light.rotation_euler = rotation
        return light

    sun("HN_PreviewKey", 3.2, (1.0, 0.93, 0.85), (math.radians(50), 0.0, math.radians(-35)))
    sun("HN_PreviewFill", 1.0, (0.55, 0.75, 1.0), (math.radians(60), 0.0, math.radians(140)))

    world = scene.world or bpy.data.worlds.new("HN_World")
    scene.world = world
    world.use_nodes = True
    background = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if background:
        background.inputs["Color"].default_value = (0.035, 0.05, 0.065, 1.0)
        background.inputs["Strength"].default_value = 1.0
    return camera


def render_preview(objects, filename, view="three_quarter", resolution=(1100, 800), margin=1.2, isolate=True):
    """Render `objects` (roots; descendants included) with EEVEE to blender/previews/<filename>.

    view: one of VIEWS ('game' = how the in-game camera sees it). isolate=True hides everything else.
    Works headless and in the live Blender. Returns the file path — open it with the Read tool.
    """
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scene = bpy.context.scene
    family = []
    for obj in objects:
        family.append(obj)
        family.extend(descendants(obj))
    keep = {obj.name for obj in family}

    camera = _preview_rig()
    lo, hi = bounds(family)
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.05)
    direction = Vector(VIEWS[view]).normalized()

    aspect = resolution[0] / resolution[1]
    fov_x = 2 * math.atan(camera.data.sensor_width / 2 / camera.data.lens)
    fov = min(fov_x, 2 * math.atan(math.tan(fov_x / 2) / aspect)) if aspect >= 1 else fov_x
    distance = radius / math.sin(fov / 2) * margin
    camera.location = centre + direction * distance
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    hidden = []
    if isolate:
        for obj in scene.objects:
            if obj.name not in keep and obj.type not in {"LIGHT", "CAMERA"} and not obj.hide_render:
                obj.hide_render = True
                hidden.append(obj)

    path = os.path.join(PREVIEW_DIR, filename)
    render = scene.render
    previous = (render.engine, render.resolution_x, render.resolution_y, render.resolution_percentage, render.filepath)
    try:
        render.engine = "BLENDER_EEVEE"
        render.resolution_x, render.resolution_y = resolution
        render.resolution_percentage = 100
        render.image_settings.file_format = "PNG"
        render.filepath = path
        bpy.ops.render.render(write_still=True)
    finally:
        render.engine, render.resolution_x, render.resolution_y, render.resolution_percentage, render.filepath = previous
        for obj in hidden:
            obj.hide_render = False
    return path
