import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-share-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { createCanvas } = await import("@napi-rs/canvas");
const cards = await import("../src/lib/share-card.js");
const { createShareRoutesHandler, buildSharePageHtml } = await import("../src/api/routes/share-routes.js");
const { buildNowPlayingPanel } = await import("../src/bot/now-playing/now-playing-panel.js");
const { BotRuntime } = await import("../src/bot/runtime.js");

const de = (german) => german;
const noImage = async () => null;
const catalog = JSON.parse(fs.readFileSync(new URL("../stations.json", import.meta.url), "utf8")).stations;

/** Width and height from a PNG's header. */
function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("a now-playing card: 1200 x 630 PNG, under 300 ms and under 50 MB", async () => {
  cards.clearShareCardCacheForTests();
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  const png = await cards.renderNowPlayingCard({
    title: "Cafe del Mar", artist: "Energy 52", stationName: "Groove Salad", guildName: "eSports Club", color: "#14B8A6", fetchImage: noImage,
  });
  const elapsed = performance.now() - started;
  const grown = (process.memoryUsage().rss - rssBefore) / 1048576;
  assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
  assert.ok(elapsed < 300, `rendered in ${Math.round(elapsed)} ms`);
  assert.ok(grown < 50, `memory grew by ${Math.round(grown)} MB`);

  const again = await cards.renderNowPlayingCard({
    title: "Cafe del Mar", artist: "Energy 52", stationName: "Groove Salad", guildName: "eSports Club", color: "#14B8A6", fetchImage: noImage,
  });
  assert.equal(again, png, "the same card comes from the cache");
});

test("a station card uses the logo when it loads, the colour with a letter when not", async () => {
  cards.clearShareCardCacheForTests();
  const logo = createCanvas(64, 64);
  logo.getContext("2d").fillRect(0, 0, 64, 64);
  const withLogo = await cards.renderStationCard({ key: "a", name: "Alpha FM", genre: "Pop", color: "#EF4444", logoUrl: "https://x/logo.png", fetchImage: async () => logo.encode("png") });
  const withoutLogo = await cards.renderStationCard({ key: "b", name: "Beta FM", genre: "Pop", color: "not-a-colour", logoUrl: null, fetchImage: noImage });
  assert.deepEqual(pngSize(await withLogo), { width: 1200, height: 630 });
  assert.deepEqual(pngSize(withoutLogo), { width: 1200, height: 630 });
  assert.equal(cards.cardColor("not-a-colour"), "#FF6B00");
  assert.equal(cards.cardColor("14b8a6"), "#14B8A6");
});

