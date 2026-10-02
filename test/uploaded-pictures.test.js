import test from "node:test";
import assert from "node:assert/strict";

import {
  PictureError, UPLOAD_MAX_BYTES, loadUploadedPicture, pictureTypeOf, storeUploadedPicture, uploadIdOf,
} from "../src/lib/uploaded-pictures.js";
import { createAdminPictureRoutes } from "../src/api/routes/admin-picture-routes.js";
import { createImageRoutesHandler } from "../src/api/routes/image-routes.js";
import { marketingResponse } from "../src/lib/owner-public.js";

// A partner's logo uploaded in the owner console (#486): kept in MongoDB and
// served by /api/image/sponsor/<n> without fetching another server, which
// OmniFM cannot always reach (on omnifm.xyz it answered 404).
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(8)]);

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    collection: () => ({
      updateOne: async (filter, update) => {
        if (!rows.has(filter._id)) rows.set(filter._id, { _id: filter._id, ...update.$setOnInsert });
        return { acknowledged: true };
      },
      findOne: async (filter) => rows.get(filter._id) || null,
    }),
  };
}

test("a picture is recognised by its first bytes, not by its name", () => {
  assert.equal(pictureTypeOf(PNG), "image/png");
  assert.equal(pictureTypeOf(WEBP), "image/webp");
  assert.equal(pictureTypeOf(Buffer.from("ffd8ffe000104a4649460001", "hex")), "image/jpeg");
  assert.equal(pictureTypeOf(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00", "latin1")), "image/gif");
  assert.equal(pictureTypeOf(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), "", "no SVG: it could carry a script");
  assert.equal(pictureTypeOf(Buffer.from("not a picture at all")), "");
});

test("kept once per file, refused when too large or no picture", async () => {
  const db = fakeDb();
  const first = await storeUploadedPicture(db, PNG);
  assert.match(first.ref, /^upload:[0-9a-f]{32}$/);
  assert.deepEqual(await storeUploadedPicture(db, PNG), first, "the same file twice is one entry");
  assert.equal(db.rows.size, 1);
  assert.deepEqual(await loadUploadedPicture(db, first.ref), { type: "image/png", body: PNG });
  assert.equal(await loadUploadedPicture(db, "upload:../../etc"), null);
  await assert.rejects(storeUploadedPicture(db, Buffer.from("plain text, named logo.png")), (error) => error instanceof PictureError && error.status === 415);
  await assert.rejects(storeUploadedPicture(db, Buffer.concat([PNG, Buffer.alloc(UPLOAD_MAX_BYTES)])), (error) => error.status === 413);
  await assert.rejects(storeUploadedPicture(null, PNG), (error) => error.status === 503);
});

test("a real MongoDB gives the very same bytes back", async (t) => {
  const mongoUrl = String(process.env.MONGO_URL || "").trim();
  if (!mongoUrl) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 4000 });
  await client.connect();
  const db = client.db(`${String(process.env.DB_NAME || "omnifm_test").trim()}_pictures`);
  t.after(async () => {
    await db.dropDatabase().catch(() => null);
    await client.close();
  });
  const { ref } = await storeUploadedPicture(db, WEBP);
  const loaded = await loadUploadedPicture(db, ref);
  assert.equal(loaded.type, "image/webp");
  assert.ok(Buffer.isBuffer(loaded.body) && loaded.body.equals(WEBP), "a Buffer again, not MongoDB's Binary");
});

test("the partner list keeps an uploaded logo; the picture comes from MongoDB, not from a fetch", async () => {
  const ref = `upload:${"a".repeat(32)}`;
  const marketing = marketingResponse({ marketing: { sponsors: [{ name: "IT-Tabelander", logoUrl: ref, url: "https://it.tabelander.co.at/" }, { name: "X", logoUrl: "javascript:alert(1)" }] } });
  assert.equal(marketing.sponsors[0].logoUrl, ref);
  assert.equal(marketing.sponsors[1].logoUrl, "", "anything else than a web address or an upload stays out");

  const fetched = [];
  const handle = createImageRoutesHandler({
    stations: () => ({ stations: {} }),
    marketing: async () => marketing,
    fetchImpl: async (url) => { fetched.push(url); throw new Error("no fetch for an upload"); },
    loadUpload: async (wanted) => (wanted === ref ? { type: "image/webp", body: WEBP } : null),
  });
  const reply = { status: 0, headers: {}, body: null };
  const res = { writeHead(status, headers) { reply.status = status; Object.assign(reply.headers, headers); }, end(body) { reply.body = body; } };
  await handle({ req: { method: "GET", headers: {} }, res, requestUrl: new URL("http://omnifm.test/api/image/sponsor/0?v=0123456789") });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers["Content-Type"], "image/webp");
  assert.deepEqual(fetched, []);
  assert.equal(uploadIdOf(ref), "a".repeat(32));
});

test("POST /api/admin/pictures: a data URL in, the reference out; wrong files refused", async () => {
  const sent = [];
  const audit = [];
  const route = (body) => createAdminPictureRoutes({
    sendJson: (res, status, payload) => sent.push({ status, payload }),
    methodNotAllowed: (res, allowed) => sent.push({ status: 405, allowed }),
    auditOwnerAction: (req, entry) => audit.push(entry),
    readRequestBody: async () => body,
  });
  const context = (method = "POST") => ({ req: { method, headers: {} }, res: {}, requestUrl: new URL("http://omnifm.test/api/admin/pictures") });

  assert.equal(await route("{}")(context("GET")), true);
  assert.equal(sent.at(-1).status, 405);
  await route(JSON.stringify({ data: `data:image/png;base64,${Buffer.from("no picture").toString("base64")}` }))(context());
  assert.equal(sent.at(-1).status, 503, "without MongoDB nothing is kept");
  await route("{}")(context());
  assert.deepEqual(sent.at(-1), { status: 400, payload: { error: "Keine Datei." } });
  assert.equal(await route("{}")({ ...context(), requestUrl: new URL("http://omnifm.test/api/admin/other") }), false);
  assert.equal(audit.length, 0);
});
