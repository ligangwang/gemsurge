# Paints an original, gentle fairy-tale glade for the Gem Surge cover as SVG:
# a sunlit sky, soft hills, a castle on the right, a winding glowing river,
# framing trees, light rays, crystals, mushrooms and fireflies.
import random, math, sys
W, H = 2400, 1500
R = random.Random(11)
out = []
def add(s): out.append(s)

def smooth(points, closed=True):
    # Catmull-Rom through the points, as an SVG path.
    n = len(points)
    d = f"M{points[0][0]:.1f},{points[0][1]:.1f}"
    rng = range(n if closed else n - 1)
    for i in rng:
        p0 = points[(i - 1) % n] if closed or i > 0 else points[i]
        p1 = points[i]
        p2 = points[(i + 1) % n]
        p3 = points[(i + 2) % n] if closed or i + 2 < n else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
    return d + (" Z" if closed else "")

add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
add('''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#7cc6e0"/><stop offset="0.45" stop-color="#bfe6e6"/>
  <stop offset="0.75" stop-color="#fdf0c8"/><stop offset="1" stop-color="#ffe7b0"/></linearGradient>
<radialGradient id="sun" cx="0.68" cy="0.34" r="0.42">
  <stop offset="0" stop-color="#fffbe6" stop-opacity="1"/><stop offset="0.25" stop-color="#fff2c4" stop-opacity="0.75"/>
  <stop offset="1" stop-color="#fff2c4" stop-opacity="0"/></radialGradient>
<linearGradient id="river" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#d9fbff"/><stop offset="0.5" stop-color="#7fe0f0"/><stop offset="1" stop-color="#3fb7d6"/></linearGradient>
<linearGradient id="trunk" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#3e2a1c"/><stop offset="0.55" stop-color="#6e4b2f"/><stop offset="0.85" stop-color="#a77b4c"/><stop offset="1" stop-color="#5a3d26"/></linearGradient>
<linearGradient id="crystal" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#eaffff"/><stop offset="0.5" stop-color="#7ee8f2"/><stop offset="1" stop-color="#3a8fd0"/></linearGradient>
<linearGradient id="crystal2" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#fbeaff"/><stop offset="0.5" stop-color="#c49af2"/><stop offset="1" stop-color="#7a52c8"/></linearGradient>
<linearGradient id="roof" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#8a4a3c"/><stop offset="0.6" stop-color="#c7745a"/><stop offset="1" stop-color="#e3a07a"/></linearGradient>
<linearGradient id="wall" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#b9b0a6"/><stop offset="0.7" stop-color="#e9e1d4"/><stop offset="1" stop-color="#fff6e6"/></linearGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>
<filter id="haze" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
<filter id="rays" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>
<filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="bigglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="30"/></filter>
</defs>''')

