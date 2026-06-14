"""Regenerate the app icons in the 'Twilight' theme — cyan dumbbell on dark navy.
Draws the glyph as rounded rectangles, supersampled then downscaled for crisp edges.
"""
from PIL import Image, ImageDraw

BG = (16, 20, 30, 255)        # --bg      #10141e  (dark navy)
GLYPH = (124, 196, 255, 255)  # --accent  #7cc4ff  (cyan)
SS = 4                        # supersample factor

# dumbbell geometry, as offsets from centre on a 512 reference canvas
HANDLE = dict(half_w=92, half_h=30, r=30)
INNER  = dict(dx=108, half_w=24, half_h=105, r=24)
OUTER  = dict(dx=162, half_w=21, half_h=75,  r=21)


def _rr(draw, cx, cy, half_w, half_h, r, u):
    draw.rounded_rectangle(
        [cx - half_w * u, cy - half_h * u, cx + half_w * u, cy + half_h * u],
        radius=r * u, fill=GLYPH,
    )


def draw_dumbbell(draw, size, glyph_scale):
    c = size / 2
    u = (size / 512) * glyph_scale          # ref-unit, scaled
    _rr(draw, c, c, HANDLE["half_w"], HANDLE["half_h"], HANDLE["r"], u)
    for sign in (-1, 1):
        _rr(draw, c + sign * INNER["dx"] * u, c, INNER["half_w"], INNER["half_h"], INNER["r"], u)
        _rr(draw, c + sign * OUTER["dx"] * u, c, OUTER["half_w"], OUTER["half_h"], OUTER["r"], u)


def render(target, glyph_scale=1.0):
    w = target * SS
    img = Image.new("RGBA", (w, w), BG)
    draw_dumbbell(ImageDraw.Draw(img), w, glyph_scale)
    return img.resize((target, target), Image.LANCZOS)


OUT = {
    "apple-touch-icon.png": (180, 1.0),
    "icon-192.png":         (192, 1.0),
    "icon-512.png":         (512, 1.0),
    "icon-maskable-512.png": (512, 0.78),   # shrink into the maskable safe zone
}

if __name__ == "__main__":
    import sys
    dest = sys.argv[1] if len(sys.argv) > 1 else "."
    for name, (size, scale) in OUT.items():
        render(size, scale).save(f"{dest}/{name}")
        print("wrote", name, size, "scale", scale)
