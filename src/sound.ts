// Sound effects, synthesised with Web Audio so the game ships no audio files.
// Pops climb in pitch as a chain grows; blasters zap, bombs thump and prisms
// ring.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function audio() {
  if (muted) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function setMuted(value: boolean) {
  muted = value;
}

function tone(
  freq: number,
  {
    type = "sine" as OscillatorType,
    dur = 0.2,
    gain = 0.2,
    to = 0,
    delay = 0,
    attack = 0.005,
  } = {},
) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(dur: number, gain: number, freq: number, delay = 0) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(80, t + dur);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

// A pentatonic scale, so rising chains always sound good.
const SCALE = [0, 2, 4, 7, 9];
const note = (step: number, base = 523.25) =>
  base * 2 ** ((Math.floor(step / 5) * 12 + SCALE[((step % 5) + 5) % 5]) / 12);

export const sfx = {
  select: () => tone(880, { type: "triangle", dur: 0.06, gain: 0.06 }),
  swap: () => tone(420, { type: "triangle", dur: 0.1, gain: 0.07, to: 620 }),
  invalid: () => {
    tone(220, { type: "square", dur: 0.08, gain: 0.05 });
    tone(180, { type: "square", dur: 0.1, gain: 0.05, delay: 0.08 });
  },
  /** A match pop, higher with each link of the chain. */
  pop: (chain: number) => {
    const f = note(chain - 1);
    tone(f, { type: "sine", dur: 0.25, gain: 0.16 });
    tone(f * 2, { type: "triangle", dur: 0.12, gain: 0.05 });
  },
  laser: () => {
    tone(1600, { type: "sawtooth", dur: 0.35, gain: 0.06, to: 200 });
    noise(0.25, 0.15, 6000);
  },
  bomb: () => {
    tone(140, { type: "sine", dur: 0.5, gain: 0.4, to: 40 });
    noise(0.5, 0.5, 1800);
  },
  prism: () => {
    for (let i = 0; i < 6; i++) tone(note(i + 5), { type: "triangle", dur: 0.3, gain: 0.07, delay: i * 0.04 });
    noise(0.4, 0.08, 9000);
  },
  wipe: () => {
    tone(80, { type: "sine", dur: 1.4, gain: 0.5, to: 30 });
    noise(1.2, 0.6, 4000);
    for (let i = 0; i < 10; i++) tone(note(i + 3), { type: "triangle", dur: 0.5, gain: 0.06, delay: i * 0.05 });
  },
  made: () => {
    tone(note(7), { type: "triangle", dur: 0.2, gain: 0.08 });
    tone(note(9), { type: "triangle", dur: 0.25, gain: 0.08, delay: 0.07 });
  },
  ice: () => noise(0.12, 0.12, 7000),
  fever: () => {
    [0, 4, 7, 12].forEach((s, i) => tone(330 * 2 ** (s / 12), { type: "sawtooth", dur: 0.6, gain: 0.05, delay: i * 0.06 }));
  },
  win: () => {
    [0, 4, 7, 12, 16].forEach((s, i) => tone(523 * 2 ** (s / 12), { type: "triangle", dur: 0.5, gain: 0.1, delay: i * 0.09 }));
  },
  lose: () => {
    [7, 4, 0].forEach((s, i) => tone(330 * 2 ** (s / 12), { type: "triangle", dur: 0.45, gain: 0.08, delay: i * 0.14 }));
  },
  star: (n: number) => tone(note(5 + n * 2), { type: "triangle", dur: 0.3, gain: 0.1 }),
};
