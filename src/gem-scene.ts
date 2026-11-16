/**
 * The 3D board, drawn with three.js: glossy gems with reflections and bloom,
 * a tilted board over a living background for each world, and the effects
 * (laser sweeps, shockwaves, lightning, particles, screen shake and slow
 * motion) that play out each move's steps from the engine.
 *
 * Coordinates: cell (x, y) sits at world (x - 3.5, 3.5 - y, 0); the camera
 * looks down the -z axis with a slight tilt.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  SIZE,
  adjacent,
  idx,
  type Blast,
  type Gem,
  type Pos,
  type Special,
} from "./engine/board";
import type { Turn } from "./engine/session";
import type { Cleared } from "./engine/board";
import { sfx } from "./sound";

export const GEM_COLORS = [0xff2450, 0xffc400, 0x18e070, 0x3a84ff, 0xb450ff, 0xfff0fa];
/** The stones themselves are a little deeper, since the light inside brightens them. */
const STONE_COLORS = [0xe8102e, 0xffb000, 0x00b54c, 0x1458f0, 0x8a2ce8, 0xfff0fa];
/** CSS versions for the HUD. */
export const GEM_CSS = GEM_COLORS.map((c) => `#${c.toString(16).padStart(6, "0")}`);

const HALF = (SIZE - 1) / 2;
const world = (x: number, y: number) => new THREE.Vector3(x - HALF, HALF - y, 0);

type SceneOptions = {
  onSwap: (a: Pos, b: Pos) => void;
  /** Called on any pointer action on the board, to reset the hint timer. */
  onPoke?: () => void;
};

type GemView = {
  gem: Gem;
  group: THREE.Group;
  body: THREE.Mesh;
  glow: THREE.Sprite;
  extra?: THREE.Object3D;
  /** Grid position it rests at. */
  x: number;
  y: number;
  phase: number;
  /** 0-1 pop-in scale. */
  scale: number;
};

type Tween = {
  t: number;
  dur: number;
  delay: number;
  update: (k: number) => void;
  done?: () => void;
  /** Ends a wait early when the board is replaced. */
  cancel?: () => void;
};

/** Thrown out of an animation whose board was replaced (setBoard). */
export class AnimationCancelled extends Error {
  constructor() {
    super("animation cancelled");
  }
}

// --------------------------------------------------------------- geometry

type Cut = {
  /** The girdle: the gem's outline seen from the front, anticlockwise. */
  outline: THREE.Vector2[];
  /** How far the flat top (the table) is shrunk from the outline. */
  table: number;
  /** Height of the crown above the girdle and depth of the pavilion below it. */
  crown: number;
  pavilion: number;
  /**
   * A brilliant cut turns the rings between table, girdle and point half a
   * step, which makes kite and star facets. A step cut keeps them lined up,
   * for the long terraces of an emerald cut.
   */
  brilliant: boolean;
  /** A step cut ends in a ridge this long instead of a point. */
  keel?: number;
};

/**
 * Cuts a gem: a table and crown facing the player, a thin girdle, and a
 * pavilion behind. Every facet is flat, so each catches the light on its own.
 */
function cutGem({ outline, table, crown, pavilion, brilliant, keel = 0 }: Cut) {
  const n = outline.length;
  const ring = (scale: number, z: number, half = false) =>
    outline.map((p, i) => {
      const q = half ? p.clone().add(outline[(i + 1) % n]).multiplyScalar(0.5) : p;
      return new THREE.Vector3(q.x * scale, q.y * scale, z);
    });
  const top = ring(table, crown, brilliant);
  const upper = ring(brilliant ? 0.8 : (1 + table) / 2, crown * (brilliant ? 0.6 : 0.55));
  const girdle = ring(1, 0, brilliant);
  const under = ring(1, -0.035, brilliant);
  // Two rings down the pavilion, so the back of the stone breaks the light
  // into many small facets.
  const lower = ring(brilliant ? 0.74 : 0.78, -pavilion * 0.36);
  const deep = ring(brilliant ? 0.42 : 0.5, -pavilion * 0.72, brilliant);
  const point = (p: THREE.Vector3) =>
    new THREE.Vector3(Math.sign(p.x) * Math.min(Math.abs(p.x), keel), 0, -pavilion);

  const tris: THREE.Vector3[][] = [];
  const centre = new THREE.Vector3(0, 0, crown);
  for (let i = 0; i < n; i++) tris.push([centre, top[i], top[(i + 1) % n]]);
  // Joins two rings. When `b` sits half a step round from `a`, the band is a
  // zigzag of triangles; otherwise it is a row of four-sided facets.
  const band = (a: THREE.Vector3[], b: THREE.Vector3[], offset: -1 | 0 | 1) => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (offset === 0) tris.push([a[i], a[j], b[j]], [a[i], b[j], b[i]]);
      else if (offset === 1) tris.push([a[i], a[j], b[i]], [a[j], b[j], b[i]]);
      else tris.push([b[i], b[j], a[j]], [a[i], b[i], a[j]]);
    }
  };
  if (brilliant) {
    band(upper, top, 1);
    band(upper, girdle, 1);
    band(girdle, under, 0);
    band(lower, under, 1);
    band(lower, deep, 1);
  } else {
    band(top, upper, 0);
    band(upper, girdle, 0);
    band(girdle, under, 0);
    band(under, lower, 0);
    band(lower, deep, 0);
  }
  for (let i = 0; i < n; i++) tris.push([deep[i], deep[(i + 1) % n], point(deep[i])], [deep[(i + 1) % n], point(deep[(i + 1) % n]), point(deep[i])]);

  // Wind every facet to face outwards, and drop the slivers a keel leaves.
  const positions: number[] = [];
  const shades: number[] = [];
  const mid = new THREE.Vector3(0, 0, (crown - pavilion) / 2);
  const normal = new THREE.Vector3();
  const out = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    normal.subVectors(b, a).cross(out.subVectors(c, a));
    if (normal.lengthSq() < 1e-10) continue;
    out.copy(a).add(b).add(c).divideScalar(3).sub(mid);
    const [p, q, r] = normal.dot(out) < 0 ? [a, c, b] : [a, b, c];
    positions.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    // Light bounces around inside a cut stone, so neighbouring facets are
    // never the same brightness. The table is the brightest.
    const onTable = a.z === crown && b.z === crown && c.z === crown;
    const shade = onTable ? 1.25 : [0.6, 1.15, 0.85, 1.35, 0.7, 1.0][(shades.length / 9) % 6 | 0];
    for (let k = 0; k < 9; k++) shades.push(shade);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(shades, 3));
  g.computeVertexNormals();
  return g;
}

/** Points round a shape whose radius at each angle comes from `radius`. */
const outlineOf = (count: number, radius: (angle: number) => number, turn = 0) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + turn;
    return new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(radius(a));
  });

/** A rounded box shape (a superellipse) `w` by `h` across; a higher `power` is squarer. */
const cushion = (w: number, h: number, power: number) => (a: number) =>
  (Math.abs(Math.cos(a) / w) ** power + Math.abs(Math.sin(a) / h) ** power) ** (-1 / power);

/**
 * Six cuts with six different outlines, so a gem reads by shape as well as
 * colour. Every outline is a smooth curve with no hard corners: round, pear,
 * cushion, oval, a soft trillion, and the pearl.
 */
