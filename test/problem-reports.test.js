import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { botTranslator } from "../src/lib/bot-i18n.js";

// Problems, ideas and feedback from Discord (#436): a report goes to a
// private team channel first. Public it becomes only after a team member's
// click AND with the reporter's consent, and then without server and name.
// Without a team channel nothing is posted anywhere. The parts with the
// stored reports skip without MONGO_URL.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-reports-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const { normalizeReportSettings, publicReportView, readConsents, cleanReportText, reportThreadName } = await import("../src/lib/problem-reports.js");
const { buildTeamReportMessage, buildForumReportPost, parseReportActionId, reportActionId } = await import("../src/bot/problem-report-messages.js");
const { buildReportModal, readReportForm, reportFormId, readProblemReport } = await import("../src/bot/forms.js");
const service = await import("../src/services/problem-reports.js");
const { buildCommandsJson } = await import("../src/commands.js");
const { setOwnerSettingsForTests } = await import("../src/lib/owner-settings-cache.js");
const { setLicenseProvider } = await import("../src/core/entitlements.js");
const { createDashboardReportsRouteHandler } = await import("../src/api/routes/dashboard-reports.js");
const { getRecentRuntimeIncidents, describeRuntimeIncident } = await import("../src/runtime-incidents-store.js");

const GUILD = "123456789012345678";
const USER = "323456789012345678";
const TEAM_USER = "423456789012345678";
const TEAM = "523456789012345678";
const FORUM = "623456789012345678";
const OPEN_CHANNEL = "723456789012345678";
setLicenseProvider((serverId) => (String(serverId) === GUILD ? { plan: "pro", active: true, seats: 1 } : null));

const created = [];
after(async () => {
  setOwnerSettingsForTests({});
  if (hasMongoConfig) {
    const { getDb, isConnected, close } = await import("../src/lib/db.js");
    if (isConnected()) await getDb().collection("problem_reports").deleteMany({ _id: { $in: created } }).catch(() => null);
    await close().catch(() => null);
  }
  fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3 });
});

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  return out;
}
const allText = (payload) => (payload.components || []).flatMap((component) => texts(component)).join("\n");
const buttons = (payload) => JSON.stringify(payload.components.map((component) => (component.toJSON ? component.toJSON() : component)));

/** A Discord text channel; @everyone sees it only when asked to. */
function textChannel(id, { everyoneCanView = false } = {}) {
  const everyone = { id: "everyone" };
  const channel = {
    id,
    type: ChannelType.GuildText,
    sent: [],
    guild: { roles: { everyone } },
    permissionsFor: (role) => ({ has: (bit) => !(role === everyone && bit === PermissionFlagsBits.ViewChannel) || everyoneCanView }),
    async send(payload) {
      channel.sent.push(payload);
      return { id: `8${String(channel.sent.length).padStart(17, "0")}` };
    },
  };
  return channel;
}

const TAGS = [{ id: "111111111111111101", name: "Neu" }, { id: "111111111111111102", name: "in arbeit" }, { id: "111111111111111103", name: "Erledigt" }];

function forumChannel(id) {
  const forum = {
    id,
    type: ChannelType.GuildForum,
    availableTags: TAGS,
    posts: [],
    threads: {
      async create(options) {
        forum.posts.push(options);
        return { id: "923456789012345678" };
      },
    },
  };
  return forum;
}

function discordClient(channels) {
  const client = { fetched: [], channels: { async fetch(id) { client.fetched.push(id); return channels[id] || null; } } };
  return client;
}

