// Gem Surge's languages: every pack says everything the game shows, with the
// same placeholders, and a language only ever gets its own text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import game from "../game.json" with { type: "json" };
import { LANGUAGES, PACKS, translate } from "../src/i18n";
import { COLOR_NAMES, WORLDS } from "../src/levels";
import { STORY, TITLES } from "../src/rounds";

const zh = PACKS["zh-CN"];
const holes = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
/** A Chinese character, which no other language's text should contain. */
const HAN = /[一-鿿]/;

test("there is a pack for every language but English, and game.json lists them all", () => {
  const files = readdirSync(new URL("../src/locales/", import.meta.url))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  assert.deepEqual(Object.keys(PACKS).sort(), files);
  assert.deepEqual([...LANGUAGES].sort(), ["en", ...files].sort());
  assert.deepEqual([...game.languages].sort(), [...LANGUAGES].sort());
  assert.equal(game.languages[0], "en");
  assert.deepEqual(LANGUAGES, ["en", "zh-CN", "es", "pt-BR", "id", "ja", "ko"]);
});

test("game.json has a title and description in every language it lists", () => {
  // dingn's field for Chinese text is "zh"; the others are the language codes.
  const title = game.title as Record<string, string>;
  const description = game.description as Record<string, string>;
  for (const locale of game.languages) {
    const field = locale === "zh-CN" ? "zh" : locale;
    assert.ok(title[field]?.trim(), `title.${field}`);
    assert.ok(description[field]?.trim(), `description.${field}`);
    assert.ok(title[field].length <= 80, `title.${field} is too long`);
    assert.ok(description[field].length <= 300, `description.${field} is too long`);
  }
  for (const field of Object.keys(description)) {
    assert.ok(game.languages.includes(field === "zh" ? "zh-CN" : field), `description.${field} has no language`);
  }
});

test("every pack has exactly the Chinese pack's keys, each with the same placeholders", () => {
  const keys = Object.keys(zh).sort();
  for (const [locale, pack] of Object.entries(PACKS)) {
    assert.deepEqual(Object.keys(pack).sort(), keys, locale);
    for (const [en, text] of Object.entries(pack)) {
      assert.ok(text.trim(), `${locale}: "${en}" is empty`);
      assert.equal(holes(text), holes(en), `${locale}: "${en}"`);
      if (locale !== "zh-CN" && locale !== "ja") assert.ok(!HAN.test(text), `${locale}: "${en}" has Chinese in it`);
    }
  }
});

test("every string the game shows is in every pack", () => {
  const shown = new Set<string>([...COLOR_NAMES, ...WORLDS.map((w) => w.name), ...TITLES, ...STORY]);
  // The literal text passed to t(), and the words on the scene's banners.
  for (const file of ["../src/game.tsx", "../src/gem-scene.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const m of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)+)"/g)) shown.add(m[1]);
    for (const m of source.matchAll(/\.banner\(\s*"((?:[^"\\]|\\.)+)"/g)) shown.add(m[1]);
    for (const m of source.matchAll(/\bnote = "((?:[^"\\]|\\.)+)"/g)) shown.add(m[1]);
    for (const m of source.matchAll(/\bsetShopNote\(\s*"((?:[^"\\]|\\.)+)"/g)) shown.add(m[1]);
    for (const m of source.matchAll(/\b(?:name|what): "((?:[^"\\]|\\.)+)"/g)) shown.add(m[1]);
  }
  const words = readFileSync(new URL("../src/gem-scene.ts", import.meta.url), "utf8").match(/CHAIN_WORDS = \[([^\]]*)\]/)![1];
  for (const m of words.matchAll(/"([^"\n,]+)"/g)) shown.add(m[1]);
  assert.ok(shown.size > 150, `only ${shown.size} strings found`);
  for (const text of shown)
    for (const [locale, pack] of Object.entries(PACKS))
      assert.ok(Object.hasOwn(pack, text), `no ${locale} for "${text}"`);
});

test("translate gives each language its own text, and English for English and unknown languages", () => {
  assert.equal(translate("Play", "en"), "Play");
  assert.equal(translate("Play", "zh-CN"), "开始");
  assert.equal(translate("Play", "es"), "Jugar");
  assert.equal(translate("Play", "pt-BR"), "Jogar");
  assert.equal(translate("Play", "id"), "Main");
  assert.equal(translate("Play", "ja"), "プレイ");
  assert.equal(translate("Play", "ko"), "플레이");
  // Patterns carry numbers and names.
  assert.equal(translate("Level 12", "es"), "Nivel 12");
  assert.equal(translate("Level 12", "ja"), "レベル 12");
  assert.equal(translate("Tier 2 of 5", "ko"), "5단계 중 2단계");
  assert.equal(translate("The score to beat is 900. 15 more to beat it.", "pt-BR"), "A pontuação a bater é 900. Faltam 15 para bater.");
  assert.equal(translate(`Collect ${translate("Ruby", "ja")}`, "ja"), "ルビーを集める");
  assert.equal(translate("Take on level 28 in Gem Surge. Can you beat the score?", "es"), "Atrévete con el nivel 28 de Gem Surge. ¿Puedes superar la puntuación?");
  // A language dingn adds later, or a missing string, stays in English.
  for (const locale of ["en", "fr", "de", "zh-TW", ""]) {
    assert.equal(translate("Play", locale), "Play", locale);
    assert.equal(translate("Level 7", locale), "Level 7", locale);
  }
  assert.equal(translate("Not a string the game has", "es"), "Not a string the game has");
});

test("no language but Chinese is ever given Chinese text", () => {
  for (const locale of ["en", "es", "pt-BR", "id", "ko", "fr", "xx"])
    for (const en of Object.keys(zh)) {
      const text = en.replace(/\{\d+\}/g, "7");
      assert.ok(!HAN.test(translate(text, locale)), `${locale}: "${en}"`);
    }
  // Japanese writes kanji, so check it gets its own text, not the Chinese.
  for (const en of Object.keys(zh)) {
    if (zh[en] === PACKS.ja[en]) continue;
    assert.notEqual(translate(en, "ja"), zh[en], `ja: "${en}"`);
  }
});
