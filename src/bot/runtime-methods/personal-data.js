// /mydata (#285): what OmniFM keeps about the person, as a file, deleted.
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js, so
// `this` is the runtime; the commander answers the command and its buttons.
import { MessageFlags } from "discord.js";

import { log } from "../../lib/logging.js";
import { collectPersonalData, countPersonalData, erasePersonalData } from "../../lib/personal-data.js";
import {
  buildErasePersonalDataConfirm,
  buildPersonalDataErasedPayload,
  buildPersonalDataFile,
  buildPersonalDataFileHere,
  buildPersonalDataFileSentPayload,
  buildPersonalDataPayload,
  buildPersonalDataProblemPayload,
  parsePersonalDataCustomId,
} from "../personal-data-panel.js";

// A component update may not carry the ephemeral flag; V2 stays.
function asUpdate(payload) {
  return { ...payload, flags: MessageFlags.IsComponentsV2 };
}

const personalDataMethods = {
  async buildPersonalDataView(interaction) {
    const { t } = this.createInteractionTranslator(interaction);
    const applicationId = interaction.applicationId || this.client?.application?.id || null;
    const collected = await collectPersonalData(interaction.user?.id);
    if (!collected.ok) return buildPersonalDataProblemPayload({ t, error: collected.error, applicationId });
    return buildPersonalDataPayload({ t, counts: countPersonalData(collected.data), applicationId });
  },

  /** /meine-daten: private, always allowed; it is the person's own data. */
  async handlePersonalDataCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.respondInteraction(interaction, await this.buildPersonalDataView(interaction));
  },

  async handlePersonalDataComponent(interaction) {
    const action = parsePersonalDataCustomId(interaction.customId);
    if (!action) return false;
    const { t } = this.createInteractionTranslator(interaction);
    const applicationId = interaction.applicationId || this.client?.application?.id || null;
    const userId = interaction.user?.id;

    if (action === "eraseno") {
      await interaction.update(asUpdate(await this.buildPersonalDataView(interaction)));
      return true;
    }
    if (action === "erase") {
      const collected = await collectPersonalData(userId);
      await interaction.update(asUpdate(collected.ok
        ? buildErasePersonalDataConfirm({ t, counts: countPersonalData(collected.data) })
        : buildPersonalDataProblemPayload({ t, error: collected.error, applicationId })));
      return true;
    }
    if (action === "eraseyes") {
      const result = await erasePersonalData(userId);
      if (!result.ok) {
        await interaction.update(asUpdate(buildPersonalDataProblemPayload({ t, error: result.error, applicationId })));
        return true;
      }
      log("INFO", `[${this.config?.name}] Personenbezogene Daten auf Wunsch geloescht (${Object.values(result.counts).reduce((a, b) => a + b, 0)} Eintraege)`);
      await interaction.update(asUpdate(buildPersonalDataErasedPayload({ t, counts: result.counts, applicationId })));
      return true;
    }
    if (action === "export") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const collected = await collectPersonalData(userId);
      if (!collected.ok) {
        await this.respondInteraction(interaction, buildPersonalDataProblemPayload({ t, error: collected.error, applicationId }));
        return true;
      }
      const dmSent = await interaction.user.send(buildPersonalDataFile({ t, data: collected.data }))
        .then(() => true)
        .catch((error) => {
          // 50007: the person does not take DMs from server members.
          if (error?.code !== 50007) log("WARN", `[${this.config?.name}] Datenauskunft per DM fehlgeschlagen: ${error?.message || error}`);
          return false;
        });
      await this.respondInteraction(interaction, buildPersonalDataFileSentPayload({ t, dmSent, applicationId }));
      if (!dmSent) await interaction.followUp(buildPersonalDataFileHere({ t, data: collected.data }));
      return true;
    }
    return false;
  },
};

export { personalDataMethods };
