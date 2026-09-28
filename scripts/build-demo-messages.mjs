#!/usr/bin/env node
// Writes what the website's live demos show from the bot (#431): the real
// panel, the answer to /invite and the command descriptions, built by the
// bot's own code, to frontend/src/components/demo/demoMessages.json.
// Run it after changing one of them; test/demo-messages.test.js says when.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDemoMessages } from "../src/bot/demo-messages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEMO_MESSAGES_FILE = path.join(ROOT, "frontend/src/components/demo/demoMessages.json");

export async function demoMessagesJson() {
  return `${JSON.stringify(await buildDemoMessages(), null, 2)}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(path.dirname(DEMO_MESSAGES_FILE), { recursive: true });
  fs.writeFileSync(DEMO_MESSAGES_FILE, await demoMessagesJson());
  console.log(`wrote ${path.relative(ROOT, DEMO_MESSAGES_FILE)}`);
}
