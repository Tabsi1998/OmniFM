// ============================================================
// OmniFM: what the imprint, the privacy policy and the terms must say (#424)
// ============================================================
// One list for the owner console's checklist, the cockpit and the public
// answers' missingCoreFields. German like the owner console. It follows the
// usual templates for a sole trader in Austria (WKO); it is no legal advice.
//
// level: "required"    has to be there
//        "conditional" has to be there if it applies; the owner can say it does not
//        "optional"    voluntary
// value(answers) reads what visitors see, from the answers of /api/legal,
// /api/privacy and /api/terms; with a list, every part has to be filled.
// Bundled by the owner console too (frontend/vite.config.js).

/** The checklist's pages, in the owner console's order, with the public address. */
export const LEGAL_PAGES = Object.freeze([
  { key: "imprint", label: "Impressum", path: "/impressum" },
  { key: "disclosure", label: "Offenlegung", path: "/impressum" },
  { key: "privacy", label: "Datenschutzerklärung", path: "/datenschutz" },
  { key: "terms", label: "Nutzungsbedingungen", path: "/nutzungsbedingungen" },
]);

const filled = (value) => String(value ?? "").trim() !== "";
const imprint = (answers) => answers?.legal?.legal || {};
const privacy = (answers) => answers?.privacy || {};
const terms = (answers) => answers?.terms || {};

export const LEGAL_REQUIREMENTS = Object.freeze([
  // Impressum
  {
    key: "providerName", page: "imprint", level: "required", label: "Name bzw. Firma",
    why: "Besucher müssen sehen, wer hinter OmniFM steht.",
    source: "§ 5 Abs. 1 Z 1 ECG", fields: ["providerName"],
    value: (answers) => imprint(answers).providerName,
  },
  {
    key: "address", page: "imprint", level: "required", label: "Anschrift",
    why: "Eine Adresse, an die man Post schicken kann; ein Postfach reicht nicht.",
    source: "§ 5 Abs. 1 Z 2 ECG", fields: ["streetAddress", "postalCode", "city"],
    value: (answers) => [imprint(answers).streetAddress, imprint(answers).postalCode, imprint(answers).city],
  },
  {
    key: "email", page: "imprint", level: "required", label: "E-Mail-Adresse",
    why: "Man muss dich schnell und direkt erreichen können.",
    source: "§ 5 Abs. 1 Z 3 ECG", fields: ["email"],
    value: (answers) => imprint(answers).email,
  },
  {
    key: "commercialRegister", page: "imprint", level: "conditional", label: "Firmenbuchnummer und Firmenbuchgericht",
    why: "Nur wenn du im Firmenbuch eingetragen bist, zum Beispiel als e.U. oder GmbH.",
    source: "§ 5 Abs. 1 Z 4 ECG, § 14 UGB", fields: ["commercialRegisterNumber", "commercialRegisterCourt"],
    value: (answers) => [imprint(answers).commercialRegisterNumber, imprint(answers).commercialRegisterCourt],
  },
  {
    key: "supervisoryAuthority", page: "imprint", level: "conditional", label: "Gewerbebehörde",
    why: "Mit Gewerbeschein: die Behörde, die ihn ausgestellt hat (Bezirkshauptmannschaft oder Magistrat).",
    source: "§ 5 Abs. 1 Z 5 ECG", fields: ["supervisoryAuthority"],
    value: (answers) => imprint(answers).supervisoryAuthority,
  },
  {
    key: "profession", page: "imprint", level: "conditional", label: "Kammer, Berufsbezeichnung und Gewerbeordnung",
    why: "Mit Gewerbeschein bist du Mitglied der Wirtschaftskammer: die Kammer, deine Berufsbezeichnung (verliehen in Österreich) und der Hinweis auf die Gewerbeordnung (www.ris.bka.gv.at).",
    source: "§ 5 Abs. 1 Z 6 ECG", fields: ["chamber", "profession", "professionRules"],
    value: (answers) => [imprint(answers).chamber, imprint(answers).profession, imprint(answers).professionRules],
  },
  {
    key: "vatId", page: "imprint", level: "conditional", label: "UID-Nummer",
    why: "Nur wenn du eine hast. Als Kleinunternehmer ohne UID-Nummer trifft das nicht zu.",
    source: "§ 5 Abs. 1 Z 7 ECG", fields: ["vatId"],
    value: (answers) => imprint(answers).vatId,
  },
  {
    key: "phone", page: "imprint", level: "optional", label: "Telefon",
    why: "Freiwillig; die E-Mail-Adresse reicht.",
    source: "", fields: ["phone"],
    value: (answers) => imprint(answers).phone,
  },
  // Offenlegung (Mediengesetz): a small website names only its owner and what they do.
  {
    key: "mediaOwner", page: "disclosure", level: "required", label: "Medieninhaber mit Wohnort bzw. Sitz",
    why: "Wer die Website herausgibt, mit Wohnort oder Sitz; meist du selbst, zum Beispiel „Max Mustermann, Linz“.",
    source: "§ 25 Abs. 5 MedienG", fields: ["mediaOwner"],
    value: (answers) => imprint(answers).mediaOwner,
  },
  {
    key: "businessPurpose", page: "disclosure", level: "required", label: "Unternehmensgegenstand",
    why: "In einem Satz, was du machst, zum Beispiel „Betrieb eines Discord-Radio-Dienstes“.",
    source: "§ 25 Abs. 5 MedienG", fields: ["businessPurpose"],
    value: (answers) => imprint(answers).businessPurpose,
  },
  {
    key: "editorialResponsible", page: "disclosure", level: "optional", label: "Redaktionell verantwortlich",
    why: "Freiwillig; nur wenn jemand anderes als du die Inhalte verantwortet.",
    source: "", fields: ["editorialResponsible"],
    value: (answers) => imprint(answers).editorialResponsible,
  },
  {
    key: "mediaLine", page: "disclosure", level: "optional", label: "Grundlegende Richtung (Blattlinie)",
    why: "Braucht eine kleine Website wie OmniFM nicht; sie erscheint nur, wenn du etwas einträgst.",
    source: "§ 25 Abs. 4 MedienG", fields: ["mediaLine"],
    value: (answers) => imprint(answers).mediaLine,
  },
  // Datenschutzerklärung
  {
    key: "controller", page: "privacy", level: "required", label: "Verantwortlicher mit Anschrift",
    why: "Wer über die Daten entscheidet. Kommt aus Name und Anschrift oben.",
    source: "Art. 13 Abs. 1 lit. a DSGVO", fields: ["providerName", "streetAddress", "postalCode", "city"],
    value: (answers) => [privacy(answers).controller?.name, privacy(answers).controller?.streetAddress,
      privacy(answers).controller?.postalCode, privacy(answers).controller?.city],
  },
  {
    key: "privacyContact", page: "privacy", level: "required", label: "Kontakt für Datenschutzfragen",
    why: "Wohin man Fragen, Auskunfts- oder Löschwünsche schickt. Kommt aus der E-Mail-Adresse oben.",
    source: "Art. 13 Abs. 1 lit. a DSGVO", fields: ["email"],
    value: (answers) => privacy(answers).contact?.email,
  },
  {
    key: "authority", page: "privacy", level: "required", label: "Beschwerdebehörde",
    why: "Steht automatisch drin: die Österreichische Datenschutzbehörde.",
    source: "Art. 13 Abs. 2 lit. d DSGVO", fields: [],
    value: (answers) => privacy(answers).authority?.name,
  },
  {
    key: "dpo", page: "privacy", level: "conditional", label: "Datenschutzbeauftragter",
    why: "Nur wenn du einen bestellt hast; bei einem kleinen Dienst ist das normalerweise nicht nötig.",
    source: "Art. 13 Abs. 1 lit. b, Art. 37 DSGVO", fields: ["dpoEmail", "dpoName"],
    value: (answers) => privacy(answers).dpo?.email,
  },
  {
    key: "hosting", page: "privacy", level: "optional", label: "Hosting-Anbieter und Standort",
    why: "Empfohlen: wer die Server betreibt und wo. Sonst nennt die Erklärung nur „den Hosting-Anbieter“.",
    source: "Art. 13 Abs. 1 lit. e DSGVO", fields: ["hostingProvider", "hostingLocation"],
    value: (answers) => [privacy(answers).hosting?.provider, privacy(answers).hosting?.location],
  },
  // Nutzungsbedingungen
  {
    key: "termsOperator", page: "terms", level: "required", label: "Anbieter und Kontakt",
    why: "Wer die Bedingungen stellt und wie man ihn erreicht. Kommt aus Name und E-Mail-Adresse oben.",
    source: "", fields: ["providerName", "email"],
    value: (answers) => [terms(answers).operator?.providerName, terms(answers).contact?.email],
  },
  {
    key: "effectiveDate", page: "terms", level: "required", label: "Gültig ab",
    why: "Ab wann diese Fassung gilt; so sieht jeder, welche Version er gerade liest.",
    source: "", fields: ["effectiveDate"],
    value: (answers) => terms(answers).contact?.effectiveDate,
  },
  {
    key: "governingLaw", page: "terms", level: "required", label: "Anwendbares Recht",
    why: "Welches Recht gilt, meist „Österreichisches Recht“; der Schutz für Verbraucher bleibt davon unberührt.",
    source: "", fields: ["governingLaw"],
    value: (answers) => terms(answers).contact?.governingLaw,
  },
]);

