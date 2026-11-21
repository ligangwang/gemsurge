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
