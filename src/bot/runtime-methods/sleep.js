// The sleep timer (#275): /sleep 15 to 120 minutes ends the stream with a
// soft fade over the last ten seconds. A minute before, the panel channel
// gets a message with "+30 min" and "off". The time is kept in the bot state,
// so it survives a restart; a stream whose time passed while the bot was
// down is not brought back.
// BotRuntime methods, mixed into BotRuntime.prototype in runtime.js, so
// `this` is the runtime (the worker that plays).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";

import { log } from "../../lib/logging.js";
import { applyVolumeTransformerLevel } from "../../lib/helpers.js";
import * as ui from "../../discord/ui/index.js";
import { NP_PREFIX } from "../runtime-shared.js";

export const SLEEP_CHOICES_MINUTES = Object.freeze([15, 30, 45, 60, 90, 120]);
export const SLEEP_WARNING_MS = 60_000;
export const SLEEP_FADE_MS = 10_000;
export const SLEEP_FADE_STEPS = 10;
export const SLEEP_EXTEND_MINUTES = 30;
export const SLEEP_MAX_MINUTES = 12 * 60;
export const NP_SLEEP_EXTEND_ID = `${NP_PREFIX}sleepextend`;
export const NP_SLEEP_OFF_ID = `${NP_PREFIX}sleepoff`;

/** Minutes from a command value: a whole number from 1 to 720, or 0 for "off". */
export function normalizeSleepMinutes(value) {
  if (String(value ?? "").trim().toLowerCase() === "off") return 0;
  const minutes = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(SLEEP_MAX_MINUTES, minutes);
}

function seconds(ms) {
  return Math.floor(Number(ms) / 1000);
}

/** The message a minute before the end, with "+30 min" and "off". */
export function buildSleepWarningPayload({ t, sleepUntilMs }) {
  return ui.message(ui.notice("info", {
    title: t("Gleich ist Schluss", "Almost bedtime"),
    body: t(
      `😴 Der Sleep-Timer schaltet OmniFM <t:${seconds(sleepUntilMs)}:R> leise aus.`,
      `😴 The sleep timer turns OmniFM off quietly <t:${seconds(sleepUntilMs)}:R>.`
    ),
    actions: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(NP_SLEEP_EXTEND_ID).setStyle(ButtonStyle.Primary)
        .setLabel(t(`+${SLEEP_EXTEND_MINUTES} min`, `+${SLEEP_EXTEND_MINUTES} min`)),
      new ButtonBuilder().setCustomId(NP_SLEEP_OFF_ID).setStyle(ButtonStyle.Secondary)
        .setLabel(t("Timer aus, weiterspielen", "Timer off, keep playing")),
    )],
  }));
}

/** What the warning turns into: extended, switched off, or asleep. */
export function buildSleepStatePayload({ t, kind, sleepUntilMs = 0 }) {
  if (kind === "extended") {
    return ui.message(ui.notice("success", {
      title: t("Verlängert", "Extended"),
      body: t(`😴 Jetzt ist um <t:${seconds(sleepUntilMs)}:t> Schluss.`, `😴 Now it ends at <t:${seconds(sleepUntilMs)}:t>.`),
    }));
  }
  if (kind === "off") {
    return ui.message(ui.notice("info", {
      title: t("Sleep-Timer aus", "Sleep timer off"),
      body: t("OmniFM spielt weiter.", "OmniFM keeps playing."),
    }));
  }
  return ui.message(ui.notice("info", {
    title: t("Gute Nacht", "Good night"),
    body: t(
      `😴 Der Sleep-Timer hat OmniFM um <t:${seconds(sleepUntilMs || Date.now())}:t> ausgeschaltet.`,
      `😴 The sleep timer turned OmniFM off at <t:${seconds(sleepUntilMs || Date.now())}:t>.`
    ),
  }));
}

