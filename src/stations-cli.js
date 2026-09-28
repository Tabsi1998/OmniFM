/* eslint-disable no-await-in-loop -- an interactive CLI asks one question after the other */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  getStationsPath,
  isValidQualityPreset,
  loadStations,
  normalizeKey,
  saveStations
} from "./stations-store.js";

function parseUrl(raw) {
  try {
    const parsed = new URL(String(raw || "").trim());
    return parsed.toString();
  } catch {
    return null;
  }
}

function listStations(data) {
  const entries = Object.entries(data.stations);
  if (entries.length === 0) {
    return "Keine Stationen konfiguriert.";
  }

  const lines = [];
  lines.push(`Default: ${data.defaultStationKey || "-"}`);
  lines.push(`Quality: ${data.qualityPreset}`);
  if (Array.isArray(data.fallbackKeys) && data.fallbackKeys.length) {
    lines.push(`Fallback: ${data.fallbackKeys.join(", ")}`);
  }
  lines.push("");

  for (const [key, value] of entries) {
    const marker = key === data.defaultStationKey ? "*" : " ";
    lines.push(`${marker} ${key}: ${value.name}`);
    lines.push(`    ${value.url}`);
  }

  return lines.join("\n");
}

async function cmdAdd(data, nameRaw, rawUrl, keyRaw) {
  const name = String(nameRaw || "").trim();
  const url = parseUrl(rawUrl);
  const key = normalizeKey(keyRaw || name);

  if (!name) throw new Error("Name fehlt.");
  if (!url) throw new Error("Ungültige URL.");
  if (!key) throw new Error("Ungültiger Key.");
  if (data.stations[key]) throw new Error(`Key existiert bereits: ${key}`);

  data.stations[key] = { name, url };
  if (!data.defaultStationKey) data.defaultStationKey = key;
  const updated = await saveStations(data);
  return { updated, message: `Station hinzugefügt: ${name} (${key})` };
}

async function cmdRemove(data, keyRaw) {
  const key = normalizeKey(keyRaw);
  if (!data.stations[key]) throw new Error(`Station nicht gefunden: ${key}`);

  delete data.stations[key];
  if (data.defaultStationKey === key) {
    data.defaultStationKey = Object.keys(data.stations)[0] || null;
  }
  data.fallbackKeys = (data.fallbackKeys || []).filter((k) => k !== key);
  const updated = await saveStations(data);
  return { updated, message: `Station entfernt: ${key}` };
}

async function cmdRename(data, keyRaw, nameRaw) {
  const key = normalizeKey(keyRaw);
  const name = String(nameRaw || "").trim();
  if (!data.stations[key]) throw new Error(`Station nicht gefunden: ${key}`);
  if (!name) throw new Error("Neuer Name fehlt.");

  data.stations[key].name = name;
  const updated = await saveStations(data);
  return { updated, message: `Station umbenannt: ${key} -> ${name}` };
}

async function cmdSetDefault(data, keyRaw) {
  const key = normalizeKey(keyRaw);
  if (!data.stations[key]) throw new Error(`Station nicht gefunden: ${key}`);

  data.defaultStationKey = key;
  const updated = await saveStations(data);
  return { updated, message: `Default gesetzt: ${key}` };
}

async function cmdQuality(data, presetRaw) {
  const preset = String(presetRaw || "").toLowerCase();
  if (!isValidQualityPreset(preset)) {
    throw new Error("Ungültiges preset. Erlaubt: low, medium, high, custom");
  }

  data.qualityPreset = preset;
  const updated = await saveStations(data);
  return { updated, message: `Quality gesetzt: ${preset}` };
}

async function cmdFallback(data, rawValue) {
  const raw = String(rawValue || "").trim();
  if (raw.toLowerCase() === "clear") {
    data.fallbackKeys = [];
    const updated = await saveStations(data);
    return { updated, message: "Fallback-Liste geleert." };
  }

  const keys = raw
    .split(",")
    .map((part) => normalizeKey(part))
    .filter((k, idx, arr) => k && arr.indexOf(k) === idx);

  if (!keys.length) throw new Error("Keine gültigen Keys angegeben.");
  for (const key of keys) {
    if (!data.stations[key]) throw new Error(`Station nicht gefunden: ${key}`);
  }

  data.fallbackKeys = keys;
  const updated = await saveStations(data);
  return { updated, message: `Fallback-Liste gesetzt: ${keys.join(", ")}` };
}

function printHelp() {
  console.log("Usage:");
  console.log("  node src/stations-cli.js wizard");
  console.log("  node src/stations-cli.js list");
  console.log("  node src/stations-cli.js add <name> <url> [key]");
  console.log("  node src/stations-cli.js remove <key>");
  console.log("  node src/stations-cli.js rename <key> <new-name>");
  console.log("  node src/stations-cli.js set-default <key>");
  console.log("  node src/stations-cli.js quality <low|medium|high|custom>");
  console.log("  node src/stations-cli.js fallback <key1,key2,...|clear>");
  console.log("");
  console.log(`stations.json: ${getStationsPath()}`);
}

function printWizardMenu() {
  console.log("");
  console.log("=== Stations Wizard ===");
  console.log("1) List");
  console.log("2) Add");
  console.log("3) Remove");
  console.log("4) Rename");
  console.log("5) Set default");
  console.log("6) Set quality");
  console.log("7) Set fallback");
  console.log("8) Exit");
}

