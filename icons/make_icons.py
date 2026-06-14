"""Regenerate the app icons in the 'Twilight' theme — navy plate + bars on cyan.
Logo concept D: a weight-plate ring framing three ascending progress bars
(gym × data). Supersampled then downscaled for crisp edges.
"""
from PIL import Image, ImageDraw

CYAN = (124, 196, 255, 255)   # --accent  #7cc4ff  (background)
NAVY = (16, 20, 30, 255)      # --bg      #10141e  (glyph)
SS = 4                        # supersample factor


def draw_logo(d, size, scale=1.0):
    c = size / 2
    u = (size / 512) * scale
    # weight-plate ring
    R = 172 * u
    d.ellipse([c - R, c - R, c + R, c + R], outline=NAVY, width=int(48 * u))
    # three ascending bars inside
    base = c + 84 * u
    w, gap = 38 * u, 24 * u
    heights = [78 * u, 122 * u, 166 * u]
    total = len(heights) * w + (len(heights) - 1) * gap
    x = c - total / 2 + w / 2
    for h in heights:
        d.rounded_rectangle([x - w / 2, base - h, x + w / 2, base], radius=11 * u, fill=NAVY)
        x += w + gap


def render(target, scale=1.0):
    w = target * SS
    img = Image.new("RGBA", (w, w), CYAN)
    draw_logo(ImageDraw.Draw(img), w, scale)
    return img.resize((target, target), Image.LANCZOS)


OUT = {
    "apple-touch-icon.png": (180, 1.0),
    "icon-192.png":         (192, 1.0),
    "icon-512.png":         (512, 1.0),
    "icon-maskable-512.png": (512, 0.80),   # shrink into the maskable safe zone
}

if __name__ == "__main__":
    import sys
    dest = sys.argv[1] if len(sys.argv) > 1 else "."
    for name, (size, scale) in OUT.items():
        render(size, scale).save(f"{dest}/{name}")
        print("wrote", name, size, "scale", scale)
