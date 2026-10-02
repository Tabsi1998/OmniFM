// /suggest-station (#303): a person suggests a station for the OmniFM
// catalogue. The stream is tested right away; a station that is already in
// the catalogue or already suggested is recognised by its stream address.
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js.
import { MessageFlags } from "discord.js";

import { log } from "../../lib/logging.js";
import { testStationStream } from "../../lib/owner-stations.js";
import { loadStations } from "../../stations-store.js";
import { createStationSuggestion, recordSuggestionCheck } from "../../station-suggestions-store.js";
import { MAX_PENDING_PER_PERSON } from "../../lib/station-suggestions.js";
import { checkFromProbe } from "../../services/station-suggestions.js";
import { buildNoticePayload } from "../commands/command-helpers.js";
import { buildSuggestionFormModal, readSuggestionForm } from "../forms.js";

export const suggestionMethods = {
  async openSuggestionForm(interaction) {
    const { t } = this.createInteractionTranslator(interaction);
    await interaction.showModal(buildSuggestionFormModal({ t }));
  },

  async handleSuggestionFormSubmit(interaction, { testStream = testStationStream } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const warn = (title, description) => this.respondInteraction(interaction, buildNoticePayload({ t, language, tone: "warning", title, description }));
    const form = readSuggestionForm(interaction.fields);
    // Testing the stream takes a few seconds: acknowledge first.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const test = await testStream(form.url).catch((error) => ({ ok: false, message: error?.message || "test_failed" }));
    if (!test?.ok) {
      await warn(t("Kein Stream gefunden", "No stream found"), t(
        "Unter der URL kam kein Audio-Stream ({error}). Nichts gespeichert – prüf den Link, es muss der direkte Stream sein.",
        "No audio stream came from the URL ({error}). Nothing saved – check the link, it has to be the direct stream.",
        { error: test?.message || t("keine Antwort", "no answer") }
      ));
      return true;
    }

    const result = await createStationSuggestion(form, {
      userId: interaction.user?.id,
      userName: interaction.user?.globalName || interaction.user?.username,
      guildId: interaction.guildId,
      language,
    }, { catalog: loadStations()?.stations || {} });
    if (result.error) {
      const messages = {
        name: t("Der Name braucht mindestens zwei Zeichen.", "The name needs at least two characters."),
        url: t("Die Stream-URL muss mit http:// oder https:// beginnen.", "The stream URL must start with http:// or https://."),
        homepage: t("Die Webseite muss mit https:// beginnen.", "The website must start with https://."),
        "in-catalog": result.station
          ? t("Den Sender gibt es schon im Katalog: **{station}**. Du findest ihn mit `/play`.", "The station is already in the catalogue: **{station}**. Find it with `/play`.", { station: result.station })
          : t("Den Sender gibt es schon im Katalog. Du findest ihn mit `/play`.", "The station is already in the catalogue. Find it with `/play`."),
        "already-suggested": result.status === "accepted"
          ? t("Diesen Sender hat schon jemand vorgeschlagen, und er ist schon angenommen.", "Someone suggested this station already, and it was accepted.")
          : t("Diesen Sender hat schon jemand vorgeschlagen; er wartet auf die Prüfung.", "Someone suggested this station already; it is waiting to be checked."),
        "too-many": t("Du hast schon {max} Vorschläge in der Prüfung. Sobald einer entschieden ist, geht der nächste.",
          "You have {max} suggestions waiting already. Once one is decided, the next one can go in.", { max: MAX_PENDING_PER_PERSON }),
        unavailable: t("Vorschläge gehen gerade nicht. Bitte später noch einmal.", "Suggestions do not work right now. Please try again later."),
      };
      await warn(t("Nicht eingereicht", "Not sent"), messages[result.error] || messages.unavailable);
      return true;
    }

    await recordSuggestionCheck(result.suggestion._id, checkFromProbe({ ...test, ok: true })).catch(() => null);
    await this.respondInteraction(interaction, buildNoticePayload({
      t, language, tone: "success", title: t("Danke für den Vorschlag!", "Thanks for the suggestion!"),
      description: t(
        "**{station}** wartet jetzt auf die Prüfung. Der Stream lief beim Test; wir hören ihn uns an und sagen dir per Direktnachricht Bescheid.",
        "**{station}** is now waiting to be checked. The stream worked in the test; we will listen to it and tell you by direct message.", { station: result.suggestion.name }
      ),
    }));
    log("INFO", `[${this.config?.name}] Sender-Vorschlag "${result.suggestion.name}" eingereicht.`);
    return true;
  },
};
