#!/usr/bin/env node
// Releases of OmniFM (#261): SemVer tags vX.Y.Z, CHANGELOG.md and GitHub
// releases.
//
//   node scripts/release.mjs notes [<since>]     merged pull requests since the
//                                                last tag, grouped for the changelog
//   node scripts/release.mjs next [<since>]      the version those changes call for
//   node scripts/release.mjs prepare <version>   sets the version in package.json
//                                                and package-lock.json
//   node scripts/release.mjs tag                 after the release PR is merged:
//                                                tag main, push, create the GitHub release
//
// The German changelog text is written by hand in the release PR; `notes` is
// the list it starts from.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GROUPS = [
  ["Neu", ["feat"]],
  ["Verbessert", ["perf", "refactor"]],
  ["Behoben", ["fix"]],
  ["Intern", ["ci", "test", "tests", "build", "chore", "docs", "deps"]],
];

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** "feat(runtime)!: title" -> { type, breaking, title } */
export function parseConventionalTitle(title) {
  const match = String(title || "").trim().match(/^(\w+)(?:\([^)]*\))?(!)?:\s*(.+)$/);
  if (!match) return { type: "other", breaking: false, title: String(title || "").trim() };
  return { type: match[1].toLowerCase(), breaking: Boolean(match[2]), title: match[3].trim() };
}

/** Merge commits of GitHub pull requests: subject "Merge pull request #N ...", body = PR title. */
export function parseMergeLog(text) {
  return String(text || "").split("\x1e").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [subject = "", body = ""] = entry.split("\x00");
    const number = subject.match(/Merge pull request #(\d+)/)?.[1];
    const title = body.split("\n").map((line) => line.trim()).find(Boolean) || subject;
    return number ? { number: Number(number), ...parseConventionalTitle(title) } : null;
  }).filter(Boolean);
}

export function groupChanges(changes) {
  const groups = GROUPS.map(([label, types]) => ({
    label,
    items: changes.filter((change) => types.includes(change.type)),
  }));
  const known = new Set(GROUPS.flatMap(([, types]) => types));
  const other = changes.filter((change) => !known.has(change.type));
  if (other.length) groups.push({ label: "Sonstiges", items: other });
  return groups.filter((group) => group.items.length > 0);
}

export function nextVersion(current, changes) {
  const [major, minor, patch] = String(current).split(".").map((part) => Number.parseInt(part, 10) || 0);
  if (changes.some((change) => change.breaking)) return `${major + 1}.0.0`;
  if (changes.some((change) => change.type === "feat")) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function renderNotes(groups) {
  return groups.map(({ label, items }) =>
    `### ${label}\n\n${items.map((item) => `- ${item.title} (#${item.number})`).join("\n")}`).join("\n\n");
}

/** The body of one version in CHANGELOG.md, for the GitHub release. */
export function changelogSection(text, version) {
  const lines = String(text || "").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${version} `) || line.trim() === `## ${version}`);
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

function lastTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*");
  } catch {
    return "";
  }
}

function changesSince(since) {
  const range = since ? `${since}..HEAD` : "HEAD";
  return parseMergeLog(git("log", "--merges", "--first-parent", "--format=%s%x00%b%x1e", range));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(data, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  const current = readJson("package.json").version;
  if (command === "notes" || command === "next") {
    const since = argument || lastTag();
    const changes = changesSince(since);
    if (command === "next") {
      console.log(nextVersion(current, changes));
    } else {
      console.log(`<!-- ${changes.length} pull requests since ${since || "the first commit"} -->\n`);
      console.log(renderNotes(groupChanges(changes)));
    }
  } else if (command === "prepare") {
    if (!/^\d+\.\d+\.\d+$/.test(String(argument || ""))) throw new Error("Usage: release.mjs prepare <x.y.z>");
    const pkg = readJson("package.json");
    pkg.version = argument;
    writeJson("package.json", pkg);
    const lock = readJson("package-lock.json");
    lock.version = argument;
    if (lock.packages?.[""]) lock.packages[""].version = argument;
    writeJson("package-lock.json", lock);
    console.log(`package.json and package-lock.json now at ${argument}. Add "## ${argument} - <date>" to CHANGELOG.md.`);
  } else if (command === "tag") {
    const tag = `v${current}`;
    const notes = changelogSection(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), current);
    if (!notes) throw new Error(`CHANGELOG.md has no section for ${current}.`);
    if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("Tag releases from main.");
    git("tag", "-a", tag, "-m", `OmniFM ${current}`);
    git("push", "origin", tag);
    const notesFile = path.join(ROOT, ".local-testing", `release-${current}.md`);
    fs.mkdirSync(path.dirname(notesFile), { recursive: true });
    fs.writeFileSync(notesFile, `${notes}\n`);
    execFileSync("gh", ["release", "create", tag, "--title", `OmniFM ${current}`, "--notes-file", notesFile], { cwd: ROOT, stdio: "inherit" });
  } else {
    console.error("Usage: node scripts/release.mjs notes|next [<since>] | prepare <x.y.z> | tag");
    process.exit(2);
  }
}