async function pickStationKey(rl, data, prompt) {
  const keys = Object.keys(data.stations);
  if (keys.length === 0) {
    console.log("Keine Stationen vorhanden.");
    return null;
  }

  keys.forEach((key, idx) => {
    const value = data.stations[key];
    const marker = key === data.defaultStationKey ? "*" : " ";
    console.log(`${idx + 1}. ${marker} ${value.name} (${key})`);
  });

  const answer = (await rl.question(`${prompt} (Nummer oder Key): `)).trim();
  if (/^[0-9]+$/.test(answer)) {
    const idx = Number(answer) - 1;
    if (idx >= 0 && idx < keys.length) return keys[idx];
  }

  const asKey = normalizeKey(answer);
  return data.stations[asKey] ? asKey : null;
}

async function runWizard() {
  const rl = createInterface({ input, output });
  let data = loadStations();

  try {
    console.log(`Stations-Datei: ${getStationsPath()}`);

    while (true) {
      printWizardMenu();
      const choice = (await rl.question("Auswahl: ")).trim();

      try {
        if (choice === "1") {
          console.log("");
          console.log(listStations(data));
          continue;
        }

        if (choice === "2") {
          const name = await rl.question("Name: ");
          const url = await rl.question("URL: ");
          const key = await rl.question("Key (optional): ");
          const result = await cmdAdd(data, name, url, key);
          data = result.updated;
          console.log(result.message);
          continue;
        }

        if (choice === "3") {
          const key = await pickStationKey(rl, data, "Zu entfernende Station");
          if (!key) {
            console.log("Station nicht gefunden.");
            continue;
          }
          const result = await cmdRemove(data, key);
          data = result.updated;
          console.log(result.message);
          continue;
        }

        if (choice === "4") {
          const key = await pickStationKey(rl, data, "Zu umbenennende Station");
          if (!key) {
            console.log("Station nicht gefunden.");
            continue;
          }
          const name = await rl.question("Neuer Name: ");
          const result = await cmdRename(data, key, name);
          data = result.updated;
          console.log(result.message);
          continue;
        }

        if (choice === "5") {
          const key = await pickStationKey(rl, data, "Neue Default-Station");
          if (!key) {
            console.log("Station nicht gefunden.");
            continue;
          }
          const result = await cmdSetDefault(data, key);
          data = result.updated;
          console.log(result.message);
          continue;
        }

        if (choice === "6") {
          const preset = await rl.question("Preset (low|medium|high|custom): ");
          const result = await cmdQuality(data, preset);
          data = result.updated;
          console.log(result.message);
          continue;
        }

        if (choice === "7") {
          console.log("Fallback-Liste setzen: key1,key2,... oder 'clear'");
          const fallback = await rl.question("Fallback: ");
          const result = await cmdFallback(data, fallback);
          data = result.updated;
          console.log(result.message);
          continue;
        }

        if (choice === "8" || choice.toLowerCase() === "exit") {
          console.log("Wizard beendet.");
          return 0;
        }

        console.log("Ungültige Auswahl.");
      } catch (err) {
        console.error(`Fehler: ${err.message}`);
      }
    }
  } finally {
    rl.close();
  }
}

async function run() {
  const [, , rawCommand, ...args] = process.argv;
  const command = String(rawCommand || "").toLowerCase();

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return command ? 0 : 1;
  }

  if (command === "wizard") {
    return runWizard();
  }

  let data = loadStations();

  try {
    if (command === "list") {
      console.log(listStations(data));
      return 0;
    }

    if (command === "add") {
      if (args.length < 2) throw new Error("add braucht: <name> <url> [key]");
      const result = await cmdAdd(data, args[0], args[1], args[2]);
      data = result.updated;
      console.log(result.message);
      return 0;
    }

    if (command === "remove") {
      if (args.length < 1) throw new Error("remove braucht: <key>");
      const result = await cmdRemove(data, args[0]);
      data = result.updated;
      console.log(result.message);
      return 0;
    }

    if (command === "rename") {
      if (args.length < 2) throw new Error("rename braucht: <key> <new-name>");
      const result = await cmdRename(data, args[0], args[1]);
      data = result.updated;
      console.log(result.message);
      return 0;
    }

    if (command === "set-default") {
      if (args.length < 1) throw new Error("set-default braucht: <key>");
      const result = await cmdSetDefault(data, args[0]);
      data = result.updated;
      console.log(result.message);
      return 0;
    }

    if (command === "quality") {
      if (args.length < 1) throw new Error("quality braucht: <low|medium|high|custom>");
      const result = await cmdQuality(data, args[0]);
      data = result.updated;
      console.log(result.message);
      return 0;
    }

    if (command === "fallback") {
      if (args.length < 1) throw new Error("fallback braucht: <key1,key2,...|clear>");
      const result = await cmdFallback(data, args[0]);
      data = result.updated;
      console.log(result.message);
      return 0;
    }

    printHelp();
    return 1;
  } catch (err) {
    console.error(`Fehler: ${err.message}`);
    return 1;
  }
}

// The catalogue lives in MongoDB when the setup has one (#292): the CLI edits
// the same stations as the bot and the owner console, not a file nobody reads.
const { loadBackendEnv } = await import("./entrypoints/owner-env.mjs");
loadBackendEnv();
if (String(process.env.MONGO_URL || "").trim()) {
  const { connect } = await import("./lib/db.js");
  const { initStationsStore } = await import("./stations-store.js");
  await connect();
  await initStationsStore();
}

const code = await run();
process.exit(code);
