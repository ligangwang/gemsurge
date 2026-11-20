/**
 * The Crystal Forest: a small 3D scene behind the board, drawn with its own
 * camera. Old trees frame a river that winds away towards a bright glade and
 * a castle on a far hill; glowing crystals grow along the banks, light falls
 * in shafts through the mist, and fireflies drift over the water.
 *
 * Everything is made in code (no models or textures to ship or credit), and
 * kept to a few thousand triangles so it runs on phones.
 */
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// A fixed sequence of random numbers, so the forest grows the same each time.
let seed = 20261120;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const between = (a: number, b: number) => a + (b - a) * rand();

/** Where the river runs: its middle at each depth z (z is negative away from us). */
const riverX = (z: number) => 1.6 * Math.sin(z * 0.11 + 0.6) + 0.5 * Math.sin(z * 0.29);
/** How wide the river is at depth z: wide in front, narrow far away. */
const riverWidth = (z: number) => THREE.MathUtils.lerp(2.6, 1.1, THREE.MathUtils.clamp(-z / 60, 0, 1));

/** Gentle hills, cut down where the river runs. */
function groundY(x: number, z: number) {
  const hills = 0.35 * Math.sin(x * 0.35 + z * 0.12) + 0.25 * Math.sin(x * 0.8 - z * 0.3);
  const fromRiver = Math.abs(x - riverX(z)) / riverWidth(z);
  const bank = THREE.MathUtils.smoothstep(fromRiver, 0.55, 1.6);
  // The far hill on the right, where the castle stands.
  const hill = 3.2 * Math.exp(-((x - 4.5) ** 2 + (z + 42) ** 2) / 40);
  return -0.35 + bank * (0.35 + Math.max(0, hills)) + hill;
}

