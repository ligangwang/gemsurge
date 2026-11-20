/**
 * The scenery behind the board: for each world, a real photograph taken all
 * the way round (a Poly Haven panorama, CC0; see public/scenes/CREDITS.md)
 * surrounds the camera, graded to the world's mood, and a few things made in
 * code bring it to life: crystals in the Crystal Forest, lanterns on the
 * lake, an aurora over the snow, fireflies, falling stars, drifting dust.
 *
 * It has its own scene and camera and is drawn before the board. Only the
 * world on screen has its photo downloaded.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** The forest floor in the Crystal Forest, below the camera. */
const FLOOR = -1.6;

// A fixed sequence of random numbers, so every world's extras are the same each time.
let seed = 20261120;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const between = (a: number, b: number) => a + (b - a) * rand();

// ------------------------------------------------------------------ worlds

type Extras = { group: THREE.Object3D; update: (t: number, dt: number) => void };

type Look = {
  /** The panorama, in public/scenes/. */
  photo: string;
  /** Which way the camera faces into the photo, and how far it looks up. */
  yaw: number;
  pitch: number;
  /** The colour grade: overall brightness, a tint, and saturation (1 as shot). */
  bright: number;
  tint: [number, number, number];
  sat: number;
  /** What shows until the photo has loaded. */
  fallback: number;
  extras: () => Extras;
};

/** The eight worlds, in the order of WORLDS in levels.ts. */
const LOOKS: Look[] = [
  {
    // Crystal Forest: a mossy forest path, with crystals growing among the ferns.
    photo: "mossy-forest.jpg",
    yaw: Math.PI,
    pitch: -0.08,
    bright: 0.82,
    tint: [1, 1, 1],
    sat: 1,
    fallback: 0x1c2a1a,
    extras: crystalForest,
  },
  {
    // Deep Sea: a rocky cove with the sun on the water.
    photo: "sea-cove.jpg",
    yaw: 5.4,
    pitch: -0.04,
    bright: 0.8,
    tint: [0.88, 1.0, 1.1],
    sat: 1.05,
    fallback: 0x0e2a3a,
    extras: () => motes({ count: 90, color: 0xe8fbff, size: 0.12, box: [-14, 14, -3.2, -0.6, -40, -10], motion: "twinkle", speed: 3 }),
  },
  {
    // Outer Space: the Milky Way arching over a desert at night.
    photo: "milky-way.jpg",
    yaw: 4.71,
    pitch: 0.28,
    bright: 1.7,
    tint: [0.95, 0.97, 1.1],
    sat: 1.1,
    fallback: 0x05060f,
    extras: () =>
      both(
        motes({ count: 60, color: 0xffffff, size: 0.16, box: [-30, 30, 4, 22, -40, -25], motion: "twinkle", speed: 1.5 }),
        fallingStars(),
      ),
  },
  {
    // Lantern Lake: a lake at dusk, with paper lanterns rising over the water.
    photo: "lake-dusk.jpg",
    yaw: 3.14,
    pitch: -0.02,
    bright: 1.05,
    tint: [1.05, 0.95, 0.9],
    sat: 1,
    fallback: 0x241a2e,
    extras: () =>
      motes({ count: 26, color: 0xffa040, size: 0.55, box: [-16, 16, -1.5, 9, -36, -12], motion: "rise", speed: 0.25, glow: true }),
  },
  {
    // Aurora Peaks: a snowy alpine lake under the northern lights.
    photo: "alpine-lake.jpg",
    yaw: 1.57,
    pitch: 0.06,
    bright: 0.4,
    tint: [0.55, 0.75, 1.15],
    sat: 0.55,
    fallback: 0x0a1424,
    extras: () =>
      both(aurora(), motes({ count: 160, color: 0xffffff, size: 0.08, box: [-10, 10, -2, 8, -16, -4], motion: "fall", speed: 0.6 })),
  },
  {
    // Golden Desert: sand and rock under a high sun, with dust in the air.
    photo: "desert.jpg",
    yaw: 3.14,
    pitch: -0.04,
    bright: 0.8,
    tint: [1.08, 0.97, 0.84],
    sat: 1.05,
    fallback: 0x5a3a1c,
    extras: () => motes({ count: 120, color: 0xffd890, size: 0.07, box: [-12, 12, -2, 4, -18, -4], motion: "drift", speed: 0.8 }),
  },
  {
    // Firefly Forest: a forest path at dusk, with fireflies.
    photo: "evening-forest.jpg",
    yaw: 0,
    pitch: -0.04,
    bright: 0.58,
    tint: [1.0, 0.78, 0.66],
    sat: 0.85,
    fallback: 0x16120e,
    extras: () =>
      motes({ count: 110, color: 0xd8ff70, size: 0.16, box: [-10, 10, -1.6, 3, -18, -3], motion: "blink", speed: 0.5, glow: true }),
  },
  {
    // Cloud Kingdom: above the clouds at sunset.
    photo: "sunset-clouds.jpg",
    yaw: 4.71,
    pitch: 0.08,
    bright: 0.85,
    tint: [1, 0.97, 0.98],
    sat: 1.05,
    fallback: 0x3a3a5a,
    extras: () => motes({ count: 50, color: 0xfff0d8, size: 0.2, box: [-20, 20, -3, 10, -40, -12], motion: "drift", speed: 0.4, glow: true }),
  },
];

