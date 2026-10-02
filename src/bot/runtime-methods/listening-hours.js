// OmniFM: listening time per person, for the linked roles (#302). BotRuntime
// methods, mixed into BotRuntime.prototype in runtime.js. At every listener
// sample the commander adds the time to the people in voice channels where
// OmniFM plays, and only to those who switched counting on in /mydata.
import { addListeningTime, consentingUserIds } from "../../listening-hours-store.js";
import { LISTENER_STATS_POLL_MS } from "../runtime-shared.js";

const CONSENT_REFRESH_MS = 5 * 60 * 1000;

export const listeningHourMethods = {
  /** The people who switched counting on; from memory for five minutes. */
  async listeningConsentSet({ now = Date.now() } = {}) {
    if (this.listeningConsents && now - this.listeningConsentsAt < CONSENT_REFRESH_MS) return this.listeningConsents;
    this.listeningConsents = await consentingUserIds();
    this.listeningConsentsAt = now;
    return this.listeningConsents;
  },

  /** The switch in /mydata counts at once in this process. */
  noteListeningConsent(userId, on) {
    if (!this.listeningConsents) return;
    if (on) this.listeningConsents.add(String(userId));
    else this.listeningConsents.delete(String(userId));
  },

  /** Who listens in a voice channel, as the commander sees it: people, not bots, not deafened. */
  listeningUserIds(guildId, channelId) {
    const channel = this.client?.guilds?.cache?.get(String(guildId))?.channels?.cache?.get(String(channelId || ""));
    if (!channel?.isVoiceBased?.() || !channel.members) return [];
    const ids = [];
    for (const member of channel.members.values()) {
      if (member?.user?.bot || member?.voice?.deaf) continue;
      ids.push(String(member.id));
    }
    return ids;
  },

  /**
   * Adds the time since the last sample to everyone who listens and has
   * counting on. The first sample after a start only sets the clock.
   * @param {Map<string, string[]>} channelsByGuild  the voice channels OmniFM plays in, per server
   * @returns {Promise<number>} how many people got time
   */
  async countListeningTime(channelsByGuild, { now = Date.now() } = {}) {
    const elapsed = this.listeningCountedAt ? Math.min(Math.max(0, now - this.listeningCountedAt), LISTENER_STATS_POLL_MS * 2) : 0;
    this.listeningCountedAt = now;
    if (!elapsed) return 0;
    const consents = await this.listeningConsentSet({ now });
    if (!consents.size) return 0;
    const time = new Map();
    for (const [guildId, channelIds] of channelsByGuild) {
      for (const channelId of channelIds) {
        for (const userId of this.listeningUserIds(guildId, channelId)) {
          // One person is in one voice channel at a time.
          if (consents.has(userId)) time.set(userId, elapsed);
        }
      }
    }
    return addListeningTime(time, { now: new Date(now) });
  },
};