# Sky and sun.
add(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
add(f'<rect width="{W}" height="{H}" fill="url(#sun)"/>')
# Soft clouds.
for cx, cy, s in [(420, 210, 1.0), (1150, 140, 0.8), (1880, 230, 1.1), (2260, 120, 0.7), (760, 330, 0.6)]:
    g = []
    for k in range(7):
        g.append(f'<ellipse cx="{cx + (k - 3) * 70 * s + R.uniform(-15,15):.0f}" cy="{cy + R.uniform(-25, 10) * s:.0f}" rx="{R.uniform(70,120)*s:.0f}" ry="{R.uniform(35,60)*s:.0f}" fill="#ffffff"/>')
    add(f'<g opacity="0.75" filter="url(#haze)">{"".join(g)}</g>')

# Distant mountains, hazy blue-green.
def ridge(base, amp, color, opacity, seed, step=120):
    r = random.Random(seed)
    pts = [(-100, H)]
    x = -100
    while x <= W + 100:
        pts.append((x, base - amp * (0.5 + 0.5 * math.sin(x / 260 + seed)) - r.uniform(0, amp * 0.5)))
        x += step
    pts.append((W + 100, H))
    add(f'<path d="{smooth(pts)}" fill="{color}" opacity="{opacity}"/>')
ridge(760, 230, "#9fc9cf", 0.8, 1)
ridge(820, 160, "#86bdb4", 0.85, 2)
add(f'<rect y="700" width="{W}" height="300" fill="#fff4d6" opacity="0.35" filter="url(#haze)"/>')

# The castle's hill on the right, and a far meadow.
ridge(930, 90, "#8fc77a", 1, 3, 160)
hill = [(1640, 1000), (1760, 860), (1950, 770), (2150, 760), (2330, 800), (2500, 880), (2500, 1100), (1640, 1100)]
add(f'<path d="{smooth(hill)}" fill="#7dbd62"/>')
add(f'<path d="{smooth([(1700,960),(1900,830),(2120,800),(2300,830),(2450,900),(2450,1000),(1700,1000)])}" fill="#9fd27c" opacity="0.6"/>')

# The castle: towers with pointed roofs, warm lit windows, little flags.
def tower(x, y, w, h, roof_h):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="url(#wall)"/>')
    add(f'<path d="M{x-8},{y} L{x+w/2},{y-roof_h} L{x+w+8},{y} Z" fill="url(#roof)"/>')
    add(f'<line x1="{x+w/2}" y1="{y-roof_h}" x2="{x+w/2}" y2="{y-roof_h-38}" stroke="#6b5040" stroke-width="3"/>')
    add(f'<path d="M{x+w/2},{y-roof_h-38} l26,8 l-26,8 Z" fill="#f2c94c"/>')
    for k in range(int(h // 70)):
        wy = y + 30 + k * 70
        add(f'<rect x="{x + w/2 - 7}" y="{wy}" width="14" height="24" rx="7" fill="#ffd27a" filter="url(#glow)"/>')
cx0 = 1960
add(f'<rect x="{cx0-40}" y="640" width="360" height="160" fill="url(#wall)"/>')
for k in range(9):
    add(f'<rect x="{cx0-40 + k*40}" y="624" width="24" height="18" fill="#d9d0c3"/>')
tower(cx0 - 80, 560, 70, 240, 120)
tower(cx0 + 300, 580, 66, 220, 110)
tower(cx0 + 90, 470, 96, 330, 170)
tower(cx0 + 200, 540, 60, 260, 105)
add(f'<path d="M{cx0+110},800 v-70 a30,30 0 0 1 60,0 v70 Z" fill="#6b4a32"/>')
add(f'<rect x="{cx0-60}" y="790" width="420" height="22" fill="#8a9a6a" opacity="0.5" filter="url(#soft)"/>')

# The river: from the far hills, winding to the front, glowing softly.
river = [(1530, 900), (1600, 905), (1500, 1000), (1260, 1080), (980, 1150), (700, 1260), (430, 1400), (300, 1520),
         (-60, 1520), (-60, 1480), (200, 1330), (560, 1180), (900, 1080), (1200, 1000), (1420, 935)]
add(f'<path d="{smooth(river)}" fill="url(#river)"/>')
add(f'<path d="{smooth(river)}" fill="#e8ffff" opacity="0.35" filter="url(#haze)"/>')
for k in range(26):
    t = R.random()
    x = 1500 - t * 1500 + R.uniform(-60, 60)
    y = 920 + t * 520 + R.uniform(-20, 20)
    add(f'<path d="M{x:.0f},{y:.0f} q{18+t*30:.0f},-6 {40+t*60:.0f},0" stroke="#ffffff" stroke-width="{2+t*4:.1f}" fill="none" opacity="0.7" stroke-linecap="round"/>')

# Banks of grass on either side of the river.
add(f'<path d="{smooth([(-60,1000),(300,960),(700,1000),(1000,1060),(700,1180),(300,1340),(-60,1440)])}" fill="#6fb45a"/>')
add(f'<path d="{smooth([(2460,980),(2100,960),(1700,1000),(1450,1060),(1100,1180),(800,1340),(560,1520),(2460,1520)])}" fill="#64ab52"/>')
add(f'<path d="{smooth([(2460,1060),(2050,1060),(1650,1120),(1300,1240),(1000,1400),(900,1520),(2460,1520)])}" fill="#5aa04a" opacity="0.9"/>')

# Light rays slanting down through the trees.
for k in range(6):
    x = 300 + k * 230 + R.uniform(-40, 40)
    wdt = R.uniform(60, 140)
    add(f'<path d="M{x},-50 L{x+wdt},-50 L{x+wdt+520},{1150} L{x+300},{1150} Z" fill="#fff7d6" opacity="{R.uniform(0.18,0.32):.2f}" filter="url(#rays)"/>')

# Framing trees: big trunks with roots and leafy crowns.
def tree(x, base, width, height, lean, crown):
    top = base - height
    pts = [(x - width * 1.6, base + 20), (x - width * 0.7, base - 40), (x - width * 0.5 + lean * 0.3, base - height * 0.5),
           (x - width * 0.38 + lean, top), (x + width * 0.38 + lean, top), (x + width * 0.5 + lean * 0.3, base - height * 0.5),
           (x + width * 0.7, base - 40), (x + width * 1.7, base + 20)]
    add(f'<path d="{smooth(pts)}" fill="url(#trunk)"/>')
    # Bark lines.
    for k in range(5):
        bx = x - width * 0.3 + k * width * 0.15
        add(f'<path d="M{bx:.0f},{base-30} q{lean*0.2+R.uniform(-10,10):.0f},{-height*0.4:.0f} {lean*0.6:.0f},{-height*0.8:.0f}" stroke="#2e1f14" stroke-width="5" fill="none" opacity="0.35"/>')
    # The crown: layers of leafy blobs, dark below, sunlit on top.
    cx, cy = x + lean, top
    for layer, (color, dy, n, r0) in enumerate([("#24502c", 40, 16, 150), ("#356f35", 0, 16, 130), ("#4d8e3f", -40, 14, 110), ("#78b552", -70, 10, 80)]):
        blobs = []
        for k in range(n):
            a = R.uniform(0, math.pi * 2)
            rr = R.uniform(0.2, 1) * crown
            blobs.append(f'<circle cx="{cx + math.cos(a)*rr*1.3:.0f}" cy="{cy + dy + math.sin(a)*rr*0.6:.0f}" r="{r0*R.uniform(0.7,1.2):.0f}" fill="{color}"/>')
        add(f'<g filter="url(#soft)">{"".join(blobs)}</g>')
tree(110, 1240, 150, 900, 60, 420)
tree(2480, 1180, 120, 860, -40, 300)

# Glowing crystals at the front.
def crystal(x, y, h, w, tilt, fill):
    add(f'<ellipse cx="{x}" cy="{y-h*0.4}" rx="{w*1.6}" ry="{h*0.6}" fill="{"#8ff3ff" if fill=="crystal" else "#d8b4ff"}" opacity="0.45" filter="url(#bigglow)"/>')
    pts = f"{x-w/2},{y} {x-w/2+tilt*0.5},{y-h*0.75} {x+tilt},{y-h} {x+w/2+tilt*0.5},{y-h*0.75} {x+w/2},{y}"
    add(f'<polygon points="{pts}" fill="url(#{fill})" stroke="#ffffff" stroke-opacity="0.6" stroke-width="2"/>')
    add(f'<polygon points="{x+tilt*0.2},{y} {x+tilt},{y-h} {x+w/2+tilt*0.5},{y-h*0.75} {x+w/2},{y}" fill="#ffffff" opacity="0.22"/>')
for (x, y, h, w, t, f) in [(150, 1440, 230, 70, -12, "crystal"), (230, 1460, 160, 54, 18, "crystal2"), (90, 1470, 120, 46, -24, "crystal"),
                           (2230, 1450, 210, 66, 14, "crystal"), (2310, 1470, 140, 50, -16, "crystal2"), (2150, 1475, 110, 42, 22, "crystal"),
                           (1620, 1140, 90, 34, 8, "crystal"), (560, 1110, 80, 30, -8, "crystal2")]:
    crystal(x, y, h, w, t, f)

# Mushrooms with softly glowing caps.
def mushroom(x, y, s, cap):
    add(f'<rect x="{x-6*s}" y="{y-34*s}" width="{12*s}" height="{34*s}" rx="{5*s}" fill="#f4e6cf"/>')
    add(f'<ellipse cx="{x}" cy="{y-36*s}" rx="{30*s}" ry="{16*s}" fill="{cap}" filter="url(#glow)"/>')
    add(f'<circle cx="{x-9*s}" cy="{y-40*s}" r="{3.5*s}" fill="#ffffff" opacity="0.8"/>')
for (x, y, s, c) in [(330, 1290, 1.4, "#ff9f8a"), (390, 1305, 1.0, "#ffb7a3"), (2080, 1250, 1.3, "#7fe6f0"), (2030, 1268, 0.9, "#a9f0f5"), (1780, 1150, 0.9, "#ff9f8a")]:
    mushroom(x, y, s, c)

# Fireflies.
for k in range(60):
    x = R.uniform(0, W); y = R.uniform(250, 1450)
    if 640 < x < 1760 and 230 < y < 1340: continue
    c = R.choice(["#fff3a8", "#bff8ff", "#ffe0f4"])
    add(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{R.uniform(3,7):.1f}" fill="{c}" filter="url(#glow)" opacity="{R.uniform(0.6,1):.2f}"/>')

# A soft vignette keeps the eye on the middle.
add(f'''<radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#1b2a1a" stop-opacity="0.35"/></radialGradient>
<rect width="{W}" height="{H}" fill="url(#vig)"/>''')
add('</svg>')
open(sys.argv[1], 'w').write("\n".join(out))
