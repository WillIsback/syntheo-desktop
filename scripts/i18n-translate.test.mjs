import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTranslations,
  buildTranslationPrompt,
  parseTranslations,
  renderMsgstr,
  translatePo,
} from "./i18n-translate.mjs";

test("construit un prompt avec glossaire et tableau JSON attendu", () => {
  const prompt = buildTranslationPrompt(["Hello"], { note: "note" });
  assert.match(prompt, /français/i);
  assert.match(prompt, /note/);
  assert.match(prompt, /tableau JSON/);
});

test("parse un tableau JSON de traductions", () => {
  assert.deepEqual(parseTranslations('["Bonjour","Au revoir"]', 2), [
    "Bonjour",
    "Au revoir",
  ]);
});

test("tolère un bloc de code markdown", () => {
  assert.deepEqual(parseTranslations('```json\n["Bonjour"]\n```', 1), [
    "Bonjour",
  ]);
});

test("rejette un tableau de mauvaise longueur", () => {
  assert.throws(() => parseTranslations('["Bonjour"]', 2));
});

test("réécrit uniquement les msgstr fournis", () => {
  const po = [
    'msgid ""',
    'msgstr ""',
    '"Language: fr\\n"',
    "",
    "#: a.ts",
    'msgid "Hello"',
    'msgstr ""',
    "",
    "#: b.ts",
    'msgid "Bye"',
    'msgstr "Salut"',
    "",
  ].join("\n");
  const out = applyTranslations(po, { Hello: "Bonjour" });
  assert.match(out, /msgid "Hello"\nmsgstr "Bonjour"/);
  assert.match(out, /msgid "Bye"\nmsgstr "Salut"/);
});

test("gère les msgstr multi-lignes", () => {
  assert.deepEqual(renderMsgstr("a\nb"), ['msgstr ""', '"a\\n"', '"b"']);
});

test("translatePo traduit les entrées vides via le client", async () => {
  const sourcePo = [
    'msgid ""',
    'msgstr ""',
    "",
    'msgid "Hello"',
    'msgstr "Hello"',
    "",
  ].join("\n");
  const targetPo = [
    'msgid ""',
    'msgstr ""',
    "",
    'msgid "Hello"',
    'msgstr ""',
    "",
  ].join("\n");
  const result = await translatePo({
    sourcePo,
    targetPo,
    client: async (strings) => strings.map((value) => `FR:${value}`),
  });
  assert.equal(result.translated, 1);
  assert.match(result.po, /msgstr "FR:Hello"/);
});

test("translatePo réessaie puis signale les échecs", async () => {
  const sourcePo = ['msgid "Hello"', 'msgstr "Hello"', ""].join("\n");
  const targetPo = ['msgid "Hello"', 'msgstr ""', ""].join("\n");
  let calls = 0;
  const result = await translatePo({
    sourcePo,
    targetPo,
    retries: 1,
    client: async () => {
      calls += 1;
      throw new Error("boom");
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.translated, 0);
  assert.deepEqual(result.failures, ["Hello"]);
});
