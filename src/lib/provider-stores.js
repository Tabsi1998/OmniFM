// The bot list and vote stores in MongoDB (#292 wave 2), started together by
// the bot (shared.js) and the public entry (api-stores.js).
import { initBotsGGStore } from "../botsgg-store.js";
import { initDiscordBotListStore } from "../discordbotlist-store.js";
import { initTopGGStore } from "../topgg-store.js";
import { initVoteEventsStore } from "../vote-events-store.js";

export async function initProviderStores(options = {}) {
  await Promise.all([
    initTopGGStore(options),
    initDiscordBotListStore(options),
    initBotsGGStore(options),
    initVoteEventsStore(options),
  ]);
}
