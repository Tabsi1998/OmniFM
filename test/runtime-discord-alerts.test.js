import test from "node:test";
import assert from "node:assert/strict";

import { dispatchRuntimeIncidentAlert } from "../src/lib/runtime-discord-alerts.js";

test("runtime discord incident alerts deliver selected events to the configured text channel", async () => {
  let sentPayload = null;
  let sendCalls = 0;
  const channel = {
    id: "523456789012345678",
    type: 0,
    name: "alerts",
    permissionsFor: () => ({ has: () => true }),
    async send(payload) {
      sendCalls += 1;
      sentPayload = payload;
      return { id: "message-1" };
    },
  };
  const guild = { id: "123456789012345678", name: "OmniFM Guild" };

  const result = await dispatchRuntimeIncidentAlert({
    runtime: {
      resolveGuildLanguage: () => "en",
    },
    guildId: "123456789012345678",
    guildName: "OmniFM Guild",
    tier: "ultimate",
    eventKey: "stream_failover_exhausted",
    payload: {
      runtime: { name: "OmniFM Test" },
      previousStationName: "Nightwave FM",
      attemptedCandidates: ["rock", "jazz"],
      triggerError: "timeout",
      streamErrorCount: 3,
      listenerCount: 4,
    },
  }, {
    hasCapability: () => true,
    loadConfig: async () => ({
      enabled: true,
      channelId: "523456789012345678",
      events: ["stream_failover_exhausted"],
    }),
    resolveGuild: async () => guild,
    resolveBotMember: async () => ({ id: "bot-1" }),
    resolveChannel: async () => channel,
  });

  assert.equal(result.delivered, true);
  assert.equal(result.channelId, "523456789012345678");
  assert.equal(result.responseId, "message-1");
  assert.equal(sendCalls, 1);
  assert.match(String(sentPayload?.embeds?.[0]?.data?.title || ""), /No station reachable/i);
  assert.match(String(sentPayload?.embeds?.[0]?.data?.description || ""), /Nightwave FM/i);
  assert.equal(
    sentPayload?.embeds?.[0]?.data?.fields?.some((field) => /error|reconnect|failover chain/i.test(String(field?.name || ""))) || false,
    false
  );
});

test("runtime discord incident alerts skip unselected events without sending", async () => {
  let sendCalls = 0;

  const result = await dispatchRuntimeIncidentAlert({
    guildId: "123456789012345678",
    guildName: "OmniFM Guild",
    tier: "ultimate",
    eventKey: "stream_recovered",
    payload: {},
  }, {
    hasCapability: () => true,
    loadConfig: async () => ({
      enabled: true,
      channelId: "523456789012345678",
      events: ["stream_failover_exhausted"],
    }),
    send: async () => {
      sendCalls += 1;
      return { id: "message-1" };
    },
  });

  assert.equal(result.skipped, "event-policy");
  assert.equal(sendCalls, 0);
});

test("runtime discord incident alerts respect capability gating before loading config", async () => {
  let loadCalls = 0;

  const result = await dispatchRuntimeIncidentAlert({
    guildId: "123456789012345678",
    guildName: "OmniFM Guild",
    tier: "pro",
    eventKey: "stream_recovered",
    payload: {},
  }, {
    hasCapability: () => false,
    loadConfig: async () => {
      loadCalls += 1;
      return null;
    },
  });

  assert.equal(result.skipped, "capability");
  assert.equal(loadCalls, 0);
});

test("incident alerts explain a backup station in plain German", async () => {
  const { buildRuntimeIncidentAlertMessage } = await import("../src/lib/runtime-discord-alerts.js");
  const message = buildRuntimeIncidentAlertMessage({
    language: "de",
    guildName: "Guild One",
    eventKey: "stream_failover_activated",
    payload: { previousStationName: "Alpha FM", failoverStationName: "Beta FM", listenerCount: 3 },
  });
  const embed = message.embeds[0].data;
  assert.equal(embed.title, "Ersatzsender läuft");
  assert.match(embed.description, /Alpha FM ist gerade nicht erreichbar\. OmniFM spielt vorübergehend Beta FM/);
  assert.doesNotMatch(`${embed.title} ${embed.description}`, /failover|verfuegbar|ausgeschoepft/i);
  assert.deepEqual(embed.fields.map((field) => field.name), ["Betroffener Sender", "Ersatzsender", "Hörer"]);
});