/** The stored reports in memory, with the store's promises (claims once, publishes once). */
function memoryStore(reports) {
  const byId = new Map(reports.map((report) => [report._id, structuredClone(report)]));
  return {
    byId,
    posted: [],
    async claimPendingReport() {
      const next = [...byId.values()].find((report) => report.dispatch.state === "pending");
      if (!next) return null;
      next.dispatch = { ...next.dispatch, state: "claimed", attempts: next.dispatch.attempts + 1 };
      return structuredClone(next);
    },
    async markReportPosted(id, { channelId, messageId }) {
      const report = byId.get(id);
      report.dispatch.state = "posted";
      report.team = { channelId, messageId };
      this.posted.push(id);
    },
    async markReportUnposted(id, { error }) { Object.assign(byId.get(id).dispatch, { state: "pending", error }); },
    async findProblemReport(id) { return byId.has(id) ? structuredClone(byId.get(id)) : null; },
    async claimReportPublishing(id) {
      const report = byId.get(id);
      if (!report || report.forum || !report.consent.public) return null;
      report.forum = { channelId: "", threadId: "" };
      return structuredClone(report);
    },
    async completeReportPublishing(id, { channelId, threadId }) {
      const report = byId.get(id);
      report.forum = { channelId, threadId };
      return structuredClone(report);
    },
    async releaseReportPublishing(id) { byId.get(id).forum = null; },
    async decideProblemReport(id, decision, { by, answer = "" }) {
      const report = byId.get(id);
      Object.assign(report, { status: decision, decidedBy: by }, answer ? { answer } : {});
      return structuredClone(report);
    },
    async markReportNotified(id, { ok }) { byId.get(id).notified = { ok }; },
  };
}

const report = (overrides = {}) => ({
  _id: "0123456789abcdef",
  kind: "problem",
  text: "LoFi Beats hängt seit gestern Abend.\n<@111111111111111111> schau mal",
  reason: null,
  source: "command",
  guild: { id: GUILD, name: "Lofi Lounge" },
  bot: { id: "bot-2", name: "OmniFM 1" },
  station: { key: "pro_urban_09", name: "LoFi Beats" },
  plan: "pro",
  phases: [],
  consent: { public: true, notify: true },
  reporter: { userId: USER, name: "Alex" },
  status: "new",
  dispatch: { state: "pending", attempts: 0 },
  team: null,
  forum: null,
  ...overrides,
});

const settings = normalizeReportSettings({ teamChannelId: TEAM, forums: { problem: FORUM } });
const teamAccount = (id) => (id === TEAM_USER ? { discordId: id, name: "Fabian", role: "support" } : id === USER ? { discordId: id, name: "Alex", role: "billing" } : null);

function click(action, id, { userId = TEAM_USER, client = discordClient({}), customId = reportActionId(action, id), fields = null } = {}) {
  const calls = [];
  return {
    calls,
    client,
    customId,
    fields,
    user: { id: userId },
    async reply(payload) { calls.push(["reply", payload]); },
    async update(payload) { calls.push(["update", payload]); },
    async showModal(modal) { calls.push(["modal", modal]); },
  };
}

test("the owner's settings keep channel IDs only; without a team channel reports are not configured", () => {
  assert.deepEqual(normalizeReportSettings({ teamChannelId: " 523456789012345678 ", forums: { problem: FORUM, idea: "not-an-id", other: FORUM }, tags: { done: "  Gelöst  ", rejected: "", duplicate: "x".repeat(40) } }), {
    teamChannelId: TEAM,
    forums: { problem: FORUM, idea: "", feedback: "" },
    tags: { new: "Neu", "in-progress": "In Arbeit", done: "Gelöst", rejected: "", duplicate: "x".repeat(20) },
  });
  assert.equal(normalizeReportSettings({}).teamChannelId, "");
  assert.deepEqual(readConsents(["public"]), { public: true, notify: false });
  assert.equal(cleanReportText("  a   b \n\n\n\n c "), "a b\n\nc");
  assert.equal(reportThreadName({ text: "x".repeat(200) }).length, 90);
});

test("only a private text channel receives the team's cards", () => {
  assert.equal(service.isPrivateTeamChannel(textChannel(TEAM)), true);
  assert.equal(service.isPrivateTeamChannel(textChannel(OPEN_CHANNEL, { everyoneCanView: true })), false, "a channel @everyone can see is public");
  assert.equal(service.isPrivateTeamChannel(forumChannel(FORUM)), false, "a forum is public by design");
  assert.equal(service.isPrivateTeamChannel(null), false);
});