test("long text wraps into two lines and ends with an ellipsis", () => {
  const ctx = createCanvas(10, 10).getContext("2d");
  ctx.font = "40px sans-serif";
  const lines = cards.wrapCardText(ctx, "one two three four five six seven eight nine ten eleven twelve", 300, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"));
  assert.ok(lines.every((line) => ctx.measureText(line).width <= 300));
  assert.deepEqual(cards.wrapCardText(ctx, "short", 300, 2), ["short"]);
});

test("remote images: only https, only answers that worked, at most 2 MB", async () => {
  const fetchOk = (bytes, headers = {}) => async () => ({ ok: true, headers: { get: (name) => headers[name] ?? null }, arrayBuffer: async () => new Uint8Array(bytes).buffer });
  assert.equal(await cards.fetchCardImage("http://plain.example/x.png", { fetchImpl: fetchOk(10) }), null);
  assert.equal(await cards.fetchCardImage("https://x/y.png", { fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await cards.fetchCardImage("https://x/y.png", { fetchImpl: fetchOk(10, { "content-length": String(3 * 1024 * 1024) }) }), null);
  assert.equal(await cards.fetchCardImage("https://x/y.png", { fetchImpl: async () => { throw new Error("blocked private address"); } }), null);
  assert.equal((await cards.fetchCardImage("https://x/y.png", { fetchImpl: fetchOk(10) })).length, 10);
});

// ---- the share links Discord reads ----

function request(pathname, { method = "GET", headers = {} } = {}) {
  const res = {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headerMap) { this.status = status; Object.assign(this.headers, headerMap); },
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
  return { req: { method, headers }, res, requestUrl: new URL(`http://localhost${pathname}`) };
}

test("a station link carries title, text, colour and card, then sends people to the website", async () => {
  const handle = createShareRoutesHandler({ websiteUrl: "https://omnifm.xyz/", fetchImage: noImage });
  const { req, res, requestUrl } = request("/api/share/station/groovesalad?lang=de");
  assert.equal(await handle({ req, res, requestUrl }), true);
  assert.equal(res.status, 200);
  assert.match(res.headers["Content-Type"], /text\/html/);
  const html = res.body;
  assert.match(html, /<meta property="og:title" content="Groove Salad – 24\/7 in Discord">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/omnifm\.xyz\/api\/share\/station\/groovesalad\.png\?lang=de">/);
  assert.match(html, new RegExp(`<meta name="theme-color" content="${catalog.groovesalad.color}">`));
  assert.match(html, /http-equiv="refresh" content="0; url=https:\/\/omnifm\.xyz\/stations\?station=groovesalad"/);
  assert.match(res.headers["Cache-Control"], /public/);
  assert.ok(res.headers["Content-Security-Policy"], "the API's security headers stay");

  const image = request("/api/share/station/groovesalad.png");
  cards.clearShareCardCacheForTests();
  await handle(image);
  assert.equal(image.res.headers["Content-Type"], "image/png");
  assert.deepEqual(pngSize(image.res.body), { width: 1200, height: 630 });
});

test("unknown stations, pages, HEAD and other methods", async () => {
  const handle = createShareRoutesHandler({ websiteUrl: "https://omnifm.xyz", getInviteUrl: () => "https://discord.com/oauth2/authorize?client_id=1" });
  const unknown = request("/api/share/station/does-not-exist");
  await handle(unknown);
  assert.equal(unknown.res.status, 404);

  const invite = request("/api/share/page/invite?lang=en");
  await handle(invite);
  assert.match(invite.res.body, /<meta property="og:title" content="Invite OmniFM">/);
  assert.match(invite.res.body, /url=https:\/\/discord\.com\/oauth2\/authorize\?client_id=1/);

  const head = request("/api/share/page/premium", { method: "HEAD" });
  await handle(head);
  assert.equal(head.res.status, 200);
  assert.equal(head.res.body, undefined);

  const post = request("/api/share/page/premium", { method: "POST" });
  await handle(post);
  assert.equal(post.res.status, 405);

  const other = request("/api/dashboard/settings");
  assert.equal(await handle(other), false, "other routes are not touched");
});

test("everything in the page is escaped", () => {
  const html = buildSharePageHtml({ title: "\"><script>x</script>", description: "a & b", imageUrl: "https://x/y.png", url: "https://x", target: "https://x/?a=1&b=2" });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
  assert.match(html, /url=https:\/\/x\/\?a=1&amp;b=2/);
});

// ---- "Share" in the panel ----

test("the panel offers Share; MusicBrainz moves into the text", () => {
  const input = {
    t: de,
    station: { name: "Groove Salad", key: "groovesalad" },
    track: { hasTrack: true, headline: "Cafe del Mar", artist: "Energy 52" },
    playback: { phase: "playing" },
    searchQuery: "Energy 52 Cafe del Mar",
    musicBrainzUrl: "https://musicbrainz.org/release/x",
  };
  const json = JSON.stringify(buildNowPlayingPanel(input).components[0].toJSON());
  assert.match(json, /"custom_id":"np:share"/);
  assert.match(json, /\[MusicBrainz\]\(https:\/\/musicbrainz\.org\/release\/x\)/);
  assert.doesNotMatch(JSON.stringify(buildNowPlayingPanel({ ...input, shareEnabled: false }).components[0].toJSON()), /np:share/);
});

function shareWorker({ playing = true } = {}) {
  const worker = Object.create(BotRuntime.prototype);
  worker.config = { name: "OmniFM 1" };
  worker.resolveInteractionLanguage = () => "de";
  worker.guildState = new Map([["123456789012345678", playing ? {
    currentStationKey: "groovesalad",
    currentStationName: "Groove Salad",
    currentMeta: { artist: "Energy 52", title: "Cafe del Mar", displayTitle: "Energy 52 - Cafe del Mar" },
  } : {}]]);
  worker.getResolvedCurrentStation = () => ({ station: { name: "Groove Salad", color: "#14B8A6", genre: "Ambient" } });
  return worker;
}

function shareClick() {
  const calls = [];
  return {
    calls,
    guildId: "123456789012345678",
    guild: { name: "eSports Club" },
    customId: "np:share",
    async reply(payload) { calls.push(["reply", payload]); },
    async deferReply(options) { calls.push(["deferReply", options]); },
    async editReply(payload) { calls.push(["editReply", payload]); },
  };
}

test("Share posts the card in the channel, once every 30 seconds per server", async () => {
  cards.clearShareCardCacheForTests();
  const worker = shareWorker();
  const click = shareClick();
  await worker.handleShareCardControl(click, { now: 1_000_000, enabled: true });
  assert.deepEqual(click.calls[0], ["deferReply", undefined], "public, not private");
  const [, reply] = click.calls[1];
  assert.match(reply.content, /🎧 \*\*Cafe del Mar\*\* – Energy 52 · 📻 Groove Salad/);
  assert.equal(reply.files[0].name, "omnifm-jetzt-laeuft.png");
  assert.deepEqual(pngSize(reply.files[0].attachment), { width: 1200, height: 630 });
  assert.match(reply.components[0].toJSON().components[0].url, /\/api\/share\/station\/groovesalad\?lang=de$/);

  const soon = shareClick();
  await worker.handleShareCardControl(soon, { now: 1_010_000, enabled: true });
  assert.match(JSON.stringify(soon.calls[0][1].components[0].toJSON()), /Gerade erst geteilt/);

  const off = shareClick();
  await worker.handleShareCardControl(off, { now: 2_000_000, enabled: false });
  assert.match(JSON.stringify(off.calls[0][1].components[0].toJSON()), /Teilen ist aus/);

  const idle = shareClick();
  await shareWorker({ playing: false }).handleShareCardControl(idle, { now: 3_000_000, enabled: true });
  assert.match(JSON.stringify(idle.calls[0][1].components[0].toJSON()), /Gerade läuft nichts/);
});