// ------------------------------------------------------------------ photo

const PHOTO_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
/** The photograph, graded to the world's mood, with Fever's glow at the edges. */
const PHOTO_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uLoaded;
uniform vec3 uFallback;
uniform vec3 uTint;
uniform float uBright;
uniform float uSat;
uniform float uTurn;
uniform float uFever;
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;
// Turns a colour round the colour wheel, for a world's later visits.
vec3 turnHue(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}
void main() {
  vec3 col = uLoaded > 0.5 ? texture2D(uMap, vUv).rgb : uFallback;
  float grey = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(grey), col, uSat) * uTint * uBright;
  if (uTurn != 0.0) col = max(turnHue(col, uTurn), 0.0);
  // Darker towards the edges of the frame, and Fever's colours there.
  vec2 e = gl_FragCoord.xy / uResolution - 0.5;
  float aspect = uResolution.x / uResolution.y;
  float edge = smoothstep(0.25, 0.75, length(e * vec2(aspect, 1.0)) / max(aspect, 1.0) * 1.6);
  vec3 hue = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + uTime * 0.4 + e.y));
  col += uFever * hue * edge * 0.55;
  col *= 1.0 - 0.3 * length(e);
  gl_FragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ extras

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
const DOT = typeof document !== "undefined" ? dotTexture() : null;

function both(a: Extras, b: Extras): Extras {
  const group = new THREE.Group();
  group.add(a.group, b.group);
  return { group, update: (t, dt) => (a.update(t, dt), b.update(t, dt)) };
}

/**
 * Points of light in a box in front of the camera: [x0, x1, y0, y1, z0, z1].
 * They twinkle on the spot, drift about, rise and start again at the bottom,
 * fall and start again at the top, or blink like fireflies.
 */
