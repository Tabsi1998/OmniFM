// The bot's own look per server (#280, Ultimate): avatar, banner and bio of
// a worker on one server. The worker sets its own profile; the commander
// resets profiles of servers that are no longer on Ultimate.
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js, so
// `this` is the runtime.
import { log } from "../../lib/logging.js";
import { getDb, isConnected } from "../../lib/db.js";
import { getTier } from "../../core/entitlements.js";
import { recordOwnerAudit } from "../../lib/owner-audit-store.js";

const DOWNGRADE_CHECK_MS = 30 * 60_000;

const botProfileMethods = {
  /**
   * Worker: sets avatar, banner and/or bio on one server (data URIs; null =
   * back to the default). { ok, avatarUrl } or { ok: false, error }.
   */
  async applyGuildBotProfile(guildId, changes = {}) {
    const guild = this.client?.guilds?.cache?.get?.(guildId)
      || await this.client?.guilds?.fetch?.(guildId).catch(() => null);
    if (!guild?.members?.editMe) return { ok: false, error: "guild_unavailable" };
    const options = {};
    for (const field of ["avatar", "banner", "bio"]) {
      if (Object.hasOwn(changes, field)) options[field] = changes[field];
    }
    try {
      const me = await guild.members.editMe({ ...options, reason: "OmniFM dashboard: bot look (#280)" });
      return { ok: true, avatarUrl: me?.displayAvatarURL?.({ size: 256 }) || null };
    } catch (err) {
      log("WARN", `[${this.config?.name}] Bot-Profil auf ${guildId} nicht gesetzt: ${err?.message || err}`);
      return { ok: false, error: err?.message || "edit_failed", code: err?.code || null };
    }
  },

  /** Worker: the avatar the bot shows on this server right now. */
  getGuildBotAvatarUrl(guildId) {
    const me = this.client?.guilds?.cache?.get?.(guildId)?.members?.me || null;
    return me?.displayAvatarURL?.({ size: 256 }) || null;
  },

  /**
   * Commander: servers no longer on Ultimate get the default look back on
   * every worker; the stored profile goes, the change is in the owner audit.
   */
  async resetBotProfilesAfterDowngrade() {
    if (this.role !== "commander" || !this.workerManager || !isConnected() || !getDb()) return [];
    const settings = getDb().collection("guild_settings");
    const rows = await settings.find({ botProfiles: { $exists: true } }, { projection: { _id: 0, guildId: 1, botProfiles: 1 } }).toArray();
    const reset = [];
    for (const row of rows) {
      if (!row?.guildId || getTier(row.guildId) === "ultimate") continue;
      for (const slot of Object.keys(row.botProfiles || {})) {
        const worker = this.workerManager.getWorkerByIndex?.(Number(slot), { prefer: "slot" });
        // eslint-disable-next-line no-await-in-loop
        await worker?.applyGuildBotProfile?.(row.guildId, { avatar: null, banner: null, bio: null });
      }
      // eslint-disable-next-line no-await-in-loop
      await settings.updateOne({ guildId: row.guildId }, { $unset: { botProfiles: "" } });
      recordOwnerAudit({
        action: "guild.botProfile.reset",
        status: "success",
        actor: "system",
        target: row.guildId,
        summary: "Bot-Aussehen nach Downgrade zurückgesetzt",
        metadata: { reason: "downgrade", workers: Object.keys(row.botProfiles || {}) },
      });
      reset.push(row.guildId);
    }
    if (reset.length) log("INFO", `[${this.config?.name}] Bot-Aussehen nach Downgrade zurueckgesetzt: ${reset.length} Server`);
    return reset;
  },

  startBotProfileDowngradeWatcher() {
    if (this.botProfileDowngradeTimer) return;
    this.botProfileDowngradeTimer = setInterval(() => {
      this.resetBotProfilesAfterDowngrade().catch((err) => {
        log("WARN", `[${this.config?.name}] Bot-Aussehen-Pruefung fehlgeschlagen: ${err?.message || err}`);
      });
    }, DOWNGRADE_CHECK_MS);
    this.botProfileDowngradeTimer.unref?.();
  },
};

export { botProfileMethods };
