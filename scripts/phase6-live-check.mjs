#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    "skip-api": false,
    "skip-logs": false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] || "");
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    if (["skip-api", "skip-logs", "help"].includes(key)) {
      args[key] = true;
      continue;
    }
    const next = String(argv[index + 1] || "");
    if (!next || next.startsWith("--")) {
      args[key] = "";
      continue;
    }
    args[key] = next;
    index += 1;
  }

  return args;
}

function normalizeBaseUrl(rawValue) {
  const value = String(rawValue || "").trim() || "http://localhost:8081";
  return value.replace(/\/+$/, "");
}

function resolveAdminToken(args) {
  return String(
    args["admin-token"]
    || process.env.OMNIFM_ADMIN_TOKEN
    || process.env.API_ADMIN_TOKEN
    || process.env.ADMIN_API_TOKEN
    || ""
  ).trim();
}

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/phase6-live-check.mjs --base-url https://omnifm.xyz --admin-token <token> [--docker-service omnifm] [--log-since 30m]");
  console.log("");
  console.log("Options:");
  console.log("  --base-url        API base URL, default: OMNIFM_BASE_URL, PUBLIC_WEB_URL, or http://localhost:8081");
  console.log("  --admin-token     Admin API token, default: OMNIFM_ADMIN_TOKEN, API_ADMIN_TOKEN, or ADMIN_API_TOKEN");
  console.log("  --docker-service  Docker Compose service name, default: OMNIFM_DOCKER_SERVICE or omnifm");
  console.log("  --log-since       docker logs lookback window, default: OMNIFM_LOG_SINCE or 30m");
  console.log("  --skip-api        Skip authenticated API checks");
  console.log("  --skip-logs       Skip Docker log checks");
}

function logLine(level, message) {
  console.log(`[${level}] ${message}`);
}

function summarizeSync(entry) {
  if (!entry) return "never";
  const at = String(entry.at || "unknown");
  return entry.ok === false ? `failed@${at}` : `ok@${at}`;
}

