import test from "node:test";
import assert from "node:assert/strict";

import {
  isSafeUserFacingErrorMessage,
  resolveUserFacingErrorMessage,
} from "../src/lib/user-facing-errors.js";

test("backend user-facing error helper keeps short actionable messages", () => {
  assert.equal(isSafeUserFacingErrorMessage("Bitte eine gueltige Lizenz-E-Mail eingeben."), true);
  assert.equal(
    resolveUserFacingErrorMessage("de", new Error("Bitte eine gueltige Lizenz-E-Mail eingeben.")),
    "Bitte eine gueltige Lizenz-E-Mail eingeben."
  );
});

test("backend user-facing error helper hides technical internals", () => {
  assert.equal(isSafeUserFacingErrorMessage("MongoDB-Verbindung fehlgeschlagen."), false);
  assert.equal(
    resolveUserFacingErrorMessage("de", new Error("MongoDB-Verbindung fehlgeschlagen."), {
      fallbackDe: "Die Einstellungen konnten gerade nicht gespeichert werden.",
      fallbackEn: "The settings could not be saved right now.",
    }),
    "Die Einstellungen konnten gerade nicht gespeichert werden."
  );
});