function motes(o: {
  count: number;
  color: number;
  size: number;
  box: [number, number, number, number, number, number];
  motion: "twinkle" | "drift" | "rise" | "fall" | "blink";
  speed: number;
  glow?: boolean;
}): Extras {
  const [x0, x1, y0, y1, z0, z1] = o.box;
  const base = new Float32Array(o.count * 3);
  const phase = new Float32Array(o.count);
  for (let i = 0; i < o.count; i++) {
    base[i * 3] = between(x0, x1);
    base[i * 3 + 1] = between(y0, y1);
    base[i * 3 + 2] = between(z0, z1);
    phase[i] = rand() * 100;
  }
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(base.slice(), 3);
  const shade = new THREE.BufferAttribute(new Float32Array(o.count * 3).fill(1), 3);
  geo.setAttribute("position", pos);
  geo.setAttribute("color", shade);
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: DOT,
      color: o.color,
      size: o.size,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const group = new THREE.Group();
  group.add(points);
  // A wide soft halo round each glowing one (lanterns, fireflies).
  let halo: THREE.Points | null = null;
  if (o.glow) {
    halo = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: DOT,
        color: o.color,
        size: o.size * 4,
        vertexColors: true,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(halo);
  }
  const height = y1 - y0;
  const update = (t: number) => {
    for (let i = 0; i < o.count; i++) {
      const b = i * 3;
      const p = phase[i];
      let x = base[b];
      let y = base[b + 1];
      const z = base[b + 2];
      let light = 1;
      switch (o.motion) {
        case "twinkle":
          light = Math.max(0, Math.sin(t * o.speed + p)) ** 6;
          break;
        case "drift":
          x += Math.sin(t * 0.13 * o.speed + p) * 1.2;
          y += Math.sin(t * 0.21 * o.speed + p * 1.7) * 0.5;
          light = 0.6 + 0.4 * Math.sin(t * 0.9 + p);
          break;
        case "rise":
          y = y0 + ((y - y0 + t * o.speed + p) % height);
          x += Math.sin(t * 0.3 + p) * 0.4;
          // Fade in at the bottom and out at the top.
          light = Math.min(1, (y - y0) / 1.5, (y1 - y) / 2) * (0.8 + 0.2 * Math.sin(t * 3 + p));
          break;
        case "fall":
          y = y1 - ((y1 - y + t * o.speed * (0.6 + 0.4 * Math.sin(p)) + p) % height);
          x += Math.sin(t * 0.7 + p) * 0.3;
          light = 0.8;
          break;
        case "blink":
          x += Math.sin(t * 0.3 * o.speed + p) * 0.8;
          y += Math.sin(t * 0.5 * o.speed + p * 1.3) * 0.5;
          light = Math.max(0, Math.sin(t * 1.4 + p)) ** 3;
          break;
      }
      pos.setXYZ(i, x, y, z);
      shade.setXYZ(i, light, light, light);
    }
    pos.needsUpdate = true;
    shade.needsUpdate = true;
  };
  return { group, update: (t) => update(t) };
}

/** Now and then a falling star streaks across the sky. */
function fallingStars(): Extras {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 8;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(255,255,255,1)");
  g.fillStyle = grad;
  g.fillRect(0, 2, 256, 4);
  const streak = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 0.08),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const from = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let start = 2;
  return {
    group: streak,
    update: (t) => {
      const k = (t - start) / 0.9;
      if (k > 1) {
        // The next one, a few seconds on, somewhere else in the sky.
        start = t + between(3, 7);
        from.set(between(-25, 15), between(10, 20), between(-40, -30));
        dir.set(between(0.6, 1), between(-0.5, -0.2), 0).normalize();
        streak.rotation.z = Math.atan2(dir.y, dir.x);
      }
      const on = k >= 0 && k <= 1;
      (streak.material as THREE.MeshBasicMaterial).opacity = on ? Math.sin(k * Math.PI) : 0;
      if (on) streak.position.copy(from).addScaledVector(dir, k * 14);
    },
  };
}

