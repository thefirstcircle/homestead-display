"""
Conway MA Farmhouse — Blender Python Script
============================================
Run in Blender: Scripting tab > Open (or paste) > Run Script
Tested with Blender 3.x / 4.x

Coordinate system:
  +X = viewer's right
  +Y = depth into screen (back of house)
  -Y = front of house (camera faces +Y toward house)
  +Z = up

Origin at ground-center of main house footprint.
"""

import bpy
import bmesh
import math

# ── Clear existing scene ──────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for d in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for b in list(d):
        d.remove(b)

# ── Material helper ───────────────────────────────────────────────────────────
def mat(name, rgb, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m

# ── Geometry helpers ──────────────────────────────────────────────────────────
def link(obj):
    bpy.context.collection.objects.link(obj)
    return obj

def box(name, sx, sy, sz, material, x=0.0, y=0.0, z=0.0):
    """Axis-aligned box, bottom at z, centered in X/Y around x/y."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, sz / 2), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = (x, y, z)
    ob.data.materials.append(material)
    return link(ob)

def gable_roof(name, width, depth, z_base, peak, material, x=0.0, y=0.0):
    """
    Gabled roof.  Ridge runs along X axis (left–right).
    Slopes go front/back; gable ends face left & right.
    """
    bm = bmesh.new()
    hw, hd = width / 2, depth / 2
    v = [bm.verts.new(p) for p in [
        (-hw, -hd, 0),           # 0  front-left  eave
        ( hw, -hd, 0),           # 1  front-right eave
        ( hw,  hd, 0),           # 2  back-right  eave
        (-hw,  hd, 0),           # 3  back-left   eave
        (-hw,   0, peak),        # 4  left  ridge end
        ( hw,   0, peak),        # 5  right ridge end
    ]]
    bm.faces.new([v[0], v[1], v[5], v[4]])   # front slope
    bm.faces.new([v[2], v[3], v[4], v[5]])   # back  slope
    bm.faces.new([v[3], v[0], v[4]])          # left  gable
    bm.faces.new([v[1], v[2], v[5]])          # right gable
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = (x, y, z_base)
    ob.data.materials.append(material)
    return link(ob)

def gable_roof_y(name, width, depth, z_base, peak, material, x=0.0, y=0.0):
    """
    Gabled roof rotated 90°.  Ridge runs along Y axis (front–back).
    Slopes go left/right; gable ends face front & back.
    Use this for buildings whose ridge is perpendicular to the main house.
    """
    bm = bmesh.new()
    hw, hd = width / 2, depth / 2
    v = [bm.verts.new(p) for p in [
        (-hw, -hd, 0),           # 0  front-left  eave
        ( hw, -hd, 0),           # 1  front-right eave
        ( hw,  hd, 0),           # 2  back-right  eave
        (-hw,  hd, 0),           # 3  back-left   eave
        (  0, -hd, peak),        # 4  front ridge
        (  0,  hd, peak),        # 5  back  ridge
    ]]
    bm.faces.new([v[3], v[0], v[4], v[5]])   # left  slope
    bm.faces.new([v[1], v[2], v[5], v[4]])   # right slope
    bm.faces.new([v[0], v[1], v[4]])          # front gable
    bm.faces.new([v[2], v[3], v[5]])          # back  gable
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = (x, y, z_base)
    ob.data.materials.append(material)
    return link(ob)

# ── Materials ─────────────────────────────────────────────────────────────────
M_YELLOW  = mat("YellowSiding",  (0.94, 0.82, 0.26), rough=0.88)
M_BROWN   = mat("BrownSiding",   (0.28, 0.16, 0.07), rough=0.92)
M_METAL   = mat("MetalRoof",     (0.62, 0.64, 0.68), rough=0.22, metal=0.82)
M_ASPHALT = mat("AsphaltRoof",   (0.21, 0.18, 0.15), rough=0.95)
M_BRICK   = mat("Brick",         (0.70, 0.28, 0.17), rough=0.90)
M_TRIM    = mat("DarkBrownTrim", (0.21, 0.12, 0.05), rough=0.85)
M_DOOR    = mat("Door",          (0.56, 0.67, 0.74), rough=0.60)
M_GLASS   = mat("Glass",         (0.77, 0.91, 0.97), rough=0.05)
M_CONC    = mat("Concrete",      (0.72, 0.72, 0.74), rough=0.95)
M_GRASS   = mat("Grass",         (0.22, 0.40, 0.14), rough=1.00)
M_GRAVEL  = mat("Gravel",        (0.52, 0.50, 0.46), rough=0.98)

# ═══════════════════════════════════════════════════════════════════════════════
#  DIMENSIONS  (all in meters; rough estimates from photo proportions)
# ═══════════════════════════════════════════════════════════════════════════════
# Main house
MW,  MD,  MH  = 8.0,  5.5, 5.2   # width, depth, wall height

# Three-section New England connected farmhouse (left → right):
#   Big (brown barn)  —  Little (connector)  —  Medium (yellow main house)

# Little connector section (between barn and main house)
LW,  LD,  LH  = 2.6,  MD - 0.5, 3.0   # narrower/shallower/shorter
LX            = -(MW / 2 + LW / 2)      # flush against main house left wall

# Big brown barn (leftmost, board-and-batten)
# ~same height as main house, wider, roof ridge runs FRONT-TO-BACK (Y axis)
AW,  AD,  AH  = 7.0,  MD,  5.0
AX            = -(MW / 2 + LW + AW / 2) # flush against connector left wall

# Front porch
PW,  PD       = MW,  2.4             # width, depth
PBASE         = 0.46                  # brick foundation height
POST_H        = 2.75                  # post height above porch deck
POST_Z        = PBASE + 0.08          # z of deck surface

# Convenience positions
FRONT_Y       = -MD / 2               # world-Y of house front wall  (-2.75)
PORCH_EDGE_Y  = FRONT_Y - PD          # world-Y of porch front edge  (-5.15)
PORCH_CENTER  = FRONT_Y - PD / 2      # world-Y center of porch      (-3.95)
WIN_D         = 0.10                   # window slab depth

# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN HOUSE
# ═══════════════════════════════════════════════════════════════════════════════
box("MainBody", MW, MD, MH, M_YELLOW)

# Metal gabled roof — slight eave overhang on all sides
gable_roof("MainRoof", MW + 0.55, MD + 0.55, MH, 2.1, M_METAL)

# Chimney — right side, near ridge, brick
box("Chimney", 0.55, 0.55, 3.7, M_BRICK, x=2.6, y=0.3, z=MH - 0.6)

# ═══════════════════════════════════════════════════════════════════════════════
#  LITTLE CONNECTOR  (single-story, brown, links barn to main house)
# ═══════════════════════════════════════════════════════════════════════════════
box("Connector", LW, LD, LH, M_BROWN, x=LX)
# Connector roof: shed or low gable — slightly lower peak than barn
gable_roof("ConnectorRoof", LW + 0.3, LD + 0.3, LH, 1.0, M_ASPHALT, x=LX)

# Connector door (front face, leads outside or to porch)
box("ConnDoor", 0.82, WIN_D, 2.0, M_DOOR,
    x=LX, y=FRONT_Y - WIN_D / 2, z=0.08)

# ═══════════════════════════════════════════════════════════════════════════════
#  BIG BROWN BARN  (leftmost, board-and-batten, single-story)
# ═══════════════════════════════════════════════════════════════════════════════
box("Addition", AW, AD, AH, M_BROWN, x=AX)

# Ridge runs front-to-back (Y) — perpendicular to main house ridge
gable_roof_y("AdditionRoof", AW + 0.35, AD + 0.35, AH, 2.0, M_ASPHALT, x=AX)

# Barn door — centered on front face
box("AddDoor", 0.85, WIN_D, 2.05, M_DOOR,
    x=AX, y=FRONT_Y - WIN_D / 2, z=0.08)

# Barn window, right of door (toward connector side)
box("AddWinFront", 0.80, WIN_D, 0.95, M_GLASS,
    x=AX + 1.4, y=FRONT_Y - WIN_D / 2, z=1.80)

# Barn window, left of door
box("AddWinFront2", 0.80, WIN_D, 0.95, M_GLASS,
    x=AX - 1.4, y=FRONT_Y - WIN_D / 2, z=1.80)

# Left-side wall of barn: window (side face visible in photo)
box("AddWinSide", WIN_D, 0.85, 0.95, M_GLASS,
    x=AX - AW / 2 - WIN_D / 2, y=0.0, z=2.00)

# ═══════════════════════════════════════════════════════════════════════════════
#  FRONT PORCH
# ═══════════════════════════════════════════════════════════════════════════════
# Raised brick foundation / skirt
box("PorchBrick", PW, PD, PBASE, M_BRICK, y=PORCH_CENTER)

# Concrete deck on top
box("PorchDeck", PW - 0.05, PD - 0.05, 0.09, M_CONC, y=PORCH_CENTER, z=PBASE)

# 4 posts (near front edge)
POST_FRONT_Y = PORCH_EDGE_Y + 0.22
for px in (-3.1, -1.05, 1.05, 3.1):
    box(f"Post{px:+.1f}", 0.17, 0.17, POST_H, M_TRIM,
        x=px, y=POST_FRONT_Y, z=POST_Z)

# Top beam spanning post tops
box("PorchBeam", PW + 0.15, 0.15, 0.20, M_TRIM,
    y=POST_FRONT_Y, z=POST_Z + POST_H - 0.10)

# Shed roof for porch (flat/shallow)
box("PorchRoof", PW + 0.40, PD + 0.25, 0.20, M_ASPHALT,
    y=PORCH_CENTER, z=POST_Z + POST_H)

# ── Steps (center, 3 risers) ──────────────────────────────────────────────────
RISE  = PBASE / 3     # height per riser ≈ 0.153 m
RUN   = 0.32          # tread depth
for i in range(3):
    # i=0 → bottommost step (furthest from house, lowest)
    step_y = PORCH_EDGE_Y - (2 - i) * RUN + RUN / 2
    step_h = RISE * (i + 1)
    box(f"StepC{i}", 1.8, RUN, step_h, M_BRICK, y=step_y)

# ── Steps (left side, near addition) ─────────────────────────────────────────
for i in range(3):
    step_y = PORCH_EDGE_Y - (2 - i) * RUN + RUN / 2
    step_h = RISE * (i + 1)
    box(f"StepL{i}", 1.4, RUN, step_h, M_BRICK, x=-2.7, y=step_y)

# ═══════════════════════════════════════════════════════════════════════════════
#  WINDOWS — MAIN HOUSE FRONT FACE
# ═══════════════════════════════════════════════════════════════════════════════
WIN_FRONT_Y = FRONT_Y - WIN_D / 2   # y-position (face flush with wall)

# Upper floor: left, center-large, right
for wx, ww, wh, wz in (
    (-2.65, 1.05, 1.25, 3.55),   # upper-left
    ( 0.00, 1.55, 1.45, 3.45),   # upper-center (larger, prominent)
    ( 2.65, 1.05, 1.25, 3.55),   # upper-right
):
    box(f"WinUp{wx:+.0f}", ww, WIN_D, wh, M_GLASS, x=wx, y=WIN_FRONT_Y, z=wz)

# Lower floor: visible through / alongside porch
for wx, ww, wh, wz in (
    (-2.40, 0.92, 1.10, 1.80),   # far left
    (-0.65, 0.88, 1.10, 1.82),   # left of door
    ( 1.95, 0.92, 1.10, 1.80),   # right
):
    box(f"WinLo{wx:+.0f}", ww, WIN_D, wh, M_GLASS, x=wx, y=WIN_FRONT_Y, z=wz)

# Front door (slightly right of center, blue-gray)
box("FrontDoor", 0.92, WIN_D, 2.12, M_DOOR,
    x=0.50, y=WIN_FRONT_Y, z=POST_Z + 0.02)

# ═══════════════════════════════════════════════════════════════════════════════
#  WINDOWS — MAIN HOUSE RIGHT SIDE  (partially visible in photo)
# ═══════════════════════════════════════════════════════════════════════════════
RSIDE_X = MW / 2 + WIN_D / 2
for wy, wz in ((-0.6, 3.5), (0.6, 3.5), (-0.6, 1.8), (0.6, 1.8)):
    box(f"WinR{wy:+.0f}_{wz:.0f}", WIN_D, 0.88, 1.02, M_GLASS,
        x=RSIDE_X, y=wy, z=wz)

# ═══════════════════════════════════════════════════════════════════════════════
#  GROUND, PATH, DRIVEWAY
# ═══════════════════════════════════════════════════════════════════════════════
box("Ground",   60.0, 60.0, 0.30, M_GRASS,  y=5.0,  z=-0.30)
box("BrickPath", 3.0,  8.0, 0.05, M_BRICK,  y=PORCH_EDGE_Y - 4.0)
box("Driveway",  6.0, 12.0, 0.05, M_GRAVEL, x=AX - 1.0, y=PORCH_EDGE_Y - 7.0)

# ═══════════════════════════════════════════════════════════════════════════════
#  CAMERA  (front-left 3/4 view, approximating the photo angle)
# ═══════════════════════════════════════════════════════════════════════════════
cam_d = bpy.data.cameras.new("Camera")
cam_d.lens = 35.0
cam_o = bpy.data.objects.new("Camera", cam_d)
cam_o.location = (12.0, -20.0, 8.0)   # wider back to frame 3-section complex
cam_o.rotation_euler = (
    math.radians(62),   # tilt down
    0.0,
    math.radians(42),   # turn toward house center (shifted left)
)
link(cam_o)
bpy.context.scene.camera = cam_o

# ═══════════════════════════════════════════════════════════════════════════════
#  LIGHTING
# ═══════════════════════════════════════════════════════════════════════════════
# Key: sun from upper-right (matches photo lighting)
sun_d = bpy.data.lights.new("Sun", type='SUN')
sun_d.energy = 3.8
sun_d.angle  = math.radians(2)
sun_o = bpy.data.objects.new("Sun", sun_d)
sun_o.location = (12, -6, 15)
sun_o.rotation_euler = (math.radians(52), 0, math.radians(32))
link(sun_o)

# Fill: soft area light from front-left
fill_d = bpy.data.lights.new("Fill", type='AREA')
fill_d.energy = 350
fill_d.size   = 10.0
fill_o = bpy.data.objects.new("Fill", fill_d)
fill_o.location = (-10, -12, 11)
link(fill_o)

# ── Done ──────────────────────────────────────────────────────────────────────
obj_count = len(bpy.context.scene.objects)
print(f"Conway farmhouse created — {obj_count} objects in scene.")
print("Tip: press NumPad-0 for camera view, Z > Material Preview for colors.")
print("Tip: select all (A), recalculate normals (Mesh > Normals > Recalculate Outside)")
print("     if any faces appear black.")
