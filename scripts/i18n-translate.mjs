#!/usr/bin/env node
// Traduit un catalogue Lingui (PO) vers le français via l'endpoint LLM
// OpenAI-compatible configuré par l'utilisateur. Aucune dépendance : le
// format PO de Lingui est parsé/réécrit localement.
import { readFileSync, writeFileSync } from "node:fs";

const ESCAPES = {
  "\\": "\\\\",
  '"': String.raw`\"`,
  "\n": String.raw`\n`,
  "\r": String.raw`\r`,
  "\t": String.raw`\t`,
};
const UNESCAPES = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };

export const SYSTEM_PROMPT = `Tu traduis en français des chaînes d'interface logicielle.
Règles :
- Traduis uniquement le texte ; conserve les variables {0} {1} {title}, le balisage et la ponctuation.
- Utilise le vouvoiement, un ton sobre et professionnel.
- Réponds STRICTEMENT par un tableau JSON de traductions, même longueur et même ordre que l'entrée, sans texte autour.`;

export const GLOSSARY = {
  note: "note",
  "compte rendu": "compte rendu",
  template: "modèle",
  meeting: "réunion",
  transcript: "transcript",
};

export function encodePoString(value) {
  return value.replace(/[\\"\n\r\t]/g, (char) => ESCAPES[char]);
}

function decodeQuoted(line) {
  const match = line.match(/"((?:[^"\\]|\\.)*)"/);
  if (!match) return "";
  return match[1].replace(/\\(.)/g, (_, char) => UNESCAPES[char] ?? char);
}

/** Rassemble une ligne `msgid`/`msgstr` et ses lignes de continuation `"...". */
function collectQuotedParts(lines, start) {
  const parts = [decodeQuoted(lines[start])];
  let next = start + 1;
  while (next < lines.length && lines[next].startsWith('"')) {
    parts.push(decodeQuoted(lines[next]));
    next += 1;
  }
  return { parts, next };
}

/** Parse une entrée `msgid` (avec son `msgstr` optionnel) à partir de `start`. */
function parseEntry(lines, start) {
  const idParts = collectQuotedParts(lines, start);
  let msgstrStart = -1;
  let msgstrEnd = -1;
  let msgstr = "";
  if (
    idParts.next < lines.length &&
    lines[idParts.next].startsWith("msgstr ")
  ) {
    msgstrStart = idParts.next;
    const strParts = collectQuotedParts(lines, idParts.next);
    msgstr = strParts.parts.join("");
    msgstrEnd = strParts.next;
  }
  return {
    entry: {
      msgid: idParts.parts.join(""),
      msgstr,
      msgstrStart,
      msgstrEnd,
    },
    next: msgstrEnd < 0 ? idParts.next : msgstrEnd,
  };
}

/** Parse un PO en conservant les bornes de chaque `msgstr` pour réécriture ciblée. */
export function parsePo(text) {
  const lines = text.split("\n");
  const entries = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("msgid ")) {
      i += 1;
      continue;
    }
    const parsed = parseEntry(lines, i);
    entries.push(parsed.entry);
    i = parsed.next;
  }
  return { lines, entries };
}

export function renderMsgstr(value) {
  if (!value.includes("\n")) {
    return [`msgstr "${encodePoString(value)}"`];
  }
  const segments = value.split("\n");
  const out = ['msgstr ""'];
  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    out.push(`"${encodePoString(segment)}${isLast ? "" : String.raw`\n`}"`);
  });
  return out;
}

/** Réécrit le PO en remplaçant uniquement les `msgstr` fournis. */
export function applyTranslations(text, translations) {
  const { entries, lines } = parsePo(text);
  const out = [];
  let cursor = 0;
  for (const entry of entries) {
    if (entry.msgstrStart < 0 || !(entry.msgid in translations)) continue;
    out.push(
      ...lines.slice(cursor, entry.msgstrStart),
      ...renderMsgstr(translations[entry.msgid]),
    );
    cursor = entry.msgstrEnd;
  }
  out.push(...lines.slice(cursor));
  return out.join("\n");
}

export function buildTranslationPrompt(strings, glossary = GLOSSARY) {
  return `${SYSTEM_PROMPT}\n\nGlossaire imposé : ${JSON.stringify(glossary)}\n\nChaînes à traduire (tableau JSON) : ${JSON.stringify(strings)}`;
}