const AURORA_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  // Curtains of light: folds across, bright along a wavy lower edge, fading up.
  float x = vUv.x * 7.0;
  float wave = 0.18 * sin(x * 0.9 + uTime * 0.15) + 0.1 * noise(vec2(x * 0.8, uTime * 0.05));
  float y = vUv.y - 0.15 - wave;
  float lower = smoothstep(-0.02, 0.04, y);
  float fade = exp(-max(y, 0.0) * 3.2);
  // Fine vertical rays, and broad patches where the curtain is bright or faint.
  float rays = 0.35 + 0.65 * noise(vec2(x * 14.0, uTime * 0.2)) * noise(vec2(x * 5.0 + 3.0, uTime * 0.1));
  float patches = smoothstep(0.25, 0.75, noise(vec2(x * 0.7 + uTime * 0.03, 1.0)));
  float a = lower * fade * rays * patches * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  vec3 col = mix(vec3(0.2, 0.95, 0.55), vec3(0.55, 0.35, 0.95), smoothstep(0.05, 0.55, y));
  gl_FragColor = vec4(col * a * 0.38, 1.0);
}`;

/** The northern lights: a band of curtains across the sky ahead. */
function aurora(): Extras {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: PHOTO_VERTEX,
    fragmentShader: AURORA_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Part of a tall cylinder round the camera, from left to right ahead.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 34, 48, 1, true, Math.PI * 0.6, Math.PI * 0.8), mat);
  band.position.y = 22;
  return { group: band, update: (t) => (mat.uniforms.uTime.value = t) };
}

// ----------------------------------------------------- the Crystal Forest

const CRYSTAL_VERTEX = /* glsl */ `
attribute float aHue;
attribute float aRise;
varying vec3 vNormal;
varying vec3 vView;
varying float vHue;
varying float vRise;
varying float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - w.xyz);
  vHue = aHue;
  vRise = aRise;
  vec4 view = viewMatrix * w;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}`;
/** A glowing crystal: lit from inside, brightest at its tip and its edges. */
const CRYSTAL_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying float vHue;
varying float vRise;
varying float vDepth;
void main() {
  vec3 N = normalize(vNormal);
  float facing = abs(dot(N, normalize(vView)));
  vec3 deep = mix(vec3(0.04, 0.24, 0.24), vec3(0.18, 0.1, 0.3), vHue);
  vec3 glow = mix(vec3(0.42, 0.95, 0.82), vec3(0.75, 0.58, 1.0), vHue);
  // The forest's own light, from above and the bright trees ahead.
  vec3 forest = vec3(0.55, 0.62, 0.42);
  // Each face a different shade, as the light inside meets it, and the faces
  // turned up take the daylight.
  float face = 0.45 + 0.55 * fract(sin(dot(floor(N * 3.0), vec3(12.9, 78.2, 37.7))) * 43758.5);
  // Lit from within: pale and bright through the middle, deeper at the base.
  vec3 col = mix(deep, glow, 0.35 + 0.55 * vRise) * face;
  col += forest * max(N.y, 0.0) * 0.25;
  // Light caught along the edges, and a soft breathing glow.
  col += glow * pow(1.0 - facing, 2.0) * 0.9;
  col += glow * (0.25 + 0.12 * sin(uTime * 1.3 + vHue * 6.0 + vRise * 3.0)) * vRise;
  // Further crystals sink into the forest's green haze.
  col = mix(col, vec3(0.36, 0.44, 0.3), smoothstep(6.0, 22.0, vDepth) * 0.4);
  gl_FragColor = vec4(col, 1.0);
}`;

/** A soft streak of light, for the shafts through the leaves. */
function shaftTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d")!;
  const across = g.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, "rgba(255,250,220,0)");
  across.addColorStop(0.5, "rgba(255,250,220,1)");
  across.addColorStop(1, "rgba(255,250,220,0)");
  g.fillStyle = across;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = "destination-in";
  const down = g.createLinearGradient(0, 0, 0, 256);
  down.addColorStop(0, "rgba(0,0,0,0)");
  down.addColorStop(0.25, "rgba(0,0,0,1)");
  down.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = down;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

/** Gives a shape the attributes the crystal shader reads. */
function glowing(geo: THREE.BufferGeometry, rise: (y: number) => number, hue: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.getAttribute("uv")) g.deleteAttribute("uv");
  const pos = g.getAttribute("position");
  const r = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) r[i] = rise(pos.getY(i));
  g.setAttribute("aRise", new THREE.BufferAttribute(r, 1));
  g.setAttribute("aHue", new THREE.BufferAttribute(new Float32Array(pos.count).fill(hue), 1));
  return g;
}

