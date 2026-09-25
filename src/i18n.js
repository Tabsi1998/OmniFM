const RAW_DEFAULT_LANGUAGE = String(
  process.env.DEFAULT_LANGUAGE
  || process.env.DEFAULT_LANG
  || process.env.APP_LANGUAGE
  || "en"
).trim().toLowerCase();

const DEFAULT_LANGUAGE = RAW_DEFAULT_LANGUAGE.startsWith("de") ? "de" : "en";

export function getDefaultLanguage() {
  return DEFAULT_LANGUAGE;
}

export function normalizeLanguage(input, fallback = DEFAULT_LANGUAGE) {
  const raw = String(input || "").trim().toLowerCase();
  if (raw.startsWith("de")) return "de";
  if (raw.startsWith("en")) return "en";
  return fallback === "de" ? "de" : "en";
}

export function resolveLanguageFromAcceptLanguage(headerValue, fallback = DEFAULT_LANGUAGE) {
  const source = String(headerValue || "").trim();
  if (!source) return normalizeLanguage("", fallback);

  const tokens = source
    .split(",")
    .map((part) => String(part || "").trim().split(";")[0].trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token.toLowerCase().startsWith("de")) return "de";
    if (token.toLowerCase().startsWith("en")) return "en";
  }

  // A browser in any other language gets English.
  return tokens.length ? "en" : normalizeLanguage("", fallback);
}

export function getLocaleForLanguage(language) {
  return normalizeLanguage(language) === "de" ? "de-DE" : "en-US";
}
