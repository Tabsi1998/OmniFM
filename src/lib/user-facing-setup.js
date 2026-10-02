import { botTranslator } from "./bot-i18n.js";

function normalizeCount(value) {
  const parsed = Number.parseInt(String(value || 0), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function buildSetupStatusSummary({
  commanderReady = true,
  invitedWorkerCount = 0,
  maxWorkerSlots = 0,
  voiceChannelCount = 0,
  t = botTranslator("de"),
} = {}) {
  const invited = normalizeCount(invitedWorkerCount);
  const maxWorkers = Math.max(invited, normalizeCount(maxWorkerSlots));
  const voiceChannels = normalizeCount(voiceChannelCount);

  const checklist = [
    `${commanderReady ? "OK" : "OFF"} ${t("Commander verbunden", "Commander connected")}`,
    `${invited > 0 ? "OK" : "OFF"} ${t("Worker eingeladen: {invited}/{max}", "Workers invited: {invited}/{max}", { invited, max: maxWorkers || 0 })}`,
    `${voiceChannels > 0 ? "OK" : "OFF"} ${t("{count} Voice-/Stage-Channels gefunden", "{count} voice/stage channels found", { count: voiceChannels })}`,
  ];

  if (!commanderReady) {
    return {
      checklist,
      nextTitle: t("Commander zuerst verbinden", "Connect the commander first"),
      nextBody: t(
        "Ohne den Hauptbot kann OmniFM diesen Server noch nicht sauber steuern.",
        "Without the main bot, OmniFM cannot manage this server cleanly yet."
      ),
      command: "/setup",
    };
  }

  if (invited <= 0) {
    return {
      checklist,
      nextTitle: t("Als Nächstes: ersten Worker einladen", "Next: invite the first worker"),
      nextBody: t(
        "Sobald mindestens ein Worker auf dem Server ist, kann /play den eigentlichen Stream starten.",
        "As soon as at least one worker is on the server, /play can start the actual stream."
      ),
      command: "/invite",
    };
  }

  if (voiceChannels <= 0) {
    return {
      checklist,
      nextTitle: t("Es fehlt noch ein Voice- oder Stage-Channel", "A voice or stage channel is still missing"),
      nextBody: t(
        "Lege in Discord zuerst einen Voice- oder Stage-Channel an. Danach kann OmniFM direkt dort starten.",
        "Create a voice or stage channel in Discord first. After that, OmniFM can start there directly."
      ),
      command: "/setup",
    };
  }

  return {
    checklist,
    nextTitle: t("Der erste Stream kann gestartet werden", "The first stream can be started"),
    nextBody: t(
      "Join einen Voice-Channel oder nutze /play mit voice:. Wenn der Ziel-Channel gewählt ist, kann OmniFM sofort starten.",
      "Join a voice channel or use /play with voice:. Once the target channel is selected, OmniFM can start immediately."
    ),
    command: "/play",
  };
}

function buildVoiceChannelAccessMessage({
  issue = "connect_missing",
  channelLabel = "",
  workerName = "",
  t = botTranslator("de"),
} = {}) {
  const target = String(channelLabel || "").trim() || t("dem gewählten Channel", "the selected channel");
  const actor = String(workerName || "").trim();

  if (issue === "select_channel") {
    return t(
      "Join zuerst einen Voice-/Stage-Channel oder setze im Command direkt `voice:`.",
      "Join a voice/stage channel first or set `voice:` directly in the command."
    );
  }

  if (issue === "connect_missing") {
    if (actor) {
      return t(
        "{bot} kann {channel} nicht beitreten. Gib diesem Bot dort die Berechtigung `Connect` oder nutze einen anderen Channel/Worker.",
        "{bot} cannot join {channel}. Grant that bot `Connect` there or use a different channel/worker.",
        { bot: actor, channel: target }
      );
    }
    return t(
      "OmniFM kann {channel} nicht beitreten. Gib dem Bot dort die Berechtigung `Connect` oder wähle einen anderen Channel.",
      "OmniFM cannot join {channel}. Grant the bot `Connect` there or choose a different channel.",
      { channel: target }
    );
  }

  if (issue === "speak_missing") {
    if (actor) {
      return t(
        "{bot} kann {channel} sehen, dort aber nicht sprechen. Gib diesem Bot `Speak` oder nutze einen anderen Channel.",
        "{bot} can see {channel}, but cannot speak there. Grant that bot `Speak` or use a different channel.",
        { bot: actor, channel: target }
      );
    }
    return t(
      "OmniFM kann {channel} betreten, dort aber nicht sprechen. Gib dem Bot `Speak` oder wähle einen anderen Channel.",
      "OmniFM can join {channel}, but cannot speak there. Grant the bot `Speak` or choose a different channel.",
      { channel: target }
    );
  }

  return t(
    "Der Ziel-Channel ist gerade nicht bereit. Bitte prüfe den Channel und versuche es erneut.",
    "The target channel is not ready right now. Please check the channel and try again."
  );
}

export {
  buildSetupStatusSummary,
  buildVoiceChannelAccessMessage,
};
