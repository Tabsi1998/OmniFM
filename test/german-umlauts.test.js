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

test("German texts under src/ use real umlauts, no ae/oe/ue substitutes", () => {
  const found = [];
  for (const file of sourceFiles("src")) {
    fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (LEGACY.test(line)) return;
      const cleaned = ALLOWED.reduce((text, keep) => text.split(keep).join(""), line);
      const match = SUBSTITUTES.exec(cleaned);
      if (match) found.push(`${file}:${index + 1} ${match[0]}`);
    });
  }
  assert.deepEqual(found, []);
});
