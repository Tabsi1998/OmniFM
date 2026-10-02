import test from "node:test";
import assert from "node:assert/strict";

import {
  applyDashboardEventTemplate,
  applyDashboardSchedulePreset,
  buildDashboardEventTemplatePresets,
  buildDashboardSchedulePresets,
  getDashboardRepeatLabel,
  renderDiscordMarkdown,
} from "../frontend/src/lib/dashboardEvents.js";
import { botTranslator } from "../src/lib/bot-i18n.js";

test("renderDiscordMarkdown keeps HTML escaped but renders Discord custom emojis", () => {
  const html = renderDiscordMarkdown(
    "**Start** <:partyblob:123456789012345678> <a:danceblob:987654321098765432> <script>alert(1)</script>"
  );

  assert.match(html, /<strong>Start<\/strong>/);
  assert.match(html, /cdn\.discordapp\.com\/emojis\/123456789012345678\.webp/);
  assert.match(html, /cdn\.discordapp\.com\/emojis\/987654321098765432\.gif/);
  assert.doesNotMatch(html, /&lt;:partyblob:123456789012345678&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("renderDiscordMarkdown resolves :name: aliases with server emojis", () => {
  const html = renderDiscordMarkdown(
    "**Start** :partyblob: :danceblob:",
    {
      serverEmojis: [
        { id: "123456789012345678", name: "partyblob", animated: false },
        { id: "987654321098765432", name: "danceblob", animated: true },
      ],
    }
  );

  assert.match(html, /cdn\.discordapp\.com\/emojis\/123456789012345678\.webp/);
  assert.match(html, /cdn\.discordapp\.com\/emojis\/987654321098765432\.gif/);
  assert.doesNotMatch(html, /&lt;:partyblob:&gt;/);
  assert.doesNotMatch(html, /&lt;:danceblob:&gt;/);
});

test("renderDiscordMarkdown only keeps safe http/https markdown links", () => {
  const html = renderDiscordMarkdown(
    "[safe](https://example.com/path?q=1) [blocked](javascript:alert(1)) [broken](https://example.com/\" onmouseover=\"alert(1))"
  );

  assert.match(html, /<a href="https:\/\/example\.com\/path\?q=1"/);
  assert.doesNotMatch(html, /href="javascript:alert\(1\)"/);
  assert.doesNotMatch(html, /onmouseover=/);
  assert.match(html, />blocked<\/span>/);
  assert.match(html, />broken<\/span>/);
});

test("getDashboardRepeatLabel mirrors Discord-style recurrence labels", () => {
  assert.equal(getDashboardRepeatLabel("weekly", "de", { startsAt: "2026-03-06T22:00" }), "Jeden Freitag");
  assert.match(getDashboardRepeatLabel("yearly", "de", { startsAt: "2026-03-06T22:00" }), /6\./);
});

test("dashboard event templates provide reusable pro event defaults", () => {
  const t = botTranslator("en");
  const templates = buildDashboardEventTemplatePresets(t);
  const primeTime = templates.find((entry) => entry.id === "prime_time");

  assert.equal(Array.isArray(templates), true);
  assert.equal(templates.length >= 4, true);
  assert.equal(primeTime?.createDiscordEvent, true);
  assert.equal(primeTime?.durationMinutes, "120");
  assert.match(primeTime?.announceMessage || "", /\{station\}/);
});

test("dashboard schedule presets compute deterministic quick picks", () => {
  const t = botTranslator("en");
  const presets = buildDashboardSchedulePresets(t, new Date(2026, 2, 5, 19, 30, 0, 0));
  const friday = presets.find((entry) => entry.id === "friday_20");
  const workdays = presets.find((entry) => entry.id === "workdays_08");

  assert.equal(presets.length >= 5, true);
  assert.equal(friday?.startsAt, "2026-03-06T20:00");
  assert.equal(friday?.repeat, "weekly");
  assert.equal(workdays?.startsAt, "2026-03-06T08:00");
  assert.equal(workdays?.repeat, "weekdays");
});

test("applying event templates and schedule presets only updates the intended form fields", () => {
  const t = botTranslator("en");
  const primeTime = buildDashboardEventTemplatePresets(t).find((entry) => entry.id === "prime_time");
  const friday = buildDashboardSchedulePresets(t, new Date(2026, 2, 5, 19, 30, 0, 0))
    .find((entry) => entry.id === "friday_20");

  const initialForm = {
    stationKey: "rock",
    channelId: "123",
    timezone: "Europe/Vienna",
    repeat: "none",
    startsAt: "",
    title: "",
    durationMinutes: "",
    announceMessage: "",
    description: "",
    stageTopic: "",
    createDiscordEvent: false,
  };

  const withTemplate = applyDashboardEventTemplate(initialForm, primeTime);
  const withSchedule = applyDashboardSchedulePreset(withTemplate, friday);

  assert.equal(withTemplate.stationKey, "rock");
  assert.equal(withTemplate.channelId, "123");
  assert.equal(withTemplate.title, "Prime Time Radio");
  assert.equal(withTemplate.createDiscordEvent, true);
  assert.equal(withSchedule.startsAt, "2026-03-06T20:00");
  assert.equal(withSchedule.repeat, "weekly");
  assert.equal(withSchedule.stationKey, "rock");
});
