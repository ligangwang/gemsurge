# The cover picture

`public/cover.jpg` (1200×750, no text) is the board set in an original
painted glade, made in two parts:

- **The glade.** `scene.py` writes it as SVG, drawn entirely in code: sky,
  hills, a castle, a river, trees, light rays, crystals, mushrooms and
  fireflies. Run `python3 scene.py scene.svg`, then render it at 2400×1500
  in any browser, for example with Playwright.
- **The board.** It is shot from the game twice at 2400×1500, once over
  black and once over white, with the scenery left out. The difference
  between the two shots gives each pixel's transparency, so the stones keep
  their soft edges. The cut-out is set in the middle of the glade with a
  soft shadow under each stone.