/**
 * Every requirement with its state: "ok" filled, "missing" required but empty,
 * "open" applies only sometimes and nobody said it does not, "na" the owner
 * said it does not apply, "optional" voluntary and empty.
 */
export function legalChecklist(answers = {}, notApplicable = []) {
  const skipped = new Set(Array.isArray(notApplicable) ? notApplicable : []);
  return LEGAL_REQUIREMENTS.map(({ value, ...item }) => {
    const parts = [].concat(value(answers));
    let state = "optional";
    if (parts.every(filled)) state = "ok";
    else if (item.level === "required") state = "missing";
    else if (item.level === "conditional") state = skipped.has(item.key) ? "na" : "open";
    return { ...item, state };
  });
}

/** Red when something required is missing, yellow when something may apply, else green. */
export function legalPageLight(items) {
  if (items.some((item) => item.state === "missing")) return "red";
  if (items.some((item) => item.state === "open")) return "yellow";
  return "green";
}

/**
 * The answers' missingCoreFields: the owner console's fields that a required
 * requirement of these pages still lacks, each once; a requirement without
 * a field (none yet) by its key.
 */
export function missingLegalFields(answers, pages) {
  const wanted = new Set(pages);
  const missing = [];
  for (const item of LEGAL_REQUIREMENTS) {
    if (!wanted.has(item.page) || item.level !== "required") continue;
    const parts = [].concat(item.value(answers));
    parts.forEach((part, index) => {
      if (!filled(part)) missing.push(item.fields[index] || item.key);
    });
  }
  return [...new Set(missing)];
}
