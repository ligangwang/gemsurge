# The cover picture

`public/cover.jpg` (1200×750, no text) is the board as it looks in a level
with ice, set on a painted backdrop: the game's own ice laid round the
board's edge with a cross through the middle, like a window, and the board's
dark pane under the four 2×2 squares left clear. The pattern, a row a line
(1 is thin ice, 2 thick, . none):

```
11111111
1..22..1
1..22..1
12222221
12222221
1..22..1
1..22..1
11111111
``` `cover.py` puts it together:

```
python3 cover.py backdrop.jpg board-on-black.png board-on-white.png ../public/cover.jpg
```

- **The backdrop.** `backdrop.jpg` is a painting of a forest glade with a
  castle and a river, supplied by the game's owner. Its pale right and
  bottom edges are trimmed, and it is scaled to fill the cover, keeping the
  left of the picture so the castle on the right stays clear of the board.
- **The board.** The two board shots are not kept here. To make them, run
  the game with that ice pattern on the board, the scenery left out, and
  all seven stones on the board. Wait for no stone to be pulsing as a hint,
  which shows as a dark outline. Shoot it twice at 2400×1500 (a
  1200×750 window at twice the pixels), once over black and once over
  white. The difference between the two shots gives each pixel's
  transparency, so the ice and the dark pane stay see-through.
- A soft shadow under the board lifts it off the painting.

# The clip

`public/clip.mp4` (960×600, 6.9 s, silent, about 850 KB) is what dingn plays
over the cover: a match of 3, a match of 4 that makes a line blaster, a match
of 5 that makes a prism, then the prism and the blaster swapped together. It
is framed exactly like the cover, with the same backdrop and the same ice.

It is captured from the game itself, one frame at a time, with the game's
clock under the script's control, so it is smooth however slow the machine.
From `cover-src/clip/`:

```
python3 backdrop.py ../backdrop.jpg bg.png 960 600 2   # the backdrop, as the game needs it
python3 hack.py apply                                  # capture-only changes to the game
(cd ../.. && npx vite --port 5295 --strictPort) &      # the game, running
node capture.cjs frames                                # about 250 pictures, 32 ms apart
python3 hack.py restore                                # put the game back; never commit the hack
python3 encode.py frames 6 222 ../../public/clip.mp4 27
```

- `hack.py` gives the game a set board (so the three matches are there to
  make), the backdrop in place of its scenery, the cover's framing, all seven
  stones, and hooks for `capture.cjs` to make the swaps. It also turns the
  screen shake off: in a small clip, against a still backdrop, the game's
  shake on every match reads as jitter, not impact.
- `backdrop.py` undoes the game's tone mapping on the painting in advance, so
  it comes out of the game looking as it does on the cover.
- `capture.cjs` holds the board and the four swaps. It steps the clock 32 ms
  a picture, exactly two of the fake clock's 16 ms animation frames: any
  other step makes some pictures land later than others, which stutters.
  `encode.py` plays them back at the matching 31.25 a second. Check a new board with
  the engine first: every swap must make its match, and nothing else may
  match before it.
- `encode.py` cuts the frames to a loop, before the level's own ending
  begins, and blends its last frames into its first.
