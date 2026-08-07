import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { readRequestBody } from "../src/api/routes/admin-routes.js";

function createRequest(headers = {}) {
  const request = new PassThrough();
  request.headers = headers;
  return request;
}

test("admin body reader returns bounded UTF-8 request bodies", async () => {
  const request = createRequest({ "content-length": "4" });
  const body = readRequestBody(request, 4);
  request.end("test");

  assert.equal(await body, "test");
  assert.equal(request.listenerCount("data"), 0);
});

test("admin body reader rejects oversized declared bodies before buffering", async () => {
  const request = createRequest({ "content-length": "5" });

  await assert.rejects(
    readRequestBody(request, 4),
    (error) => error?.statusCode === 413 && error?.message === "Request body too large"
  );
  assert.equal(request.listenerCount("data"), 0);
});

test("admin body reader drains chunked uploads once the byte limit is exceeded", async () => {
  const request = createRequest();
  const body = readRequestBody(request, 4);
  request.end(Buffer.from("12345"));

  await assert.rejects(
    body,
    (error) => error?.statusCode === 413 && error?.message === "Request body too large"
  );
  assert.equal(request.listenerCount("data"), 0);
});