test("a report goes only to the team channel, with server, bot, station, plan and reporter; nobody is pinged", async () => {
  const team = textChannel(TEAM);
  const forum = forumChannel(FORUM);
  const client = discordClient({ [TEAM]: team, [FORUM]: forum });
  const store = memoryStore([report()]);
  const result = await service.dispatchPendingReports(client, { settings, store });
  assert.deepEqual(result, { posted: 1 });
  assert.deepEqual(client.fetched, [TEAM], "only the team channel is touched");
  assert.equal(forum.posts.length, 0, "nothing public without a click");
  const [card] = team.sent;
  const text = allText(card);
  for (const part of ["Lofi Lounge", GUILD, "OmniFM 1", "LoFi Beats", "Plan: Pro", `<@${USER}>`, "darf ins Forum", "möchte Bescheid", "LoFi Beats hängt"]) {
    assert.ok(text.includes(part), `the card shows ${part}`);
  }
  assert.deepEqual(card.allowedMentions, { parse: [] });
  assert.match(buttons(card), /Im Forum veröffentlichen/);
  assert.equal(store.byId.get("0123456789abcdef").team.channelId, TEAM);
});

test("a channel @everyone can see never gets a report, and neither does anything without a team channel", async () => {
  const open = textChannel(OPEN_CHANNEL, { everyoneCanView: true });
  const store = memoryStore([report()]);
  const client = discordClient({ [OPEN_CHANNEL]: open });
  const openSettings = normalizeReportSettings({ teamChannelId: OPEN_CHANNEL });
  assert.deepEqual(await service.dispatchPendingReports(client, { settings: openSettings, store }), { posted: 0 });
  assert.equal(open.sent.length, 0);
  assert.equal(store.byId.get("0123456789abcdef").dispatch.state, "pending", "it waits instead");

  const nothing = discordClient({});
  const quietStore = memoryStore([report()]);
  assert.deepEqual(await service.dispatchPendingReports(nothing, { settings: normalizeReportSettings({}), store: quietStore }), { posted: 0 });
  assert.deepEqual(nothing.fetched, [], "no channel is even looked at");
  assert.equal(quietStore.byId.get("0123456789abcdef").dispatch.attempts, 0, "no report is taken");
});

test("public only after a team member's click AND the reporter's consent, without server, bot and name", async () => {
  const forum = forumChannel(FORUM);
  const client = discordClient({ [FORUM]: forum });

  // Somebody without an owner console account, and a billing account: no.
  for (const userId of ["999999999999999999", USER]) {
    const store = memoryStore([report()]);
    const stranger = click("publish", "0123456789abcdef", { userId, client });
    // eslint-disable-next-line no-await-in-loop -- one after the other
    assert.equal(await service.handleReportAction(stranger, { settings, store, account: teamAccount }), true);
    assert.match(stranger.calls[0][1].content, /nur das OmniFM-Team/);
  }
  assert.equal(forum.posts.length, 0);

  // Without the reporter's consent the team cannot publish either.
  const privateStore = memoryStore([report({ consent: { public: false, notify: false }, reporter: undefined })]);
  const noConsent = click("publish", "0123456789abcdef", { client });
  await service.handleReportAction(noConsent, { settings, store: privateStore, account: teamAccount });
  assert.match(noConsent.calls[0][1].content, /nicht zugestimmt/);
  assert.equal(forum.posts.length, 0);
  assert.doesNotMatch(buttons(buildTeamReportMessage(privateStore.byId.get("0123456789abcdef"), { forumChannelId: FORUM })), /Im Forum veröffentlichen/, "no button without consent");

  // With both: one post, without the server, its ID, the bot or a name.
  const store = memoryStore([report()]);
  const publish = click("publish", "0123456789abcdef", { client });
  await service.handleReportAction(publish, { settings, store, account: teamAccount });
  assert.equal(forum.posts.length, 1);
  const post = JSON.stringify(forum.posts[0]);
  for (const hidden of [GUILD, "Lofi Lounge", USER, "Alex", "OmniFM 1", "bot-2"]) assert.equal(post.includes(hidden), false, `the forum post has no ${hidden}`);
  assert.ok(post.includes("LoFi Beats hängt seit gestern Abend."));
  assert.ok(post.includes("📻 LoFi Beats"));
  assert.deepEqual(forum.posts[0].message.allowedMentions, { parse: [] }, "the mention in the text pings nobody");
  const [kind, card] = publish.calls[0];
  assert.equal(kind, "update");
  assert.match(allText(card), /Im Forum: <#923456789012345678>/);
  assert.doesNotMatch(buttons(card), /Im Forum veröffentlichen/, "published once, the button is gone");

  // A second click posts nothing.
  const again = click("publish", "0123456789abcdef", { client });
  await service.handleReportAction(again, { settings, store, account: teamAccount });
  assert.equal(forum.posts.length, 1);
  assert.match(again.calls[0][1].content, /schon im Forum/);
});

test("the forum post holds the text, the station and the plan, whatever the stored report holds", () => {
  const view = publicReportView(report());
  assert.deepEqual(Object.keys(view).sort(), ["kind", "plan", "station", "text"]);
  const post = buildForumReportPost(report());
  assert.equal(post.name, "LoFi Beats hängt seit gestern Abend.");
});

test("the team decides with one click; the card says who and when it is done", async () => {
  const store = memoryStore([report({ consent: { public: false, notify: false }, reporter: undefined })]);
  const done = click("done", "0123456789abcdef");
  await service.handleReportAction(done, { settings, store, account: teamAccount });
  const [kind, card] = done.calls[0];
  assert.equal(kind, "update");
  assert.match(allText(card), /Status: ✅ erledigt von Fabian/);
  const json = JSON.parse(buttons(card));
  const erledigt = JSON.stringify(json).match(/"label":"Erledigt"[^}]*"disabled":true|"disabled":true[^}]*"label":"Erledigt"/);
  assert.ok(erledigt, "done cannot be clicked twice");
  assert.equal(store.byId.get("0123456789abcdef").status, "done");
  assert.equal(parseReportActionId("omnifm:report:done:0123456789abcdef").action, "done");
  assert.equal(parseReportActionId("omnifm:report:drop:0123456789abcdef"), null);
});

