import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #469: the website's covers, station and partner logos come from this site.
// The website names a picture by what it shows; /api/image fetches it on the
// server, and only what it names: never an address from the request.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-images-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const images = await import("../src/lib/public-images.js");
const { createImageRoutesHandler, IMAGE_MAX_BYTES } = await import("../src/api/routes/image-routes.js");
const { enforceApiRateLimit } = await import("../src/lib/api-rate-limit.js");
const { coverLookup } = await import("../src/lib/owner-public.js");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const STATIONS = {
  stations: {
    groove: { name: "Groove Salad", tier: "free", logo: "https://logos.example/groove.png" },
    night: { name: "Night Drive", tier: "pro", logo: "http://insecure.example/night.png" },
    vault: { name: "Vault", tier: "ultimate", logo: "https://logos.example/vault.png" },
    "custom:123:mine": { name: "Mine", tier: "free", logo: "https://logos.example/mine.png" },
  },
};

function picture(body = PNG, type = "image/png", extra = {}) {
  return new Response(body, { status: 200, headers: { "content-type": type, ...extra } });
}

function handler({ fetchImpl, cover = null, sponsors = [] } = {}) {
  const fetched = [];
  const handle = createImageRoutesHandler({
    stations: () => STATIONS,
    lookupCover: async ({ term }) => (cover ? { ok: true, query: term, ...cover } : { ok: false, query: term }),
    marketing: async () => ({ sponsors }),
    fetchImpl: async (url, options) => {
      fetched.push(url);
      return (fetchImpl || (() => picture()))(url, options);
    },
  });
  return { handle, fetched };
}

async function get(handle, url, method = "GET") {
  const reply = { status: 0, headers: {}, body: null };
  const res = {
    writeHead(status, headers = {}) {
      reply.status = status;
      Object.assign(reply.headers, headers);
    },
    setHeader(name, value) { reply.headers[name] = value; },
    end(body) { reply.body = body ?? null; },
  };
  const handled = await handle({ req: { method, headers: {} }, res, requestUrl: new URL(url, "http://omnifm.test") });
  return { handled, ...reply };
}