const SUN = new THREE.Vector3(-0.15, 0.22, -1).normalize();

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uSun;
varying vec3 vDir;
void main() {
  float up = clamp(vDir.y, -0.2, 1.0);
  // Pale gold low in the glade, teal above, deep green where the canopy closes.
  vec3 col = mix(vec3(0.98, 0.9, 0.64), vec3(0.4, 0.7, 0.6), smoothstep(0.0, 0.22, up));
  col = mix(col, vec3(0.07, 0.24, 0.2), smoothstep(0.25, 0.75, up));
  float sun = max(dot(vDir, uSun), 0.0);
  col += vec3(1.0, 0.9, 0.6) * (pow(sun, 24.0) * 1.4 + pow(sun, 4.0) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

const WATER_VERTEX = /* glsl */ `
varying vec3 vWorld;
varying float vFog;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 view = viewMatrix * w;
  vFog = smoothstep(6.0, 70.0, -view.z);
  gl_Position = projectionMatrix * view;
}`;
const WATER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uFog;
varying vec3 vWorld;
varying float vFog;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 p = vWorld.xz;
  float far = smoothstep(0.0, -50.0, vWorld.z);
  // The sky and the glade, mirrored: bright where the river runs away from us.
  vec3 col = mix(vec3(0.03, 0.17, 0.2), vec3(0.62, 0.8, 0.68), pow(far, 1.4));
  // Slow, broad swells, and the bright glade sliding over them.
  float swell = noise(p * vec2(0.9, 0.35) + vec2(0.0, uTime * 0.25));
  float fine = noise(p * vec2(3.0, 1.2) - vec2(uTime * 0.15, uTime * 0.5));
  col *= 0.88 + 0.22 * swell;
  col += vec3(0.85, 0.95, 0.85) * smoothstep(0.6, 0.85, swell * 0.6 + fine * 0.4) * 0.18 * (0.3 + far);
  // A few small glints where the ripples catch the light.
  float glint = smoothstep(0.9, 0.97, noise(p * vec2(7.0, 2.5) + vec2(uTime * 0.2, uTime * 0.7)));
  col += vec3(1.0, 0.97, 0.85) * glint * 0.45 * (1.0 - 0.5 * far);
  // The crystals' glow, caught on the water near the banks.
  col += vec3(0.05, 0.3, 0.28) * 0.35 * (1.0 - far);
  gl_FragColor = vec4(mix(col, uFog, vFog * 0.85), 1.0);
}`;

const CRYSTAL_VERTEX = /* glsl */ `
attribute float aHue;
attribute float aRise;
varying vec3 vNormal;
varying vec3 vView;
varying float vHue;
varying float vRise;
varying float vFog;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - w.xyz);
  vHue = aHue;
  vRise = aRise;
  vec4 view = viewMatrix * w;
  vFog = smoothstep(8.0, 75.0, -view.z);
  gl_Position = projectionMatrix * view;
}`;
/** A glowing crystal: lit from inside, brightest at its tip and its edges. */
const CRYSTAL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uFog;
varying vec3 vNormal;
varying vec3 vView;
varying float vHue;
varying float vRise;
varying float vFog;
void main() {
  vec3 N = normalize(vNormal);
  float facing = abs(dot(N, normalize(vView)));
  vec3 deep = mix(vec3(0.02, 0.32, 0.36), vec3(0.22, 0.12, 0.42), vHue);
  vec3 glow = mix(vec3(0.45, 1.0, 0.9), vec3(0.8, 0.6, 1.0), vHue);
  // Each face a different shade, as the light inside meets it.
  float face = 0.55 + 0.45 * fract(sin(dot(floor(N * 3.0), vec3(12.9, 78.2, 37.7))) * 43758.5);
  vec3 col = mix(deep, glow, vRise * 0.8) * face;
  col += glow * pow(1.0 - facing, 2.5) * 1.2;
  col += glow * (0.25 + 0.15 * sin(uTime * 1.3 + vHue * 6.0 + vRise * 3.0)) * vRise;
  gl_FragColor = vec4(mix(col, uFog, vFog * 0.7), 1.0);
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

/** Paints every vertex of a geometry with one colour, for merging. */
function painted(
  geo: THREE.BufferGeometry,
  color: THREE.Color,
  shade?: (y: number, n: THREE.Vector3) => number,
  smooth = false,
) {
  // Nothing here is textured, so no shape keeps texture coordinates (merged
  // shapes must all have the same attributes).
  if (geo.getAttribute("uv")) geo.deleteAttribute("uv");
  // Smooth shapes join their corners so their normals are shared; the rest
  // show each face.
  if (smooth) {
    geo = mergeVertices(geo);
    geo.computeVertexNormals();
  }
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute("position");
  if (!smooth) g.computeVertexNormals();
  const nor = g.getAttribute("normal");
  const colors = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i);
    const k = shade ? shade(pos.getY(i), n) : 1;
    colors[i * 3] = color.r * k;
    colors[i * 3 + 1] = color.g * k;
    colors[i * 3 + 2] = color.b * k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Nudges every vertex of a blob outward or in, so it is lumpy. */
function lumpy(geo: THREE.BufferGeometry, amount: number) {
  const pos = geo.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + amount * (Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.3 - v.y) );
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  return geo;
}

/** An old tree: a leaning, tapering trunk with flared roots and a crown of leaves. */
function tree(x: number, z: number, size: number, trunks: THREE.BufferGeometry[], leaves: THREE.BufferGeometry[]) {
  const y = groundY(x, z) - 0.2;
  const h = 6 * size;
  const lean = between(-0.25, 0.25);
  const trunk = new THREE.CylinderGeometry(0.16 * size, 0.42 * size, h, 9, 8, true);
  const pos = trunk.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    const up = (py + h / 2) / h;
    // Roots flare out at the foot; the trunk bends as it rises.
    const flare = 1 + 1.4 * Math.max(0, 0.18 - up) / 0.18;
    pos.setXYZ(i, pos.getX(i) * flare + lean * up * up * h * 0.25 + 0.15 * Math.sin(up * 5), py, pos.getZ(i) * flare);
  }
  trunk.translate(x, y + h / 2, z);
  const streak = rand() * 10;
  trunks.push(
    painted(trunk, new THREE.Color(0x5e4430), (py, n) => {
      // Lit on the side facing the glade, with dark grooves running up the bark.
      const lit = 0.35 + 0.65 * Math.max(0, n.x * 0.5 - n.z * 0.4 + 0.45);
      const groove = 0.75 + 0.25 * Math.sin(Math.atan2(n.z, n.x) * 9 + streak);
      return lit * groove * (0.7 + 0.3 * ((py - y) / h));
    }),
  );
  // A crown of a few lumpy clumps of leaves.
  const top = new THREE.Vector3(x + lean * h * 0.25, y + h, z);
  const clumps = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < clumps; i++) {
    const r = size * between(1.3, 2.1);
    // Smooth shading hides the facets, so the trees further back can be simpler.
    const blob = lumpy(new THREE.IcosahedronGeometry(r, size > 1.35 ? 2 : 1), 0.18);
    blob.scale(1, 0.72, 1);
    const a = (i / clumps) * Math.PI * 2 + rand();
    blob.translate(
      top.x + Math.cos(a) * size * between(0.8, 1.9),
      top.y + between(-0.6, 0.9) * size,
      top.z + Math.sin(a) * size * between(0.8, 1.6),
    );
    const green = new THREE.Color().setHSL(between(0.24, 0.32), between(0.35, 0.5), between(0.18, 0.27));
    // Lit gold-green on top, deep green beneath.
    leaves.push(painted(blob, green, (_, n) => 0.4 + 0.9 * Math.max(0, n.y * 0.7 + n.z * 0.2 + 0.3), true));
  }
}

/** A cluster of crystals: hexagonal prisms with pointed tips, leaning out from a point. */
function crystals(x: number, z: number, size: number, hue: number, out: THREE.BufferGeometry[]) {
  const y = groundY(x, z) - 0.1;
  const count = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    const r = size * between(0.12, 0.26) * (i === 0 ? 1.5 : 1);
    const h = size * between(0.8, 2.0) * (i === 0 ? 1.9 : 1);
    const body = new THREE.CylinderGeometry(r, r * 1.08, h, 6, 1);
    body.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2.2, 6);
    tip.translate(0, h + r * 1.1, 0);
    const one = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])!;
    const total = h + r * 2.2;
    const rise = new Float32Array(one.getAttribute("position").count);
    const pos = one.getAttribute("position");
    for (let k = 0; k < rise.length; k++) rise[k] = pos.getY(k) / total;
    one.setAttribute("aRise", new THREE.BufferAttribute(rise, 1));
    one.setAttribute("aHue", new THREE.BufferAttribute(new Float32Array(rise.length).fill(hue), 1));
    one.rotateZ(i === 0 ? between(-0.1, 0.1) : between(-0.6, 0.6));
    one.rotateX(i === 0 ? between(-0.1, 0.1) : between(-0.5, 0.5));
    one.rotateY(rand() * Math.PI);
    one.translate(x + between(-0.3, 0.3) * size, y, z + between(-0.3, 0.3) * size);
    one.deleteAttribute("uv");
    out.push(one);
  }
}

/** A mossy boulder. */
function rock(x: number, z: number, size: number, out: THREE.BufferGeometry[]) {
  const geo = lumpy(new THREE.DodecahedronGeometry(size, 1), 0.12);
  geo.scale(1.3, 0.7, 1);
  geo.rotateY(rand() * 3);
  geo.translate(x, groundY(x, z) + size * 0.15, z);
  out.push(
    painted(geo, new THREE.Color(0x7d8a8f), (_, n) => (n.y > 0.55 ? 0 : 0.6 + 0.4 * n.y), true),
  );
  // Moss on the top, as its own colour.
  const moss = out[out.length - 1].getAttribute("color");
  const nor = out[out.length - 1].getAttribute("normal");
  for (let i = 0; i < moss.count; i++)
    if (nor.getY(i) > 0.55) moss.setXYZ(i, 0.22, 0.42, 0.14);
}

/** A little glowing mushroom, or a few purple flowers, on the bank. */
function undergrowth(x: number, z: number, glow: THREE.BufferGeometry[], plain: THREE.BufferGeometry[]) {
  const y = groundY(x, z);
  if (rand() < 0.55) {
    const s = between(0.12, 0.26);
    const stem = new THREE.CylinderGeometry(s * 0.25, s * 0.32, s * 1.2, 6);
    stem.translate(x, y + s * 0.6, z);
    plain.push(painted(stem, new THREE.Color(0xe8dcc0)));
    const cap = new THREE.SphereGeometry(s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.6, 1);
    cap.translate(x, y + s * 1.15, z);
    cap.deleteAttribute("uv");
    const n = cap.getAttribute("position").count;
    cap.setAttribute("aRise", new THREE.BufferAttribute(new Float32Array(n).fill(0.9), 1));
    cap.setAttribute("aHue", new THREE.BufferAttribute(new Float32Array(n).fill(rand() < 0.5 ? 0 : 0.6), 1));
    glow.push(cap.toNonIndexed());
  } else {
    for (let i = 0; i < 4; i++) {
      const f = new THREE.IcosahedronGeometry(0.07, 0);
      f.translate(x + between(-0.25, 0.25), y + between(0.12, 0.3), z + between(-0.25, 0.25));
      plain.push(painted(f, new THREE.Color().setHSL(between(0.75, 0.85), 0.6, 0.6)));
    }
  }
}

/** The castle on the far hill: towers with pointed roofs and a wall. */
function castle(out: THREE.BufferGeometry[]) {
  const baseX = 4.5;
  const baseZ = -42;
  const y = groundY(baseX, baseZ) - 0.3;
  const stone = new THREE.Color(0xc8c0b0);
  const roof = new THREE.Color(0x8a4a3a);
  const parts: [number, number, number, number][] = [
    // [x, z, radius, height]
    [0, 0, 0.9, 6.5],
    [-2.2, 0.8, 0.6, 4.4],
    [2.0, 0.6, 0.65, 4.8],
    [-1.0, -1.4, 0.5, 5.2],
    [1.2, -1.2, 0.45, 3.8],
  ];
  for (const [dx, dz, r, h] of parts) {
    const tower = new THREE.CylinderGeometry(r, r * 1.05, h, 10);
    tower.translate(baseX + dx, y + h / 2, baseZ + dz);
    out.push(painted(tower, stone, (_, n) => 0.6 + 0.4 * Math.max(0, -n.x * 0.5 + n.z * 0.5 + 0.5)));
    const cone = new THREE.ConeGeometry(r * 1.25, r * 2.6, 10);
    cone.translate(baseX + dx, y + h + r * 1.3, baseZ + dz);
    out.push(painted(cone, roof, (_, n) => 0.6 + 0.4 * Math.max(0, -n.x * 0.5 + 0.5)));
  }
  const wall = new THREE.BoxGeometry(4.2, 2.2, 2.4);
  wall.translate(baseX, y + 1.1, baseZ);
  out.push(painted(wall, stone, (_, n) => 0.65 + 0.35 * Math.max(0, n.z)));
}

export class CrystalForest {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  private time = 0;
  private waterMat: THREE.ShaderMaterial;
  private crystalMat: THREE.ShaderMaterial;
  private shafts: THREE.Mesh[] = [];
  private flies: THREE.Points;
  private flyBase: Float32Array;

  constructor() {
    const fog = new THREE.Color(0x9ccfb8);
    this.scene.fog = new THREE.Fog(fog, 10, 80);
    this.scene.add(new THREE.HemisphereLight(0xfff2c8, 0x1e3a24, 1.25));
    const sun = new THREE.DirectionalLight(0xffe6b0, 2.2);
    sun.position.copy(SUN).multiplyScalar(-1).setY(6).add(new THREE.Vector3(0, 8, 0));
    this.scene.add(sun);

    // The sky.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(150, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: SUN } },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.scene.add(sky);

    // The ground, mossy green, lighter in the sunny glade.
    const ground = new THREE.PlaneGeometry(140, 140, 90, 90);
    ground.rotateX(-Math.PI / 2);
    const gp = ground.getAttribute("position");
    const gc = new Float32Array(gp.count * 3);
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const z = gp.getZ(i);
      gp.setY(i, groundY(x, z));
      const patch = 0.5 + 0.25 * Math.sin(x * 0.9 + 1.3) * Math.sin(z * 0.7) + 0.25 * Math.sin(x * 2.3 - z * 1.7);
      const lit = 0.6 + 0.5 * patch;
      const bank = THREE.MathUtils.smoothstep(Math.abs(x - riverX(z)) / riverWidth(z), 0.5, 1.0);
      // Wet dark earth at the water's edge, deep moss beyond, sunlit grass in patches.
      const moss = new THREE.Color().lerpColors(new THREE.Color(0x1f3a18), new THREE.Color(0x4c7a34), patch);
      const c = new THREE.Color().lerpColors(new THREE.Color(0x2e2618), moss, bank);
      gc[i * 3] = c.r * lit;
      gc[i * 3 + 1] = c.g * lit;
      gc[i * 3 + 2] = c.b * lit;
    }
    ground.setAttribute("color", new THREE.BufferAttribute(gc, 3));
    ground.computeVertexNormals();
    this.scene.add(
      new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })),
    );

    // The river: a ribbon following its course, just under the banks.
    const steps = 90;
    const water: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const z = 8 - (i / steps) * 78;
      const w = riverWidth(z) * 1.05;
      water.push(riverX(z) - w, -0.2, z, riverX(z) + w, -0.2, z);
      if (i < steps) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const river = new THREE.BufferGeometry();
    river.setAttribute("position", new THREE.Float32BufferAttribute(water, 3));
    river.setIndex(index);
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFog: { value: fog } },
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
    });
    this.scene.add(new THREE.Mesh(river, this.waterMat));

    // Trees: two great ones framing the view, and more going back into the mist.
    const trunks: THREE.BufferGeometry[] = [];
    const leaves: THREE.BufferGeometry[] = [];
    tree(-5.2, 0.5, 1.5, trunks, leaves);
    tree(5.6, -1.5, 1.4, trunks, leaves);
    for (let i = 0; i < 26; i++) {
      const z = -4 - i * 2.4 - rand() * 2;
      const side = i % 2 ? 1 : -1;
      const x = riverX(z) + side * (riverWidth(z) + between(2.5, 9));
      // Leave the castle's hill clear.
      if (Math.hypot(x - 4.5, z + 42) < 7) continue;
      tree(x, z, between(0.8, 1.3), trunks, leaves);
    }
    this.scene.add(
      new THREE.Mesh(mergeGeometries(trunks)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })),
      new THREE.Mesh(mergeGeometries(leaves)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })),
    );

    // Rocks along the banks, and the castle far away.
    const stones: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 18; i++) {
      const z = 3 - i * 3.2 - rand() * 2;
      const side = rand() < 0.5 ? -1 : 1;
      rock(riverX(z) + side * (riverWidth(z) + between(0.1, 1.2)), z, between(0.35, 0.8), stones);
    }
    castle(stones);
    this.scene.add(
      new THREE.Mesh(mergeGeometries(stones)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })),
    );

    // Crystals: tall spires near us, smaller clusters further along the banks.
    const shards: THREE.BufferGeometry[] = [];
    crystals(-4.4, -1.5, 1.15, 0, shards);
    crystals(4.8, -3.5, 1.0, 0.15, shards);
    crystals(-3.4, -9, 1.4, 0, shards);
    crystals(4.6, -13, 1.7, 0.1, shards);
    for (let i = 0; i < 14; i++) {
      const z = -3 - i * 3.6 - rand() * 2;
      const side = rand() < 0.5 ? -1 : 1;
      crystals(riverX(z) + side * (riverWidth(z) + between(0.3, 2.5)), z, between(0.5, 1.1), rand() < 0.25 ? 1 : 0, shards);
    }
    this.crystalMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFog: { value: fog } },
      vertexShader: CRYSTAL_VERTEX,
      fragmentShader: CRYSTAL_FRAGMENT,
    });
    // Glowing mushrooms and flowers along the banks.
    const small: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 46; i++) {
      const z = 5 - i * 1.3 - rand();
      const side = rand() < 0.5 ? -1 : 1;
      undergrowth(riverX(z) + side * (riverWidth(z) + between(0.2, 3)), z, shards, small);
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(shards)!, this.crystalMat));
    this.scene.add(
      new THREE.Mesh(mergeGeometries(small)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })),
    );
    // A soft halo of light round each big cluster.
    const halo = dotTexture();
    for (const [hx, hz, hs, hue] of [
      [-4.4, -1.5, 3.2, 0],
      [4.8, -3.5, 2.8, 0.15],
      [-3.4, -9, 3.6, 0],
      [4.6, -13, 4.2, 0.1],
    ]) {
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: halo,
          color: new THREE.Color().lerpColors(new THREE.Color(0x40ffd8), new THREE.Color(0xb090ff), hue),
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      glow.position.set(hx, groundY(hx, hz) + hs * 0.45, hz);
      glow.scale.setScalar(hs);
      this.scene.add(glow);
    }

    // Shafts of light falling through the leaves towards the glade.
    const shaftTex = shaftTexture();
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(between(1.2, 2.6), 26),
        new THREE.MeshBasicMaterial({
          map: shaftTex,
          color: 0xfff1c4,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      const z = -8 - i * 6;
      m.position.set(riverX(z) + between(-4, 4), 7, z);
      m.rotation.z = 0.42;
      m.userData.phase = rand() * 6;
      this.shafts.push(m);
      this.scene.add(m);
    }

    // Fireflies and floating motes of light over the river.
    const count = 160;
    const fp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const z = 4 - rand() * 50;
      fp[i * 3] = riverX(z) + between(-5, 5);
      fp[i * 3 + 1] = between(0.2, 3.5);
      fp[i * 3 + 2] = z;
    }
    this.flyBase = fp.slice();
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
    this.flies = new THREE.Points(
      fg,
      new THREE.PointsMaterial({
        map: dotTexture(),
        color: 0xd8ffb0,
        size: 0.22,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.scene.add(this.flies);
  }

  /** Fits the view to the frame: wide enough to show the framing trees on a phone too. */
  resize(aspect: number) {
    this.camera.aspect = aspect;
    const across = THREE.MathUtils.degToRad(72);
    const fov = 2 * Math.atan(Math.tan(across / 2) / aspect);
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(fov), 50, 95);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, tilt: THREE.Vector2) {
    this.time += dt;
    const t = this.time;
    this.waterMat.uniforms.uTime.value = t;
    this.crystalMat.uniforms.uTime.value = t;
    // A slow drift, and a little parallax with the pointer.
    this.camera.position.set(0.4 * Math.sin(t * 0.05) + tilt.x * 0.6, 2.2 + tilt.y * 0.3, 7.5);
    this.camera.lookAt(riverX(-30) * 0.4, 2.0, -30);
    for (const s of this.shafts)
      (s.material as THREE.MeshBasicMaterial).opacity = 0.11 + 0.06 * Math.sin(t * 0.4 + s.userData.phase);
    const pos = this.flies.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const b = i * 3;
      pos.setXYZ(
        i,
        this.flyBase[b] + 0.4 * Math.sin(t * 0.3 + i),
        this.flyBase[b + 1] + 0.3 * Math.sin(t * 0.5 + i * 1.7),
        this.flyBase[b + 2] + 0.3 * Math.cos(t * 0.25 + i * 0.7),
      );
    }
    pos.needsUpdate = true;
  }
}
