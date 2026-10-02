// OmniFM: the server's jingle over the music (#309, Ultimate). BotRuntime
// methods, mixed into BotRuntime.prototype in runtime.js. The jingle goes
// through the mixer of the running stream (src/lib/jingle-mixer.js) when
// someone starts or switches the station (/play, the dashboard, favourites,
// events), on the full hour in the server's time zone, and from the
// dashboard's button. Restarts, fallbacks and restores stay quiet.
import { AudioPlayerStatus } from "@discordjs/voice";

import { log } from "../../lib/logging.js";
import { serverHasCapability } from "../../core/entitlements.js";
import { toSamples } from "../../lib/jingle-mixer.js";
import { fullHourKey, mayBeFullHourSomewhere, normalizeJingleSettings } from "../../lib/jingle-audio.js";
import { DEFAULT_SEASON_TIME_ZONE, isValidTimeZone } from "../../lib/seasons.js";
import { getGuildJingleInfo, getGuildJinglePcm } from "../../jingles-store.js";

const CLOCK_EVERY_MS = 15_000;
// Jingles each bot keeps in memory, the one played last at the end.
const CACHE_LIMIT = 6;
// A jingle shortly before the full hour (a switch at 13:59:30) makes the hour's one too many.
const HOUR_GAP_MS = 60_000;
const SETTINGS_MAX_AGE_MS = 15_000;

export const jingleMethods = {
  /** The server's jingle as samples; from memory while the stored one has not changed. */
  async loadGuildJingleSamples(guildId) {
    const info = await getGuildJingleInfo(guildId);
    if (!info) {
      this.jingleCache.delete(guildId);
      return null;
    }
    const cached = this.jingleCache.get(guildId);
    if (cached && cached.updatedAt === info.updatedAt) {
      this.jingleCache.delete(guildId);
      this.jingleCache.set(guildId, cached);
      return cached.samples;
    }
    const stored = await getGuildJinglePcm(guildId);
    if (!stored) return null;
    const samples = toSamples(stored.pcm);
    this.jingleCache.set(guildId, { updatedAt: stored.updatedAt, samples });
    while (this.jingleCache.size > CACHE_LIMIT) this.jingleCache.delete(this.jingleCache.keys().next().value);
    return samples;
  },

  /**
   * Plays the server's jingle over what this bot plays there now. reason
   * "switch" and "hour" follow the server's switches; "test", the
   * dashboard's button, always plays.
   * @param {string} guildId
   * @param {{ reason?: "switch" | "hour" | "test", now?: number }} [options]
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async playGuildJingle(guildId, { reason = "test", now = Date.now() } = {}) {
    const state = this.guildState.get(guildId);
    if (!state?.currentStationKey) return { ok: false, error: "not-playing" };
    const mixer = state.jingleMixer || null;
    // Without PCM (TRANSCODE_MODE=opus) there is nothing to mix into.
    if (!mixer) return { ok: false, error: "unsupported" };
    if (!serverHasCapability(guildId, "jingles")) return { ok: false, error: "plan" };
    const status = state.player?.state?.status;
    if (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused) return { ok: false, error: "paused" };
    if (reason !== "test") {
      const settings = await this.loadGuildSettingsCached(guildId, { maxAgeMs: SETTINGS_MAX_AGE_MS }).catch(() => ({}));
      const switches = normalizeJingleSettings(settings?.jingle);
      if (!(reason === "hour" ? switches.onHour : switches.onSwitch)) return { ok: false, error: "off" };
    }
    if (mixer.busy) return { ok: false, error: "busy" };
    const samples = await this.loadGuildJingleSamples(guildId);
    if (!samples) return { ok: false, error: "none" };
    // The stream may have changed, or another jingle started, while this one loaded.
    if (state.jingleMixer !== mixer || mixer.busy) return { ok: false, error: "busy" };
    // Before the first music the jingle needs no fade down: the station starts under it.
    mixer.play(samples, { fadeIn: mixer.flowing });
    state.lastJingleAt = now;
    return { ok: true };
  },

  /** The dashboard's button: the jingle now, whatever the switches say. */
  async playJingleFromDashboard(guildId) {
    return this.playGuildJingle(guildId, { reason: "test" });
  },

  /**
   * The full hour: every bot playing on an Ultimate server with the switch
   * on plays the jingle once, in the server's time zone.
   * @returns {Promise<number>} how many jingles started
   */
  async runJingleClock(moment = new Date()) {
    if (!mayBeFullHourSomewhere(moment)) return 0;
    let played = 0;
    for (const [guildId, state] of this.guildState.entries()) {
      if (!state?.jingleMixer || !state.currentStationKey) continue;
      if (!serverHasCapability(guildId, "jingles")) continue;
      // eslint-disable-next-line no-await-in-loop -- one server after the other, from the cache
      const settings = await this.loadGuildSettingsCached(guildId, { maxAgeMs: SETTINGS_MAX_AGE_MS }).catch(() => ({}));
      if (!normalizeJingleSettings(settings?.jingle).onHour) continue;
      const timeZone = isValidTimeZone(settings?.timeZone) ? settings.timeZone : DEFAULT_SEASON_TIME_ZONE;
      const hour = fullHourKey(moment, timeZone);
      if (!hour || state.jingleHourKey === hour) continue;
      if (moment.getTime() - (Number(state.lastJingleAt) || 0) < HOUR_GAP_MS) {
        state.jingleHourKey = hour;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- one server after the other
      const result = await this.playGuildJingle(guildId, { reason: "hour", now: moment.getTime() });
      // Busy: the next tick within the minute tries again.
      if (result.ok || result.error !== "busy") state.jingleHourKey = hour;
      if (result.ok) played += 1;
    }
    return played;
  },

  startJingleClock() {
    if (this.jingleClockTimer) return;
    this.jingleClockTimer = setInterval(() => {
      this.runJingleClock().catch((err) => {
        log("WARN", `[${this.config.name}] Jingle zur vollen Stunde: ${err?.message || err}`);
      });
    }, CLOCK_EVERY_MS);
    this.jingleClockTimer.unref?.();
  },

  stopJingleClock() {
    if (this.jingleClockTimer) clearInterval(this.jingleClockTimer);
    this.jingleClockTimer = null;
  },
};
