// ============================================================
// OmniFM: the public website data from the owner console (#288)
// ============================================================
// The Node twin of FastAPI's public answers that depend on the owner
// console: imprint, privacy and terms (company section), prices and tiers
// (plans), sponsors and bot listings (marketing), the live numbers from the
// bots' health document, and the cover lookup. Same fields and fallbacks as
// backend/services/legal.py, backend/routers/premium.py and public.py.
import {
  DEFAULT_OWNER_CONFIG,
  configSectionFrom,
} from "./owner-config.js";
import {
  configBool,
  directorySetting,
  isStripeEnabled,
  liveRuntimeTotals,
  stripeSecretKey,
  systemSetting,
} from "./owner-monitoring.js";
import { parseIntLike } from "./owner-licenses.js";
import { isPublicOrigin, pickPublicOrigin, webDomainOrigin } from "./public-origin.js";
import { safeFetch } from "./safe-outbound-http.js";

/** FastAPI's TIERS: the base the owner's plans are laid over. */
export const BASE_TIERS = Object.freeze({
  free: { name: "Free", bitrate: "64k", reconnectMs: 5000, maxBots: 2, pricePerMonth: 0 },
  pro: { name: "Pro", bitrate: "128k", reconnectMs: 1500, maxBots: 8, pricePerMonth: 299 },
  ultimate: { name: "Ultimate", bitrate: "320k", reconnectMs: 400, maxBots: 16, pricePerMonth: 499 },
});
const DURATION_PRICING = { pro: { 1: 299, 3: 249, 6: 229, 12: 199 }, ultimate: { 1: 499, 3: 399, 6: 349, 12: 299 } };
const SEAT_MONTHLY_TOTAL_CENTS = { pro: { 1: 299, 2: 549, 3: 749, 5: 1149 }, ultimate: { 1: 499, 2: 799, 3: 1099, 5: 1699 } };
export const DURATION_OPTIONS = Object.freeze([1, 3, 6, 12]);
export const SEAT_OPTIONS = Object.freeze([1, 2, 3, 5]);
const PRO_TRIAL_MONTHS = 1;

const text = (value) => String(value ?? "").trim();

/** An env value that is still the example text counts as empty (Node kept this guard). */
function isPlaceholder(value) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return false;
  return normalized.includes("example operator")
    || normalized.startsWith("example ")
    || normalized.endsWith("@example.com")
    || normalized.includes("://localhost")
    || normalized.includes("://127.0.0.1");
}

function envValue(env, name) {
  const value = text(env[name]);
  return isPlaceholder(value) ? "" : value;
}

