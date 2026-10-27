import assert from "node:assert/strict";
import test from "node:test";

import { rebrandText } from "./rebrand.mjs";

test("renomme le produit, les identifiants et les scopes", () => {
  assert.equal(rebrandText("Anarlog Desktop"), "Syntheo Desktop");
  assert.equal(rebrandText("ANARLOG_DB_PATH"), "SYNTHEO_DB_PATH");
  assert.equal(rebrandText("anarlog-cli"), "syntheo-cli");
  assert.equal(rebrandText("@anlg/desktop"), "@syntheo/desktop");
  assert.equal(rebrandText("@anlg/plugin-tray"), "@syntheo/plugin-tray");
  assert.equal(
    rebrandText("tauri-plugin-anlg-tray"),
    "tauri-plugin-syntheo-tray",
  );
  assert.equal(rebrandText("anlg-http-utils"), "syntheo-http-utils");
  assert.equal(rebrandText("AnarlogMark"), "SyntheoMark");
  assert.equal(rebrandText("anarlog-mark"), "syntheo-mark");
  assert.equal(rebrandText('"anlg-tray"'), '"syntheo-tray"');
});

test("renomme les identifiants hyprnote hérités", () => {
  assert.equal(rebrandText("com.hyprnote.stable"), "com.syntheo.stable");
  assert.equal(rebrandText("hyprnote://share/open"), "syntheo://share/open");
});

test("protège les hôtes et le dépôt Fastrepl", () => {
  assert.equal(
    rebrandText("https://anarlog.so/changelog"),
    "https://anarlog.so/changelog",
  );
  assert.equal(rebrandText("https://anarlog.dev"), "https://anarlog.dev");
  assert.equal(
    rebrandText("https://github.com/fastrepl/anarlog.git"),
    "https://github.com/fastrepl/anarlog.git",
  );
});

test("laisse la clé localStorage héritée hypr-theme intacte", () => {
  assert.equal(
    rebrandText('const K = "hypr-theme";'),
    'const K = "hypr-theme";',
  );
});

test("ne touche pas un texte déjà rebrandé", () => {
  assert.equal(rebrandText("Syntheo Desktop"), "Syntheo Desktop");
});