function clipLine(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function fetchJson(baseUrl, path, adminToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: adminToken ? { "X-Admin-Token": adminToken } : {},
      signal: controller.signal,
    });
    const rawText = await response.text();
    let body = null;
    if (rawText.trim()) {
      try {
        body = JSON.parse(rawText);
      } catch {
        body = { raw: rawText };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(baseUrl, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
      contentType: response.headers.get("content-type") || "",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      contentType: "",
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectSeo(baseUrl) {
  const checks = [
    {
      name: "robots.txt",
      path: "/robots.txt",
      assertions: [
        { label: "user-agent", regex: /User-agent:\s*\*/i },
        { label: "sitemap", regex: /Sitemap:\s*https:\/\/omnifm\.xyz\/sitemap\.xml/i },
      ],
    },
    {
      name: "sitemap.xml",
      path: "/sitemap.xml",
      assertions: [
        { label: "home loc", regex: /<loc>https:\/\/omnifm\.xyz\/<\/loc>/i },
        { label: "dashboard loc", regex: /<loc>https:\/\/omnifm\.xyz\/dashboard<\/loc>/i },
        { label: "stations loc", regex: /<loc>https:\/\/omnifm\.xyz\/stations<\/loc>/i },
        { label: "premium loc", regex: /<loc>https:\/\/omnifm\.xyz\/premium<\/loc>/i },
        { label: "faq loc", regex: /<loc>https:\/\/omnifm\.xyz\/faq<\/loc>/i },
        { label: "privacy loc", regex: /<loc>https:\/\/omnifm\.xyz\/datenschutz<\/loc>/i },
      ],
    },
    {
      name: "manifest.json",
      path: "/manifest.json",
      assertions: [
        { label: "app name", regex: /"name"\s*:\s*"OmniFM"/i },
        { label: "start url", regex: /"start_url"\s*:\s*"\/"/i },
      ],
    },
    {
      name: "favicon.ico",
      path: "/favicon.ico",
      contentType: /image\/(png|x-icon)/i,
      assertions: [],
    },
    {
      name: "home meta",
      path: "/",
      assertions: [
        { label: "canonical", regex: /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/omnifm\.xyz\//i },
        { label: "og title", regex: /<meta[^>]+property=["']og:title["']/i },
        { label: "twitter card", regex: /<meta[^>]+name=["']twitter:card["']/i },
        { label: "json ld", regex: /application\/ld\+json/i },
      ],
    },
  ];

  let ok = true;
  for (const check of checks) {
    const response = await fetchText(baseUrl, check.path);
    if (!response.ok) {
      ok = false;
      logLine("FAIL", `seo ${check.name}: GET ${check.path} failed (${response.status || "network"}): ${response.error || "request failed"}`);
      continue;
    }
    if (check.contentType && !check.contentType.test(response.contentType)) {
      ok = false;
      logLine("FAIL", `seo ${check.name}: unexpected contentType=${response.contentType || "unknown"}`);
      continue;
    }
    const missing = check.assertions
      .filter((assertion) => !assertion.regex.test(response.text))
      .map((assertion) => assertion.label);
    if (missing.length > 0) {
      ok = false;
      logLine("FAIL", `seo ${check.name}: missing ${missing.join(", ")}`);
      continue;
    }
    logLine("OK", `seo ${check.name}: status=${response.status}, contentType=${response.contentType || "unknown"}`);
  }
  return { ok };
}

function evaluateProvider(name, payload, syncFields) {
  const failures = [];
  const warnings = [];
  if (!payload?.configured) {
    warnings.push("not configured");
  }

  const state = payload?.state || {};
  for (const field of syncFields) {
    const entry = state?.[field] || null;
    if (!entry) {
      if (payload?.configured) warnings.push(`${field}=never`);
      continue;
    }
    if (entry.ok === false) {
      failures.push(`${field}=${entry.error || "failed"}`);
    }
  }

  const live = payload?.live;
  if (live) {
    if (live.ok === true) {
      return { failures, warnings };
    }
    if (live.skipped) {
      warnings.push(`live=${live.reason || "skipped"}`);
    } else {
      failures.push(`live=${live.error || live.reason || "failed"}`);
    }
  }

  return { failures, warnings };
}

function printProviderSummary(name, payload, syncFields) {
  const { failures, warnings } = evaluateProvider(name, payload, syncFields);
  const live = payload?.live || null;
  const state = payload?.state || {};
  const syncSummary = syncFields
    .map((field) => `${field}:${summarizeSync(state[field])}`)
    .join(", ");
  const liveSummary = live
    ? live.ok
      ? "ok"
      : live.skipped
        ? `skipped:${live.reason || "unknown"}`
        : `failed:${live.error || live.reason || "unknown"}`
    : "not-requested";
  const header = `${name}: configured=${payload?.configured === true ? "yes" : "no"}, live=${liveSummary}, sync=[${syncSummary}]`;

  if (failures.length > 0) {
    logLine("FAIL", `${header}; ${failures.join("; ")}`);
    return { ok: false, warnings };
  }

  if (warnings.length > 0) {
    logLine("WARN", `${header}; ${warnings.join("; ")}`);
    return { ok: true, warnings };
  }

  logLine("OK", header);
  return { ok: true, warnings };
}

function pickDockerCommand() {
  const dockerCompose = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (dockerCompose.status === 0) {
    return { command: "docker", argsPrefix: ["compose"] };
  }

  const legacy = spawnSync("docker-compose", ["version"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (legacy.status === 0) {
    return { command: "docker-compose", argsPrefix: [] };
  }

  return null;
}

function inspectLogs(dockerService, logSince) {
  const docker = pickDockerCommand();
  if (!docker) {
    logLine("WARN", "Docker Compose not available; skipping log scan.");
    return { ok: true };
  }

  const result = spawnSync(
    docker.command,
    [...docker.argsPrefix, "logs", "--since", logSince, dockerService],
    {
      encoding: "utf8",
      stdio: "pipe",
    }
  );

  if (result.status !== 0) {
    const errorText = clipLine(result.stderr || result.stdout || "docker logs failed");
    logLine("WARN", `Docker log scan skipped: ${errorText}`);
    return { ok: true };
  }

  const lines = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const failurePatterns = [
    { label: "guild access denied", regex: /Guild-Zugriff verweigert|access denied/i },
    { label: "guild leave", regex: /Verlasse Guild|leave guild/i },
    { label: "worker start error", regex: /Startfehler/i },
  ];
  const warningPatterns = [
    { label: "reconnect circuit", regex: /Reconnect-Circuit/i },
    { label: "reconnect aborted", regex: /Reconnect abgebrochen/i },
    { label: "voice timeout", regex: /Reconnect Voice-Timeout/i },
  ];

  let hadFailure = false;
  for (const pattern of failurePatterns) {
    const matches = lines.filter((line) => pattern.regex.test(line));
    if (matches.length > 0) {
      hadFailure = true;
      logLine("FAIL", `logs: ${pattern.label} matched ${matches.length} line(s); sample="${clipLine(matches[0])}"`);
    }
  }

  for (const pattern of warningPatterns) {
    const matches = lines.filter((line) => pattern.regex.test(line));
    if (matches.length > 0) {
      logLine("WARN", `logs: ${pattern.label} matched ${matches.length} line(s); sample="${clipLine(matches[0])}"`);
    }
  }

  if (!hadFailure) {
    logLine("OK", `logs: scanned ${lines.length} line(s) for service ${dockerService} over ${logSince}`);
  }

  return { ok: !hadFailure };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const baseUrl = normalizeBaseUrl(args["base-url"] || process.env.OMNIFM_BASE_URL || process.env.PUBLIC_WEB_URL);
  const adminToken = resolveAdminToken(args);
  const dockerService = String(args["docker-service"] || process.env.OMNIFM_DOCKER_SERVICE || "omnifm").trim() || "omnifm";
  const logSince = String(args["log-since"] || process.env.OMNIFM_LOG_SINCE || "30m").trim() || "30m";
  const skipApi = args["skip-api"] === true;
  const skipLogs = args["skip-logs"] === true;

  let hadFailure = false;

  logLine("INFO", `baseUrl=${baseUrl}`);
  logLine("INFO", `dockerService=${dockerService}, logSince=${logSince}`);

  const seoResult = await inspectSeo(baseUrl);
  if (!seoResult.ok) hadFailure = true;

  if (!skipApi) {
    if (!adminToken) {
      logLine("FAIL", "Admin token missing. Set --admin-token, OMNIFM_ADMIN_TOKEN, API_ADMIN_TOKEN, or ADMIN_API_TOKEN.");
      hadFailure = true;
    } else {
      const requests = [
        {
          name: "discordbotlist",
          path: "/api/discordbotlist/status?live=1",
          syncFields: ["lastCommandsSync", "lastStatsSync", "lastVoteSync"],
        },
        {
          name: "botsgg",
          path: "/api/botsgg/status?live=1",
          syncFields: ["lastStatsSync"],
        },
        {
          name: "topgg",
          path: "/api/topgg/status?live=1",
          syncFields: ["lastProjectSync", "lastCommandsSync", "lastStatsSync", "lastVoteSync"],
        },
        {
          name: "vote-events",
          path: "/api/vote-events/status?limit=10",
          syncFields: [],
        },
      ];

      for (const request of requests) {
        const response = await fetchJson(baseUrl, request.path, adminToken);
        if (!response.ok) {
          hadFailure = true;
          logLine(
            "FAIL",
            `${request.name}: GET ${request.path} failed (${response.status || "network"}): ${response.error || response.body?.error || "request failed"}`
          );
          continue;
        }

        if (request.name === "vote-events") {
          const body = response.body || {};
          const supported = Array.isArray(body?.rewardReadiness?.supportedVoteProviders)
            ? body.rewardReadiness.supportedVoteProviders.join(", ")
            : "none";
          logLine(
            "OK",
            `vote-events: totalVotes=${body.totalVotes || 0}, supportedProviders=${supported}, rewardEngineImplemented=${body?.rewardReadiness?.rewardEngineImplemented === true ? "yes" : "no"}`
          );
          continue;
        }

        const summary = printProviderSummary(request.name, response.body || {}, request.syncFields);
        if (!summary.ok) hadFailure = true;
      }
    }
  } else {
    logLine("WARN", "API checks skipped.");
  }

  if (!skipLogs) {
    const logResult = inspectLogs(dockerService, logSince);
    if (!logResult.ok) hadFailure = true;
  } else {
    logLine("WARN", "Docker log checks skipped.");
  }

  if (hadFailure) {
    logLine("FAIL", "Phase 6 live acceptance failed.");
    process.exitCode = 1;
    return;
  }

  logLine("OK", "Phase 6 live acceptance passed.");
}

main().catch((error) => {
  logLine("FAIL", error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
