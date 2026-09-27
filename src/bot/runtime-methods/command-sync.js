// OmniFM: slash command registration and cleanup, per server and global.
// BotRuntime methods, split out of src/bot/runtime.js (#295); mixed into
// BotRuntime.prototype there, so `this` is the runtime as before.
import { Routes } from "discord.js";
import { log } from "../../lib/logging.js";
import {
  resolveCommandRegistrationMode,
  usesGlobalCommandRegistration,
  usesGuildCommandRegistration,
} from "../../discord/commandRegistrationMode.js";
import { syncGuildCommandsSafe } from "../../discord/syncGuildCommandsSafe.js";
import {
  EMPTY_COMMANDS_HASH,
  defaultCommandFingerprintStore,
} from "../../discord/commandFingerprints.js";
import { buildCommandBuilders } from "../../commands.js";

const commandSyncMethods = {
  getCommandRegistrationMode() {
    return resolveCommandRegistrationMode(process.env);
  },

  async refreshCommandsOnReady() {
    const mode = this.getCommandRegistrationMode();
    const usesGuild = usesGuildCommandRegistration(mode);
    const usesGlobal = usesGlobalCommandRegistration(mode);

    log(
      "INFO",
      `[${this.config.name}] Command-Registrierungsmodus: ${mode} (guild=${usesGuild} global=${usesGlobal}).`
    );

    if (usesGlobal) {
      await this.syncGlobalCommands("startup");
    } else if (this.shouldCleanGlobalCommandsOnBoot()) {
      await this.clearGlobalCommands("startup-cleanup");
    }

    if (usesGuild) {
      if (this.isGuildCommandCleanupEnabled()) {
        log(
          "INFO",
          `[${this.config.name}] CLEAN_GUILD_COMMANDS_ON_BOOT=1 erkannt, Cleanup wird im Schutzmodus uebersprungen. Es erfolgt ein direkter Voll-Sync.`
        );
      }
      await this.syncGuildCommands("startup");
    } else if (this.shouldCleanGuildCommandsOnBoot()) {
      await this.cleanupGuildCommands();
    }
  },

  isGuildCommandSyncEnabled() {
    return usesGuildCommandRegistration(this.getCommandRegistrationMode());
  },

  isGlobalCommandSyncEnabled() {
    return usesGlobalCommandRegistration(this.getCommandRegistrationMode());
  },

  buildGuildCommandPayload() {
    return buildCommandBuilders().map((builder) => builder.toJSON());
  },

  getApplicationId() {
    return String(this.client.user?.id || this.config.clientId || "").trim();
  },

  shouldCleanGlobalCommandsOnBoot() {
    return String(process.env.CLEAN_GLOBAL_COMMANDS_ON_BOOT ?? "1") !== "0";
  },

  shouldCleanGuildCommandsOnBoot() {
    return String(process.env.CLEAN_GUILD_COMMANDS_ON_BOOT ?? "0") !== "0";
  },

  isGuildCommandCleanupEnabled() {
    if (!this.isGuildCommandSyncEnabled()) return false;
    return this.shouldCleanGuildCommandsOnBoot();
  },

  isWorkerGuildCommandCleanupEnabled() {
    return String(process.env.CLEAN_WORKER_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
  },

  async syncGuildCommands(source = "sync", options = {}) {
    if (!this.isGuildCommandSyncEnabled()) return;
    const payload = this.buildGuildCommandPayload();
    const targetGuildIds = Array.isArray(options?.guildIds)
      ? options.guildIds
      : options?.guildId
        ? [options.guildId]
        : null;
    await syncGuildCommandsSafe({
      client: this.client,
      rest: this.rest,
      routes: Routes,
      commands: payload,
      guildIds: targetGuildIds,
      botToken: this.config.token,
      botLabel: `${this.config.name}`,
      source,
      logFn: (level, message) => log(level, message),
      fingerprints: this.commandFingerprints || defaultCommandFingerprintStore,
      force: options?.force === true,
    });
  },

  async syncGlobalCommands(source = "sync") {
    if (!this.isGlobalCommandSyncEnabled()) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) {
      log("ERROR", `[${this.config.name}] Global-Command-Sync uebersprungen: Application ID fehlt.`);
      return;
    }
    const payload = this.buildGuildCommandPayload();
    log("INFO", `[${this.config.name}] Global-Command-Sync startet (source=${source}, commands=${payload.length}).`);
    await this.rest.put(Routes.applicationCommands(applicationId), { body: payload });
    log("INFO", `[${this.config.name}] Global-Command-Sync abgeschlossen (source=${source}).`);
  },

  async clearGlobalCommands(source = "cleanup") {
    if (!this.shouldCleanGlobalCommandsOnBoot()) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) return;
    await this.rest.put(Routes.applicationCommands(applicationId), { body: [] }).catch((err) => {
      log("WARN", `[${this.config.name}] Global-Command-Cleanup fehlgeschlagen (source=${source}): ${err?.message || err}`);
    });
  },

  async clearGuildCommandsForWorker() {
    if (this.role !== "worker") return;
    if (!this.isWorkerGuildCommandCleanupEnabled()) return;
    const allGuildIds = [...this.client.guilds.cache.keys()];
    if (!allGuildIds.length) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) return;
    // Servers already cleared in an earlier start need no PUT again (#215).
    const fingerprints = this.commandFingerprints || defaultCommandFingerprintStore;
    const known = await fingerprints.load(applicationId, allGuildIds).catch(() => new Map());
    const guildIds = allGuildIds.filter((guildId) => known.get(guildId) !== EMPTY_COMMANDS_HASH);
    if (!guildIds.length) {
      log("INFO", `[${this.config.name}] Worker-Guild-Commands bereits leer (Guilds: ${allGuildIds.length}).`);
      return;
    }
    const cleared = [];
    for (const guildId of guildIds) {
      // eslint-disable-next-line no-await-in-loop
      await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] })
        .then(() => cleared.push(guildId))
        .catch((err) => {
          log("WARN", `[${this.config.name}] Worker-Command-Cleanup fehlgeschlagen fuer Guild ${guildId}: ${err?.message || err}`);
        });
    }
    await fingerprints.save(applicationId, cleared, EMPTY_COMMANDS_HASH).catch(() => null);
    log("INFO", `[${this.config.name}] Worker-Guild-Commands bereinigt (Guilds: ${cleared.length}/${guildIds.length}, schon leer: ${allGuildIds.length - guildIds.length}).`);
  },

  async clearCommandsForWorker() {
    if (this.role !== "worker") return;
    await this.clearGlobalCommands("worker-startup");
    await this.clearGuildCommandsForWorker();
  },

  async cleanupGuildCommands() {
    if (!this.isGuildCommandCleanupEnabled()) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) {
      log("ERROR", `[${this.config.name}] Guild-Command-Cleanup uebersprungen: Application ID fehlt.`);
      return;
    }

    const guildIds = [...this.client.guilds.cache.keys()];
    if (!guildIds.length) return;

    let cleaned = 0;
    let failed = 0;
    log("INFO", `[${this.config.name}] Bereinige Guild-Commands in ${guildIds.length} Servern...`);

    const clearedGuildIds = [];
    for (const guildId of guildIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] });
        cleaned += 1;
        clearedGuildIds.push(guildId);
      } catch (err) {
        failed += 1;
        log(
          "ERROR",
          `[${this.config.name}] Guild-Command-Cleanup fehlgeschlagen (guild=${guildId}): ${err?.message || err}`
        );
      }
    }

    log(
      "INFO",
      `[${this.config.name}] Guild-Command-Cleanup fertig: ok=${cleaned}, failed=${failed}.`
    );
    // A later sync must write the list again into these servers (#215).
    await (this.commandFingerprints || defaultCommandFingerprintStore)
      .save(applicationId, clearedGuildIds, EMPTY_COMMANDS_HASH).catch(() => null);
  },
};

export { commandSyncMethods };
