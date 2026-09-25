import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-language-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
// Even with a German default the server's language has to decide.
process.env.DEFAULT_LANGUAGE = "de";

const { BotRuntime } = await import("../src/bot/runtime.js");
const { resolveLanguageFromAcceptLanguage } = await import("../src/i18n.js");

function fakeRuntime(guilds = {}) {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.client = { guilds: { cache: new Map(Object.entries(guilds)) } };
  return runtime;
}

test("on a server the server's language decides, not the person's", () => {
  const runtime = fakeRuntime();
  const english = { guildId: "900000000000000001", guildLocale: "en-US", locale: "de" };
  const german = { guildId: "900000000000000002", guildLocale: "de", locale: "en-US" };
  const french = { guildId: "900000000000000003", guildLocale: "fr", locale: "de" };
  assert.equal(runtime.resolveInteractionLanguage(english), "en");
  assert.equal(runtime.resolveInteractionLanguage(german), "de");
  assert.equal(runtime.resolveInteractionLanguage(french), "en");
});

test("without a known server language OmniFM speaks English", () => {
  const runtime = fakeRuntime();
  assert.equal(runtime.resolveInteractionLanguage({ guildId: "900000000000000004", locale: "de" }), "en");
  assert.equal(runtime.resolveGuildLanguage("900000000000000005"), "en");
  assert.equal(
    fakeRuntime({ "900000000000000006": { preferredLocale: "de" } }).resolveGuildLanguage("900000000000000006"),
    "de"
  );
});

test("direct messages follow the person's own Discord language", () => {
  const runtime = fakeRuntime();
  assert.equal(runtime.resolveInteractionLanguage({ locale: "de" }), "de");
  assert.equal(runtime.resolveInteractionLanguage({ locale: "es-ES" }), "en");
});

test("pages rendered by the server: German browser German, any other browser English", () => {
  assert.equal(resolveLanguageFromAcceptLanguage("de-AT,de;q=0.9"), "de");
  assert.equal(resolveLanguageFromAcceptLanguage("fr-FR,fr;q=0.9"), "en");
  assert.equal(resolveLanguageFromAcceptLanguage("en-GB"), "en");
});
