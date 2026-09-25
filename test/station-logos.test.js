import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-logos-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.PUBLIC_WEB_URL = "https://omnifm.xyz";

const { processStationLogo, STATION_LOGO_MAX_BYTES } = await import("../src/lib/station-logo-image.js");
const forms = await import("../src/bot/forms.js");
const { createStationLogoRoutesHandler } = await import("../src/api/routes/station-logo-routes.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const customStations = await import("../src/custom-stations.js");

const GUILD = "123456789012345678";
const de = (german) => german;

async function pictureOf(width, height, format = "png") {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ff6b00";
  context.fillRect(0, 0, width, height);
  return canvas.encode(format);
}

function uploaded(file) {
  return {
    getTextInputValue: (id) => ({ name: "Vereinsradio", url: "https://stream.example.com/live" })[id] ?? "",
    getStringSelectValues: () => [],
    getUploadedFiles: (id) => (id === "logo" && file ? { first: () => file } : null),
  };
}

test("a logo becomes a 256x256 PNG; too large or not a picture is refused", async () => {
  const wide = await processStationLogo(await pictureOf(600, 300, "jpeg"));
  assert.equal(wide.ok, true);
  const image = await loadImage(wide.png);
  assert.deepEqual([image.width, image.height], [256, 256], "cut to a centred square, not squashed");
  assert.equal(wide.png.subarray(1, 4).toString("ascii"), "PNG");

  assert.equal((await processStationLogo(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).error, "wrong-type");
  const huge = Buffer.concat([await pictureOf(10, 10), Buffer.alloc(STATION_LOGO_MAX_BYTES)]);
  assert.equal((await processStationLogo(huge)).error, "too-large");
  assert.equal((await processStationLogo(Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG broken data")]))).error, "unreadable");
});

test("the form refuses a wrong logo before anything is saved", () => {
  assert.equal(forms.readStationForm(uploaded({ url: "https://cdn.discordapp.com/a/logo.png", size: STATION_LOGO_MAX_BYTES + 1, contentType: "image/png" })).error, "logo-too-large");
  assert.equal(forms.readStationForm(uploaded({ url: "https://cdn.discordapp.com/a/logo.gif", size: 1000, contentType: "image/gif" })).error, "logo-wrong-type");
  assert.equal(forms.readStationForm(uploaded({ url: "https://cdn.discordapp.com/a/logo.bmp", size: 1000, contentType: "" })).error, "logo-wrong-type");
  const ok = forms.readStationForm(uploaded({ url: "https://cdn.discordapp.com/a/logo.webp", size: 1000, contentType: "image/webp" }));
  assert.deepEqual(ok.logo, { url: "https://cdn.discordapp.com/a/logo.webp", size: 1000 });
  assert.equal(forms.readStationForm(uploaded(null)).logo, null, "the logo is optional");
});

test("the logo link is public, versioned and cached; unknown ones are 404", async () => {
  const png = await pictureOf(256, 256);
  const handler = createStationLogoRoutesHandler({
    getLogo: async (guildId, key) => (guildId === GUILD && key === "vereinsradio" ? { png, updatedAt: 1_700_000_000_000 } : null),
  });
  const call = async (url, method = "GET") => {
    const res = { setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
    const handled = await handler({ req: { method, headers: {} }, res, requestUrl: new URL(url, "https://omnifm.xyz") });
    return { handled, ...res };
  };
  const hit = await call(`/api/station-logos/${GUILD}/vereinsradio.png?v=1700000000000`);
  assert.equal(hit.status, 200);
  assert.equal(hit.headers["Content-Type"], "image/png");
  assert.match(hit.headers["Cache-Control"], /immutable/);
  assert.equal(hit.body, png);
  assert.equal((await call(`/api/station-logos/${GUILD}/other.png`)).status, 404);
  assert.equal((await call("/api/station-logos/not-a-server/x.png")).status, 404);
  assert.equal((await call(`/api/station-logos/${GUILD}/Vereinsradio.PNG`)).status, 404, "only the exact form");
  assert.equal((await call(`/api/station-logos/${GUILD}/vereinsradio.png`, "POST")).handled, true);
  assert.equal((await call("/api/share/page/premium")).handled, false, "other paths are not touched");
});

test("a logo that fails after the upload is named, the station stays", async () => {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM DJ" };
  const tooBig = await runtime.storeStationFormLogo(GUILD, "vereinsradio", { url: "https://cdn.discordapp.com/x.png" }, {
    t: de, fetchLogo: async () => Buffer.concat([await pictureOf(10, 10), Buffer.alloc(STATION_LOGO_MAX_BYTES)]),
  });
  assert.match(tooBig, /Logo wurde nicht übernommen: es ist größer als 256 KB/);
  const unreachable = await runtime.storeStationFormLogo(GUILD, "vereinsradio", { url: "https://cdn.discordapp.com/x.png" }, {
    t: de, fetchLogo: async () => null,
  });
  assert.match(unreachable, /ließ sich nicht öffnen/);
});

test("saving, the link in the station and deleting against a real MongoDB", async (t) => {
  if (!String(process.env.MONGO_URL || "").trim()) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }
  const dbModule = await import("../src/lib/db.js");
  await dbModule.connect();
  const store = await import("../src/station-logos-store.js");
  t.after(async () => {
    await dbModule.getDb().dropDatabase().catch(() => null);
    await dbModule.close();
  });

  await customStations.addGuildStation(GUILD, "vereinsradio", { name: "Vereinsradio", url: "https://1.1.1.1/live" }, "https://1.1.1.1/live");
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM DJ" };
  const note = await runtime.storeStationFormLogo(GUILD, "vereinsradio", { url: "https://cdn.discordapp.com/x.png" }, {
    t: de, fetchLogo: async () => pictureOf(512, 512),
  });
  assert.match(note, /Logo ist gespeichert/);

  const station = customStations.getGuildStations(GUILD).vereinsradio;
  const link = customStations.customStationLogoUrl(GUILD, "vereinsradio", station);
  assert.match(link, new RegExp(`^https://omnifm\\.xyz/api/station-logos/${GUILD}/vereinsradio\\.png\\?v=\\d+$`));
  const stored = await store.getStationLogo(GUILD, "vereinsradio");
  assert.deepEqual([(await loadImage(stored.png)).width, stored.updatedAt], [256, station.logoUpdatedAt]);

  await customStations.updateGuildStation(GUILD, "vereinsradio", { name: "Vereinsradio Neu", url: "https://1.1.1.1/live" }, "https://1.1.1.1/live");
  assert.equal(customStations.getGuildStations(GUILD).vereinsradio.logoUpdatedAt, station.logoUpdatedAt, "an edit keeps the logo");

  customStations.removeGuildStation(GUILD, "vereinsradio");
  // The logo is deleted in the background; wait a few turns for it.
  const logoGone = async (tries = 20) => {
    if (!(await store.getStationLogo(GUILD, "vereinsradio"))) return true;
    if (tries <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return logoGone(tries - 1);
  };
  assert.equal(await logoGone(), true, "the logo goes with the station");
});
