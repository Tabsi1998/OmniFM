// ============================================================
// OmniFM Radio (#594): one attempt per DM
// ============================================================
// discord.js sends through @discordjs/rest with three retries and waits out
// every 429. For the owner DMs both are wrong: a POST that timed out may
// already have been delivered (a retry can send a second DM), and a wait on
// a rate limit ignores the kill switch and the end of the show. So the DMs
// use their own REST client with the commander's token: no retries, a rate
// limit rejects at once, and the run's AbortSignal cancels a request.
// Two kinds of rate limit come back as RateLimitError:
//   - a real 429 from Discord (radioDmTooManyRequests): the run brakes;
//   - a lock the client sets itself before asking Discord (radioDmWaitMs):
//     nothing was sent, the run may wait that long and send the DM then.
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

/** Discord answered with a 429 (or the client rejected that answer). */
export function isRadioDmRateLimit(error) {
  return error?.radioDmTooManyRequests === true || error?.status === 429;
}

/** How long the client's own lock lasts, or null. Under such a lock nothing reached Discord. */
export function radioDmWaitMs(error) {
  if (Number.isFinite(error?.radioDmWaitMs)) return Math.max(0, error.radioDmWaitMs);
  if (error instanceof RateLimitError && error.radioDmTooManyRequests !== true) return Math.max(0, Number(error.timeToReset) || 0);
  return null;
}

/**
 * Opens the DM channel and sends the message, each one request.
 * @param {{ token?: string, rest?: { post: (route: any, options: any) => Promise<any>, on?: (event: string, listener: (...args: any[]) => void) => any } }} options
 */
export function createRadioDmSender({ token, rest = createRadioDmRest(token) }) {
  // Set by the answer to the request that runs now; the requests run one after the other.
  let tooManyRequests = false;
  rest.on?.("response", (_request, response) => {
    if (response?.status === 429) tooManyRequests = true;
  });

  async function post(route, options) {
    tooManyRequests = false;
    try {
      return await rest.post(route, options);
    } catch (error) {
      if (error instanceof RateLimitError) {
        Object.assign(error, tooManyRequests
          ? { radioDmTooManyRequests: true }
          : { radioDmWaitMs: Math.max(0, Number(error.timeToReset) || 0) });
      }
      throw error;
    }
  }

  return {
    /** @param {{ signal?: AbortSignal }} [options] */
    async send(userId, body, { signal } = {}) {
      const channel = await post(Routes.userChannels(), { body: { recipient_id: userId }, signal });
      if (!channel?.id) throw new Error("Discord hat keinen DM-Kanal zurückgegeben.");
      await post(Routes.channelMessages(channel.id), { body, signal });
    },
    stop() {
      // @ts-ignore -- only the real REST client has sweepers
      rest.clearHashSweeper?.();
      // @ts-ignore
      rest.clearHandlerSweeper?.();
    },
  };
}