function extractJsonArray(raw) {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start < 0 || end < 0) {
      throw new Error("réponse sans tableau JSON");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

export function parseTranslations(raw, expected) {
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) {
    throw new TypeError("la réponse n'est pas un tableau JSON");
  }
  if (parsed.length !== expected) {
    throw new Error(`attendu ${expected} traductions, reçu ${parsed.length}`);
  }
  return parsed.map((value, index) => {
    if (typeof value !== "string") {
      throw new TypeError(`traduction non textuelle à l'index ${index}`);
    }
    return value;
  });
}

export async function translateBatch(strings, options) {
  const { baseUrl, apiKey, model, glossary, timeoutMs = 120000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 4000,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: buildTranslationPrompt(strings, glossary),
            },
          ],
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`endpoint LLM ${response.status}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new TypeError("réponse LLM sans contenu");
    }
    return parseTranslations(content, strings.length);
  } finally {
    clearTimeout(timer);
  }
}

function sourceTextFor(entry) {
  return entry.msgstr.trim() === "" ? entry.msgid : entry.msgstr;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exécute le client sur un batch, avec un nombre maximal de `retries`
 * nouvelles tentatives et une attente croissante. Retourne `null` quand
 * toutes les tentatives ont échoué.
 */
async function attemptBatch(client, strings, retries, attempt) {
  try {
    return await client(strings);
  } catch {
    // Erreur volontairement ignorée ici : la tentative est répétée avec une
    // attente croissante, et si toutes échouent l'appelant collecte les
    // msgids du batch dans `failures` et les remonte à l'utilisateur.
    if (attempt >= retries) return null;
    await delay(2000 * (attempt + 1));
    return attemptBatch(client, strings, retries, attempt + 1);
  }
}

export async function translatePo({
  sourcePo,
  targetPo,
  client,
  batchSize = 20,
  glossary = GLOSSARY,
  retries = 2,
  onProgress = () => {},
}) {
  const source = parsePo(sourcePo);
  const target = parsePo(targetPo);
  const sourceById = new Map(source.entries.map((e) => [e.msgid, e]));

  const pending = target.entries.filter(
    (entry) => entry.msgid !== "" && entry.msgstr.trim() === "",
  );
  const translations = {};
  let translated = 0;
  const failures = [];

  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    const strings = batch.map((entry) =>
      sourceTextFor(sourceById.get(entry.msgid) ?? entry),
    );
    const results = await attemptBatch(client, strings, retries, 0);
    if (results) {
      batch.forEach((entry, index) => {
        translations[entry.msgid] = results[index];
        translated += 1;
      });
    } else {
      failures.push(...batch.map((entry) => entry.msgid));
    }
    onProgress(translated, pending.length, failures.length);
  }

  return {
    po: applyTranslations(targetPo, translations),
    translated,
    skipped: pending.length - translated,
    failures,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const sourcePath = opt(
    "--source",
    "apps/desktop/src/i18n/locales/en/messages.po",
  );
  const targetPath = opt(
    "--target",
    "apps/desktop/src/i18n/locales/fr/messages.po",
  );
  const batchSize = Number(opt("--batch-size", "20"));
  const baseUrl = process.env.SYNTHEO_I18N_BASE_URL;
  const apiKey = process.env.SYNTHEO_I18N_API_KEY;
  const model = process.env.SYNTHEO_I18N_MODEL;
  if (!baseUrl || !model) {
    throw new Error("SYNTHEO_I18N_BASE_URL et SYNTHEO_I18N_MODEL sont requis");
  }

  const result = await translatePo({
    sourcePo: readFileSync(sourcePath, "utf8"),
    targetPo: readFileSync(targetPath, "utf8"),
    batchSize,
    onProgress: (done, total, failed) =>
      console.error(`progression : ${done}/${total} (échecs ${failed})`),
    client: (strings) => translateBatch(strings, { baseUrl, apiKey, model }),
  });

  if (args.includes("--dry-run")) {
    console.log(`[dry-run] ${result.translated} chaînes à traduire`);
    return;
  }
  writeFileSync(targetPath, result.po);
  console.log(
    `Traduit ${result.translated} chaînes vers ${targetPath} (échecs ${result.failures.length})`,
  );
  if (result.failures.length > 0) {
    console.error(
      `msgids non traduits : ${result.failures.slice(0, 10).join(", ")}…`,
    );
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
