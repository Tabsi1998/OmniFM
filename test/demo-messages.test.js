import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The website's live demos show the bot's real messages (#431): the JSON in
// the frontend must be what the bot's own code builds today.
const { DEMO_MESSAGES_FILE, demoMessagesJson } = await import("../scripts/build-demo-messages.mjs");

test("the demos show the bot's current messages (run scripts/build-demo-messages.mjs after changing them)", async () => {
  assert.equal(fs.readFileSync(DEMO_MESSAGES_FILE, "utf8"), await demoMessagesJson());
});

test("the demos have the moments they need, in the bot's languages and the website's", async () => {
  const demo = JSON.parse(await demoMessagesJson());
  for (const language of ["de", "en"]) {
    const panel = (moment) => JSON.stringify(demo.panels[language][moment]);
    assert.match(panel("lofi"), /Lofi Café/);
    assert.match(panel("lofi"), /"custom_id":"np:toggle"/);
    assert.match(panel("lofi"), /"custom_id":"np:fav:lounge"/);
    assert.match(panel("paused"), language === "de" ? /Weiter/ : /Resume/);
    // The favourite on air is shown as such.
    assert.match(panel("lounge"), /"custom_id":"np:fav:lounge"[^}]*"disabled":true/);
    const invite = JSON.stringify(demo.invite[language]);
    assert.match(invite, language === "de" ? /Worker-Bots einladen/ : /Invite worker bots/);
    assert.match(invite, /Invite OmniFM 1/);
    assert.doesNotMatch(invite, /BOT_\d/);
    // No version or commit: the file must not change with every build.
    assert.doesNotMatch(JSON.stringify(demo), /v\d+\.\d+\.\d+ · [0-9a-f]{7}/);
  }
  assert.deepEqual(Object.keys(demo.commands).sort(), ["de", "en", "es", "fr", "it", "nl", "pl", "pt", "tr"]);
  assert.equal(demo.commands.fr.play, "Lancer une radio dans ton salon vocal");
});
