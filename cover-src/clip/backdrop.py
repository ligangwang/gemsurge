# The cover's backdrop, as the game must be given it so that it comes out of
# the game's tone mapping looking exactly like the cover's: the tone mapping
# (three.js's Neutral) is undone here, and the picture is stored at 1/GAIN of
# its brightness because undoing it needs values brighter than white.
import sys
import numpy as np
from PIL import Image
src_path, out_path, W, H, GAIN = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5])
# Cropped and scaled as cover-src/cover.py does, so clip and cover line up.
src = Image.open(src_path).convert("RGB").crop((6, 8, 792, 440))
big = src.resize((round(src.width * 1500 / src.height), 1500), Image.BICUBIC).crop((0, 0, 2400, 1500))
img = np.asarray(big.resize((W, H), Image.LANCZOS)).astype(np.float64) / 255
to_linear = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
to_srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)
def neutral(color):
    start, desat = 0.8 - 0.04, 0.15
    x = color.min(axis=2, keepdims=True)
    color = color - np.where(x < 0.08, x - 6.25 * x * x, 0.04)
    peak = color.max(axis=2, keepdims=True)
    d = 1 - start
    new_peak = 1 - d * d / (peak + d - start)
    squeezed = color * new_peak / np.maximum(peak, 1e-9)
    g = 1 - 1 / (desat * (peak - new_peak) + 1)
    squeezed = squeezed * (1 - g) + new_peak * g
    return np.where(peak < start, color, squeezed)
# Capped just under where the game's bloom starts (1.6 before tone mapping).
target = np.clip(to_linear(img), 0, 0.94)
# Undo it exactly, step by step in reverse.
start, desat, d = 0.8 - 0.04, 0.15, 1 - (0.8 - 0.04)
new_peak = target.max(axis=2, keepdims=True)
peak = d * d / (1 - new_peak) - d + start
g = 1 - 1 / (desat * (peak - new_peak) + 1)
unsqueezed = np.clip((target - new_peak * g) / (1 - g), 0, None) * peak / np.maximum(new_peak, 1e-9)
color = np.where(new_peak < start, target, unsqueezed)
low = color.min(axis=2, keepdims=True)
x = np.sqrt(np.clip(low, 0, None) / 6.25)
c = np.clip(color + np.where(low >= 0.04, 0.04, x - low), 0, GAIN)
err = np.abs(to_srgb(neutral(c)) - to_srgb(target)).max()
print("worst error after tone mapping, of 255:", round(float(err) * 255, 2))
Image.fromarray(np.round(np.clip(to_srgb(c / GAIN), 0, 1) * 255).astype("uint8")).save(out_path)
e = np.abs(to_srgb(neutral(c)) - to_srgb(target)).max(axis=2) * 255
print("mean error", round(float(e.mean()), 3), "| 99th percentile", round(float(np.percentile(e, 99)), 2), "| share over 4:", round(float((e > 4).mean()) * 100, 3), "%")
ys, xs = np.where(e > 20)
if len(ys): print("worst pixels at", list(zip(xs[:5].tolist(), ys[:5].tolist())), "colours", (img[ys[:3], xs[:3]] * 255).round().tolist())