test("somebody who asked to hear back: the team answers in a short form, the person gets a direct message (#437)", async () => {
  const sent = [];
  const reporterUser = { async send(payload) { sent.push(payload); } };
  const client = { channels: { async fetch() { return null; } }, users: { async fetch(id) { assert.equal(id, USER); return reporterUser; } } };
  const store = memoryStore([report({ language: "de" })]);

  // "In Arbeit" is a step on the way: no form, no message.
  const working = click("in-progress", "0123456789abcdef", { client });
  await service.handleReportAction(working, { settings, store, account: teamAccount });
  assert.equal(working.calls[0][0], "update");
  assert.match(allText(working.calls[0][1]), /Status: 🔧 in Arbeit von Fabian/);
  assert.equal(sent.length, 0);

  // "Erledigt" first asks for the answer ...
  const done = click("done", "0123456789abcdef", { client });
  await service.handleReportAction(done, { settings, store, account: teamAccount });
  assert.equal(done.calls[0][0], "modal");
  assert.equal(done.calls[0][1].toJSON().custom_id, "omnifm:report:answer:done:0123456789abcdef");
  assert.equal(store.byId.get("0123456789abcdef").status, "in-progress", "nothing decided before the form");

  // ... and the form decides, answers and tells the person.
  const answered = click("done", "0123456789abcdef", {
    client,
    customId: "omnifm:report:answer:done:0123456789abcdef",
    fields: { getTextInputValue: (id) => (id === "answer" ? "Ist mit 3.14 behoben." : "") },
  });
  await service.handleReportAction(answered, { settings, store, account: teamAccount });
  assert.equal(sent.length, 1);
  const dm = allText(sent[0]);
  assert.match(dm, /Deine Meldung an OmniFM ist erledigt/);
  assert.match(dm, /Antwort des Teams:\*\* Ist mit 3\.14 behoben\./);
  assert.match(dm, /LoFi Beats hängt seit gestern Abend/);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  const card = allText(answered.calls[0][1]);
  assert.match(card, /Status: ✅ erledigt von Fabian/);
  assert.match(card, /Antwort: Ist mit 3\.14 behoben\./);
  assert.match(card, /📬 Bescheid gegeben/);

  // A second decision does not message again ("rejected" without the form now).
  const rejected = click("rejected", "0123456789abcdef", { client });
  await service.handleReportAction(rejected, { settings, store, account: teamAccount });
  assert.equal(rejected.calls[0][0], "update");
  assert.equal(sent.length, 1);
});

