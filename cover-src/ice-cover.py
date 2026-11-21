# Builds the Gem Surge cover: the board's stones on a slab of ice, set on the
# painted backdrop. Usage: ice-cover.py backdrop.jpg board-cutout.png out.jpg
import sys, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

backdrop, cutout, out = sys.argv[1:4]
W, H = 2400, 1500
R = random.Random(5)

# The painting: pale right and bottom edges trimmed, scaled to fill, keeping
# its left so the castle on the right clears the board.
src = Image.open(backdrop).convert("RGB").crop((6, 0, 792, 440))
big = src.resize((round(src.width * H / 440), H), Image.BICUBIC)
bg = big.crop((0, 0, W, H)).convert("RGBA")

# The board cut-out and where its 8x8 grid lands on the cover.
CROP = (445, 4, 1947, 1493)
board = Image.open(cutout).crop(CROP)
s = 1220 / board.height
board = board.resize((round(board.width * s), round(board.height * s)), Image.LANCZOS)
bx = (W - board.width) // 2 - 130
by = (H - board.height) // 2
cell = 178.5 * s
gx = bx + (483.75 - CROP[0]) * s
gy = by + (35.75 - CROP[1]) * s
size = cell * 8

# ---- the slab of ice
pad = 36
x0, y0, x1, y1 = gx - pad, gy - pad, gx + size + pad, gy + size + pad
box = [round(v) for v in (x0, y0, x1, y1)]
mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=64, fill=255)

# Its shadow on the scene.
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle([box[0] + 6, box[1] + 30, box[2] + 6, box[3] + 34], radius=64, fill=(8, 24, 40, 150))
bg.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(30)))

# Ice is the scene seen through frost: blurred, paled and cooled.
frost = bg.filter(ImageFilter.GaussianBlur(20)).convert("RGB")
frost = Image.blend(frost, Image.new("RGB", (W, H), (150, 215, 250)), 0.42)
ice = frost.convert("RGBA")

def overlay(alpha_array, color=(255, 255, 255)):
    layer = Image.new("RGBA", (W, H), color + (0,))
    layer.putalpha(Image.fromarray(np.clip(alpha_array, 0, 255).astype("uint8")))
    ice.alpha_composite(layer)

rng = np.random.default_rng(3)
# Brighter towards the top, where the light comes in.
yy = np.linspace(1, 0, H)[:, None] * np.ones((1, W))
overlay(60 * yy ** 1.5)
# Frost gathers at the slab's edges; its middle stays clear.
edge = Image.new("L", (W, H), 255)
ImageDraw.Draw(edge).rounded_rectangle([box[0] + 46, box[1] + 46, box[2] - 46, box[3] - 46], radius=40, fill=0)
overlay(np.asarray(edge.filter(ImageFilter.GaussianBlur(34))).astype(float) * 0.62)
# Cloudy patches deep in the ice, and a fine frosty grain on its face.
cloud = Image.fromarray((rng.random((H // 8, W // 8)) * 255).astype("uint8")).resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(40))
overlay((np.asarray(cloud).astype(float) - 118) * 1.0)
grain = Image.fromarray((rng.random((H, W)) * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))
overlay((np.asarray(grain).astype(float) - 122) * 0.7)

# Fine cracks, each with a branch or two.
cracks = Image.new("RGBA", (W, H), (0, 0, 0, 0))
cd = ImageDraw.Draw(cracks)
def crack(x, y, angle, length, width, alpha, depth=0):
    pts = [(x, y)]
    for _ in range(int(length / 26)):
        angle += R.uniform(-0.5, 0.5)
        x += np.cos(angle) * 26; y += np.sin(angle) * 26
        pts.append((x, y))
        if depth < 2 and R.random() < 0.16:
            crack(x, y, angle + R.choice([-1, 1]) * R.uniform(0.5, 1.1), length * 0.4, max(1, width - 1), alpha * 0.7, depth + 1)
    cd.line(pts, fill=(255, 255, 255, int(alpha)), width=width, joint="curve")
for _ in range(9):
    crack(R.uniform(x0, x1), R.uniform(y0, y1), R.uniform(0, 6.28), R.uniform(220, 520), 3, 120)
ice.alpha_composite(cracks.filter(ImageFilter.GaussianBlur(0.8)))

# Each cell is its own block: a pale face, a bright edge up and to the left,
# a blue one down and to the right, and a glint of light.
tiles = Image.new("RGBA", (W, H), (0, 0, 0, 0))
td = ImageDraw.Draw(tiles)
glints = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glints)
for r in range(8):
    for c in range(8):
        tx0 = gx + c * cell + 5; ty0 = gy + r * cell + 5
        tx1 = tx0 + cell - 10; ty1 = ty0 + cell - 10
        td.rounded_rectangle([tx0 + 3, ty0 + 3, tx1 + 3, ty1 + 3], radius=26, outline=(20, 90, 160, 150), width=4)
        td.rounded_rectangle([tx0, ty0, tx1, ty1], radius=26, fill=(220, 245, 255, 40), outline=(255, 255, 255, 215), width=3)
        gd.line([(tx0 + 20, ty0 + 44), (tx0 + 44, ty0 + 20)], fill=(255, 255, 255, 210), width=9)
        gd.line([(tx1 - 40, ty1 - 14), (tx1 - 14, ty1 - 40)], fill=(255, 255, 255, 90), width=6)
ice.alpha_composite(tiles.filter(ImageFilter.GaussianBlur(0.7)))
ice.alpha_composite(glints.filter(ImageFilter.GaussianBlur(5)))

# A broad sheen across the whole slab.
sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(sheen)
sd.polygon([(x0 + 180, y0), (x0 + 520, y0), (x0 + 60, y1), (x0 - 280, y1)], fill=(255, 255, 255, 60))
sd.polygon([(x0 + 700, y0), (x0 + 800, y0), (x0 + 340, y1), (x0 + 240, y1)], fill=(255, 255, 255, 30))
ice.alpha_composite(sheen.filter(ImageFilter.GaussianBlur(18)))

bg.paste(ice, (0, 0), mask)

# The slab's rim: bright where the light hits, deep blue in its thickness.
rim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
rd = ImageDraw.Draw(rim)
rd.rounded_rectangle([box[0] + 6, box[1] + 10, box[2] + 6, box[3] + 14], radius=64, outline=(20, 110, 180, 200), width=14)
rd.rounded_rectangle(box, radius=64, outline=(255, 255, 255, 235), width=7)
rd.rounded_rectangle([box[0] + 12, box[1] + 12, box[2] - 12, box[3] - 12], radius=54, outline=(255, 255, 255, 70), width=3)
bg.alpha_composite(rim.filter(ImageFilter.GaussianBlur(1.1)))

# ---- the stones, without the board's dark pane, each shadowed on the ice
r, g, b, a = board.split()
a = a.point(lambda v: 0 if v < 150 else min(255, int((v - 150) * 255 / 70)))
stones = Image.merge("RGBA", (r, g, b, a))
dark = Image.new("RGBA", board.size, (16, 52, 96, 0))
dark.putalpha(a.point(lambda v: int(v * 0.6)))
under = Image.new("RGBA", (W, H), (0, 0, 0, 0))
under.alpha_composite(dark, (bx + 7, by + 15))
bg.alpha_composite(under.filter(ImageFilter.GaussianBlur(11)))
bg.alpha_composite(stones, (bx, by))

bg.convert("RGB").resize((1200, 750), Image.LANCZOS).save(out, quality=90)