function makeGeometries(): THREE.BufferGeometry[] {
  const N = 24;
  const ruby = cutGem({ outline: outlineOf(N, () => 0.45), table: 0.56, crown: 0.17, pavilion: 0.34, brilliant: true });
  // A pear: round at the bottom, drawn up to a soft tip.
  const topaz = cutGem({
    outline: outlineOf(N, (a) => 0.33 * (1 + 0.5 * Math.max(0, Math.sin(a)) ** 3), Math.PI / N),
    table: 0.5,
    crown: 0.17,
    pavilion: 0.3,
    brilliant: true,
  });
  topaz.translate(0, -0.07, 0);
  const emerald = cutGem({
    outline: outlineOf(N, cushion(0.38, 0.47, 3.2), Math.PI / N),
    table: 0.52,
    crown: 0.16,
    pavilion: 0.3,
    brilliant: false,
    keel: 0.1,
  });
  const sapphire = cutGem({ outline: outlineOf(N, cushion(0.49, 0.37, 2)), table: 0.55, crown: 0.17, pavilion: 0.32, brilliant: true });
  // A trillion with bowed sides and rounded corners.
  const amethyst = cutGem({
    outline: outlineOf(N, (a) => {
      const third = (Math.PI * 2) / 3;
      const fromSide = ((((a - Math.PI / 2) % third) + third) % third) - third / 2;
      const side = 0.33 / Math.cos(fromSide);
      return (side ** -4 + 0.52 ** -4) ** (-1 / 4);
    }),
    table: 0.5,
    crown: 0.16,
    pavilion: 0.3,
    brilliant: true,
  });
  amethyst.translate(0, -0.04, 0);
  const pearl = new THREE.SphereGeometry(0.38, 32, 24);
  pearl.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(pearl.attributes.position.count * 3).fill(1), 3));
  return [ruby, topaz, emerald, sapphire, amethyst, pearl];
}

/**
 * What the gems reflect: a dark jeweller's studio with a few bright lamps.
 * Most facets pick up the dark and stay deep in colour, and the few that face
 * a lamp flash, which is what makes a cut stone look cut.
 */
function studioTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, "#5a5f80");
  sky.addColorStop(0.5, "#26283c");
  sky.addColorStop(1, "#0a0a12");
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 256);
  // Lamps: [x, y, width, height, colour], spread all the way round.
  const lamps: [number, number, number, number, string][] = [
    [20, 30, 44, 22, "#ffffff"],
    [96, 60, 18, 46, "#ffffff"],
    [150, 20, 30, 16, "#fff4e0"],
    [205, 70, 40, 18, "#ffffff"],
    [262, 26, 18, 40, "#e6f0ff"],
    [318, 64, 44, 20, "#ffffff"],
    [384, 24, 22, 44, "#ffffff"],
    [436, 70, 40, 18, "#fff0f6"],
    [486, 30, 18, 40, "#ffffff"],
    [50, 112, 26, 12, "#ffffff"],
    [176, 118, 22, 12, "#ffffff"],
    [300, 112, 26, 12, "#ffffff"],
    [420, 118, 22, 12, "#ffffff"],
    [80, 160, 40, 12, "#b8c4ff"],
    [250, 170, 50, 10, "#ffd0f0"],
    [410, 162, 40, 12, "#c8fff0"],
  ];
  g.filter = "blur(2px)";
  for (const [x, y, w, h, colour] of lamps) {
    g.fillStyle = colour;
    g.fillRect(x, y, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/** A four-pointed star, for the glints that wink on the gems. */
function starTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.translate(32, 32);
  for (const turn of [0, Math.PI / 2]) {
    g.save();
    g.rotate(turn);
    const grad = g.createLinearGradient(-32, 0, 32, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.5, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-32, 0);
    g.quadraticCurveTo(0, -3, 32, 0);
    g.quadraticCurveTo(0, 3, -32, 0);
    g.fill();
    g.restore();
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, 9);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = core;
  g.fillRect(-9, -9, 18, 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * What the facets at the back of a stone send out to the eye: mostly bright
 * light, broken up by dark patches. A cut stone is a set of little mirrors
 * that return the light from above, and the dark patches are what make
 * neighbouring facets flash differently.
 */
function brightTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f4f4fa";
  g.fillRect(0, 0, 512, 256);
  // Patches placed by a fixed little generator, so every player sees the same stones.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 130; i++) {
    const shade = Math.floor(10 + rnd() * 120);
    g.fillStyle = `rgb(${shade},${shade},${shade + 12})`;
    g.fillRect(rnd() * 512, rnd() * 256, 10 + rnd() * 34, 8 + rnd() * 26);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------- background

const BG_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;

const BG_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float time;
uniform float world;
uniform float fever;
uniform float aspect;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 neon(vec2 uv) {
  vec3 col = mix(vec3(0.01, 0.0, 0.04), vec3(0.1, 0.01, 0.18), smoothstep(0.0, 0.7, uv.y));
  vec2 c = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  // A striped sun on the horizon.
  float d = length(c - vec2(0.0, 0.08));
  float sun = smoothstep(0.32, 0.3, d) * step(0.0, c.y - 0.0);
  float stripes = step(0.5, fract((c.y - 0.08) * 22.0 - time * 0.3)) + step(0.2, c.y);
  col += sun * mix(vec3(1.0, 0.2, 0.55), vec3(1.0, 0.75, 0.2), smoothstep(0.0, 0.35, c.y)) * min(stripes, 1.0);
  col += vec3(0.9, 0.1, 0.6) * 0.18 * exp(-abs(c.y) * 12.0);
  // A synthwave grid floor below the horizon.
  if (c.y < 0.0) {
    float z = 0.18 / max(-c.y, 0.001);
    vec2 g = vec2(c.x * z * 2.0, z + time * 0.6);
    vec2 gl = abs(fract(g) - 0.5) / fwidth(g);
    float line = 1.0 - min(min(gl.x, gl.y), 1.0);
    col = mix(vec3(0.02, 0.0, 0.05), col, 0.25) + line * vec3(0.0, 0.9, 1.0) * clamp(1.2 - z * 0.08, 0.0, 1.0);
  }
  // Skyline.
  float bx = floor(c.x * 18.0);
  float h = 0.02 + hash(vec2(bx, 3.0)) * 0.12;
  if (c.y > 0.0 && c.y < h) {
    col = vec3(0.03, 0.0, 0.08);
    vec2 w = fract(vec2(c.x * 90.0, c.y * 60.0));
    if (w.x < 0.4 && w.y < 0.5 && hash(floor(vec2(c.x * 90.0, c.y * 60.0))) > 0.6) col += vec3(1.0, 0.6, 0.9) * 0.6;
  }
  return col;
}
vec3 sea(vec2 uv) {
  vec3 col = mix(vec3(0.0, 0.03, 0.08), vec3(0.0, 0.22, 0.38), uv.y);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  // God rays from the surface.
  float rays = fbm(vec2(p.x * 3.0 + p.y * 0.8, time * 0.15));
  col += vec3(0.2, 0.6, 0.7) * pow(rays, 3.0) * smoothstep(0.1, 1.0, uv.y) * 0.9;
  // Caustics.
  float c = fbm(p * 6.0 + vec2(time * 0.2, time * 0.13));
  col += vec3(0.1, 0.5, 0.6) * smoothstep(0.55, 0.8, c) * 0.25;
  // Sea floor silhouettes.
  float floorY = 0.12 + fbm(vec2(p.x * 2.0, 1.0)) * 0.12;
  if (uv.y < floorY) col = mix(col, vec3(0.0, 0.04, 0.07), 0.85);
  return col;
}
vec3 space(vec2 uv) {
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  vec3 col = vec3(0.01, 0.0, 0.03);
  float n = fbm(p * 2.5 + vec2(time * 0.01, 0.0));
  float n2 = fbm(p * 4.0 - vec2(0.0, time * 0.015) + n);
  col += vec3(0.45, 0.1, 0.6) * pow(n2, 2.5) * 1.6;
  col += vec3(0.1, 0.35, 0.8) * pow(n, 3.0) * 1.2;
  // Stars.
  vec2 s = p * 120.0;
  float star = hash(floor(s));
  float tw = 0.6 + 0.4 * sin(time * 2.0 + star * 50.0);
  col += step(0.992, star) * smoothstep(0.5, 0.0, length(fract(s) - 0.5)) * tw * 1.5;
  // A ringed planet.
  vec2 q = p - vec2(0.55, 0.25);
  float d = length(q);
  col = mix(col, vec3(0.9, 0.5, 0.3) * (0.3 + 0.7 * smoothstep(0.12, -0.05, q.x + q.y)), smoothstep(0.1, 0.098, d));
  float ring = abs(length(vec2(q.x, q.y * 3.5 + q.x * 1.2)) - 0.17);
  col += vec3(1.0, 0.8, 0.6) * smoothstep(0.012, 0.0, ring) * step(0.1, d + step(0.0, q.y * 3.5 + q.x * 1.2)) * 0.6;
  return col;
}
void main() {
  vec3 col = world < 0.5 ? neon(vUv) : world < 1.5 ? sea(vUv) : space(vUv);
  // Fever: hue-shifting energy around the edges.
  vec2 e = vUv - 0.5;
  float edge = smoothstep(0.25, 0.75, length(e * vec2(aspect, 1.0)) / max(aspect, 1.0) * 1.6);
  vec3 hue = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + time * 0.4 + vUv.y));
  col += fever * hue * edge * 0.55;
  col *= 1.0 - 0.35 * length(e);
  gl_FragColor = vec4(col, 1.0);
}`;

// --------------------------------------------------------------- particles

const PARTICLES = 4000;
const P_VERTEX = /* glsl */ `
attribute float size;
attribute vec4 tint;
varying vec4 vTint;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const P_FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec4 vTint;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vTint.rgb * t.rgb, t.a * vTint.a);
}`;

class Particles {
  points: THREE.Points;
  pos = new Float32Array(PARTICLES * 3);
  vel = new Float32Array(PARTICLES * 3);
  tint = new Float32Array(PARTICLES * 4);
  size = new Float32Array(PARTICLES);
  base = new Float32Array(PARTICLES);
  life = new Float32Array(PARTICLES);
  maxLife = new Float32Array(PARTICLES);
  drag = new Float32Array(PARTICLES);
  gravity = new Float32Array(PARTICLES);
  next = 0;
  constructor(texture: THREE.Texture) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("tint", new THREE.BufferAttribute(this.tint, 4));
    geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: P_VERTEX,
      fragmentShader: P_FRAGMENT,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }
  emit(
    at: THREE.Vector3,
    color: THREE.Color,
    count: number,
    { speed = 3, size = 0.3, life = 0.8, spread = 0.2, gravity = -4, drag = 2.5, boost = 1.5 } = {},
  ) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const z = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - z * z);
      const s = speed * (0.35 + Math.random() * 0.65);
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = at.z + 0.3;
      this.vel[i * 3] = Math.cos(a) * r * s;
      this.vel[i * 3 + 1] = Math.sin(a) * r * s;
      this.vel[i * 3 + 2] = Math.abs(z) * s * 0.8;
      const white = Math.random() < 0.25 ? 0.6 : 0;
      this.tint[i * 4] = (color.r + white) * boost;
      this.tint[i * 4 + 1] = (color.g + white) * boost;
      this.tint[i * 4 + 2] = (color.b + white) * boost;
      this.tint[i * 4 + 3] = 1;
      this.base[i] = size * (0.4 + Math.random() * 0.8);
      this.life[i] = this.maxLife[i] = life * (0.5 + Math.random() * 0.6);
      this.drag[i] = drag;
      this.gravity[i] = gravity;
    }
  }
  update(dt: number) {
    for (let i = 0; i < PARTICLES; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.tint[i * 4 + 3] = k;
      this.size[i] = this.base[i] * (0.3 + 0.7 * k);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}

// ------------------------------------------------------------------- scene

export class GemScene {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  private bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private boardGroup = new THREE.Group();
  private fx = new THREE.Group();
  private geometries = makeGeometries();
  private prismGeometry = new THREE.IcosahedronGeometry(0.46, 0);
  private materials: THREE.MeshPhysicalMaterial[];
  private shellMaterials: THREE.MeshPhysicalMaterial[];
  private prismMaterial: THREE.MeshPhysicalMaterial;
  private glowTex = glowTexture();
  private starTex = starTexture();
  private nextGlint = 0;
  private particles: Particles;
  private views = new Map<number, GemView>();
  private iceMeshes: (THREE.Mesh | null)[] = new Array(SIZE * SIZE).fill(null);
  private iceGeo = new RoundedBoxGeometry(0.94, 0.94, 0.08, 2, 0.03);
  private iceMats: THREE.MeshStandardMaterial[];
  private tiles!: THREE.InstancedMesh;
  private frame!: THREE.Mesh;
  private frameMat = new THREE.MeshStandardMaterial({ color: 0x0b0f1d, roughness: 0.35, metalness: 0.6, emissive: 0x3020ff, emissiveIntensity: 0.15 });
  private selRing: THREE.Mesh;
  private tweens: Tween[] = [];
  private last = performance.now();
  private time = 0;
  private timeScale = 1;
  private slowUntil = 0;
  private shake = 0;
  private pointer = new THREE.Vector2();
  private tilt = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private selected: Pos | null = null;
  private dragFrom: { pos: Pos; at: THREE.Vector3 } | null = null;
  private inputOn = true;
  private hint: [Pos, Pos] | null = null;
  private fever = 0;
  private feverTarget = 0;
  private worldIndex = 0;
  private overlay: HTMLDivElement;
  private raf = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  /** Gem colour at each cell, for effects that need it. */
  private cells: (Gem | null)[] = [];
  private lightningLines: { line: THREE.Line; from: THREE.Vector3; to: THREE.Vector3; until: number }[] = [];

  constructor(
    private host: HTMLElement,
    private options: SceneOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = "gem-canvas";

    this.overlay = document.createElement("div");
    this.overlay.className = "gem-overlay";
    host.appendChild(this.overlay);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const studio = studioTexture();
    this.scene.environment = pmrem.fromEquirectangular(studio).texture;
    studio.dispose();
    const bright = brightTexture();
    const inside = pmrem.fromEquirectangular(bright).texture;
    bright.dispose();
    pmrem.dispose();

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.2, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.bg = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, world: { value: 0 }, fever: { value: 0 }, aspect: { value: 1 } },
        vertexShader: BG_VERTEX,
        fragmentShader: BG_FRAGMENT,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -10;
    this.scene.add(this.bg);

    // Soft light from above with no highlights of its own: every glint on a
    // gem comes from the studio it reflects, which keeps them crisp and small.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a8a, 2.8));

    this.materials = STONE_COLORS.map(
      (c, i) =>
        new THREE.MeshPhysicalMaterial({
          color: c,
          emissive: c,
          emissiveIntensity: i === 5 ? 0.25 : 0.12,
          envMap: i === 5 ? null : inside,
          roughness: i === 5 ? 0.3 : 0.06,
          metalness: i === 5 ? 0 : 0.92,
          // A cut stone is see-through: what you see is the facets at the
          // back (the pavilion), lit from inside, under a glassy top.
          side: i === 5 ? THREE.FrontSide : THREE.BackSide,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          iridescence: i === 5 ? 0.8 : 0,
          iridescenceIOR: 1.6,
          envMapIntensity: i === 5 ? 3 : 1.25,
          sheen: i === 5 ? 1 : 0,
          sheenColor: new THREE.Color(0xffc0ff),
          flatShading: false,
          vertexColors: true,
          specularIntensity: 1,
          ior: 2.2,
        }),
    );
    // The glassy top of each stone: only its reflections and a veil of
    // colour, added over the facets seen through it.
    this.shellMaterials = STONE_COLORS.map(
      (c) =>
        new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(c).multiplyScalar(0.04),
          roughness: 0.04,
          metalness: 0,
          ior: 2.2,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          envMapIntensity: 1.2,
          vertexColors: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
    );
    this.prismMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.3,
      roughness: 0.02,
      metalness: 0.2,
      iridescence: 1,
      iridescenceIOR: 2,
      
      clearcoat: 1,
      flatShading: true,
      envMapIntensity: 2.5,
    });
    this.iceMats = [
      [0x5aa9d6, 0.55],
      [0x2f7fb8, 0.8],
    ].map(
      ([color, opacity]) =>
        new THREE.MeshStandardMaterial({
          color,
          emissive: 0x1d6fb0,
          emissiveIntensity: 0.12,
          roughness: 0.35,
          metalness: 0.1,
          envMapIntensity: 0.4,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
    );

    this.buildBoard();
    this.scene.add(this.boardGroup, this.fx);
    this.particles = new Particles(this.glowTex);
    this.scene.add(this.particles.points);

    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.52, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5), transparent: true, toneMapped: false }),
    );
    this.selRing.visible = false;
    this.selRing.position.z = -0.2;
    this.boardGroup.add(this.selRing);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------- building

  private buildBoard() {
    const tileGeo = new RoundedBoxGeometry(0.96, 0.96, 0.14, 2, 0.1);
    const tileMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.2,
      envMapIntensity: 0.35,
    });
    this.tiles = new THREE.InstancedMesh(tileGeo, tileMat, SIZE * SIZE);
    const m = new THREE.Matrix4();
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const p = world(x, y);
        m.makeTranslation(p.x, p.y, -0.5);
        this.tiles.setMatrixAt(idx(x, y), m);
      }
    this.boardGroup.add(this.tiles);
    this.frame = new THREE.Mesh(new RoundedBoxGeometry(SIZE + 0.5, SIZE + 0.5, 0.3, 4, 0.2), this.frameMat);
    this.frame.position.z = -0.72;
    this.boardGroup.add(this.frame);
    this.paintTiles();
  }

  private paintTiles() {
    const palettes = [
      [0x2a1c52, 0x35246a],
      [0x103a54, 0x15486a],
      [0x221d48, 0x2c2660],
    ];
    const [a, b] = palettes[this.worldIndex] ?? palettes[0];
    const c = new THREE.Color();
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) this.tiles.setColorAt(idx(x, y), c.set((x + y) % 2 ? a : b));
    this.tiles.instanceColor!.needsUpdate = true;
    const edge = [0xff2bd6, 0x22d3ee, 0x8b5cf6][this.worldIndex] ?? 0x3020ff;
    this.frameMat.emissive.set(edge);
  }

  private makeView(gem: Gem, x: number, y: number): GemView {
    const group = new THREE.Group();
    const special = gem.special;
    const prism = special === "prism";
    const color = prism ? new THREE.Color(1, 1, 1) : new THREE.Color(GEM_COLORS[gem.color]);
    let material: THREE.Material = prism ? this.prismMaterial : this.materials[gem.color];
    if (special && !prism) {
      const m = this.materials[gem.color].clone();
      m.emissiveIntensity = 0.75;
      material = m;
    }
    const body = new THREE.Mesh(prism ? this.prismGeometry : this.geometries[gem.color], material);
    group.add(body);
    if (!prism && gem.color !== 5) {
      const shell = new THREE.Mesh(this.geometries[gem.color], this.shellMaterials[gem.color]);
      shell.userData.shared = true;
      shell.renderOrder = 2;
      body.add(shell);
    }
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color: color.clone().multiplyScalar(special ? 0.8 : 0.22),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.scale.setScalar(special ? 1.6 : 1.05);
    glow.position.z = -0.25;
    group.add(glow);
    let extra: THREE.Object3D | undefined;
    if (special === "row" || special === "col") {
      extra = new THREE.Group();
      const barMat = new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(3), toneMapped: false });
      for (const off of [-0.13, 0.13]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.05, 0.05), barMat);
        bar.position.set(0, off, 0.3);
        extra.add(bar);
        for (const side of [-1, 1]) {
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 8), barMat);
          tip.rotation.z = -side * Math.PI / 2;
          tip.position.set(side * 0.52, off, 0.3);
          extra.add(tip);
        }
      }
      if (special === "col") extra.rotation.z = Math.PI / 2;
      group.add(extra);
    } else if (special === "bomb") {
      extra = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.3).multiplyScalar(3.5), toneMapped: false });
      for (let i = 0; i < 2; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40), ringMat);
        ring.rotation.x = i ? 1.1 : -1.1;
        extra.add(ring);
      }
      group.add(extra);
    } else if (prism) {
      extra = new THREE.Mesh(
        new THREE.TorusGeometry(0.52, 0.025, 8, 48),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3), toneMapped: false }),
      );
      group.add(extra);
    }
    const p = world(x, y);
    group.position.copy(p);
    this.boardGroup.add(group);
    const view: GemView = { gem, group, body, glow, extra, x, y, phase: Math.random() * Math.PI * 2, scale: 1 };
    this.views.set(gem.id, view);
    return view;
  }

  private removeView(id: number) {
    const v = this.views.get(id);
    if (!v) return;
    this.boardGroup.remove(v.group);
    v.group.traverse((o) => {
      if (o instanceof THREE.Sprite) o.material.dispose();
      if (o instanceof THREE.Mesh && o !== v.body && !o.userData.shared) {
        o.geometry.dispose();
      }
    });
    if (v.gem.special && v.gem.special !== "prism") (v.body.material as THREE.Material).dispose();
    this.views.delete(id);
  }

  /** Shows a board at once, without animation. */
  setBoard(cells: (Gem | null)[], ice: number[], worldIndex: number) {
    for (const id of [...this.views.keys()]) this.removeView(id);
    // A move still animating on the old board stops here.
    const pending = this.tweens;
    this.tweens = [];
    for (const tw of pending) tw.cancel?.();
    this.setWorld(worldIndex);
    this.cells = cells.map((g) => (g ? { ...g } : null));
    cells.forEach((g, i) => {
      if (!g) return;
      const v = this.makeView(g, i % SIZE, Math.floor(i / SIZE));
      // Drop in from above, column by column.
      const target = v.group.position.clone();
      v.group.position.y += 9;
      const delay = (i % SIZE) * 0.03 + (SIZE - Math.floor(i / SIZE)) * 0.025;
      this.tween(0.55, (k) => (v.group.position.y = target.y + 9 * (1 - easeOutBack(k))), delay);
    });
    ice.forEach((n, i) => this.setIce(i, n));
    this.select(null);
    this.hint = null;
    this.setFever(false);
  }

  setWorld(i: number) {
    this.worldIndex = i;
    this.bg.material.uniforms.world.value = i;
    this.paintTiles();
  }

  private setIce(i: number, layers: number) {
    const mesh = this.iceMeshes[i];
    if (!layers) {
      if (mesh) {
        this.boardGroup.remove(mesh);
        this.iceMeshes[i] = null;
      }
      return;
    }
    const m = mesh ?? new THREE.Mesh(this.iceGeo, this.iceMats[0]);
    m.material = this.iceMats[Math.min(layers, 2) - 1];
    const p = world(i % SIZE, Math.floor(i / SIZE));
    m.position.set(p.x, p.y, -0.4);
    m.scale.z = layers > 1 ? 2 : 1;
    if (!mesh) {
      this.boardGroup.add(m);
      this.iceMeshes[i] = m;
    }
  }

  setInput(on: boolean) {
    this.inputOn = on;
    if (!on) {
      this.select(null);
      this.dragFrom = null;
    }
  }

  showHint(pair: [Pos, Pos] | null) {
    this.hint = pair;
  }

  setFever(on: boolean) {
    this.feverTarget = on ? 1 : 0;
  }

  // ------------------------------------------------------------- input

  private cellAt(e: PointerEvent): { pos: Pos; at: THREE.Vector3 } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const at = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, at)) return null;
    this.boardGroup.worldToLocal(at);
    const x = Math.round(at.x + HALF);
    const y = Math.round(HALF - at.y);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return { pos: { x, y }, at };
  }

  private onDown = (e: PointerEvent) => {
    this.options.onPoke?.();
    if (!this.inputOn) return;
    const hit = this.cellAt(e);
    if (!hit) {
      this.select(null);
      return;
    }
    if (this.selected && adjacent(this.selected, hit.pos)) {
      const from = this.selected;
      this.select(null);
      this.options.onSwap(from, hit.pos);
      return;
    }
    this.select(hit.pos);
    this.dragFrom = hit;
    sfx.select();
  };

  private onMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    if (!this.dragFrom || !this.inputOn) return;
    const hit = this.cellAt(e);
    if (!hit) return;
    const dx = hit.at.x - this.dragFrom.at.x;
    const dy = hit.at.y - this.dragFrom.at.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.45) return;
    const from = this.dragFrom.pos;
    const to = Math.abs(dx) > Math.abs(dy) ? { x: from.x + Math.sign(dx), y: from.y } : { x: from.x, y: from.y - Math.sign(dy) };
    this.dragFrom = null;
    if (to.x < 0 || to.y < 0 || to.x >= SIZE || to.y >= SIZE) return;
    this.select(null);
    this.options.onSwap(from, to);
  };

  private onUp = () => {
    this.dragFrom = null;
  };

  private select(p: Pos | null) {
    this.selected = p;
    this.selRing.visible = !!p;
    if (p) this.selRing.position.set(p.x - HALF, HALF - p.y, -0.2);
  }

  // ------------------------------------------------------------- animation

  private tween(dur: number, update: (k: number) => void, delay = 0, done?: () => void) {
    update(0);
    this.tweens.push({ t: 0, dur, delay, update, done });
  }

  /** Waits game time (slowed by slow motion). */
  private wait(seconds: number) {
    return new Promise<void>((resolve, reject) => {
      this.tween(seconds, () => {}, 0, resolve);
      this.tweens[this.tweens.length - 1].cancel = () => reject(new AnimationCancelled());
    });
  }

  private viewAt(cells: (Gem | null)[], p: Pos) {
    const g = cells[idx(p.x, p.y)];
    return g ? this.views.get(g.id) : undefined;
  }

  /** A swap that does nothing: the gems nudge over and back. */
  async playInvalid(a: Pos, b: Pos) {
    const va = this.viewAt(this.cells, a);
    const vb = this.viewAt(this.cells, b);
    sfx.invalid();
    const pa = world(a.x, a.y);
    const pb = world(b.x, b.y);
    for (const [v, from, to] of [
      [va, pa, pb],
      [vb, pb, pa],
    ] as const) {
      if (!v) continue;
      this.tween(0.32, (k) => {
        const s = Math.sin(k * Math.PI) * 0.45;
        v.group.position.lerpVectors(from, to, s);
      });
    }
    this.shake = Math.max(this.shake, 0.06);
    await this.wait(0.34);
  }

  /** Plays a move from the engine: the swap, each step, and any shuffle. */
  async playTurn(
    turn: Turn,
    swapped: [Pos, Pos] | null,
    hooks: { onStep?: (index: number, points: number) => void } = {},
  ) {
    this.hint = null;
    this.select(null);
    if (swapped) {
      const [a, b] = swapped;
      const va = this.viewAt(this.cells, a);
      const vb = this.viewAt(this.cells, b);
      sfx.swap();
      const pa = world(a.x, a.y);
      const pb = world(b.x, b.y);
      if (va) this.tween(0.18, (k) => va.group.position.lerpVectors(pa, pb, easeInOut(k)));
      if (vb) this.tween(0.18, (k) => vb.group.position.lerpVectors(pb, pa, easeInOut(k)));
      await this.wait(0.19);
      const ia = idx(a.x, a.y);
      const ib = idx(b.x, b.y);
      [this.cells[ia], this.cells[ib]] = [this.cells[ib], this.cells[ia]];
      if (va) [va.x, va.y] = [b.x, b.y];
      if (vb) [vb.x, vb.y] = [a.x, a.y];
    }
    const multiplier = turn.inFever ? 2 : 1;
    const big = !!turn.combo || turn.steps.some((s) => s.blasts.some((b) => b.kind === "wipe" || (b.kind === "prism" && b.targets.length > 6)));
    if (big) this.slowMotion(1.1);
    for (let i = 0; i < turn.steps.length; i++) {
      const step = turn.steps[i];
      if (step.chain >= 4) this.slowMotion(0.7);
      await this.playStep(step, multiplier);
      hooks.onStep?.(i, step.score * multiplier);
    }
    if (turn.shuffled) await this.playShuffle(turn.shuffled);
  }

  private slowMotion(seconds: number) {
    this.slowUntil = Math.max(this.slowUntil, performance.now() / 1000 + seconds);
  }

  private async playStep(step: Turn["steps"][number], multiplier: number) {
    // Gems turning into specials first (prism combos and the end surge).
    if (step.converted.length) {
      step.converted.forEach((c, n) => {
        const old = this.cells[idx(c.x, c.y)];
        if (old) this.removeView(old.id);
        const v = this.makeView(c.gem, c.x, c.y);
        this.cells[idx(c.x, c.y)] = c.gem;
        v.scale = 0;
        this.tween(0.25, (k) => (v.scale = easeOutBack(k)), n * 0.05);
        this.burst(world(c.x, c.y), c.gem.color, 8, { speed: 2 });
      });
      sfx.made();
      await this.wait(0.3 + step.converted.length * 0.05);
    }

    // Matched gems that make a special fly into its cell.
    for (const c of step.created) {
      const to = world(c.x, c.y);
      for (const f of c.from) {
        const v = this.viewAt(this.cells, f);
        if (!v) continue;
        const from = v.group.position.clone();
        this.tween(0.14, (k) => v.group.position.lerpVectors(from, to, easeInOut(k)));
      }
    }
    if (step.created.length) await this.wait(0.12);

    // Blasts go off one after another, and gems vanish as each reaches them.
    const clearDelay = new Map<number, number>();
    let t = 0;
    for (const blast of step.blasts) {
      this.playBlast(blast, t);
      const reach = blastCells(blast);
      for (const i of reach) if (!clearDelay.has(i)) clearDelay.set(i, t + 0.06 + blastDelay(blast, i));
      t += blast.kind === "prism" ? 0.18 : 0.09;
    }
    // How big this clear is, from 0 (a plain three) to 2: more gems and a
    // longer chain make everything below louder, wider and brighter.
    const power = Math.min(2, Math.max(0, step.cleared.length - 3) / 8 + (step.chain - 1) * 0.3);
    if (!step.blasts.length) sfx.pop(step.chain, step.cleared.length);
    if (power >= 0.3) sfx.boom(power);

    // Plain matches (no blast reached them) get their own show: a beam along
    // each line of three or more, then every gem flares, pops and shatters,
    // rippling out from the middle of its line.
    const plain = step.cleared.filter((c) => !clearDelay.has(idx(c.x, c.y)));
    const ripple = this.matchBeams(plain);
    if (plain.length) this.shake = Math.max(this.shake, 0.05 + 0.01 * plain.length);
    if (step.cleared.length) this.shake = Math.max(this.shake, 0.22 * power);
    if (power >= 0.3) {
      // A shockwave from the middle of the clear, then more of everything as it grows.
      const mid = new THREE.Vector3();
      for (const c of step.cleared) mid.add(world(c.x, c.y));
      mid.divideScalar(step.cleared.length);
      const tint = new THREE.Color(GEM_COLORS[Math.max(0, step.cleared[0].color)]);
      this.tween(0.01, () => {}, 0.12, () => {
        this.ring(mid, tint, 2 + 2.5 * power, 0.5 + 0.15 * power);
        this.burst(mid, -1, Math.round(40 * power), { speed: 5 + 4 * power, life: 0.8, size: 0.26, boost: 1.4 });
        if (power >= 0.7) {
          this.ring(mid, new THREE.Color(1, 1, 1), 1.4 + 2 * power, 0.4);
          this.flash(Math.min(0.5, 0.18 * power));
        }
        if (power >= 1.2) {
          this.ring(mid, tint, 4 + 3 * power, 0.9);
          this.burst(mid, -1, 90, { speed: 11, life: 1.3, size: 0.3, gravity: -6, drag: 1.4, boost: 1.6 });
          this.slowMotion(0.3);
        }
      });
    }

    for (const c of step.cleared) {
      const i = idx(c.x, c.y);
      const v = this.views.get(c.id);
      if (!v) continue;
      const matched = !clearDelay.has(i);
      const delay = matched ? (ripple.get(i) ?? 0) : clearDelay.get(i)!;
      const start = v.scale;
      if (matched) {
        this.tween(0.01, () => {}, delay, () => this.flare(v.group.position, c.color));
        this.tween(
          0.26,
          (k) => {
            // Swell with a quick wobble, then snap to nothing.
            const swell = k < 0.55 ? 1 + 0.35 * easeOut(k / 0.55) : 1.35 * (1 - easeIn((k - 0.55) / 0.45));
            v.scale = start * swell;
            v.body.rotation.z += 0.25;
          },
          delay,
          () => {
            const at = v.group.position;
            this.ring(at, new THREE.Color(GEM_COLORS[Math.max(0, c.color)]), 0.95 + 0.5 * power, 0.35);
            // Fast sparks, then heavier shards that fall away.
            this.burst(at, c.color, Math.round(14 + 12 * power), { speed: 4.5 + 2.5 * power, size: 0.2, life: 0.5 + 0.2 * power, gravity: 0, boost: 1.3 });
            this.burst(at, c.color, Math.round(10 + 8 * power), { speed: 2.6 + 1.5 * power, size: 0.3, life: 1, gravity: -11, drag: 1.2, boost: 1 });
            this.removeView(c.id);
          },
        );
        continue;
      }
      this.tween(
        0.2,
        (k) => {
          v.scale = start * (1 + k * 0.4) * (1 - easeIn(k));
          v.body.rotation.z += 0.2;
        },
        delay,
        () => {
          this.burst(v.group.position, c.color, Math.round((c.special ? 30 : 16) * (1 + 0.5 * power)), {
            speed: (c.special ? 4.5 : 3) * (1 + 0.3 * power),
          });
          this.removeView(c.id);
        },
      );
    }
    for (const ice of step.ice) {
      const i = idx(ice.x, ice.y);
      this.tween(0.01, () => {}, clearDelay.get(i) ?? 0, () => {
        this.setIce(i, ice.left);
        this.shards(world(ice.x, ice.y));
      });
    }
    if (step.ice.length) sfx.ice();
    const longest = Math.max(0, ...step.cleared.map((c) => clearDelay.get(idx(c.x, c.y)) ?? (ripple.get(idx(c.x, c.y)) ?? 0) + 0.08));
    await this.wait(longest + 0.2);

    // New specials pop in.
    for (const c of step.created) {
      const old = this.cells[idx(c.x, c.y)];
      if (old) this.removeView(old.id);
      const v = this.makeView(c.gem, c.x, c.y);
      v.scale = 0;
      this.tween(0.3, (k) => (v.scale = easeOutBack(k)));
      this.ring(world(c.x, c.y), c.gem.special === "prism" ? new THREE.Color(1, 1, 1) : new THREE.Color(GEM_COLORS[c.gem.color]), 1.2, 0.4);
    }
    if (step.created.length) sfx.made();

    // Points float up from the middle of what was cleared.
    if (step.cleared.length) {
      const mid = new THREE.Vector3();
      for (const c of step.cleared) mid.add(world(c.x, c.y));
      mid.divideScalar(step.cleared.length);
      this.floatText(`+${(step.score * multiplier).toLocaleString()}`, mid, step.chain > 1 ? "big" : "");
    }
    if (step.chain >= 2) this.banner(chainWord(step.chain), step.chain);

    // Gems fall and new ones drop in.
    await this.fall(step.cells, new Set(step.spawned));
  }

  private async fall(cells: (Gem | null)[], spawned: Set<number>) {
    const newPerColumn = new Array(SIZE).fill(0);
    cells.forEach((g, i) => g && spawned.has(g.id) && newPerColumn[i % SIZE]++);
    let longest = 0;
    cells.forEach((g, i) => {
      if (!g) return;
      const x = i % SIZE;
      const y = Math.floor(i / SIZE);
      let v = this.views.get(g.id);
      let fromY: number;
      if (!v) {
        v = this.makeView(g, x, y);
        fromY = y - newPerColumn[x] - 0.6;
      } else {
        fromY = HALF - v.group.position.y;
      }
      v.x = x;
      v.y = y;
      const view = v;
      const from = world(x, fromY);
      const to = world(x, y);
      const drop = y - fromY;
      if (drop < 0.01 && Math.abs(view.group.position.x - to.x) < 0.01) {
        view.group.position.copy(to);
        return;
      }
      const dur = 0.16 + Math.sqrt(Math.max(drop, 0)) * 0.11;
      longest = Math.max(longest, dur);
      this.tween(dur, (k) => view.group.position.lerpVectors(from, to, easeOutBounce(k)));
    });
    this.cells = cells.map((g) => (g ? { ...g } : null));
    await this.wait(longest + 0.02);
  }

  private async playShuffle(cells: (Gem | null)[]) {
    this.banner("Shuffle", 1);
    cells.forEach((g, i) => {
      if (!g) return;
      const v = this.views.get(g.id);
      if (!v) return;
      const from = v.group.position.clone();
      const to = world(i % SIZE, Math.floor(i / SIZE));
      v.x = i % SIZE;
      v.y = Math.floor(i / SIZE);
      this.tween(0.7, (k) => {
        v.group.position.lerpVectors(from, to, easeInOut(k));
        v.group.position.z = Math.sin(k * Math.PI) * 1.5;
        v.body.rotation.y = k * Math.PI * 2;
      });
    });
    this.cells = cells.map((g) => (g ? { ...g } : null));
    await this.wait(0.75);
  }

  /** The final celebration, after a win. */
  async celebrate() {
    for (let i = 0; i < 6; i++) {
      const at = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, 0.5);
      this.burst(at, Math.floor(Math.random() * 6), 50, { speed: 6, life: 1.4, gravity: -3 });
      this.ring(at, new THREE.Color(GEM_COLORS[i % 6]), 3, 0.7);
      await this.wait(0.12);
    }
  }

  // ---------------------------------------------------------------- effects

  private playBlast(blast: Blast, delay: number) {
    this.tween(0.01, () => {}, delay, () => {
      const at = world(blast.x, blast.y);
      const color = blastColor(this.cells, blast);
      switch (blast.kind) {
        case "row":
        case "col":
          sfx.laser();
          this.laser(blast, color);
          this.shake = Math.max(this.shake, blast.width > 1 ? 0.22 : 0.1);
          break;
        case "bomb":
          sfx.bomb();
          this.ring(at, color, blast.radius * 1.6 + 1, 0.5);
          this.ring(at, new THREE.Color(1, 1, 1), blast.radius * 1.2 + 0.8, 0.35);
          this.burst(at, -1, 40 * blast.radius, { speed: 7 * blast.radius, life: 0.7 });
          this.flash(0.25);
          this.shake = Math.max(this.shake, 0.25 * blast.radius);
          break;
        case "prism":
          sfx.prism();
          for (const target of blast.targets) this.lightning(at, world(target.x, target.y), color);
          this.ring(at, new THREE.Color(1, 1, 1), 2.2, 0.5);
          this.shake = Math.max(this.shake, 0.12);
          break;
        case "wipe":
          sfx.wipe();
          this.flash(0.8);
          for (let r = 0; r < 3; r++) this.ring(at, new THREE.Color(GEM_COLORS[r * 2]), 6 + r * 2, 0.8 + r * 0.2);
          this.shake = Math.max(this.shake, 0.6);
          this.slowMotion(1.4);
          break;
      }
    });
  }

  private laser(blast: Extract<Blast, { kind: "row" | "col" }>, color: THREE.Color) {
    const horizontal = blast.kind === "row";
    const length = SIZE + 3;
    const hot = color.clone().lerp(new THREE.Color(1, 1, 1), 0.4).multiplyScalar(4);
    const mat = new THREE.MeshBasicMaterial({ color: hot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const thick = 0.55 * blast.width;
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(horizontal ? length : thick, horizontal ? thick : length), mat);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(horizontal ? length : thick * 0.25, horizontal ? thick * 0.25 : length), core);
    const p = world(blast.x, blast.y);
    const group = new THREE.Group();
    group.add(beam, inner);
    group.position.set(horizontal ? 0 : p.x, horizontal ? p.y : 0, 0.6);
    this.fx.add(group);
    this.tween(
      0.45,
      (k) => {
        const s = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
        if (horizontal) group.scale.set(Math.min(1, k * 5), s, 1);
        else group.scale.set(s, Math.min(1, k * 5), 1);
        mat.opacity = s;
        core.opacity = s;
      },
      0,
      () => {
        this.fx.remove(group);
        beam.geometry.dispose();
        inner.geometry.dispose();
        mat.dispose();
        core.dispose();
      },
    );
    // Sparks streaming along the beam.
    for (let k = 0; k < SIZE; k++) {
      for (let w = 0; w < blast.width; w++) {
        const off = w - (blast.width - 1) / 2;
        const at = horizontal ? world(k, blast.y + off) : world(blast.x + off, k);
        this.particles.emit(at, color, 6, { speed: 2.5, size: 0.3, life: 0.5, gravity: 0 });
      }
    }
  }

  private ring(at: THREE.Vector3, color: THREE.Color, radius: number, dur: number) {
    const mat = new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(3),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 64), mat);
    mesh.position.set(at.x, at.y, 0.7);
    this.fx.add(mesh);
    this.tween(
      dur,
      (k) => {
        mesh.scale.setScalar(0.1 + easeOut(k) * radius);
        mat.opacity = 1 - k;
      },
      0,
      () => {
        this.fx.remove(mesh);
        mesh.geometry.dispose();
        mat.dispose();
      },
    );
  }

  private lightning(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color) {
    const mat = new THREE.LineBasicMaterial({
      color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(5),
      transparent: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
    const line = new THREE.Line(geo, mat);
    this.fx.add(line);
    const entry = { line, from: from.clone().setZ(0.6), to: to.clone().setZ(0.6), until: 0 };
    this.lightningLines.push(entry);
    this.jag(entry);
    this.tween(
      0.5,
      (k) => (mat.opacity = 1 - k * k),
      0,
      () => {
        this.fx.remove(line);
        geo.dispose();
        mat.dispose();
        this.lightningLines = this.lightningLines.filter((l) => l !== entry);
      },
    );
  }

  private jag(l: { line: THREE.Line; from: THREE.Vector3; to: THREE.Vector3 }) {
    const attr = l.line.geometry.attributes.position as THREE.BufferAttribute;
    const n = attr.count;
    const dir = l.to.clone().sub(l.from);
    const normal = new THREE.Vector3(-dir.y, dir.x, 0).normalize();
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const p = l.from.clone().lerp(l.to, k);
      if (i > 0 && i < n - 1) p.addScaledVector(normal, (Math.random() - 0.5) * 0.45);
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
  }

  /**
   * A beam of light along every line of three or more same-coloured gems in
   * `cleared`. Returns how long each cell waits to pop, so a line bursts from
   * its middle outwards.
   */
  private matchBeams(cleared: Cleared[]) {
    const delay = new Map<number, number>();
    const color = new Map<number, number>();
    for (const c of cleared) color.set(idx(c.x, c.y), c.color);
    const line = (cells: Pos[]) => {
      const mid = (cells.length - 1) / 2;
      cells.forEach((p, n) => {
        const d = 0.05 + Math.abs(n - mid) * 0.045;
        const i = idx(p.x, p.y);
        delay.set(i, Math.min(delay.get(i) ?? Infinity, d));
      });
      const a = world(cells[0].x, cells[0].y);
      const b = world(cells[cells.length - 1].x, cells[cells.length - 1].y);
      this.beam(a, b, new THREE.Color(GEM_COLORS[Math.max(0, color.get(idx(cells[0].x, cells[0].y))!)]));
    };
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      for (const c of cleared) {
        const same = (x: number, y: number) =>
          x >= 0 && y >= 0 && x < SIZE && y < SIZE && color.get(idx(x, y)) === c.color;
        if (same(c.x - dx, c.y - dy)) continue; // not the start of a line
        const cells: Pos[] = [];
        for (let x = c.x, y = c.y; same(x, y); x += dx, y += dy) cells.push({ x, y });
        if (cells.length >= 3) line(cells);
      }
    }
    return delay;
  }

  /** A soft bar of light from `a` to `b` that flashes wide and thins out. */
  private beam(a: THREE.Vector3, b: THREE.Vector3, color: THREE.Color) {
    const length = a.distanceTo(b) + 1.1;
    const make = (tint: THREE.Color, height: number) => {
      const mat = new THREE.MeshBasicMaterial({
        map: this.glowTex,
        color: tint,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0.75);
      mesh.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      this.fx.add(mesh);
      this.tween(
        0.32,
        (k) => {
          mesh.scale.set(length * (0.6 + 0.5 * easeOut(Math.min(1, k * 3))), height * (1 - easeIn(k)) + 0.02, 1);
          mat.opacity = 1 - k * k;
        },
        0,
        () => {
          this.fx.remove(mesh);
          mesh.geometry.dispose();
          mat.dispose();
        },
      );
    };
    make(color.clone().multiplyScalar(1.5), 1.5);
    make(color.clone().lerp(new THREE.Color(1, 1, 1), 0.6).multiplyScalar(1.3), 0.4);
  }

  /** A quick bloom of light on a gem as it pops. */
  private flare(at: THREE.Vector3, color: number) {
    const mat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: new THREE.Color(GEM_COLORS[Math.max(0, color)]).lerp(new THREE.Color(1, 1, 1), 0.2).multiplyScalar(1.3),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(at.x, at.y, 0.8);
    this.fx.add(sprite);
    this.tween(
      0.34,
      (k) => {
        sprite.scale.setScalar(0.7 + 1.3 * easeOut(k));
        mat.opacity = 1 - k;
      },
      0,
      () => {
        this.fx.remove(sprite);
        mat.dispose();
      },
    );
  }

  /** A star winks on a random gem, the way a facet catches the light. */
  private glint() {
    const all = [...this.views.values()];
    const v = all[Math.floor(Math.random() * all.length)];
    if (!v || v.scale < 0.9) return;
    const mat = new THREE.SpriteMaterial({
      map: this.starTex,
      color: new THREE.Color(1.1, 1.1, 1.1),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const r = 0.1 + Math.random() * 0.18;
    sprite.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.45);
    v.group.add(sprite);
    const size = 0.3 + Math.random() * 0.15;
    this.tween(
      0.9,
      (k) => {
        const pulse = Math.sin(k * Math.PI);
        sprite.scale.setScalar(size * (0.3 + pulse));
        mat.opacity = pulse * 0.7;
        mat.rotation = k * 0.4;
      },
      0,
      () => {
        v.group.remove(sprite);
        mat.dispose();
      },
    );
  }

  private burst(at: THREE.Vector3, color: number, count: number, opts: Parameters<Particles["emit"]>[3] = {}) {
    const c = color < 0 ? new THREE.Color(1, 0.9, 0.7) : new THREE.Color(GEM_COLORS[color]);
    this.particles.emit(at, c, count, opts);
  }

  private shards(at: THREE.Vector3) {
    this.particles.emit(at, new THREE.Color(0.7, 0.9, 1), 14, { speed: 3.5, size: 0.22, life: 0.7, gravity: -9, boost: 1.6 });
  }

  private flash(strength: number) {
    const el = document.createElement("div");
    el.className = "gem-flash";
    el.style.opacity = String(strength);
    this.overlay.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = "0"));
    setTimeout(() => el.remove(), 700);
  }

  private floatText(text: string, at: THREE.Vector3, kind: string) {
    const el = document.createElement("div");
    el.className = `gem-float ${kind}`;
    el.textContent = text;
    const p = at.clone();
    this.boardGroup.localToWorld(p);
    p.project(this.camera);
    el.style.left = `${(p.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-p.y * 0.5 + 0.5) * 100}%`;
    this.overlay.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  /** A big word across the board, such as "Fever!". */
  banner(text: string, level = 1) {
    const el = document.createElement("div");
    el.className = `gem-banner level-${Math.min(level, 6)}`;
    el.textContent = this.translate(text);
    this.overlay.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  /** How banner words are translated. */
  setBannerTranslator(t: (s: string) => string) {
    this.translate = t;
  }
  private translate = (s: string) => s;

  // ------------------------------------------------------------------- loop

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // Fit the board (about 9.4 units with a margin) in both directions.
    const fit = 9.6;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const distH = fit / 2 / Math.tan(vFov / 2);
    const distW = fit / 2 / (Math.tan(vFov / 2) * this.camera.aspect);
    this.baseDistance = Math.max(distH, distW);
    this.camera.updateProjectionMatrix();
    this.bg.material.uniforms.aspect.value = w / h;
  }
  private baseDistance = 16;

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const nowMs = performance.now();
    const real = Math.min((nowMs - this.last) / 1000, 0.1);
    this.last = nowMs;
    const now = nowMs / 1000;
    const slow = now < this.slowUntil;
    this.timeScale += ((slow ? 0.35 : 1) - this.timeScale) * Math.min(1, real * 10);
    const dt = real * this.timeScale;
    this.time += dt;

    // Tweens.
    const running = this.tweens;
    this.tweens = [];
    const keep: Tween[] = [];
    for (const tw of running) {
      if (tw.delay > 0) {
        tw.delay -= dt;
        keep.push(tw);
        continue;
      }
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.update(k);
      if (k >= 1) tw.done?.();
      else keep.push(tw);
    }
    this.tweens = keep.concat(this.tweens);

    // Gems idle: barely a sway, so a board at rest is calm to look at; specials spin and pulse.
    for (const v of this.views.values()) {
      const t = this.time + v.phase;
      const hinted = this.hint?.some((p) => p.x === v.x && p.y === v.y);
      const sel = this.selected && this.selected.x === v.x && this.selected.y === v.y;
      v.body.rotation.x = Math.sin(t * 0.5) * 0.07;
      v.body.rotation.y = v.gem.special === "prism" ? t * 1.5 : Math.sin(t * 0.4) * 0.09 + (sel ? t * 4 : 0);
      let s = v.scale * (sel ? 1.15 : 1);
      if (hinted) s *= 1 + Math.sin(this.time * 8) * 0.12;
      if (v.gem.special) s *= 1 + Math.sin(this.time * 5 + v.phase) * 0.05;
      v.group.scale.setScalar(Math.max(s, 0.0001));
      if (v.extra) {
        if (v.gem.special === "bomb") v.extra.rotation.z = this.time * 2;
        else if (v.gem.special === "prism") {
          v.extra.rotation.x = this.time * 1.3;
          v.extra.rotation.y = this.time * 0.9;
        }
      }
      const glow = v.glow.material as THREE.SpriteMaterial;
      glow.opacity = v.gem.special ? 0.55 + 0.25 * Math.sin(t * 3) : this.fever * (0.5 + 0.3 * Math.sin(t * 4));
      v.glow.visible = glow.opacity > 0.02;
    }
    if (this.prismMaterial) this.prismMaterial.emissive.setHSL((this.time * 0.25) % 1, 0.9, 0.55);
    this.selRing.rotation.z = this.time;

    for (const l of this.lightningLines) {
      if (this.time > l.until) {
        this.jag(l);
        l.until = this.time + 0.05;
      }
    }

    // Fever and the background.
    this.fever += (this.feverTarget - this.fever) * Math.min(1, real * 3);
    const u = this.bg.material.uniforms;
    u.time.value = this.time;
    u.fever.value = this.fever;
    this.bloom.strength = 0.4 + this.fever * 0.35;
    this.frameMat.emissiveIntensity = 0.15 + this.fever * (0.8 + 0.4 * Math.sin(this.time * 6));
    for (const m of this.materials) m.emissiveIntensity = 0.1 + this.fever * 0.2;

    // Camera: a slight tilt, a touch of parallax, and shake.
    this.tilt.lerp(this.pointer, Math.min(1, real * 2));
    this.shake = Math.max(0, this.shake - real * 1.6);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const d = this.baseDistance;
    this.camera.position.set(this.tilt.x * 0.25 + sx, -d * 0.2 + this.tilt.y * 0.15 + sy, d);
    this.camera.lookAt(sx * 0.5, -0.15 + sy * 0.5, 0);

    this.particles.update(dt);
    if (this.time > this.nextGlint) {
      this.nextGlint = this.time + 0.9 + Math.random() * 1.3;
      this.glint();
    }
    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    for (const id of [...this.views.keys()]) this.removeView(id);
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }
}

// ----------------------------------------------------------------- helpers

function blastCells(blast: Blast): number[] {
  const out: number[] = [];
  const add = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && out.push(idx(x, y));
  if (blast.kind === "row" || blast.kind === "col") {
    const half = (blast.width - 1) / 2;
    for (let o = -half; o <= half; o++)
      for (let k = 0; k < SIZE; k++) blast.kind === "row" ? add(k, blast.y + o) : add(blast.x + o, k);
  } else if (blast.kind === "bomb") {
    for (let y = -blast.radius; y <= blast.radius; y++) for (let x = -blast.radius; x <= blast.radius; x++) add(blast.x + x, blast.y + y);
  } else if (blast.kind === "prism") {
    for (const t of blast.targets) add(t.x, t.y);
  } else for (let i = 0; i < SIZE * SIZE; i++) out.push(i);
  return out;
}

/** When a blast reaches cell i, after it goes off. */
function blastDelay(blast: Blast, i: number) {
  const x = i % SIZE;
  const y = Math.floor(i / SIZE);
  const d = Math.hypot(x - blast.x, y - blast.y);
  if (blast.kind === "prism") return 0.12;
  if (blast.kind === "row" || blast.kind === "col") return d * 0.025;
  return d * 0.05;
}

function blastColor(cells: (Gem | null)[], blast: Blast) {
  if (blast.kind === "prism") return new THREE.Color(GEM_COLORS[blast.color] ?? 0xffffff);
  const g = cells[idx(blast.x, blast.y)];
  return new THREE.Color(g && g.color >= 0 ? GEM_COLORS[g.color] : 0xffffff);
}

const CHAIN_WORDS = ["", "", "Nice", "Great", "Brilliant", "Dazzling", "Radiant", "Unstoppable"];
/** The banner for a chain; the game translates these words. */
export const chainWord = (chain: number) => CHAIN_WORDS[Math.min(chain, CHAIN_WORDS.length - 1)];

const easeIn = (k: number) => k * k;
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
function easeOutBack(k: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
}
function easeOutBounce(k: number) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (k < 1 / d1) return n1 * k * k;
  if (k < 2 / d1) return n1 * (k -= 1.5 / d1) * k + 0.75;
  if (k < 2.5 / d1) return n1 * (k -= 2.25 / d1) * k + 0.9375;
  return n1 * (k -= 2.625 / d1) * k + 0.984375;
}

export type { Special };