export function extractMailbox(raw) {
  const value = text(raw);
  if (!value || isPlaceholder(value)) return "";
  const bracket = value.match(/<([^>]+)>/);
  if (bracket?.[1]) return bracket[1].trim();
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

export function isProTrialEnabled(env = process.env) {
  return text(env.PRO_TRIAL_ENABLED || "1") !== "0";
}

const productNameOf = (env) => envValue(env, "LEGAL_PRODUCT_NAME") || "OmniFM";

/** The website fallback: only an address visitors can reach, never the LAN one start.sh writes. */
function publicWebsite(env) {
  const origin = pickPublicOrigin([env.PUBLIC_WEB_URL, webDomainOrigin(env.WEB_DOMAIN)]);
  return isPublicOrigin(origin) ? origin : "";
}

/**
 * GET /api/legal (build_public_legal_notice). What the owner saved first, then
 * LEGAL_*, then the console default; FastAPI let the default hide LEGAL_*.
 */
export function legalNotice(raw, env = process.env) {
  const saved = raw?.company && typeof raw.company === "object" ? raw.company : {};
  const defaults = DEFAULT_OWNER_CONFIG.company || {};
  const publicUrl = publicWebsite(env);
  const fallbackEmail = extractMailbox(systemSetting(raw, "smtp", "from", "SMTP_FROM", "", env));
  const val = (field, envKey, fallback = "") => text(saved[field]) || envValue(env, envKey) || text(defaults[field]) || fallback;
  const kleinunternehmer = saved.kleinunternehmer === undefined ? defaults.kleinunternehmer !== false : Boolean(saved.kleinunternehmer);
  const legal = {
    productName: productNameOf(env),
    providerName: val("providerName", "LEGAL_PROVIDER_NAME"),
    legalForm: val("legalForm", "LEGAL_LEGAL_FORM"),
    representative: val("representative", "LEGAL_REPRESENTATIVE"),
    streetAddress: val("streetAddress", "LEGAL_STREET_ADDRESS"),
    postalCode: val("postalCode", "LEGAL_POSTAL_CODE"),
    city: val("city", "LEGAL_CITY"),
    country: val("country", "LEGAL_COUNTRY", "Österreich"),
    email: val("email", "LEGAL_EMAIL") || fallbackEmail,
    phone: val("phone", "LEGAL_PHONE"),
    website: val("website", "LEGAL_WEBSITE") || publicUrl,
    businessPurpose: val("businessPurpose", "LEGAL_BUSINESS_PURPOSE"),
    commercialRegisterNumber: val("commercialRegisterNumber", "LEGAL_COMMERCIAL_REGISTER_NUMBER"),
    commercialRegisterCourt: val("commercialRegisterCourt", "LEGAL_COMMERCIAL_REGISTER_COURT"),
    vatId: val("vatId", "LEGAL_VAT_ID"),
    supervisoryAuthority: val("supervisoryAuthority", "LEGAL_SUPERVISORY_AUTHORITY"),
    chamber: val("chamber", "LEGAL_CHAMBER"),
    profession: val("profession", "LEGAL_PROFESSION"),
    professionRules: val("professionRules", "LEGAL_PROFESSION_RULES"),
    editorialResponsible: val("editorialResponsible", "LEGAL_EDITORIAL_RESPONSIBLE"),
    mediaOwner: val("mediaOwner", "LEGAL_MEDIA_OWNER"),
    mediaLine: val("mediaLine", "LEGAL_MEDIA_LINE"),
    kleinunternehmer,
    taxNote: kleinunternehmer ? "Umsatzsteuerbefreit als Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG (keine Umsatzsteuer, kein USt-Ausweis)." : "",
  };
  const missingCoreFields = ["providerName", "streetAddress", "postalCode", "city", "email"].filter((field) => !legal[field]);
  return {
    legal,
    missingCoreFields,
    isConfigured: missingCoreFields.length === 0,
    basis: ["ECG_5", "UGB_14", "GewO_63", "MedienG_25"],
    updatedAt: new Date().toISOString(),
  };
}

function directoryEnabled(raw, env, directory, envPrefix) {
  return configBool(directorySetting(raw, directory, "enabled", `${envPrefix}_ENABLED`, false, env))
    && Boolean(text(directorySetting(raw, directory, "token", `${envPrefix}_TOKEN`, "", env)));
}

/** GET /api/privacy (build_public_privacy_notice). */
export function privacyNotice(raw, env = process.env) {
  const legal = legalNotice(raw, env).legal;
  const company = configSectionFrom(raw, "company");
  const botId = text(directorySetting(raw, "discordBotList", "botId", "DISCORDBOTLIST_BOT_ID", "", env) || env.BOT_1_CLIENT_ID);
  const controller = {
    name: envValue(env, "PRIVACY_CONTROLLER_NAME") || legal.providerName,
    representative: envValue(env, "PRIVACY_CONTROLLER_REPRESENTATIVE") || legal.representative,
    streetAddress: envValue(env, "PRIVACY_CONTROLLER_STREET_ADDRESS") || legal.streetAddress,
    postalCode: envValue(env, "PRIVACY_CONTROLLER_POSTAL_CODE") || legal.postalCode,
    city: envValue(env, "PRIVACY_CONTROLLER_CITY") || legal.city,
    country: envValue(env, "PRIVACY_CONTROLLER_COUNTRY") || legal.country || "Österreich",
    website: envValue(env, "PRIVACY_CONTROLLER_WEBSITE") || legal.website,
  };
  const contact = {
    email: envValue(env, "PRIVACY_CONTACT_EMAIL") || legal.email,
    phone: envValue(env, "PRIVACY_CONTACT_PHONE") || legal.phone,
  };
  const missingCoreFields = [];
  if (!controller.name) missingCoreFields.push("controllerName");
  if (!controller.streetAddress) missingCoreFields.push("controllerStreetAddress");
  if (!controller.postalCode) missingCoreFields.push("controllerPostalCode");
  if (!controller.city) missingCoreFields.push("controllerCity");
  if (!contact.email) missingCoreFields.push("contactEmail");
  return {
    controller,
    productName: legal.productName,
    contact,
    dpo: {
      name: envValue(env, "PRIVACY_DPO_NAME") || text(company.dpoName),
      email: envValue(env, "PRIVACY_DPO_EMAIL") || text(company.dpoEmail),
    },
    hosting: {
      provider: envValue(env, "PRIVACY_HOSTING_PROVIDER") || text(company.hostingProvider),
      location: envValue(env, "PRIVACY_HOSTING_LOCATION") || text(company.hostingLocation),
    },
    authority: {
      name: envValue(env, "PRIVACY_AUTHORITY_NAME") || "Österreichische Datenschutzbehörde",
      website: envValue(env, "PRIVACY_AUTHORITY_WEBSITE") || "https://www.dsb.gv.at/",
    },
    additionalRecipients: envValue(env, "PRIVACY_ADDITIONAL_RECIPIENTS"),
    customNote: envValue(env, "PRIVACY_CUSTOM_NOTE"),
    features: {
      stripeEnabled: isStripeEnabled(raw, env) && Boolean(stripeSecretKey(raw, env)),
      smtpEnabled: Boolean(text(systemSetting(raw, "smtp", "host", "SMTP_HOST", "", env))),
      discordBotListEnabled: directoryEnabled(raw, env, "discordBotList", "DISCORDBOTLIST") && /^\d{17,22}$/.test(botId),
      botsGGEnabled: directoryEnabled(raw, env, "botsGG", "BOTSGG"),
      topGGEnabled: directoryEnabled(raw, env, "topGG", "TOPGG"),
      recognitionEnabled: configBool(systemSetting(raw, "audioRecognition", "enabled", "NOW_PLAYING_RECOGNITION_ENABLED", false, env))
        && Boolean(text(systemSetting(raw, "audioRecognition", "apiKey", "ACOUSTID_API_KEY", "", env))),
      googleAnalyticsEnabled: true,
      googleAnalyticsMeasurementId: "G-J5X0ZZ5E3Z",
      cookieConsentStorageKey: "omnifm.cookieConsent.v1",
      stationPreviewEnabled: true,
      localeStorageKey: "omnifm.web.locale",
    },
    retention: {
      logDays: parseIntLike(env.LOG_MAX_DAYS, 14),
      songHistoryEnabled: configBool(systemSetting(raw, "songHistory", "enabled", "SONG_HISTORY_ENABLED", true, env), true),
      songHistoryMaxPerGuild: parseIntLike(systemSetting(raw, "songHistory", "maxPerGuild", "SONG_HISTORY_MAX_PER_GUILD", 100, env), 100),
      listeningStatsEnabled: true,
      scheduledEventsEnabled: true,
    },
    missingCoreFields,
    isConfigured: missingCoreFields.length === 0,
    basis: ["GDPR_ART_13", "GDPR_ART_15_22", "DSB_AT"],
    updatedAt: new Date().toISOString(),
  };
}

/** GET /api/terms (build_public_terms_notice). PayPal has no checkout yet, so it is never advertised. */
export function termsNotice(raw, env = process.env) {
  const legal = legalNotice(raw, env).legal;
  const company = configSectionFrom(raw, "company");
  const publicUrl = publicWebsite(env);
  const fallbackEmail = extractMailbox(systemSetting(raw, "smtp", "from", "SMTP_FROM", "", env));
  const hasStripe = isStripeEnabled(raw, env) && Boolean(stripeSecretKey(raw, env));
  const operator = {
    providerName: legal.providerName || "",
    representative: legal.representative || "",
    businessPurpose: legal.businessPurpose || "",
    website: legal.website || publicUrl,
  };
  const contact = {
    email: envValue(env, "TERMS_CONTACT_EMAIL") || envValue(env, "PRIVACY_CONTACT_EMAIL") || legal.email || fallbackEmail,
    website: envValue(env, "TERMS_SUPPORT_URL") || legal.website || publicUrl,
    effectiveDate: envValue(env, "TERMS_EFFECTIVE_DATE") || text(company.effectiveDate),
    governingLaw: envValue(env, "TERMS_GOVERNING_LAW") || text(company.governingLaw),
  };
  const missingCoreFields = [];
  if (!operator.providerName) missingCoreFields.push("providerName");
  if (!contact.email) missingCoreFields.push("contactEmail");
  if (!contact.website) missingCoreFields.push("website");
  return {
    operator,
    productName: legal.productName,
    contact,
    service: {
      discordBotEnabled: true,
      dashboardEnabled: true,
      stationPreviewEnabled: true,
      scheduledEventsEnabled: true,
      customStationsEnabled: true,
    },
    billing: {
      premiumCheckoutEnabled: hasStripe,
      paymentProvider: hasStripe ? "Stripe" : "",
      emailDeliveryEnabled: Boolean(text(systemSetting(raw, "smtp", "host", "SMTP_HOST", "", env))),
      trialEnabled: isProTrialEnabled(env),
    },
    customNote: envValue(env, "TERMS_CUSTOM_NOTE"),
    missingCoreFields,
    isConfigured: missingCoreFields.length === 0,
    basis: ["DISCORD_TERMS", "AUSTRIAN_SERVICE_TERMS", "STREAM_RIGHTS_NOTICE"],
    updatedAt: new Date().toISOString(),
  };
}

/** GET /api/premium/tiers: the owner's plans over the base tiers. */
export function premiumTiers(raw) {
  const plans = configSectionFrom(raw, "plans");
  const tiers = {};
  for (const key of ["free", "pro", "ultimate"]) {
    const base = { ...BASE_TIERS[key] };
    const plan = plans[key] || {};
    for (const field of ["name", "bitrate", "maxBots", "pricePerMonth"]) {
      if (field in plan) base[field] = plan[field];
    }
    tiers[key] = base;
  }
  return { tiers };
}

const formatCents = (cents) => (Math.trunc(Number(cents) || 0) / 100).toFixed(2).replace(".", ",");

/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (Math.abs(diff - 0.5) > 1e-9) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * GET /api/premium/pricing. Features only when the owner changed them, else []
 * so the website shows its own translated copy.
 */
export function premiumPricing(raw, { license = null, upgrade = null, trialEnabled = isProTrialEnabled() } = {}) {
  const plans = configSectionFrom(raw, "plans");
  const rawPlans = raw?.plans && typeof raw.plans === "object" ? raw.plans : {};
  const defaultPlans = DEFAULT_OWNER_CONFIG.plans || {};
  const priceOf = (tier, fallback) => {
    const plan = plans[tier] || {};
    return "pricePerMonth" in plan ? plan.pricePerMonth : fallback;
  };
  const scaled = (tier, mapping) => {
    const base = BASE_TIERS[tier]?.pricePerMonth || 0;
    const price = priceOf(tier, base) || 0;
    const ratio = base ? price / base : 1;
    return Object.fromEntries(Object.entries(mapping).map(([key, cents]) => [String(key), formatCents(roundHalfEven(cents * ratio))]));
  };
  const plan = (key) => {
    const current = plans[key] || {};
    const rawFeatures = rawPlans[key]?.features;
    const defaults = defaultPlans[key]?.features || [];
    const customized = Array.isArray(rawFeatures) && rawFeatures.length > 0 && JSON.stringify(rawFeatures) !== JSON.stringify(defaults);
    return {
      name: "name" in current ? current.name : key[0].toUpperCase() + key.slice(1),
      pricePerMonth: priceOf(key, BASE_TIERS[key]?.pricePerMonth || 0),
      features: customized ? rawFeatures : [],
    };
  };
  const paid = (key, fallback) => ({
    ...plan(key),
    startingAt: formatCents(priceOf(key, fallback)),
    durationPricing: scaled(key, DURATION_PRICING[key]),
    seatPricing: scaled(key, SEAT_MONTHLY_TOTAL_CENTS[key]),
  });
  const result = {
    brand: "OmniFM",
    tiers: { free: plan("free"), pro: paid("pro", 299), ultimate: paid("ultimate", 499) },
    durations: [...DURATION_OPTIONS],
    seatOptions: [...SEAT_OPTIONS],
    trial: { enabled: trialEnabled, tier: "pro", months: PRO_TRIAL_MONTHS, oneTimePerEmail: true },
  };
  if (license && !license.expired) {
    result.currentLicense = {
      tier: license.tier || license.plan || "free",
      seats: Math.max(1, parseIntLike(license.seats || 1, 1)),
      expiresAt: license.expiresAt ?? null,
      remainingDays: license.remainingDays ?? 0,
    };
    if ((license.tier || license.plan) === "pro" && upgrade) {
      result.upgrade = { to: "ultimate", seats: upgrade.seats, cost: upgrade.upgradeCost, daysLeft: upgrade.daysLeft };
    }
  }
  return result;
}

/** GET /api/marketing: named sponsors and the switched-on bot listings with a link. */
export function marketingResponse(raw) {
  const marketing = configSectionFrom(raw, "marketing");
  const safeUrl = (value) => {
    const url = text(value);
    return /^https?:\/\//i.test(url) ? url : "";
  };
  const sponsors = (Array.isArray(marketing.sponsors) ? marketing.sponsors : [])
    .filter((sponsor) => sponsor && typeof sponsor === "object" && text(sponsor.name))
    .map((sponsor) => ({ name: text(sponsor.name), logoUrl: safeUrl(sponsor.logoUrl), url: safeUrl(sponsor.url) }));
  const botListings = (Array.isArray(marketing.botListings) ? marketing.botListings : [])
    .filter((listing) => listing && typeof listing === "object" && listing.enabled && safeUrl(listing.url))
    .map((listing) => ({ name: text(listing.name), url: safeUrl(listing.url) }));
  return { sponsors, botListings };
}

const COVER_CACHE_MAX = 500;
const coverCache = new Map();

/** GET /api/cover: the first iTunes match for a song, cached like FastAPI (500 entries, then cleared). */
export async function coverLookup({ artist = "", title = "", term = "" } = {}, { fetchImpl = safeFetch } = {}) {
  const query = String(term || `${artist} ${title}`).trim().replace(/\s+/g, " ").slice(0, 120);
  if (!query) return { ok: false, error: "Kein Suchbegriff." };
  const cacheKey = query.toLowerCase();
  if (coverCache.has(cacheKey)) return coverCache.get(cacheKey);
  let result = { ok: false, query };
  try {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({ term: query, entity: "song", limit: "1" })}`;
    const response = await fetchImpl(url, { headers: { "User-Agent": "OmniFM/1.0" }, timeoutMs: 5000 });
    if (response.status < 400) {
      const item = (await response.json())?.results?.[0];
      if (item) {
        const art = String(item.artworkUrl100 || "");
        const artHi = art.replace("100x100bb", "600x600bb").replace("100x100", "600x600");
        result = {
          ok: true,
          query,
          artwork: artHi || null,
          artworkSmall: art || null,
          artist: item.artistName ?? null,
          title: item.trackName ?? null,
          collection: item.collectionName ?? null,
          genre: item.primaryGenreName ?? null,
          previewUrl: item.previewUrl ?? null,
        };
      }
    }
  } catch {
    result = { ok: false, query };
  }
  if (coverCache.size >= COVER_CACHE_MAX) coverCache.clear();
  coverCache.set(cacheKey, result);
  return result;
}

/**
 * The bots' health document for the public numbers. Without MongoDB (a single
 * process in development) the bots of this process stand in for it.
 */
export function healthDocFromRuntimes(runtimes = []) {
  const nodes = runtimes.map((runtime) => {
    const status = runtime.getPublicStatus?.() || {};
    return {
      botId: status.clientId || runtime.config?.clientId || null,
      index: Number(runtime.config?.index || status.index || 0) || 0,
      status: status.ready ? "online" : "offline",
      guilds: Number(status.servers || 0) || 0,
      users: Number(status.users || 0) || 0,
      voiceConnections: Number(status.connections || 0) || 0,
      listeners: Number(status.listeners || 0) || 0,
      userTag: status.userTag || null,
    };
  });
  const uptimeSec = Math.max(0, ...runtimes.map((runtime) => Number(runtime.getPublicStatus?.()?.uptimeSec || 0) || 0));
  return { nodes, process: { uptimeSec } };
}

/** GET /api/bots: the configured bots with their live numbers; premium bots keep their IDs private. */
export function publicBotsResponse(configuredBots, liveDoc) {
  const nodes = liveDoc?.nodes || [];
  const byIndex = new Map(nodes.map((node) => [parseIntLike(node.index, 0), node]));
  const byId = new Map(nodes.filter((node) => node.botId).map((node) => [String(node.botId), node]));
  const bots = configuredBots.map((bot) => {
    const item = { ...bot };
    const node = byId.get(String(item.clientId || "")) || byIndex.get(parseIntLike(item.index, 0));
    if (node) {
      Object.assign(item, {
        ready: node.status === "online",
        servers: parseIntLike(node.guilds, 0),
        users: parseIntLike(node.users, 0),
        connections: parseIntLike(node.voiceConnections, 0),
        listeners: parseIntLike(node.listeners, 0),
        userTag: node.userTag ?? null,
        uptimeSec: parseIntLike(liveDoc?.process?.uptimeSec, 0),
      });
    }
    if ((item.requiredTier || "free") !== "free") {
      item.clientId = null;
      item.inviteUrl = null;
    }
    return item;
  });
  const live = liveRuntimeTotals(liveDoc);
  return { bots, totals: { servers: live.servers, users: live.users, connections: live.voiceConnections, listeners: live.listeners } };
}

/** GET /api/stats: live numbers only from real telemetry (0 without a running bot). */
export function publicStatsResponse(configuredBots, liveDoc, catalog) {
  const live = liveRuntimeTotals(liveDoc);
  return {
    servers: live.servers,
    users: live.users,
    connections: live.voiceConnections,
    listeners: live.listeners,
    bots: live.botsOnline,
    botsConfigured: configuredBots.length,
    live: live.live,
    stations: catalog.total,
    freeStations: catalog.freeStations,
    proStations: catalog.proStations,
    ultimateStations: catalog.ultimateStations,
  };
}
