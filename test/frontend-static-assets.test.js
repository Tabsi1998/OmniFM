import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("React public folder does not ship legacy standalone frontend assets", () => {
  const reactPublicDir = path.join(repoRoot, "frontend", "public");
  const legacyWebDir = path.join(repoRoot, "web");

  assert.equal(
    fs.existsSync(path.join(reactPublicDir, "app.js")),
    false,
    "frontend/public/app.js would be copied to frontend/build/app.js by the React build"
  );
  assert.equal(
    fs.existsSync(path.join(reactPublicDir, "styles.css")),
    false,
    "frontend/public/styles.css would be copied to frontend/build/styles.css by the React build"
  );

  assert.equal(
    fs.existsSync(path.join(legacyWebDir, "app.js")),
    true,
    "web/app.js remains the explicit legacy fallback asset"
  );
  assert.equal(
    fs.existsSync(path.join(legacyWebDir, "styles.css")),
    true,
    "web/styles.css remains the explicit legacy fallback asset"
  );
});

test("React public index references only the React mount and no legacy root assets", () => {
  const indexHtml = fs.readFileSync(
    path.join(repoRoot, "frontend", "public", "index.html"),
    "utf8"
  );

  assert.match(indexHtml, /<div id="root"><\/div>/);
  assert.doesNotMatch(indexHtml, /src=["']\/app\.js["']/i);
  assert.doesNotMatch(indexHtml, /href=["']\/styles\.css["']/i);
});
