import { afterEach, expect, test, vi } from "vitest";
import { say, setMuted } from "../src/sound";

class Line {
  voice: unknown = null;
  lang = "";
  pitch = 1;
  rate = 1;
  volume = 1;
  constructor(public text: string) {}
}
const voices = [
  { name: "Daniel", lang: "en-GB" },
  { name: "Samantha", lang: "en-US" },
  { name: "Li-mu", lang: "zh-TW" },
  { name: "Ting-Ting", lang: "zh-CN" },
  { name: "Kyoko", lang: "ja-JP" },
  { name: "Paulina", lang: "es_MX" },
  { name: "Luciana", lang: "pt-BR" },
  { name: "Joana", lang: "pt-PT" },
];
function speech() {
  const speak = vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance", Line);
  vi.stubGlobal("speechSynthesis", { getVoices: () => voices, cancel: vi.fn(), speak });
  return speak;
}
afterEach(() => {
  vi.unstubAllGlobals();
  setMuted(false);
});

test("cheers are spoken in a bright, girlish voice in the player's language", () => {
  const speak = speech();
  say("Awesome!", "en");
  say("太棒了！", "zh-CN");
  const [en, zh] = speak.mock.calls.map((c) => c[0] as Line);
  expect(en).toMatchObject({ text: "Awesome", lang: "en-US", voice: voices[1] });
  expect(zh).toMatchObject({ text: "太棒了", lang: "zh-CN", voice: voices[3] });
  expect(en.pitch).toBeGreaterThan(1.5);
  expect(en.pitch).toBeLessThanOrEqual(2);
  expect(en.volume).toBe(1);
});

test("mute silences the voice, and a device without speech is fine", () => {
  const speak = speech();
  setMuted(true);
  say("Nice", "en");
  expect(speak).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  setMuted(false);
  expect(() => say("Nice", "en")).not.toThrow();
});

test("each language is spoken in its own voice, or in English where the device has none", () => {
  const speak = speech();
  say("¡Increíble!", "es", "Awesome!");
  say("Incrível!", "pt-BR", "Awesome!");
  say("最高！", "ja", "Awesome!");
  // No Korean or Indonesian voice on this device: the English words, in English.
  say("최고예요!", "ko", "Awesome!");
  say("Keren!", "id", "Awesome!");
  const [es, pt, ja, ko, id] = speak.mock.calls.map((c) => c[0] as Line);
  expect(es).toMatchObject({ text: "Increíble", lang: "es-ES", voice: voices[5] });
  expect(pt).toMatchObject({ text: "Incrível", lang: "pt-BR", voice: voices[6] });
  expect(ja).toMatchObject({ text: "最高", lang: "ja-JP", voice: voices[4] });
  expect(ko).toMatchObject({ text: "Awesome", lang: "en-US", voice: voices[1] });
  expect(id).toMatchObject({ text: "Awesome", lang: "en-US", voice: voices[1] });
});

test("before the device lists its voices, the line is still tagged with the player's language", () => {
  const speak = vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance", Line);
  vi.stubGlobal("speechSynthesis", { getVoices: () => [], cancel: vi.fn(), speak });
  say("최고예요!", "ko", "Awesome!");
  expect(speak.mock.calls[0][0]).toMatchObject({ text: "최고예요", lang: "ko-KR", voice: null });
});