function translatorFor(runtime, guildId) {
  const language = runtime.resolveGuildLanguage?.(guildId) || "de";
  return (de, en) => (language === "de" ? de : en);
}

const sleepMethods = {
  /** Stops the timers of a guild; `keepTime` leaves sleepUntilMs for a new arm. */
  clearSleepTimer(guildId, { keepTime = false } = {}) {
    const state = this.guildState?.get?.(guildId);
    if (!state) return;
    for (const handle of Object.values(state.sleepTimers || {})) clearTimeout(handle);
    state.sleepTimers = null;
    // A fade that was cut off (extended or switched off) gets the set volume back.
    if (state.sleepFading) {
      state.sleepFading = false;
      applyVolumeTransformerLevel(state.player?.state?.resource?.volume, Math.max(0, Math.min(100, Number(state.volume ?? 100))));
    }
    if (!keepTime) {
      state.sleepUntilMs = 0;
      state.sleepWarning = null;
    }
  },

  /** Schedules warning, fade and stop for state.sleepUntilMs. */
  armSleepTimer(guildId, { now = Date.now() } = {}) {
    const state = this.guildState?.get?.(guildId);
    if (!state) return false;
    this.clearSleepTimer(guildId, { keepTime: true });
    const sleepUntilMs = Number(state.sleepUntilMs) || 0;
    if (sleepUntilMs <= now) return false;

    const timers = {};
    const warnInMs = sleepUntilMs - SLEEP_WARNING_MS - now;
    if (warnInMs > 0) {
      timers.warning = setTimeout(() => {
        this.sendSleepWarning(guildId).catch((err) => {
          log("WARN", `[${this.config?.name}] Sleep-Hinweis fehlgeschlagen (guild=${guildId}): ${err?.message || err}`);
        });
      }, warnInMs);
    }
    timers.fade = setTimeout(() => this.fadeOutForSleep(guildId), Math.max(0, sleepUntilMs - SLEEP_FADE_MS - now));
    for (const handle of Object.values(timers)) handle?.unref?.();
    state.sleepTimers = timers;
    return true;
  },

  /** Sets (minutes > 0) or clears (0) the timer. { ok, sleepUntilMs } or { ok: false, error }. */
  async setSleepTimerInGuild(guildId, minutes, { now = Date.now() } = {}) {
    const state = this.guildState?.get?.(guildId);
    const normalized = normalizeSleepMinutes(minutes);
    if (normalized > 0 && !state?.currentStationKey) return { ok: false, error: "Es laeuft nichts." };
    if (!state) return { ok: true, sleepUntilMs: 0 };
    if (normalized === 0) {
      this.clearSleepTimer(guildId);
    } else {
      state.sleepUntilMs = now + normalized * 60_000;
      this.armSleepTimer(guildId, { now });
    }
    this.persistState?.({ forceLog: false });
    this.updateNowPlayingEmbed?.(guildId, state, { force: true })?.catch?.(() => null);
    return { ok: true, sleepUntilMs: state.sleepUntilMs || 0, workerName: this.config?.name || "" };
  },

  /** "+30 min": from the planned end, or from now when that is already close. */
  async extendSleepTimerInGuild(guildId, minutes = SLEEP_EXTEND_MINUTES, { now = Date.now() } = {}) {
    const state = this.guildState?.get?.(guildId);
    if (!state?.currentStationKey || !(state.sleepUntilMs > 0)) return { ok: false, error: "Kein Sleep-Timer aktiv." };
    state.sleepUntilMs = Math.max(state.sleepUntilMs, now) + normalizeSleepMinutes(minutes) * 60_000;
    this.armSleepTimer(guildId, { now });
    this.persistState?.({ forceLog: false });
    this.updateNowPlayingEmbed?.(guildId, state, { force: true })?.catch?.(() => null);
    return { ok: true, sleepUntilMs: state.sleepUntilMs };
  },

  async sendSleepWarning(guildId) {
    const state = this.guildState?.get?.(guildId);
    if (!state?.currentStationKey || !(state.sleepUntilMs > 0)) return;
    const channel = await this.resolveNowPlayingChannel?.(guildId, state);
    if (!channel?.send) return;
    const message = await channel.send(buildSleepWarningPayload({ t: translatorFor(this, guildId), sleepUntilMs: state.sleepUntilMs }));
    state.sleepWarning = { channelId: channel.id, messageId: message?.id || null };
  },

  /** Ten steps down to silence, then the stream stops; the volume setting stays. */
  fadeOutForSleep(guildId) {
    const state = this.guildState?.get?.(guildId);
    if (!state?.currentStationKey || !(state.sleepUntilMs > 0)) return;
    const startVolume = Math.max(0, Math.min(100, Number(state.volume ?? 100)));
    const stepMs = SLEEP_FADE_MS / SLEEP_FADE_STEPS;
    state.sleepFading = true;
    let step = 0;
    const next = () => {
      step += 1;
      const transformer = state.player?.state?.resource?.volume;
      applyVolumeTransformerLevel(transformer, Math.round(startVolume * (1 - step / SLEEP_FADE_STEPS)));
      if (step < SLEEP_FADE_STEPS) {
        state.sleepTimers = { ...(state.sleepTimers || {}), fade: setTimeout(next, stepMs) };
        return;
      }
      state.sleepFading = false;
      this.finishSleep(guildId).catch((err) => {
        log("WARN", `[${this.config?.name}] Sleep-Stopp fehlgeschlagen (guild=${guildId}): ${err?.message || err}`);
      });
    };
    state.sleepTimers = { ...(state.sleepTimers || {}), fade: setTimeout(next, stepMs) };
  },

  /** "+30 min" and "off" on the warning: same /perm rule as /sleep, the message changes in place. */
  async handleSleepControl(interaction, action) {
    const { t } = this.createInteractionTranslator(interaction);
    const permission = this.checkCommandRolePermission?.(interaction, "sleep");
    if (permission && !permission.ok) {
      await interaction.reply(ui.reply(ui.notice("warning", {
        title: t("Nicht erlaubt", "Not allowed"),
        body: permission.message || t("Dafür fehlen dir die Rechte.", "You are not allowed to do that."),
      })));
      return true;
    }
    const result = action === "sleepextend"
      ? await this.extendSleepTimerInGuild(interaction.guildId)
      : await this.setSleepTimerInGuild(interaction.guildId, 0);
    if (!result.ok) {
      await interaction.reply(ui.reply(ui.notice("info", {
        title: t("Kein Sleep-Timer", "No sleep timer"),
        body: t("Gerade läuft kein Sleep-Timer mehr.", "No sleep timer is running any more."),
      })));
      return true;
    }
    await interaction.update({
      ...buildSleepStatePayload({ t, kind: action === "sleepextend" ? "extended" : "off", sleepUntilMs: result.sleepUntilMs }),
      flags: MessageFlags.IsComponentsV2,
    });
    return true;
  },

  async finishSleep(guildId) {
    const state = this.guildState?.get?.(guildId);
    const sleepUntilMs = state?.sleepUntilMs || Date.now();
    const warning = state?.sleepWarning || null;
    log("INFO", `[${this.config?.name}] Sleep-Timer abgelaufen, Stream wird gestoppt (guild=${guildId})`);
    await this.stopInGuild(guildId);
    if (warning?.messageId) {
      const guild = this.client?.guilds?.cache?.get?.(guildId);
      const channel = guild?.channels?.cache?.get?.(warning.channelId);
      const message = await channel?.messages?.fetch?.(warning.messageId).catch(() => null);
      await message?.edit?.(buildSleepStatePayload({ t: translatorFor(this, guildId), kind: "asleep", sleepUntilMs })).catch(() => null);
    }
  },
};

export { sleepMethods };
