import dotenv from "dotenv";
import { REST } from "@discordjs/rest";
import { Routes } from "discord.js";
import { loadBotConfigs } from "./bot-config.js";
import { buildCommandsJson } from "./commands.js";
import {
  resolveCommandRegistrationMode,
  usesGlobalCommandRegistration,
  usesGuildCommandRegistration,
} from "./discord/commandRegistrationMode.js";

dotenv.config();

const commands = buildCommandsJson();
const commandRegistrationMode = resolveCommandRegistrationMode(process.env);
const syncGuildCommands = usesGuildCommandRegistration(commandRegistrationMode);
const syncGlobalCommands = usesGlobalCommandRegistration(commandRegistrationMode);
const cleanGlobalCommands = String(process.env.CLEAN_GLOBAL_COMMANDS_ON_BOOT ?? "1") !== "0";
let bots;

try {
  bots = loadBotConfigs(process.env);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}

const failedBots = [];
const configuredCommander = Number.parseInt(String(process.env.COMMANDER_BOT_INDEX || "1"), 10);
const commanderBot = Number.isFinite(configuredCommander) && configuredCommander >= 1
  ? bots.find((bot) => Number(bot?.index || 0) === configuredCommander) || bots[0]
  : bots[0];

for (const bot of bots) {
  try {
    const rest = new REST({ version: "10" }).setToken(bot.token);
    // eslint-disable-next-line no-await-in-loop -- one bot after the other, as Discord's rate limit wants
    const me = await rest.get(Routes.user("@me"));
    const runtimeClientId = String(me?.id || bot.clientId || "").trim();
    if (!runtimeClientId) {
      throw new Error("Application ID konnte nicht aufgelöst werden.");
    }
    if (runtimeClientId !== String(bot.clientId || "").trim()) {
      console.warn(`[WARN] ${bot.name}: CLIENT_ID mismatch (env=${bot.clientId}, runtime=${runtimeClientId}). Nutze runtime-ID.`);
    }
    const isCommander = bot.id === commanderBot.id;

    if (!isCommander) {
      if (cleanGlobalCommands) {
        // eslint-disable-next-line no-await-in-loop -- one bot after the other, as Discord's rate limit wants
        await rest.put(Routes.applicationCommands(runtimeClientId), { body: [] });
        console.log(`Worker ${bot.name}: globale Slash-Commands entfernt.`);
      } else {
        console.log(`Worker ${bot.name}: globale Slash-Commands bleiben unverändert (Cleanup deaktiviert).`);
      }
      console.log("Fertig.");
      continue;
    }

    if (syncGlobalCommands) {
      console.log(`Registriere globale Slash-Commands für Commander ${bot.name} (${runtimeClientId})...`);
      // eslint-disable-next-line no-await-in-loop -- one bot after the other, as Discord's rate limit wants
      await rest.put(Routes.applicationCommands(runtimeClientId), { body: commands });
    } else if (cleanGlobalCommands) {
      // eslint-disable-next-line no-await-in-loop -- one bot after the other, as Discord's rate limit wants
      await rest.put(Routes.applicationCommands(runtimeClientId), { body: [] });
      console.log(`Commander ${bot.name}: globale Slash-Commands bereinigt (Modus ${commandRegistrationMode}).`);
    } else {
      console.log(`Überspringe globale Slash-Commands für Commander ${bot.name} (${runtimeClientId}) (Modus ${commandRegistrationMode}).`);
    }
    console.log("Fertig.");
  } catch (err) {
    failedBots.push(bot.name);
    console.error(`Fehler bei ${bot.name}:`, err?.message || err);
  }
}

if (syncGuildCommands && syncGlobalCommands) {
  console.log("Hybrid-Modus aktiv: globale Commands für den Commander registriert, Guild-Sync bleibt beim Bot-Start aktiv.");
} else if (syncGuildCommands) {
  console.log("Global-Command-Deploy übersprungen (Guild-Modus). Nur der Commander synchronisiert Guild-Commands beim Bot-Start.");
} else {
  console.log("Globale Commands für Commander registriert (Global-Modus, Worker haben keine Commands).");
}

if (failedBots.length > 0) {
  console.error(`[WARN] Command-Deploy unvollständig. Fehlgeschlagen für: ${failedBots.join(", ")}`);
  process.exitCode = 1;
}
