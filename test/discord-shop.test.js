import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #320: Premium bought in Discord becomes the server's license. Purchase,
// renewal, cancellation, refund and expiry change it; a license the server
// had before comes back when the subscription ends.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-discord-shop-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 }));

const shopModule = await import("../src/premium/discord-shop.js");
const { applyDiscordEntitlement, reconcileDiscordEntitlements, discordShopSettings, tierForSku } = shopModule;
const { getServerLicense, createLicense, linkServerToLicense } = await import("../src/premium-store.js");
const { premiumPricing } = await import("../src/lib/owner-public.js");

let nextId = 100000000000000000n;
const id = () => String(nextId++);
const PRO_SKU = id();
const ULTIMATE_SKU = id();
const SHOP = discordShopSettings({ discordShop: { enabled: true, skus: { pro: PRO_SKU, ultimate: ULTIMATE_SKU } } });
const DAY = 24 * 60 * 60 * 1000;

test("the shop settings take only real SKU IDs and know which plan a SKU sells", () => {
  const shop = discordShopSettings({ discordShop: { enabled: true, skus: { pro: "abc", ultimate: ULTIMATE_SKU } } });
  assert.deepEqual(shop, { enabled: true, skus: { pro: "", ultimate: ULTIMATE_SKU } });
  assert.equal(discordShopSettings({}).enabled, false, "off without settings");
  assert.equal(tierForSku(PRO_SKU, SHOP), "pro");
  assert.equal(tierForSku(ULTIMATE_SKU, SHOP), "ultimate");
  assert.equal(tierForSku(id(), SHOP), null);
});

test("purchase, renewal, cancellation and expiry change the server's license", () => {
  const guildId = id();
  const now = Date.now();
  const entitlement = { id: id(), skuId: PRO_SKU, guildId, userId: id(), startsTimestamp: now - 1000, endsTimestamp: now + 30 * DAY };

  // Bought in Discord: Pro for this server, until the end of the period.
  assert.deepEqual(applyDiscordEntitlement(entitlement, { shop: SHOP, now }).state, "linked");
  let license = getServerLicense(guildId);
  assert.equal(license.plan, "pro");
  assert.equal(license.active, true);
  assert.equal(license.activatedBy, "discord");
  assert.equal(new Date(license.expiresAt).getTime(), entitlement.endsTimestamp);

  // Renewed: Discord moves the end of the period.
  const renewed = { ...entitlement, endsTimestamp: now + 60 * DAY };
  assert.equal(applyDiscordEntitlement(renewed, { shop: SHOP, now }).state, "updated");
  assert.equal(new Date(getServerLicense(guildId).expiresAt).getTime(), renewed.endsTimestamp);

  // Cancelled: the period runs out, the license stays until then.
  assert.equal(getServerLicense(guildId).active, true);

  // After the end the comparison with Discord ends it.
  assert.equal(applyDiscordEntitlement(renewed, { shop: SHOP, now: renewed.endsTimestamp + 1000 }).state, "ended");
  license = getServerLicense(guildId);
  assert.equal(license === null || license.active === false || license.expired === true, true, "no Premium any more");
});

test("a refund ends it at once, and the license from before comes back", () => {
  const guildId = id();
  const now = Date.now();
  const earlier = createLicense({ plan: "pro", seats: 1, months: 3, activatedBy: "stripe", note: "old purchase" });
  assert.equal(linkServerToLicense(guildId, earlier.id).ok, true);

  const entitlement = { id: id(), skuId: ULTIMATE_SKU, guildId, startsTimestamp: now - 1000, endsTimestamp: now + 30 * DAY };
  applyDiscordEntitlement(entitlement, { shop: SHOP, now });
  assert.equal(getServerLicense(guildId).plan, "ultimate", "the Discord subscription wins while it runs");

  assert.equal(applyDiscordEntitlement(entitlement, { shop: SHOP, now, deleted: true }).state, "ended");
  const back = getServerLicense(guildId);
  assert.equal(back.id, earlier.id, "the old purchase runs on until its end");
  assert.equal(back.plan, "pro");
});

test("other SKUs, user subscriptions and entitlements that never ran change nothing", () => {
  const now = Date.now();
  assert.equal(applyDiscordEntitlement({ id: id(), skuId: id(), guildId: id() }, { shop: SHOP, now }).reason, "not-an-omnifm-sku");
  assert.equal(applyDiscordEntitlement({ id: id(), skuId: PRO_SKU, userId: id() }, { shop: SHOP, now }).reason, "not-a-server-subscription");
  assert.equal(applyDiscordEntitlement({ id: id(), skuId: PRO_SKU, guildId: id(), endsTimestamp: now - DAY }, { shop: SHOP, now }).reason, "never-active");
});

test("the comparison with Discord adds what is missing and ends what Discord no longer has", async () => {
  const now = Date.now();
  const keptGuild = id();
  const goneGuild = id();
  const kept = { id: id(), skuId: PRO_SKU, guildId: keptGuild, endsTimestamp: now + 10 * DAY };
  const gone = { id: id(), skuId: PRO_SKU, guildId: goneGuild, endsTimestamp: now + 10 * DAY };
  applyDiscordEntitlement(gone, { shop: SHOP, now });
  assert.equal(getServerLicense(goneGuild).active, true);

  const result = await reconcileDiscordEntitlements(async () => [kept], { shop: SHOP, now });
  assert.equal(result.applied >= 1, true);
  assert.equal(result.ended >= 1, true);
  assert.equal(getServerLicense(keptGuild).plan, "pro", "bought while the commander was offline");
  const ended = getServerLicense(goneGuild);
  assert.equal(ended === null || ended.active === false || ended.expired === true, true);

  assert.deepEqual(await reconcileDiscordEntitlements(async () => [], { shop: { ...SHOP, enabled: false }, now }), { skipped: true }, "off: nothing is touched");
});

test("the website links to the app's store page only when the shop is on", () => {
  const raw = { discordShop: { enabled: true, skus: { pro: PRO_SKU, ultimate: "" } }, discord: { commander: { clientId: "123456789012345670" } } };
  assert.deepEqual(premiumPricing(raw, { env: {} }).discordShop, { enabled: true, storeUrl: "https://discord.com/application-directory/123456789012345670/store" });
  assert.deepEqual(premiumPricing({ ...raw, discordShop: { enabled: false, skus: raw.discordShop.skus } }, { env: {} }).discordShop, { enabled: false });
  assert.deepEqual(premiumPricing({ discordShop: raw.discordShop }, { env: { BOT_1_CLIENT_ID: "123456789012345671" } }).discordShop.storeUrl, "https://discord.com/application-directory/123456789012345671/store", "the commander from the environment");
});
