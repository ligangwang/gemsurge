# The cover picture

`public/cover.jpg` (1200×750, no text) is the board as it looks in a level
with ice, set on a painted backdrop: the game's own ice in its `diamond`
pattern (`ICE.diamond` in `src/levels.ts`), thick in the middle and thin at
the rim, and the board's dark pane under the rest. `cover.py` puts it together:

```
python3 cover.py backdrop.jpg board-on-black.png board-on-white.png ../public/cover.jpg
```

- **The backdrop.** `backdrop.jpg` is a painting of a forest glade with a
  castle and a river, supplied by the game's owner. Its pale right and
  bottom edges are trimmed, and it is scaled to fill the cover, keeping the
  left of the picture so the castle on the right stays clear of the board.
- **The board.** The two board shots are not kept here. To make them, run
  the game with the `diamond` ice pattern on the board, the scenery left
  out, and all seven stones on the board. Shoot it twice at 2400×1500 (a
  1200×750 window at twice the pixels), once over black and once over
  white. The difference between the two shots gives each pixel's
  transparency, so the ice and the dark pane stay see-through.
- A soft shadow under the board lifts it off the painting.