test("closed direct messages: the card says so; duplicates and people without \"tell me\" get none", async () => {
  const client = { channels: { async fetch() { return null; } }, users: { async fetch() { return { async send() { throw new Error("Cannot send messages to this user"); } }; } } };
  const store = memoryStore([report()]);
  const answered = click("rejected", "0123456789abcdef", { client, customId: "omnifm:report:answer:rejected:0123456789abcdef", fields: { getTextInputValue: () => "" } });
  await service.handleReportAction(answered, { settings, store, account: teamAccount });
  assert.match(allText(answered.calls[0][1]), /📭 Bescheid ging nicht/);

  let messaged = 0;
  const counting = { channels: { async fetch() { return null; } }, users: { async fetch() { messaged += 1; return { async send() {} }; } } };
  const duplicate = memoryStore([report()]);
  await service.handleReportAction(click("duplicate", "0123456789abcdef", { client: counting }), { settings, store: duplicate, account: teamAccount });
  const silent = memoryStore([report({ consent: { public: true, notify: false }, reporter: undefined })]);
  await service.handleReportAction(click("done", "0123456789abcdef", { client: counting }), { settings, store: silent, account: teamAccount });
  assert.equal(messaged, 0);
});

test("the forum post carries the tag of the status, found by its name (#437)", async () => {
  const forum = forumChannel(FORUM);
  const tagged = [];
  const thread = { id: "923456789012345678", parent: forum, async setAppliedTags(tags) { tagged.push(tags); } };
  const client = discordClient({ [FORUM]: forum, "923456789012345678": thread });
  const store = memoryStore([report({ consent: { public: true, notify: false }, reporter: undefined })]);
  await service.handleReportAction(click("publish", "0123456789abcdef", { client }), { settings, store, account: teamAccount });
  assert.deepEqual(forum.posts[0].appliedTags, ["111111111111111101"], "published as \"Neu\"");
  await service.handleReportAction(click("in-progress", "0123456789abcdef", { client }), { settings, store, account: teamAccount });
  await service.handleReportAction(click("done", "0123456789abcdef", { client }), { settings, store, account: teamAccount });
  assert.deepEqual(tagged, [["111111111111111101"], ["111111111111111102"], ["111111111111111103"]], "\"in arbeit\" matches \"In Arbeit\"; then \"Erledigt\"");
  await service.handleReportAction(click("duplicate", "0123456789abcdef", { client }), { settings, store, account: teamAccount });
  assert.deepEqual(tagged.at(-1), [], "a forum without the tag gets none");
});

test("/problem, /idee and /feedback: the form, and the commands in German with their descriptions", () => {
  const t = botTranslator("de");
  const modal = buildReportModal({ t, kind: "idea" }).toJSON();
  assert.equal(modal.custom_id, reportFormId("idea"));
  assert.equal(modal.title, "Idee vorschlagen");
  const form = readReportForm(reportFormId("feedback"), {
    getTextInputValue: (id) => (id === "text" ? "  Tolles   Radio!  " : ""),
    getStringSelectValues: (id) => (id === "options" ? ["notify"] : []),
  });
  assert.deepEqual(form, { kind: "feedback", text: "Tolles Radio!", consent: { public: false, notify: true } });
  assert.equal(readReportForm("omnifm:form:station", { getTextInputValue: () => "x", getStringSelectValues: () => [] }).kind, null);
  // The panel's form carries the two ticks too.
  assert.deepEqual(readProblemReport({ getTextInputValue: () => "", getStringSelectValues: (id) => (id === "reason" ? ["no_sound"] : ["public"]) }).consent, { public: true, notify: false });

  const commands = Object.fromEntries(buildCommandsJson().map((command) => [command.name, command]));
  assert.equal(commands.report.name_localizations.de, "problem");
  assert.equal(commands.idea.name_localizations.de, "idee");
  assert.equal(commands.feedback.description_localizations.de, "Dem OmniFM-Team sagen, was du denkst");
  assert.equal(commands.report.description_localizations.fr, "Signaler un problème avec OmniFM à l'équipe");
});

