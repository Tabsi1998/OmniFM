// ============================================================
// OmniFM: station suggestions (#303), checked and answered
// ============================================================
// The commander checks every pending suggestion's stream once an hour (the
// owner console shows how it did over 24 hours) and tells the person who
// sent it about the owner's decision, once, by direct message. The owner
// console only marks the decision: it runs without a Discord connection.

import { botTranslator, normalizeBotLanguage } from "../lib/bot-i18n.js";
import { log } from "../lib/logging.js";
import { probeStationUrl } from "../lib/owner-stations.js";
import {
  markSuggestionNotified,
  recordSuggestionCheck,
  suggestionsToCheck,
  suggestionsToNotify,
} from "../station-suggestions-store.js";
import * as ui from "../discord/ui/index.js";

const CHECK_EVERY_MS = 60 * 60_000;
const NOTIFY_EVERY_MS = 2 * 60_000;

/** A probe of the stream as the queue keeps it. */
export function checkFromProbe(probe = {}) {
  return {
    ok: probe.ok === true,
    audio: probe.isAudioStream === true,
    bitrate: Number.parseInt(String(probe.bitrate ?? ""), 10) || null,
    latencyMs: Number.isFinite(probe.latencyMs) ? probe.latencyMs : null,
    error: probe.ok ? "" : String(probe.message || probe.reason || (probe.status ? `HTTP ${probe.status}` : "no answer")),
  };
}

/** Tests every pending suggestion once; returns how many were tested. */
export async function checkPendingSuggestions({ probe = probeStationUrl, now = Date.now() } = {}) {
  const pending = await suggestionsToCheck({ now });
  for (const suggestion of pending) {
    // eslint-disable-next-line no-await-in-loop -- one stream after the other, gentle on the hosts
    const result = await probe(suggestion.url).catch((err) => ({ ok: false, message: String(err?.message || err) }));
    // eslint-disable-next-line no-await-in-loop
    await recordSuggestionCheck(suggestion._id, checkFromProbe(result), { now });
  }
  return pending.length;
}

/** The message to the person who sent the suggestion, in their language. */
export function buildSuggestionAnswer(suggestion) {
  const t = botTranslator(normalizeBotLanguage(suggestion?.submitter?.language, "en"));
  const name = String(suggestion?.name || "");
  if (suggestion?.status === "accepted") {
    return ui.message(ui.notice("success", {
      title: t("Dein Sender-Vorschlag ist im Katalog", "Your station suggestion is in the catalogue"),
      body: t(
        "**{station}** ist jetzt bei OmniFM. Danke! Du spielst ihn mit `/play` und dem Sender `{key}`.",
        "**{station}** is now on OmniFM. Thank you! Play it with `/play` and the station `{key}`.", { station: name, key: suggestion.stationKey },
      ),
    }));
  }
  const note = String(suggestion?.decisionNote || "").trim();
  return ui.message(ui.notice("info", {
    title: t("Dein Sender-Vorschlag", "Your station suggestion"),
    body: note
      ? t(
        "**{station}** kommt nicht in den Katalog. Grund: {reason} Danke fürs Vorschlagen!",
        "**{station}** does not go into the catalogue. Reason: {reason} Thanks for suggesting it!",
        { station: name, reason: note },
      )
      : t(
        "**{station}** kommt nicht in den Katalog. Danke fürs Vorschlagen!",
        "**{station}** does not go into the catalogue. Thanks for suggesting it!",
        { station: name },
      ),
  }));
}

/** Sends the pending answers; a closed direct message is not tried again. */
export async function sendSuggestionAnswers(runtime, { now = Date.now() } = {}) {
  let sent = 0;
  for (const suggestion of await suggestionsToNotify()) {
    let delivered = false;
    try {
      // eslint-disable-next-line no-await-in-loop -- a few messages, one after the other
      const user = await runtime.client.users.fetch(suggestion.submitter.userId);
      // eslint-disable-next-line no-await-in-loop
      await user.send(buildSuggestionAnswer(suggestion));
      delivered = true;
      sent += 1;
    } catch (err) {
      log("INFO", `[Vorschläge] Antwort an den Einsender von "${suggestion.name}" nicht zustellbar: ${err?.message || err}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await markSuggestionNotified(suggestion._id, { ok: delivered, now });
  }
  return sent;
}

let timers = [];

export function startStationSuggestionService(runtime) {
  if (timers.length) return;
  const run = (label, job) => () => job().catch((err) => log("WARN", `[Vorschläge] ${label} fehlgeschlagen: ${err?.message || err}`));
  timers = [
    setInterval(run("Stream-Prüfung", () => checkPendingSuggestions()), CHECK_EVERY_MS),
    setInterval(run("Antworten", () => sendSuggestionAnswers(runtime)), NOTIFY_EVERY_MS),
  ];
  for (const timer of timers) timer.unref?.();
}

export function stopStationSuggestionService() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}
