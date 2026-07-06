import assert from "node:assert/strict";
import test from "node:test";

import { resolveUnhandledRejectionPolicy } from "../src/lib/process-policy.js";

test("unhandled rejection policy defaults to log and accepts exit aliases", () => {
  assert.equal(resolveUnhandledRejectionPolicy({}), "log");
  assert.equal(resolveUnhandledRejectionPolicy({ UNHANDLED_REJECTION_POLICY: "log" }), "log");
  assert.equal(resolveUnhandledRejectionPolicy({ UNHANDLED_REJECTION_POLICY: "exit" }), "exit");
  assert.equal(resolveUnhandledRejectionPolicy({ UNHANDLED_REJECTION_POLICY: "restart" }), "exit");
  assert.equal(resolveUnhandledRejectionPolicy({ UNHANDLED_REJECTION_POLICY: "unknown" }), "log");
});