test("stored reports: the Discord ID only with \"tell me\", claimed once, kept 180 days after the decision", { skip: !hasMongoConfig }, async () => {
  const { connect } = await import("../src/lib/db.js");
  await connect();
  const store = await import("../src/problem-reports-store.js");
  const now = Date.now();
  const quiet = await store.createProblemReport({ kind: "idea", text: "Mehr Jazz", consent: { public: true }, reporter: { userId: USER, name: "Alex" }, guild: { id: GUILD, name: "Club" } }, { now });
  const loud = await store.createProblemReport({ kind: "problem", text: "Kein Ton", consent: { notify: true }, reporter: { userId: USER, name: "Alex" } }, { now });
  created.push(quiet.report._id, loud.report._id);
  assert.equal(quiet.report.reporter, undefined, "without \"tell me\" no ID");
  assert.deepEqual(loud.report.reporter, { userId: USER, name: "Alex" });
  assert.equal(quiet.report.expiresAt.getTime(), now + store.KEEP_OPEN_MS);

  const first = await store.claimReport(quiet.report._id, { now });
  const second = await store.claimReport(quiet.report._id, { now });
  assert.equal(first.dispatch.state, "claimed");
  assert.equal(second, null, "a second commander does not post it again");

  const decided = await store.decideProblemReport(loud.report._id, "done", { by: { id: TEAM_USER, name: "Fabian" }, now });
  assert.equal(decided.status, "done");
  assert.equal(decided.expiresAt.getTime(), now + store.KEEP_DECIDED_MS);
  assert.equal(await store.claimReportPublishing(loud.report._id), null, "no consent, no forum");
});

test("the commander posts /problem at once; a worker's panel report waits for the commander's round", { skip: !hasMongoConfig }, async () => {
  const { connect } = await import("../src/lib/db.js");
  await connect();
  const { BotRuntime } = await import("../src/bot/runtime.js");
  const { findProblemReport } = await import("../src/problem-reports-store.js");
  setOwnerSettingsForTests({ reports: { teamChannelId: TEAM, forums: { problem: FORUM } } });
  const team = textChannel(TEAM);
  const client = discordClient({ [TEAM]: team });

  const commander = Object.create(BotRuntime.prototype);
  Object.assign(commander, { config: { id: "bot-commander", name: "OmniFM DJ" }, role: "commander", client, resolveInteractionLanguage: () => "de" });
  const calls = [];
  const command = {
    customId: reportFormId("problem"),
    guildId: GUILD,
    guild: { id: GUILD, name: "Lofi Lounge" },
    user: { id: `9${String(Date.now()).padStart(17, "0")}`, username: "alex" },
    fields: { getTextInputValue: (id) => (id === "text" ? "Der Bot spielt nicht" : ""), getStringSelectValues: (id) => (id === "options" ? ["notify"] : []) },
    isModalSubmit: () => true,
    async reply(payload) { calls.push(payload); },
  };
  await commander.handleFormSubmit(command);
  assert.match(allText(calls[0]), /Danke für die Meldung[\s\S]*beim OmniFM-Team angekommen[\s\S]*Direktnachricht/);
  assert.equal(team.sent.length, 1, "posted at once");
  const stored = await findProblemReport(allText(team.sent[0]).match(/Meldung ([a-f0-9]{16})/)[1]);
  created.push(stored._id);
  assert.equal(stored.dispatch.state, "posted");
  assert.equal(stored.team.channelId, TEAM);

  const worker = Object.create(BotRuntime.prototype);
  Object.assign(worker, {
    config: { id: "bot-2", name: "OmniFM 1" },
    role: "worker",
    resolveInteractionLanguage: () => "de",
    guildState: new Map([[GUILD, { currentStationKey: "groovesalad", currentStationName: "Groove Salad", playbackPhaseHistory: [] }]]),
  });
  const panelCalls = [];
  const panel = {
    customId: "np:reportform",
    guildId: GUILD,
    guild: { id: GUILD, name: "Lofi Lounge" },
    user: { id: `8${String(Date.now()).padStart(17, "0")}`, username: "bea" },
    fields: { getTextInputValue: () => "", getStringSelectValues: (id) => (id === "reason" ? ["no_sound"] : ["public"]) },
    isModalSubmit: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    async reply(payload) { panelCalls.push(payload); },
  };
  await worker.handleNowPlayingControl(panel);
  assert.match(allText(panelCalls[0]), /Danke für die Meldung/);
  assert.equal(team.sent.length, 1, "the worker does not post; the commander does");
  const round = await service.dispatchPendingReports(client, { settings: service.reportSettings() });
  assert.ok(round.posted >= 1);
  const panelCard = team.sent.map(allText).find((text) => text.includes("Groove Salad"));
  assert.ok(panelCard, "the panel's report reached the team with its station");
  assert.match(panelCard, /Kein Ton/);
  created.push(panelCard.match(/Meldung ([a-f0-9]{16})/)[1]);
});

