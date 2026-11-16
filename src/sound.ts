// Sound effects, synthesised with Web Audio so the game ships no audio files.
// Pops climb in pitch as a chain grows; blasters zap, bombs thump and prisms
// ring. Each world has its own calm ambient music, made up as it plays.

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

type Mood = {
  /** Seconds each chord is held. */
  hold: number;
  /** Chords as MIDI notes, lowest first; the first is the bass. */
  chords: number[][];
  /** The scale the bell notes are picked from (MIDI, one octave; other octaves follow). */
  scale: number[];
  /** How often a bell rings, as a chance per half second. */
  bells: number;
};

/**
 * Ambient music for each world: long, soft chords that melt into each other
 * and a few bell notes picked at random from a pentatonic scale, so it never
 * repeats a tune and never clashes.
 */
const MOODS: Mood[] = [
  // Neon City: warm, a little bright (C major pentatonic).
  {
    hold: 6,
    chords: [
      [48, 60, 64, 67, 71],
      [45, 57, 60, 64, 67],
      [41, 57, 60, 65, 69],
      [43, 59, 62, 67, 69],
    ],
    scale: [72, 74, 76, 79, 81],
    bells: 0.3,
  },
  // Deep Sea: slow and floating (D major pentatonic).
  {
    hold: 8,
    chords: [
      [38, 57, 62, 66, 69],
      [43, 59, 62, 66, 69],
      [47, 59, 62, 66, 73],
      [45, 57, 61, 64, 69],
    ],
    scale: [74, 76, 78, 81, 83],
    bells: 0.2,
  },
  // Outer Space: open and distant (E minor pentatonic).
  {
    hold: 8,
    chords: [
      [40, 59, 64, 67, 71],
      [36, 60, 64, 67, 71],
      [43, 59, 62, 67, 71],
      [38, 57, 62, 66, 69],
    ],
    scale: [76, 79, 81, 83, 86],
    bells: 0.16,
  },
];

/** A note that swells in and fades out slowly. */
function swell(a: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, gain: number, type: OscillatorType) {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = (Math.random() - 0.5) * 10;
  const g = a.createGain();
  const fade = dur * 0.4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + fade);
  g.gain.setValueAtTime(gain, t + dur - fade * 0.5);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + fade);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + fade + 0.1);
}

/** A soft bell: a sine with a quiet octave above it, ringing out. */
function bell(a: AudioContext, dest: AudioNode, freq: number, t: number, gain: number) {
  for (const [mult, level, ring] of [
    [1, 1, 2.4],
    [2, 0.25, 1.2],
  ]) {
    const osc = a.createOscillator();
    osc.frequency.value = freq * mult;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + ring + 0.1);
  }
}

/** Starts a world's ambient music (or stops the music with -1). */
export function music(world: number) {
  if (world === musicWorld) return;
  musicNodes?.stop();
  musicNodes = null;
  musicWorld = world;
  const a = world >= 0 ? audio() : null;
  if (!a || !master) return;
  const mood = MOODS[world % MOODS.length];
  const out = a.createGain();
  out.gain.setValueAtTime(0.0001, a.currentTime);
  out.gain.exponentialRampToValueAtTime(0.22, a.currentTime + 4);
  out.connect(master);

  // Chords go through a low-pass filter so they stay mellow.
  const pads = a.createBiquadFilter();
  pads.type = "lowpass";
  pads.frequency.value = 900;
  pads.connect(out);

  // Bells go through a quiet echo, which gives them some room.
  const bells = a.createGain();
  const echo = a.createDelay(1);
  echo.delayTime.value = 0.42;
  const feedback = a.createGain();
  feedback.gain.value = 0.35;
  const wet = a.createGain();
  wet.gain.value = 0.5;
  bells.connect(out);
  bells.connect(echo);
  echo.connect(feedback).connect(echo);
  echo.connect(wet).connect(out);

  let chord = 0;
  let nextChord = a.currentTime + 0.1;
  let nextBell = a.currentTime + 3;
  let step = Math.floor(mood.scale.length / 2);
  // Look a little ahead and schedule on the audio clock, so late timers do not matter.
  const tick = () => {
    const horizon = a.currentTime + 1;
    // After a long stall (a hidden tab, a paused debugger), skip what was
    // missed instead of playing it all at once.
    if (nextChord < a.currentTime - 0.5) nextChord = a.currentTime + 0.1;
    if (nextBell < a.currentTime) nextBell = a.currentTime + 0.5;
    while (nextChord < horizon) {
      const notes = mood.chords[chord++ % mood.chords.length];
      notes.forEach((n, i) => {
        if (i === 0) swell(a, pads, midi(n), nextChord, mood.hold, 0.2, "sine");
        else swell(a, pads, midi(n), nextChord, mood.hold, 0.07, i % 2 ? "triangle" : "sine");
      });
      nextChord += mood.hold;
    }
    while (nextBell < horizon) {
      if (Math.random() < mood.bells) {
        // Wander up and down the scale by a step or two, over two octaves.
        step = Math.min(mood.scale.length * 2 - 1, Math.max(0, step + Math.floor(Math.random() * 5) - 2));
        const n = mood.scale[step % mood.scale.length] + 12 * Math.floor(step / mood.scale.length) - 12;
        bell(a, bells, midi(n), nextBell, 0.07 + Math.random() * 0.05);
      }
      nextBell += 0.5;
    }
  };
  tick();
  const timer = window.setInterval(tick, 250);
  musicNodes = {
    stop() {
      window.clearInterval(timer);
      const t = a.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      window.setTimeout(() => out.disconnect(), 1500);
    },
  };
}
