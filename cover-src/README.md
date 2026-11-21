# The cover picture

`public/cover.jpg` (1200×750, no text) is the board's stones on a slab of
ice, set on a painted backdrop. `ice-cover.py` puts it together:

```
python3 ice-cover.py backdrop.jpg board-cutout.png ../public/cover.jpg
```

- **The backdrop.** `backdrop.jpg` is a painting of a forest glade with a
  castle and a river, supplied by the game's owner. Its pale right and
  bottom edges are trimmed, and it is scaled to fill the cover, keeping the
  left of the picture so the castle on the right stays clear of the board.
- **The ice.** Behind the stones is a slab of ice, so they stand out from
  the trees: the backdrop blurred and cooled to a pale blue, frosted at its
  edges, with fine cracks, a block for each cell and a bright rim.
- **The board.** `board-cutout.png` is not kept here. To make it, shoot the
  board from the game twice at 2400×1500 (a 1200×750 window at twice the
  pixels), once over black and once over white, with the scenery left out
  and the same stones both times. The difference between the two shots
  gives each pixel's transparency. The script drops the board's dark pane
  and gives each stone a soft shadow on the ice.
