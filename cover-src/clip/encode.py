# Cuts the captured frames to a loop and encodes the clip.
# Usage: encode.py framesDir first last out.mp4 [crf]
import sys, os, shutil, subprocess
from PIL import Image
frames, first, last, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
crf = sys.argv[5] if len(sys.argv) > 5 else "25"
FADE = 12  # the last frames blend into the first, so the loop has no jump
# Working frames go in a temporary folder, never next to the output: in
# public/ they would ship with the game.
import tempfile
tmp = tempfile.mkdtemp(prefix="clip-loop-")
start = Image.open(f"{frames}/f{first:04d}.png").convert("RGB")
n = 0
for i in range(first, last + 1):
    im = Image.open(f"{frames}/f{i:04d}.png").convert("RGB")
    left = last - i
    if left < FADE:
        im = Image.blend(im, start, (FADE - left) / (FADE + 1))
    im.save(f"{tmp}/{n:04d}.png"); n += 1
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "31.25", "-i", f"{tmp}/%04d.png",
    "-c:v", "libx264", "-preset", "veryslow", "-crf", crf, "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-movflags", "+faststart", "-an", out], check=True)
shutil.rmtree(tmp, ignore_errors=True)
print(n, "frames,", round(n * 0.032, 2), "s,", round(os.path.getsize(out) / 1024), "KB")
