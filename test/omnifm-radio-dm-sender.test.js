import test from "node:test";
import assert from "node:assert/strict";

// OmniFM Radio DMs (#594): one attempt per DM. discord.js would retry a
// timed-out POST (which can deliver twice) and wait out a 429 (which
// ignores the kill switch and the end of the show); this sender does neither.
import { MessageFlags } from "discord.js";
import { RateLimitError } from "@discordjs/rest";
import { createRadioDmRest, createRadioDmSender, isRadioDmRateLimit, radioDmBody, radioDmWaitMs } from "../src/services/omnifm-radio-dm-sender.js";
import { buildRadioDmMessage } from "../src/bot/omnifm-radio-dm-message.js";

const USER = "200000000000000001";
const SHOW = { streamerName: "DJ Tabsi", title: "Abendshow", startedAt: "2026-11-25T20:00:00.000Z", source: "webhook" };
const CONFIG = { baseUrl: "https://radio.omnifm.xyz", station: "omnifm_radio" };

const rateLimit = () => new RateLimitError({ timeToReset: 5000, limit: 1, method: "POST", hash: "h", url: "u", route: "/channels/:id/messages", majorParameter: "1", global: false, retryAfter: 5000, sublimitTimeout: 0, scope: "user" });

/** A REST stand-in: `fail.at` is the post that fails; `fail.response` is the status Discord answered first. */
function fakeRest({ fail = null } = {}) {
  const posts = [];
  const listeners = [];
  return {
    posts,
    on(event, listener) {
      if (event === "response") listeners.push(listener);
      return this;
    },
    async post(route, options) {
      posts.push({ route, body: options?.body, signal: options?.signal });
      if (fail && posts.length === fail.at) {
        if (fail.response) for (const listener of listeners) listener({ route }, { status: fail.response });
        throw fail.error;
      }
      return route === "/users/@me/channels" ? { id: "900000000000000001" } : { id: "910000000000000001" };
    },
  };
}

test("the REST client of the DMs never retries and rejects a rate limit instead of waiting", async () => {
  const rest = createRadioDmRest("token");
  assert.equal(rest.options.retries, 0);
  assert.equal(await rest.options.rejectOnRateLimit({ route: "/channels/:id/messages" }), true);
  rest.clearHashSweeper();
  rest.clearHandlerSweeper();
});

test("a DM is one DM channel and one message, the body built from the design system", async () => {
  const rest = fakeRest();
  const body = radioDmBody(buildRadioDmMessage({ show: SHOW, language: "de", config: CONFIG }));
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.ok(body.flags & MessageFlags.IsComponentsV2);
  assert.equal(body.components[0].type, 17, "a container, as JSON");
  const controller = new AbortController();
  await createRadioDmSender({ rest }).send(USER, body, { signal: controller.signal });
  assert.deepEqual(rest.posts.map((post) => post.route), ["/users/@me/channels", "/channels/900000000000000001/messages"]);
  assert.deepEqual(rest.posts[0].body, { recipient_id: USER });
  assert.equal(rest.posts[1].body, body);
  assert.ok(rest.posts.every((post) => post.signal === controller.signal), "the kill switch can cancel both requests");
});

test("a real 429 from Discord is a rate limit, after one attempt", async () => {
  const rest = fakeRest({ fail: { at: 2, response: 429, error: rateLimit() } });
  const error = await createRadioDmSender({ rest }).send(USER, { components: [] }).then(() => null, (failure) => failure);
  assert.equal(isRadioDmRateLimit(error), true);
  assert.equal(radioDmWaitMs(error), null, "no waiting it out");
  assert.equal(rest.posts.length, 2, "no second message attempt");
  assert.equal(isRadioDmRateLimit(Object.assign(new Error("Too Many Requests"), { status: 429 })), true);
  assert.equal(isRadioDmRateLimit(Object.assign(new Error("Cannot send"), { code: 50007, status: 403 })), false);
});

test("a lock the REST client sets before asking Discord is a wait, not a rate limit", async () => {
  const rest = fakeRest({ fail: { at: 1, error: rateLimit() } });
  const error = await createRadioDmSender({ rest }).send(USER, { components: [] }).then(() => null, (failure) => failure);
  assert.equal(isRadioDmRateLimit(error), false);
  assert.equal(radioDmWaitMs(error), 5000);
  assert.equal(radioDmWaitMs(new Error("other")), null);

  // The 429 flag belongs to one request: after a 429, a later lock is still a lock.
  const both = fakeRest({ fail: { at: 2, response: 429, error: rateLimit() } });
  const sender = createRadioDmSender({ rest: both });
  await sender.send(USER, { components: [] }).catch(() => null);
  both.post = async () => { throw rateLimit(); };
  assert.equal(radioDmWaitMs(await sender.send(USER, {}).catch((failure) => failure)), 5000);
});