/** A cluster of crystals: hexagonal prisms with pointed tips, leaning out from a point. */
function crystals(x: number, z: number, size: number, hue: number, out: THREE.BufferGeometry[]) {
  const count = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    const r = size * between(0.12, 0.26) * (i === 0 ? 1.5 : 1);
    const h = size * between(0.8, 2.0) * (i === 0 ? 1.9 : 1);
    const body = new THREE.CylinderGeometry(r, r * 1.08, h, 6, 1);
    body.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2.2, 6);
    tip.translate(0, h + r * 1.1, 0);
    const total = h + r * 2.2;
    const one = glowing(mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])!, (y) => y / total, hue);
    one.rotateZ(i === 0 ? between(-0.1, 0.1) : between(-0.6, 0.6));
    one.rotateX(i === 0 ? between(-0.1, 0.1) : between(-0.5, 0.5));
    one.rotateY(rand() * Math.PI);
    one.translate(x + between(-0.3, 0.3) * size, FLOOR - 0.1, z + between(-0.3, 0.3) * size);
    out.push(one);
  }
}

/** A little glowing mushroom on the forest floor. */
function mushroom(x: number, z: number, out: THREE.BufferGeometry[]) {
  const s = between(0.1, 0.22);
  const stem = new THREE.CylinderGeometry(s * 0.25, s * 0.32, s * 1.2, 6);
  stem.translate(x, FLOOR + s * 0.6, z);
  out.push(glowing(stem, () => 0.2, 0.05));
  const cap = new THREE.SphereGeometry(s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.6, 1);
  cap.translate(x, FLOOR + s * 1.15, z);
  out.push(glowing(cap, () => 0.95, rand() < 0.5 ? 0 : 0.6));
}

/**
 * The Crystal Forest's extras: crystal clusters growing among the rocks and
 * ferns at the sides, sized like the stones in the photo, glowing mushrooms,
 * shafts of light and fireflies.
 */
function crystalForest(): Extras {
  const group = new THREE.Group();
  const shards: THREE.BufferGeometry[] = [];
  for (const [x, z, s, hue] of [
    [-4.2, -7.5, 0.55, 0],
    [4.6, -8.5, 0.5, 0.15],
    [-6.5, -12, 0.65, 0],
    [6.2, -13, 0.6, 1],
    [-2.8, -15, 0.35, 0],
    [3.1, -17, 0.4, 0],
  ]) {
    crystals(x, z, s, hue, shards);
  }
  for (let i = 0; i < 10; i++) mushroom(between(-5, 5), between(-5, -13), shards);
  const crystalMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: CRYSTAL_VERTEX,
    fragmentShader: CRYSTAL_FRAGMENT,
  });
  group.add(new THREE.Mesh(mergeGeometries(shards)!, crystalMat));

  // A soft halo of light round each big cluster.
  for (const [hx, hz, hs, hue] of [
    [-4.2, -7.5, 2.2, 0],
    [4.6, -8.5, 2.0, 0.15],
    [-6.5, -12, 2.6, 0],
    [6.2, -13, 2.4, 1],
  ]) {
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: DOT,
        color: new THREE.Color().lerpColors(new THREE.Color(0x40ffd8), new THREE.Color(0xb090ff), hue),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.position.set(hx, FLOOR + hs * 0.4, hz);
    glow.scale.setScalar(hs);
    group.add(glow);
  }

  // Shafts of light falling through the leaves.
  const shaftTex = shaftTexture();
  const shafts: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(between(1.2, 2.4), 22),
      new THREE.MeshBasicMaterial({
        map: shaftTex,
        color: 0xfff1c4,
        transparent: true,
        opacity: 0.09,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    m.position.set(between(-7, 7), 5, -8 - i * 3.5);
    m.rotation.z = 0.4;
    m.userData.phase = rand() * 6;
    shafts.push(m);
    group.add(m);
  }

  const flies = motes({ count: 70, color: 0xd8ffb0, size: 0.12, box: [-8, 8, FLOOR + 0.2, 2.5, -18, -3], motion: "drift", speed: 1 });
  group.add(flies.group);
  return {
    group,
    update: (t, dt) => {
      crystalMat.uniforms.uTime.value = t;
      for (const s of shafts)
        (s.material as THREE.MeshBasicMaterial).opacity = 0.06 + 0.035 * Math.sin(t * 0.4 + s.userData.phase);
      flies.update(t, dt);
    },
  };
}