// ---- the dashboard's "Melden" (#436) ----

function dashboardRoute(userId) {
  const answers = [];
  const handle = createDashboardReportsRouteHandler({
    getDashboardRequestTranslator: () => ({ language: "de" }),
    getDashboardSession: () => ({ session: { user: { id: userId, username: "alex", globalName: "Alex" } } }),
    getLocalizedJsonBodyError: () => "Ungültiger Body.",
    methodNotAllowed: () => answers.push([405, null]),
    resolveDashboardGuildForSession: (_session, id) => (id === GUILD ? { id: GUILD, name: "Lofi Lounge", tier: "pro" } : null),
    sendJson: (_res, status, body) => answers.push([status, body]),
    sendLocalizedError: (_res, status, _language, german) => answers.push([status, { error: german }]),
  });
  const send = (body, { runtimes = [], serverId = GUILD } = {}) => handle({
    req: { method: "POST" },
    res: {},
    requestUrl: new URL(`https://omnifm.local/api/dashboard/reports?serverId=${serverId}`),
    readJsonBody: async () => body,
    runtimes,
  });
  return { answers, send };
}

test("dashboard: without a team channel nothing goes to Discord, the owner console keeps it, and the page is told", async () => {
  setOwnerSettingsForTests({});
  const route = dashboardRoute("111111111111111111");
  assert.equal(await route.send({ kind: "feedback", text: "Tolles Radio, danke!", consent: { public: true } }), true);
  assert.deepEqual(route.answers[0], [200, { ok: false, reason: "unavailable" }]);
  const [incident] = await getRecentRuntimeIncidents(GUILD, 3);
  assert.equal(incident.payload.kind, "feedback");
  assert.equal(describeRuntimeIncident("listener_report", incident.payload, "Lofi Lounge"), "Lofi Lounge: Feedback von einem Hörer: Tolles Radio, danke!");
  assert.equal(JSON.stringify(incident).includes("111111111111111111"), false, "nobody's ID in the incident");

  // One report per person and five minutes; a text of a few words at least; only one's own servers.
  await route.send({ kind: "idea", text: "Noch eine Idee" });
  assert.deepEqual(route.answers[1], [200, { ok: false, reason: "cooldown" }]);
  const other = dashboardRoute("222222222222222222");
  await other.send({ kind: "problem", text: "ok" });
  assert.deepEqual(other.answers[0], [400, { ok: false, reason: "text" }]);
  await other.send({ kind: "problem", text: "Kein Ton" }, { serverId: "999999999999999999" });
  assert.equal(other.answers[1][0], 403);
});

test("dashboard: with a team channel the commander in this process posts the report at once", { skip: !hasMongoConfig }, async () => {
  const { connect } = await import("../src/lib/db.js");
  await connect();
  setOwnerSettingsForTests({ reports: { teamChannelId: TEAM } });
  const team = textChannel(TEAM);
  const route = dashboardRoute(`7${String(Date.now()).padStart(17, "0")}`);
  await route.send({ kind: "problem", text: "Das Dashboard zeigt keine Hörer", consent: { notify: true } }, { runtimes: [{ role: "commander", client: discordClient({ [TEAM]: team }) }] });
  assert.deepEqual(route.answers[0], [200, { ok: true, waiting: false }]);
  const card = allText(team.sent[0]);
  assert.match(card, /Problem aus dem Dashboard/);
  assert.match(card, /Lofi Lounge/);
  assert.match(card, /möchte Bescheid/);
  created.push(card.match(/Meldung ([a-f0-9]{16})/)[1]);
  setOwnerSettingsForTests({});
});

