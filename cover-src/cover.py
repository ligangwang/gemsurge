# Builds the Gem Surge cover: the board, with the game's own ice under every
# stone, set on the painted backdrop.
# Usage: cover.py backdrop.jpg board-on-black.png board-on-white.png out.jpg
import sys
import numpy as np
from PIL import Image, ImageFilter

backdrop, on_black, on_white, out = sys.argv[1:5]
W, H = 2400, 1500

# The painting: its pale edges trimmed (a strip along the top, and the right
# and bottom), scaled to fill, keeping its left so the castle on the right
# clears the board. cover-src/clip/backdrop.py crops it the same way.
src = Image.open(backdrop).convert("RGB").crop((6, 8, 792, 440))
big = src.resize((round(src.width * H / src.height), H), Image.BICUBIC)
bg = big.crop((0, 0, W, H)).convert("RGBA")

# The board's transparency is what differs between the two shots: nothing
# where it is clear, everything where a stone hides the background.
b = np.asarray(Image.open(on_black).convert("RGB")).astype(float) / 255
w = np.asarray(Image.open(on_white).convert("RGB")).astype(float) / 255
span = float(np.median((w - b)[:20, :20]))  # how far apart the bare backgrounds are
a = np.clip(1 - (w - b).mean(axis=2) / span, 0, 1)
# Stones glint differently in each shot, which reads as holes: fill them.
solid = Image.fromarray(((a > 0.97) * 255).astype("uint8")).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(13))
a = np.maximum(a, np.asarray(solid).astype(float) / 255)
rgb = np.clip(b / np.maximum(a, 1e-3)[..., None], 0, 1)
board = Image.fromarray((np.dstack([rgb, a]) * 255).astype("uint8"), "RGBA")

CROP = (445, 4, 1947, 1493)
board = board.crop(CROP)
s = 1220 / board.height
board = board.resize((round(board.width * s), round(board.height * s)), Image.LANCZOS)
x = (W - board.width) // 2 - 130
y = (H - board.height) // 2

# A soft shadow under the ice, so the board stands off the painting.
alpha = board.split()[3]
dark = Image.new("RGBA", board.size, (8, 28, 44, 0))
dark.putalpha(alpha.point(lambda v: int(v * 0.5)))
under = Image.new("RGBA", (W, H), (0, 0, 0, 0))
under.alpha_composite(dark, (x + 8, y + 20))
bg.alpha_composite(under.filter(ImageFilter.GaussianBlur(18)))
bg.alpha_composite(board, (x, y))
bg.convert("RGB").resize((1200, 750), Image.LANCZOS).save(out, quality=90)
