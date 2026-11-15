// Sound effects, synthesised with Web Audio so the game ships no audio files.
// Pops climb in pitch as a chain grows; blasters zap, bombs thump and prisms
// ring. Each world has its own looping tune, sequenced from the code below.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let musicNodes: { stop(): void } | null = null;
let musicWorld = -1;

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
  if (value) {
    musicNodes?.stop();
    musicNodes = null;
    musicWorld = -1;
  }
}
export const isMuted = () => muted;

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

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

type Song = {
  bpm: number;
  /** Per bar: the bass root and three chord tones (MIDI numbers). */
  chords: [number, number[]][];
  /** Per bar: eight eighth notes of melody, 0 for silence. A note lasts until the next one. */
  melody: number[][];
  /** Drum hits on the sixteen sixteenths of a bar. */
  kick: number[];
  snare: number[];
  hat: number[];
  /** How the chord is arpeggiated: chord-tone index per eighth, -1 for none. */
  arp: number[];
  lead: OscillatorType;
};

/** One tune per world: bright synth-pop, a slow sea song, and a spacey half-time groove. */
const SONGS: Song[] = [
  {
    bpm: 112,
    chords: [
      [45, [69, 72, 76]],
      [41, [69, 72, 77]],
      [48, [67, 72, 76]],
      [43, [67, 71, 74]],
    ],
    melody: [
      [76, 0, 74, 72, 74, 0, 69, 0],
      [72, 0, 72, 74, 76, 0, 72, 0],
      [79, 0, 76, 0, 74, 72, 74, 0],
      [74, 0, 71, 0, 67, 0, 0, 0],
    ],
    kick: [0, 8, 10],
    snare: [4, 12],
    hat: [2, 6, 10, 14],
    arp: [0, 1, 2, 1, 0, 1, 2, 1],
    lead: "square",
  },
  {
    bpm: 84,
    chords: [
      [50, [62, 66, 69]],
      [47, [59, 62, 66]],
      [43, [59, 62, 67]],
      [45, [61, 64, 69]],
    ],
    melody: [
      [78, 0, 0, 76, 74, 0, 0, 0],
      [73, 0, 74, 0, 71, 0, 0, 0],
      [71, 0, 74, 0, 79, 0, 78, 0],
      [76, 0, 0, 0, 73, 0, 0, 0],
    ],
    kick: [0, 10],
    snare: [],
    hat: [4, 12],
    arp: [0, -1, 1, -1, 2, -1, 1, -1],
    lead: "sine",
  },
  {
    bpm: 96,
    chords: [
      [40, [64, 67, 71]],
      [36, [64, 67, 72]],
      [38, [62, 66, 69]],
      [35, [62, 66, 71]],
    ],
    melody: [
      [71, 0, 0, 74, 76, 0, 74, 0],
      [72, 0, 71, 0, 67, 0, 0, 0],
      [69, 0, 71, 0, 74, 0, 78, 0],
      [76, 0, 74, 0, 71, 0, 0, 0],
    ],
    kick: [0, 7, 10],
    snare: [8],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    arp: [0, 2, 1, 2, 0, 2, 1, 2],
    lead: "triangle",
  },
];

let noiseBuffer: AudioBuffer | null = null;
function noiseSource(a: AudioContext) {
  if (!noiseBuffer) {
    noiseBuffer = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  return src;
}

/** A plucked or held note into `dest` at time `t`, with a soft attack and release. */
function voice(
  a: AudioContext,
  dest: AudioNode,
  freq: number,
  t: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  cutoff = 4000,
) {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(gain * 0.6, t + Math.min(0.15, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(filter).connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function kick(a: AudioContext, dest: AudioNode, t: number) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 0.35);
}

function hit(a: AudioContext, dest: AudioNode, t: number, dur: number, gain: number, type: BiquadFilterType, freq: number) {
  const src = noiseSource(a);
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

/** Schedules one sixteenth of a song. Every fourth pass through the tune leaves the melody out. */
function playStep(a: AudioContext, dest: AudioNode, song: Song, step: number, t: number) {
  const sixteenth = 60 / song.bpm / 4;
  const bar = Math.floor(step / 16) % song.chords.length;
  const pass = Math.floor(step / (16 * song.chords.length));
  const inBar = step % 16;
  const [root, tones] = song.chords[bar];

  if (song.kick.includes(inBar)) kick(a, dest, t);
  if (song.snare.includes(inBar)) hit(a, dest, t, 0.18, 0.18, "bandpass", 1800);
  if (song.hat.includes(inBar)) hit(a, dest, t, 0.05, 0.08, "highpass", 8000);

  if (inBar === 0) {
    // A soft pad holds the chord for the whole bar.
    for (const n of tones) voice(a, dest, midi(n - 12), t, sixteenth * 16, "triangle", 0.035, 1200);
  }
  if (inBar === 0 || inBar === 6 || inBar === 10) {
    voice(a, dest, midi(root), t, sixteenth * (inBar === 0 ? 5 : 3.5), "triangle", 0.22, 600);
  }
  if (inBar % 2 === 0) {
    const eighth = inBar / 2;
    const tone = song.arp[eighth];
    if (tone >= 0) voice(a, dest, midi(tones[tone]), t, sixteenth * 2, "triangle", 0.045, 3000);
    if (pass % 4 !== 3) {
      const line = song.melody[bar];
      const n = line[eighth];
      if (n) {
        let len = 1;
        while (eighth + len < line.length && !line[eighth + len]) len++;
        voice(a, dest, midi(n), t, sixteenth * 2 * len * 0.9, song.lead, song.lead === "square" ? 0.05 : 0.09, 2400);
      }
    }
  }
}

/** Starts a world's looping tune (or stops the music with -1). */
export function music(world: number) {
  if (world === musicWorld) return;
  musicNodes?.stop();
  musicNodes = null;
  musicWorld = world;
  const a = world >= 0 ? audio() : null;
  if (!a || !master) return;
  const song = SONGS[world % SONGS.length];
  const out = a.createGain();
  out.gain.setValueAtTime(0.0001, a.currentTime);
  out.gain.exponentialRampToValueAtTime(0.45, a.currentTime + 1.5);
  out.connect(master);

  const sixteenth = 60 / song.bpm / 4;
  let step = 0;
  let nextTime = a.currentTime + 0.1;
  // Look a little ahead and schedule notes on the audio clock, so timers that
  // run late do not make the beat stumble.
  const tick = () => {
    if (nextTime < a.currentTime) nextTime = a.currentTime + 0.05;
    while (nextTime < a.currentTime + 0.2) {
      playStep(a, out, song, step++, nextTime);
      nextTime += sixteenth;
    }
  };
  tick();
  const timer = window.setInterval(tick, 50);
  musicNodes = {
    stop() {
      window.clearInterval(timer);
      const t = a.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      window.setTimeout(() => out.disconnect(), 1000);
    },
  };
}