// ------------------------------------------------------------------ scene

export class Scenery {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  private time = 0;
  private photo: THREE.ShaderMaterial;
  private sphere: THREE.Mesh;
  private photos = new Map<string, THREE.Texture>();
  private extras: Extras | null = null;
  private look = LOOKS[0];
  private world = -1;

  constructor() {
    this.photo = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uLoaded: { value: 0 },
        uFallback: { value: new THREE.Color() },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uBright: { value: 1 },
        uSat: { value: 1 },
        uTurn: { value: 0 },
        uFever: { value: 0 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: PHOTO_VERTEX,
      fragmentShader: PHOTO_FRAGMENT,
      depthWrite: false,
    });
    // Turned inside out, so the photo reads the right way round from inside.
    const geo = new THREE.SphereGeometry(80, 64, 32);
    geo.scale(-1, 1, 1);
    this.sphere = new THREE.Mesh(geo, this.photo);
    this.sphere.renderOrder = -1;
    this.scene.add(this.sphere);
  }

  /** Shows world `i` (0-7); `cycle` turns its colours on later visits. */
  setWorld(i: number, cycle = 0) {
    const look = LOOKS[i] ?? LOOKS[0];
    const u = this.photo.uniforms;
    // Later visits turn the colours a little round the wheel.
    const turn = cycle > 0 ? Math.sin(cycle * 0.9) * 0.6 : 0;
    u.uTurn.value = turn;
    if (i === this.world) return;
    this.world = i;
    this.look = look;
    u.uFallback.value.set(look.fallback);
    u.uTint.value.set(...look.tint);
    u.uBright.value = look.bright;
    u.uSat.value = look.sat;
    this.sphere.rotation.y = look.yaw;
    // The photo: from the cache, or downloaded now (until then, its colour).
    const cached = this.photos.get(look.photo);
    u.uMap.value = cached ?? null;
    u.uLoaded.value = cached ? 1 : 0;
    if (!cached)
      new THREE.TextureLoader().load(`./scenes/${look.photo}`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this.photos.set(look.photo, tex);
        if (this.look === look) {
          u.uMap.value = tex;
          u.uLoaded.value = 1;
        }
      });
    if (this.extras) {
      this.scene.remove(this.extras.group);
      this.extras.group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) {
          o.geometry?.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.extras = look.extras();
    this.scene.add(this.extras.group);
  }

  setFever(fever: number) {
    this.photo.uniforms.uFever.value = fever;
  }

  /** Fits the view to the frame: wide enough to show the scene on a phone too. */
  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    const across = THREE.MathUtils.degToRad(80);
    const fov = 2 * Math.atan(Math.tan(across / 2) / this.camera.aspect);
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(fov), 55, 100);
    this.camera.updateProjectionMatrix();
    this.photo.uniforms.uResolution.value.set(width, height);
  }

  update(dt: number, tilt: THREE.Vector2) {
    this.time += dt;
    const t = this.time;
    this.photo.uniforms.uTime.value = t;
    // Stand still and look gently about: a slow sway, and a little with the pointer.
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(this.look.pitch + tilt.y * 0.03, 0.04 * Math.sin(t * 0.05) - tilt.x * 0.05, 0, "YXZ");
    this.extras?.update(t, dt);
  }
}
