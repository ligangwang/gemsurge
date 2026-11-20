/**
 * The Crystal Forest: the scene behind the first world's board. A real
 * photograph of a mossy forest with a stream, taken all the way round (a
 * Poly Haven panorama, CC0), surrounds the camera; in front of it, made in
 * code, glowing crystals and mushrooms stand on the forest floor, light falls
 * in soft shafts and fireflies drift. It has its own camera and is drawn
 * before the board.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** The panorama, served with the game (see public/scenes/CREDITS.md). */
const PHOTO = "./scenes/mossy-forest.jpg";
/**
 * Which way the camera looks into the photo, in radians round the panorama:
 * down the mossy path, between the boulders, into the bright trees.
 */
const VIEW_YAW = Math.PI;
/** The forest floor, below the camera (the photo was taken from about this height). */
const FLOOR = -1.6;

// A fixed sequence of random numbers, so the crystals grow the same each time.
let seed = 20261120;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const between = (a: number, b: number) => a + (b - a) * rand();

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

export class CrystalForest {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  private time = 0;
  private crystalMat: THREE.ShaderMaterial;
  private shafts: THREE.Mesh[] = [];
  private flies: THREE.Points;
  private flyBase: Float32Array;

  constructor() {
    // The photograph, all the way round. Until it loads, a deep forest green.
    this.scene.background = new THREE.Color(0x1c2a1a);
    const photo = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, toneMapped: false });
    new THREE.TextureLoader().load(PHOTO, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      photo.map = tex;
      photo.needsUpdate = true;
    });
    // A touch darker than the photo, so the board's stones stand out on it.
    photo.color.setScalar(0.82);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(80, 64, 32), photo);
    sphere.rotation.y = VIEW_YAW;
    this.scene.add(sphere);

    // A few crystal clusters growing among the rocks and ferns at the sides,
    // sized like real stones in the photo, and a scatter further off.
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
    this.crystalMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: CRYSTAL_VERTEX,
      fragmentShader: CRYSTAL_FRAGMENT,
    });
    this.scene.add(new THREE.Mesh(mergeGeometries(shards)!, this.crystalMat));

    // A soft halo of light round each big cluster.
    const halo = dotTexture();
    for (const [hx, hz, hs, hue] of [
      [-4.2, -7.5, 2.2, 0],
      [4.6, -8.5, 2.0, 0.15],
      [-6.5, -12, 2.6, 0],
      [6.2, -13, 2.4, 1],
    ]) {
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: halo,
          color: new THREE.Color().lerpColors(new THREE.Color(0x40ffd8), new THREE.Color(0xb090ff), hue),
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.position.set(hx, FLOOR + hs * 0.4, hz);
      glow.scale.setScalar(hs);
      this.scene.add(glow);
    }

    // Shafts of light falling through the leaves.
    const shaftTex = shaftTexture();
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
      this.shafts.push(m);
      this.scene.add(m);
    }

    // Fireflies and floating motes of light.
    const count = 70;
    const fp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      fp[i * 3] = between(-8, 8);
      fp[i * 3 + 1] = between(FLOOR + 0.2, 2.5);
      fp[i * 3 + 2] = between(-3, -18);
    }
    this.flyBase = fp.slice();
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
    this.flies = new THREE.Points(
      fg,
      new THREE.PointsMaterial({
        map: dotTexture(),
        color: 0xd8ffb0,
        size: 0.12,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(this.flies);
  }

  /** Fits the view to the frame: wide enough to show the crystals on a phone too. */
  resize(aspect: number) {
    this.camera.aspect = aspect;
    const across = THREE.MathUtils.degToRad(80);
    const fov = 2 * Math.atan(Math.tan(across / 2) / aspect);
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(fov), 55, 100);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, tilt: THREE.Vector2) {
    this.time += dt;
    const t = this.time;
    this.crystalMat.uniforms.uTime.value = t;
    // Stand still and look gently about: a slow sway, and a little with the pointer.
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(-0.08 + tilt.y * 0.03, 0.04 * Math.sin(t * 0.05) - tilt.x * 0.05, 0, "YXZ");
    for (const s of this.shafts)
      (s.material as THREE.MeshBasicMaterial).opacity = 0.06 + 0.035 * Math.sin(t * 0.4 + s.userData.phase);
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
