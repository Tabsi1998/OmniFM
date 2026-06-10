#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {
    "env-file": path.join(repoRoot, ".env"),
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] || "");
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    if (key === "json" || key === "help") {
      args[key] = true;
      continue;
    }
    const next = String(argv[index + 1] || "");
    args[key] = next && !next.startsWith("--") ? next : "";
    if (args[key]) index += 1;
  }

  return args;
}

function parseEnvText(text = "") {
  const env = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function countConfiguredBots(env = {}) {
  let count = 0;
  while (count < 20) {
    const key = `BOT_${count + 1}_TOKEN`;
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function resolveCommanderIndex(env = {}, botCount = countConfiguredBots(env)) {
  const configured = Number.parseInt(String(env.COMMANDER_BOT_INDEX || "1"), 10);
  if (Number.isFinite(configured) && configured >= 1 && configured <= botCount) {
    return {
      configured,
      resolved: configured,
      valid: true,
    };
  }
  return {
    configured,
    resolved: botCount >= 1 ? 1 : null,
    valid: botCount >= 1 && !String(env.COMMANDER_BOT_INDEX || "").trim(),
  };
}

function determineDeploymentMode(env = {}, { hasSplitCompose = true } = {}) {
  const requested = String(env.OMNIFM_DEPLOYMENT_MODE || "auto").trim().toLowerCase();
  if (requested === "split") return hasSplitCompose ? "split" : "monolith";
  if (["monolith", "single", "legacy"].includes(requested)) return "monolith";
  return countConfiguredBots(env) > 1 && hasSplitCompose ? "split" : "monolith";
}

function isMongoConfigured(env = {}) {
  return String(env.MONGO_URL || "").trim().length > 0
    || String(env.MONGO_ENABLED || "").trim() === "1";
}

function addMessage(messages, severity, code, message) {
  messages.push({ severity, code, message });
}

function analyzeSplitRequirements(env = {}, options = {}) {
  const messages = [];
  const botCount = countConfiguredBots(env);
  const mode = determineDeploymentMode(env, options);
  const commander = resolveCommanderIndex(env, botCount);
  const mongoConfigured = isMongoConfigured(env);

  if (botCount < 1) {
    addMessage(messages, "fail", "bot_missing", "No BOT_1_TOKEN entry is configured.");
  } else {
    addMessage(messages, "ok", "bots_configured", `Configured bot entries: ${botCount}.`);
  }

  if (!commander.valid) {
    addMessage(
      messages,
      "fail",
      "commander_index_invalid",
      `COMMANDER_BOT_INDEX=${Number.isFinite(commander.configured) ? commander.configured : "invalid"} does not point to a configured bot.`
    );
  } else {
    addMessage(messages, "ok", "commander_index", `Commander resolves to BOT_${commander.resolved}.`);
  }

  addMessage(messages, "ok", "deployment_mode", `Effective deployment mode: ${mode}.`);

  if (mode === "split") {
    if (mongoConfigured) {
      addMessage(messages, "ok", "split_mongo_configured", "Split mode MongoDB requirement is configured.");
    } else {
      addMessage(
        messages,
        "fail",
        "split_mongo_required",
        "Split mode requires MongoDB. Set MONGO_URL=mongodb://mongodb:27017 or MONGO_ENABLED=1 before starting commander/workers."
      );
    }
  } else if (mongoConfigured) {
    addMessage(messages, "ok", "monolith_mongo_configured", "MongoDB is configured for monolith mode.");
  } else {
    addMessage(messages, "warn", "monolith_file_fallback", "Monolith mode can run with file-backed fallback stores when MongoDB is not configured.");
  }

  const failCount = messages.filter((message) => message.severity === "fail").length;
  const warnCount = messages.filter((message) => message.severity === "warn").length;

  return {
    ok: failCount === 0,
    mode,
    botCount,
    commander,
    mongoConfigured,
    messages,
    summary: {
      ok: messages.length - warnCount - failCount,
      warn: warnCount,
      fail: failCount,
    },
  };
}

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/check-split-requirements.mjs [--env-file .env] [--json]");
}

function loadEnvFile(filePath) {
  try {
    return parseEnvText(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      __loadError: error?.message || String(error),
    };
  }
}

function formatSeverity(severity) {
  if (severity === "fail") return "FAIL";
  if (severity === "warn") return "WARN";
  return "OK";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const envFile = path.resolve(String(args["env-file"] || path.join(repoRoot, ".env")));
  const env = loadEnvFile(envFile);
  const hasSplitCompose = fs.existsSync(path.join(path.dirname(envFile), "docker-compose.split.yml"))
    || fs.existsSync(path.join(repoRoot, "docker-compose.split.yml"));
  const result = analyzeSplitRequirements(env, { hasSplitCompose });

  if (env.__loadError) {
    result.ok = false;
    result.messages.unshift({
      severity: "fail",
      code: "env_file_missing",
      message: `Env file could not be read: ${env.__loadError}`,
    });
    result.summary.fail += 1;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const message of result.messages) {
      console.log(`${formatSeverity(message.severity)}: ${message.message}`);
    }
  }

  if (!result.ok) {
    process.exitCode = 2;
  } else if (result.summary.warn > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || "")).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error?.stack || error?.message || String(error)}`);
    process.exitCode = 2;
  });
}

export {
  analyzeSplitRequirements,
  countConfiguredBots,
  determineDeploymentMode,
  isMongoConfigured,
  parseEnvText,
  resolveCommanderIndex,
};
