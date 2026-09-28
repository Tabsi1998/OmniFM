import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// German texts use real umlauts (#450): "auswählbar", not "auswaehlbar".
// Looks for the substitutes that had crept into the bot's answers, the
// dashboard's error messages and the logs. (/jahresrueckblick is a command name.)
const STEMS = [
  "[Zz]urueck", "[Aa]usgewaehlt", "[Aa]uswaehl", "[Gg]ewaehlt", "[Ww]aehl", "[Nn]aechst", "[Pp]ruef", "[Aa]uszufuehr",
  "[Aa]usgefuehrt", "[Dd]urchfuehr", "[Vv]erfueg", "[Aa]ender", "[Uu]nveraendert", "[Ss]paet", "[Tt]emporaer", "[Ll]aeuft",
  "[Uu]ebern", "[Uu]eberspr", "[Uu]eberschritten", "[Uu]ebrig", "[Hh]oerer", "[Zz]uhoerer", "[Hh]oerzeit", "hoert",
  "[Uu]?[Nn]?[Gg]ueltig", "[Ll]autstaerk", "[Aa]ufloes", "[Ff]uer", "[Bb]estaetig", "[Ee]inloes", "[Ee]ingeloest",
  "[Aa]ufgeloest", "[Aa]usgeloest", "[Ee]intraeg", "[Mm]enue", "[Nn]otfaell", "[Rr]ueckkehr", "[Ss]toerung",
  "[Vv]erlaenger", "[Vv]oruebergehend", "[Ww]oechentlich", "[Zz]usaetzlich", "[Bb]enoetig", "noetig", "[Gg]eloescht",
  "[Ll]oeschen", "[Gg]eschuetzt", "[Gg]roesser", "[Hh]inzugefuegt", "[Hh]oeher", "[Kk]oennen", "[Ll]aenger",
  "[Mm]oeglich", "[Mm]uessen", "[Uu]nterstuetz", "[Uu]nvollstaendig", "[Vv]erknuepf", "[Ww]aehrend",
  // Found in the dashboard (#454).
  "[Vv]orfaell", "[Aa]usloes", "[Ff]ehlschlaeg", "[Aa]nkuendig", "[Ss]chuetz", "[Rr]egulaer", "[Ww]uensch", "[Dd]uerf",
  "[Aa]usgeschoepft", "[Aa]usfaell", "[Ff]uellt", "[Ff]uege", "[Ss]chliesse", "[Uu]eberg", "[Hh]oere\\b", "[Dd]afuer",
];
const SUBSTITUTES = new RegExp(`\\b(?:${STEMS.join("|")})\\w*`);
// File names stay plain ASCII on purpose, and so do the aliases that
// recognise old messages stored with the substitutes (src/lib/language.js).
const ALLOWED = ["omnifm-jetzt-laeuft.png"];
const LEGACY = /\baliases:\s*\[/;

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

// The other languages' website texts are not German ("fuera" is Spanish).
const OTHER_LANGUAGE_FILES = /[\\/]i18n[\\/](?:ui[\\/]|guide[\\/](?!de\.js)|(?:en|es|fr|it|nl|pl|pt|tr)-)/;

test("German texts under src/ and frontend/src/ use real umlauts, no ae/oe/ue substitutes", () => {
  const found = [];
  const files = [...sourceFiles("src"), ...sourceFiles(path.join("frontend", "src")).filter((file) => !OTHER_LANGUAGE_FILES.test(file) && !file.endsWith(".test.js"))];
  for (const file of files) {
    fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (LEGACY.test(line)) return;
      const cleaned = ALLOWED.reduce((text, keep) => text.split(keep).join(""), line);
      const match = SUBSTITUTES.exec(cleaned);
      if (match) found.push(`${file}:${index + 1} ${match[0]}`);
    });
  }
  assert.deepEqual(found, []);
});
