// ============================================================
// OmniFM Radio (#594): one attempt per DM
// ============================================================
// discord.js sends through @discordjs/rest with three retries and waits out
// every 429. For the owner DMs both are wrong: a POST that timed out may
// already have been delivered (a retry can send a second DM), and a wait on
// a rate limit ignores the kill switch and the end of the show. So the DMs
// use their own REST client with the commander's token: no retries, and a
// rate limit rejects at once (the distribution then stops).
import { REST, RateLimitError } from "@discordjs/rest";
import { Routes } from "discord.js";

export function createRadioDmRest(token) {
  return new REST({ version: "10", retries: 0, rejectOnRateLimit: () => true }).setToken(token);
}

/** A payload of src/discord/ui as the JSON body Discord takes; the builders are checked here. */
export function radioDmBody(payload) {
  return {
    components: (payload?.components || []).map((component) => (typeof component?.toJSON === "function" ? component.toJSON() : component)),
    flags: payload?.flags,
    allowed_mentions: { parse: [] },
  };
}

/** Whether Discord answered with a rate limit (a pre-emptive one of @discordjs/rest or a 429). */
export function isRadioDmRateLimit(error) {
  return error instanceof RateLimitError || error?.status === 429;
}

/**
 * Opens the DM channel and sends the message, each one request.
 * @param {{ token?: string, rest?: { post: (route: string, options: any) => Promise<any> } }} options
 */
export function createRadioDmSender({ token, rest = createRadioDmRest(token) }) {
  return {
    async send(userId, body) {
      const channel = await rest.post(Routes.userChannels(), { body: { recipient_id: userId } });
      if (!channel?.id) throw new Error("Discord hat keinen DM-Kanal zurückgegeben.");
      await rest.post(Routes.channelMessages(channel.id), { body });
    },
    stop() {
      // @ts-ignore -- only the real REST client has sweepers
      rest.clearHashSweeper?.();
      // @ts-ignore
      rest.clearHandlerSweeper?.();
    },
  };
}
