import test from "node:test";
import assert from "node:assert/strict";

const pub = await import("../src/lib/owner-public.js");
const { DEFAULT_OWNER_CONFIG } = await import("../src/lib/owner-config.js");

const plansWith = (changes) => {
  const plans = JSON.parse(JSON.stringify(DEFAULT_OWNER_CONFIG.plans));
  for (const [tier, fields] of Object.entries(changes)) Object.assign(plans[tier], fields);
  return { plans };
};

test("the imprint reads the company section first, then LEGAL_*; the tax note follows the switch", () => {
  const raw = { company: { providerName: "Radio GmbH", streetAddress: "Gasse 1", postalCode: "1010", city: "Wien", email: "hi@radio.at" } };
  const notice = pub.legalNotice(raw, { LEGAL_PROVIDER_NAME: "Env Name", LEGAL_PHONE: "+43 1" });
  assert.equal(notice.legal.providerName, "Radio GmbH");
  assert.equal(notice.legal.phone, "+43 1", "the environment fills what the owner left empty");
  assert.equal(notice.legal.country, "Österreich");
  assert.equal(notice.isConfigured, true);
  assert.match(notice.legal.taxNote, /Kleinunternehmer/);

  const off = pub.legalNotice({ company: { ...raw.company, kleinunternehmer: false } }, {});
  assert.deepEqual([off.legal.kleinunternehmer, off.legal.taxNote], [false, ""]);
  assert.deepEqual(pub.legalNotice({}, {}).missingCoreFields, ["providerName", "streetAddress", "postalCode", "city", "email"]);
});

test("the website fallback is never a LAN or example address", () => {
  assert.equal(pub.legalNotice({}, { PUBLIC_WEB_URL: "http://192.168.1.20:8001" }).legal.website, "");
  assert.equal(pub.legalNotice({}, { PUBLIC_WEB_URL: "http://192.168.1.20:8001", WEB_DOMAIN: "omnifm.xyz" }).legal.website, "https://omnifm.xyz");
  assert.equal(pub.legalNotice({}, { LEGAL_EMAIL: "owner@example.com" }).legal.email, "");
});

test("privacy and terms take the owner's company and integration settings", () => {
  const raw = {
    company: { providerName: "Radio GmbH", email: "hi@radio.at", website: "https://radio.at", dpoName: "Data Person", governingLaw: "AT" },
    payments: { stripe: { enabled: true, secretKey: "sk_live_x" } },
    system: { botDirectories: { topGG: { enabled: true, token: "t" }, discordBotList: { enabled: true, token: "t", botId: "abc" } } },
  };
  const privacy = pub.privacyNotice(raw, {});
  assert.equal(privacy.dpo.name, "Data Person");
  assert.equal(privacy.features.stripeEnabled, true);
  assert.equal(privacy.features.topGGEnabled, true);
  assert.equal(privacy.features.discordBotListEnabled, false, "needs a real bot ID");
  const terms = pub.termsNotice(raw, {});
  assert.deepEqual([terms.billing.paymentProvider, terms.contact.governingLaw, terms.isConfigured], ["Stripe", "AT", true]);
});

test("prices follow the owner's plans; features only when the owner changed them", () => {
  const defaults = pub.premiumPricing(plansWith({}), { trialEnabled: true });
  assert.deepEqual(defaults.tiers.pro.features, []);
  assert.equal(defaults.tiers.pro.startingAt, "2,99");
  assert.equal(defaults.tiers.pro.durationPricing["12"], "1,99");

  const changed = pub.premiumPricing(plansWith({ pro: { pricePerMonth: 349, features: ["Mine"] } }));
  assert.equal(changed.tiers.pro.pricePerMonth, 349);
  assert.equal(changed.tiers.pro.startingAt, "3,49");
  assert.equal(changed.tiers.pro.durationPricing["1"], "3,49");
  assert.deepEqual(changed.tiers.pro.features, ["Mine"]);
  assert.deepEqual(changed.tiers.ultimate.features, []);

  const tiers = pub.premiumTiers(plansWith({ pro: { pricePerMonth: 399, maxBots: 9 } })).tiers;
  assert.deepEqual([tiers.pro.pricePerMonth, tiers.pro.maxBots, tiers.pro.reconnectMs], [399, 9, 1500]);

  const withLicense = pub.premiumPricing({}, { license: { tier: "pro", seats: 2, expiresAt: "x", remainingDays: 5 }, upgrade: { seats: 2, upgradeCost: 100, daysLeft: 5 } });
  assert.deepEqual(withLicense.currentLicense, { tier: "pro", seats: 2, expiresAt: "x", remainingDays: 5 });
  assert.deepEqual(withLicense.upgrade, { to: "ultimate", seats: 2, cost: 100, daysLeft: 5 });
});

test("marketing lists only named sponsors and switched-on listings with a web link", () => {
  const raw = { marketing: {
    sponsors: [{ name: "A", url: "https://a.example", logoUrl: "javascript:alert(1)" }, { name: " ", url: "https://b.example" }],
    botListings: [{ name: "top.gg", url: "https://top.gg/bot/1", enabled: true }, { name: "off", url: "https://x", enabled: false }, { name: "no link", url: "", enabled: true }],
  } };
  assert.deepEqual(pub.marketingResponse(raw), {
    sponsors: [{ name: "A", logoUrl: "", url: "https://a.example" }],
    botListings: [{ name: "top.gg", url: "https://top.gg/bot/1" }],
  });
});

test("the live numbers: configured bots with their node, premium bots keep their IDs private", () => {
  const configured = [
    { index: 1, clientId: "111", inviteUrl: "https://invite/1", requiredTier: "free", servers: 0 },
    { index: 2, clientId: "222", inviteUrl: null, requiredTier: "pro", servers: 0 },
  ];
  const liveDoc = { process: { uptimeSec: 60 }, nodes: [
    { botId: "111", index: 1, status: "online", guilds: 7, voiceConnections: 3, users: 50, listeners: 4, userTag: "Omni#1" },
    { botId: "222", index: 2, status: "offline", guilds: 99 },
  ] };
  const bots = pub.publicBotsResponse(configured, liveDoc);
  assert.deepEqual([bots.bots[0].ready, bots.bots[0].servers, bots.bots[0].uptimeSec], [true, 7, 60]);
  assert.deepEqual([bots.bots[1].clientId, bots.bots[1].inviteUrl], [null, null]);
  assert.deepEqual(bots.totals, { servers: 7, users: 50, connections: 3, listeners: 4 });

  const catalog = { total: 120, freeStations: 20, proStations: 100, ultimateStations: 0 };
  const stats = pub.publicStatsResponse(configured, null, catalog);
  assert.deepEqual([stats.live, stats.bots, stats.servers, stats.botsConfigured, stats.stations], [false, 0, 0, 2, 120]);
});

test("the cover lookup asks iTunes once per song and keeps the answer", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    assert.match(url, /^https:\/\/itunes\.apple\.com\/search\?term=Artist\+Song/);
    return { status: 200, json: async () => ({ results: [{ artworkUrl100: "https://img/100x100bb.jpg", artistName: "Artist", trackName: "Song" }] }) };
  };
  const first = await pub.coverLookup({ artist: "Artist", title: "Song" }, { fetchImpl });
  const again = await pub.coverLookup({ term: "  artist   song " }, { fetchImpl });
  assert.equal(first.artwork, "https://img/600x600bb.jpg");
  assert.equal(again.title, "Song");
  assert.equal(calls, 1);
  assert.deepEqual(await pub.coverLookup({}, { fetchImpl }), { ok: false, error: "Kein Suchbegriff." });
});