test("the website's answers name pictures by what they show; nothing points elsewhere", () => {
  const cover = images.websiteCover({ ok: true, query: "Artist Song", artwork: "https://is1.example/600.jpg", artworkSmall: "https://is1.example/100.jpg", title: "Song" });
  assert.equal(cover.artwork, "/api/image/cover?term=Artist+Song&size=600");
  assert.equal(cover.artworkMedium, "/api/image/cover?term=Artist+Song&size=300");
  assert.equal(cover.artworkSmall, "/api/image/cover?term=Artist+Song&size=100");
  assert.equal(cover.title, "Song");
  assert.deepEqual(images.websiteCover({ ok: false, query: "x" }), { ok: false, query: "x" });

  const chart = images.websiteChart({
    week: { id: "2026-39" },
    stations: [{ key: "groove", name: "Groove Salad", logo: "https://logos.example/groove.png" }, { key: "plain", logo: null }],
    songs: [{ displayTitle: "Artist - Song", cover: "https://is1.example/600.jpg" }, { displayTitle: "Jingle", cover: null }],
  });
  assert.equal(chart.week.id, "2026-39");
  assert.deepEqual(chart.stations.map((entry) => entry.logo), ["/api/image/station/groove", null]);
  assert.deepEqual(chart.songs.map((entry) => entry.cover), ["/api/image/cover?term=Artist+Song&size=600", null]);

  const marketing = images.websiteMarketing({ sponsors: [{ name: "A", logoUrl: "https://a.example/logo.png", url: "https://a.example" }, { name: "B", logoUrl: "", url: "" }], botListings: [] });
  assert.match(marketing.sponsors[0].logoUrl, /^\/api\/image\/sponsor\/0\?v=[0-9a-f]{10}$/, "the number, and a version that changes with the logo (#486)");
  assert.equal(marketing.sponsors[1].logoUrl, "");
  const changed = images.websiteMarketing({ sponsors: [{ name: "A", logoUrl: "https://a.example/new.png", url: "" }] });
  assert.notEqual(changed.sponsors[0].logoUrl, marketing.sponsors[0].logoUrl, "a new logo, a new address: no browser keeps the old one");
  assert.equal(marketing.sponsors[0].url, "https://a.example", "the link to the partner stays");
  assert.doesNotMatch(JSON.stringify([cover, chart, marketing]).replace(/"url":"[^"]*"/g, ""), /https?:\/\/(?!omnifm)/, "no picture from elsewhere");
});

test("a catalogue station's logo comes from this site, once fetched and then from the cache", async () => {
  const { handle, fetched } = handler();
  const first = await get(handle, "/api/image/station/groove");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, PNG);
  assert.equal(first.headers["Content-Type"], "image/png");
  assert.equal(first.headers["Cache-Control"], "public, max-age=86400");
  assert.match(first.headers["Content-Security-Policy"], /sandbox/);
  const again = await get(handle, "/api/image/station/groove");
  assert.equal(again.status, 200);
  assert.deepEqual(fetched, ["https://logos.example/groove.png"], "fetched once");
  const head = await get(handle, "/api/image/station/groove", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
});

test("only what the site names is fetched: no other station, no address from the request", async () => {
  const { handle, fetched } = handler();
  for (const url of [
    "/api/image/station/unknown",
    "/api/image/station/vault",
    "/api/image/station/custom%3A123%3Amine",
    "/api/image/station/night",
    "/api/image/station/..%2F..%2Fetc",
    "/api/image/cover?term=Song&url=https://evil.example/x.png",
    "/api/image/sponsor/0",
    "/api/image/other?url=https://evil.example/x.png",
  ]) {
    // eslint-disable-next-line no-await-in-loop -- one request after the other
    const reply = await get(handle, url);
    assert.equal(reply.status, 404, url);
  }
  assert.deepEqual(fetched, [], "nothing was fetched");
  assert.equal((await get(handle, "/api/imagery")).handled, false, "other paths are not this route's");
  const post = await get(handle, "/api/image/station/groove", "POST");
  assert.equal(post.status, 405);
});

test("covers in three sizes, and partner logos by their number", async () => {
  const { handle, fetched } = handler({
    cover: { artwork: "https://is1.example/600.jpg", artworkMedium: "https://is1.example/300.jpg", artworkSmall: "https://is1.example/100.jpg" },
    sponsors: [{ name: "A", logoUrl: "https://a.example/logo.webp" }],
    fetchImpl: (url) => picture(PNG, url.endsWith(".webp") ? "image/webp" : "image/jpeg"),
  });
  assert.equal((await get(handle, "/api/image/cover?term=Artist%20Song&size=600")).status, 200);
  assert.equal((await get(handle, "/api/image/cover?term=Artist%20Song&size=100")).headers["Content-Type"], "image/jpeg");
  assert.equal((await get(handle, "/api/image/cover?term=Artist%20Song&size=300")).status, 200);
  assert.equal((await get(handle, "/api/image/sponsor/0")).headers["Content-Type"], "image/webp");
  assert.equal((await get(handle, "/api/image/sponsor/1")).status, 404);
  assert.deepEqual(fetched, ["https://is1.example/600.jpg", "https://is1.example/100.jpg", "https://is1.example/300.jpg", "https://a.example/logo.webp"]);
});

test("pictures only, at most 2 MB; an SVG runs in a sandbox", async () => {
  const html = handler({ fetchImpl: () => picture("<html></html>", "text/html") });
  assert.equal((await get(html.handle, "/api/image/station/groove")).status, 404, "not a picture");

  const declared = handler({ fetchImpl: () => picture(PNG, "image/png", { "content-length": String(IMAGE_MAX_BYTES + 1) }) });
  assert.equal((await get(declared.handle, "/api/image/station/groove")).status, 404, "too large by its word");

  const streamed = handler({ fetchImpl: () => picture(Buffer.alloc(IMAGE_MAX_BYTES + 10), "image/png") });
  assert.equal((await get(streamed.handle, "/api/image/station/groove")).status, 404, "too large as it came");

  const failing = handler({ fetchImpl: () => new Response("gone", { status: 404, headers: { "content-type": "image/png" } }) });
  assert.equal((await get(failing.handle, "/api/image/station/groove")).status, 404, "the station's server has none");

  const svg = handler({ fetchImpl: () => picture("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/svg+xml") });
  const reply = await get(svg.handle, "/api/image/station/groove");
  assert.equal(reply.status, 200);
  assert.equal(reply.headers["Content-Type"], "image/svg+xml");
  assert.match(reply.headers["Content-Security-Policy"], /default-src 'none'.*sandbox/);
});

test("the pictures have their own request budget, larger than the API's 60 a minute", () => {
  const blocked = [];
  const res = { writeHead(status) { blocked.push(status); }, setHeader() {}, end() {} };
  const req = { headers: {}, socket: { remoteAddress: "203.0.113.77" } };
  for (let index = 0; index < 120; index += 1) enforceApiRateLimit(req, res, "/api/image/station/groove");
  assert.deepEqual(blocked, [], "120 pictures in a minute pass");
  const other = { headers: {}, socket: { remoteAddress: "203.0.113.78" } };
  for (let index = 0; index < 61; index += 1) enforceApiRateLimit(other, res, "/api/stations");
  assert.deepEqual(blocked, [429], "while the API's own budget stops at 60");
});

test("a cover is one the website's own search found: a picture request never searches iTunes", async () => {
  const fetched = [];
  const handle = createImageRoutesHandler({
    stations: () => STATIONS,
    marketing: async () => ({ sponsors: [] }),
    fetchImpl: async (url) => {
      fetched.push(url);
      return picture(PNG, "image/jpeg");
    },
  });
  assert.equal((await get(handle, "/api/image/cover?term=Never%20Searched%20Song")).status, 404);
  assert.deepEqual(fetched, [], "no search, no download");

  // The website asks /api/cover first; that search is what the picture may show.
  const itunes = async () => ({ status: 200, json: async () => ({ results: [{ artworkUrl100: "https://is1.example/searched/100x100bb.jpg", trackName: "Song" }] }) });
  const found = await coverLookup({ term: "Searched   Artist Song" }, { fetchImpl: itunes });
  assert.equal(found.ok, true);
  assert.equal((await get(handle, "/api/image/cover?term=Searched%20Artist%20Song&size=600")).status, 200);
  assert.deepEqual(fetched, ["https://is1.example/searched/600x600bb.jpg"]);
});

test("the kept pictures stay within their budget; the longest unused goes first", async () => {
  const fetched = [];
  const handle = createImageRoutesHandler({
    stations: () => ({ stations: {
      one: { tier: "free", logo: "https://logos.example/one.png" },
      two: { tier: "free", logo: "https://logos.example/two.png" },
      three: { tier: "free", logo: "https://logos.example/three.png" },
    } }),
    lookupCover: async () => null,
    marketing: async () => ({ sponsors: [] }),
    fetchImpl: async (url) => {
      fetched.push(url);
      return picture();
    },
    cacheBytes: PNG.length * 2,
  });
  for (const key of ["one", "two", "one", "three", "one", "two"]) {
    // eslint-disable-next-line no-await-in-loop -- in this order
    assert.equal((await get(handle, `/api/image/station/${key}`)).status, 200);
  }
  // Room for two: "two" was the longest unused when "three" came, so it was fetched again.
  assert.deepEqual(fetched.map((url) => url.split("/").pop()), ["one.png", "two.png", "three.png", "two.png"]);
});
