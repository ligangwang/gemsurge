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
  if (value && typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
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

/** A short, bright burst of noise in one band: one crack of ice or a glint. */
function crack(dur: number, gain: number, freq: number, delay = 0) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.4;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

// A pentatonic scale, so rising chains always sound good.
const SCALE = [0, 2, 4, 7, 9];
const note = (step: number, base = 523.25) =>
  base * 2 ** ((Math.floor(step / 5) * 12 + SCALE[((step % 5) + 5) % 5]) / 12);

// --- A spoken word of encouragement, in a soft, higher voice.

// Voices that sound young and bright come first; any other woman's voice is next best.
const GIRL_VOICES = /xiaoyi|xiaoxiao|xiaomeng|xiaoshuang|ting-?ting|mei-?jia|sin-?ji|yaoyao|ana\b|jenny|aria|samantha|shelley|sandy|flo\b/i;
const SOFT_VOICES = /female|woman|girl|huihui|karen|victoria|zira|moira|tessa|google/i;

// Browsers load their voices late, so ask early: the first cheer then has them.
if (typeof speechSynthesis !== "undefined") {
  try {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());
  } catch {
    // No speech here.
  }
}

/** Says `text` aloud with the device's own speech, when it has one. */
export function say(text: string, locale: string) {
  if (muted || typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return;
  try {
    const lang = locale.startsWith("zh") ? "zh" : "en";
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
    const line = new SpeechSynthesisUtterance(text.replace(/[!！]/g, ""));
    line.voice =
      voices.find((v) => GIRL_VOICES.test(v.name)) ?? voices.find((v) => SOFT_VOICES.test(v.name)) ?? voices[0] ?? null;
    line.lang = lang === "zh" ? "zh-CN" : "en-US";
    // A bright, girlish voice: clearly higher than the default and a touch quicker.
    line.pitch = 1.8;
    line.rate = 1.1;
    line.volume = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(line);
  } catch {
    // No speech on this device: the banner still shows the word.
  }
}

/**
 * Pieces landing on a goal in quick succession climb in pitch, so a big
 * collection sounds like a rising cascade; a pause starts the run again.
 */
let lastLanding = -1;
let landings = 0;
function landingStep() {
  const a = audio();
  if (!a) return -1;
  const now = a.currentTime;
  // Pieces that land together sound once.
  if (now - lastLanding < 0.035) return -1;
  landings = now - lastLanding > 0.7 ? 0 : Math.min(landings + 1, 14);
  lastLanding = now;
  return landings;
}

export const sfx = {
  /**
   * A gem landing on its goal: a quick run of tiny bells, "sha-la-la", that
   * ends in a soft pop as it drops into the bag.
   */
  collect: () => {
    const step = landingStep();
    if (step < 0) return;
    for (let i = 0; i < 3; i++) {
      const f = note(step + i + 8);
      tone(f, { type: "sine", dur: 0.14, gain: 0.085, delay: i * 0.028 });
      tone(f * 2.01, { type: "sine", dur: 0.08, gain: 0.03, delay: i * 0.028 });
    }
    crack(0.06, 0.08, 9000, 0.02);
    tone(240, { type: "sine", dur: 0.1, gain: 0.12, to: 130, delay: 0.09 });
  },
  /** A chip of ice landing on its goal: a crunchy crackle with a glassy tinkle. */
  collectIce: () => {
    const step = landingStep();
    if (step < 0) return;
    for (let i = 0; i < 5; i++) crack(0.025, 0.18, 2500 + Math.random() * 4500, i * 0.014 + Math.random() * 0.008);
    tone(note(step + 12) * 2, { type: "triangle", dur: 0.09, gain: 0.05, delay: 0.05 });
    tone(note(step + 14) * 2, { type: "triangle", dur: 0.12, gain: 0.04, delay: 0.085 });
  },
  /** A goal is complete: a bright "ding-ding" with a sparkle. */
  goalDone: () => {
    tone(note(12), { type: "triangle", dur: 0.22, gain: 0.12, delay: 0.12 });
    tone(note(14), { type: "triangle", dur: 0.4, gain: 0.12, delay: 0.22 });
    tone(note(14) * 2, { type: "sine", dur: 0.3, gain: 0.03, delay: 0.22 });
    crack(0.3, 0.04, 10000, 0.22);
  },
  select: () => tone(880, { type: "triangle", dur: 0.06, gain: 0.06 }),
  swap: () => tone(420, { type: "triangle", dur: 0.1, gain: 0.07, to: 620 }),
  invalid: () => {
    tone(220, { type: "square", dur: 0.08, gain: 0.05 });
    tone(180, { type: "square", dur: 0.1, gain: 0.05, delay: 0.08 });
  },
  /** A match pop, higher with each link of the chain. */
  pop: (chain: number, gems = 3) => {
    const f = note(chain - 1);
    tone(f, { type: "sine", dur: 0.25, gain: 0.16 });
    tone(f * 2, { type: "triangle", dur: 0.12, gain: 0.05 });
    // Each gem past the third adds a note, running up the scale.
    for (let i = 1; i <= Math.min(gems - 3, 6); i++) {
      tone(note(chain - 1 + i), { type: "sine", dur: 0.2, gain: 0.1, delay: i * 0.045 });
    }
  },
  /** The thump under a big clear; `power` runs from 0.3 to 2. */
  boom: (power: number) => {
    tone(110 + 30 * power, { type: "sine", dur: 0.3 + 0.25 * power, gain: Math.min(0.5, 0.14 + 0.2 * power), to: 38 });
    noise(0.25 + 0.3 * power, Math.min(0.55, 0.1 + 0.22 * power), 1400 + 2200 * power);
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
  /** A rising fanfare for finishing a round. */
  fanfare: () => {
    [0, 4, 7, 12, 7, 12, 16, 19, 24].forEach((step, i) =>
      tone(392 * 2 ** (step / 12), { type: "triangle", dur: i === 8 ? 1.1 : 0.32, gain: 0.11, delay: i * 0.13 }),
    );
    [0, 7, 12].forEach((step) => tone(196 * 2 ** (step / 12), { type: "sine", dur: 1.6, gain: 0.08, delay: 1.04 }));
    noise(0.5, 0.07, 9000, 1.04);
  },
  star: (n: number) => tone(note(5 + n * 2), { type: "triangle", dur: 0.3, gain: 0.1 }),
};
