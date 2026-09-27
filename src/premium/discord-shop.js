// ============================================================
// OmniFM: Premium bought in Discord (#320)
// ============================================================
// Discord sells OmniFM Premium as guild subscriptions (one per server,
// monthly). Each purchase is an entitlement; the commander turns it into the
// server's license in the same store the workers and the dashboard read:
//   license "discord-<entitlement id>", plan by SKU, seats 1, expires when
//   the entitlement ends, activatedBy "discord".
// Discord announces purchase, renewal (new end date), cancellation (end date
// stays, then it runs out) and refunds (entitlement deleted). Every start and
// every 6 hours the commander also compares all entitlements with the store,
// so nothing is lost while it was offline.
// A server that had a license before (an owner grant, an old Stripe
// purchase) gets it back when the Discord subscription ends, as long as it is
// still valid. The shop is switched on in the owner console once Discord lets
// the app sell (verified app, from 75 servers).
import { getDefaultLanguage } from "../i18n.js";
import { log } from "../lib/logging.js";
import { ownerSettings } from "../lib/owner-settings-cache.js";
import { discordShopSettings as readShopSettings, snowflake, tierForSku as tierOfSku } from "../lib/discord-shop-settings.js";
import { isExpired, linkServerToLicense, unlinkServerFromLicense } from "./licenses.js";
import { load, save } from "../premium-store.js";

export const DISCORD_LICENSE_PREFIX = "discord-";
const RECONCILE_EVERY_MS = 6 * 60 * 60 * 1000;

/** The shop settings of the owner console, from the settings the commander keeps. */
export function discordShopSettings(settings = ownerSettings()) {
  return readShopSettings(settings);
}

export function tierForSku(skuId, shop = discordShopSettings()) {
  return tierOfSku(skuId, shop);
}

/** The fields OmniFM needs, from a discord.js Entitlement or a plain object (tests, the fetch). */
export function entitlementFields(entitlement) {
  const time = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const ms = typeof value === "number" ? value : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  return {
    id: snowflake(entitlement?.id),
    skuId: snowflake(entitlement?.skuId ?? entitlement?.sku_id),
    guildId: snowflake(entitlement?.guildId ?? entitlement?.guild_id),
    userId: snowflake(entitlement?.userId ?? entitlement?.user_id),
    startsAt: time(entitlement?.startsTimestamp ?? entitlement?.starts_at),
    endsAt: time(entitlement?.endsTimestamp ?? entitlement?.ends_at),
    deleted: entitlement?.deleted === true,
  };
}

function isRunning(fields, now) {
  if (fields.deleted) return false;
  if (fields.startsAt && fields.startsAt > now) return false;
  return !fields.endsAt || fields.endsAt > now;
}

/**
 * One entitlement, as Discord reported it, applied to the server's license.
 * Returns what happened: "linked", "updated", "ended", or why nothing did.
 */
export function applyDiscordEntitlement(entitlement, { shop = discordShopSettings(), now = Date.now(), deleted = false } = {}) {
  const fields = entitlementFields(entitlement);
  if (deleted) fields.deleted = true;
  const tier = tierForSku(fields.skuId, shop);
  if (!fields.id || !tier) return { changed: false, reason: "not-an-omnifm-sku" };
  if (!fields.guildId) return { changed: false, reason: "not-a-server-subscription" };

  const licenseId = `${DISCORD_LICENSE_PREFIX}${fields.id}`;
  const running = isRunning(fields, now);
  const data = load();
  const existing = data.licenses[licenseId];
  if (!existing && !running) return { changed: false, reason: "never-active" };

  const nowIso = new Date(now).toISOString();
  const expiresAt = running
    ? (fields.endsAt ? new Date(fields.endsAt).toISOString() : null)
    : nowIso;
  const current = data.serverEntitlements[fields.guildId];
  const previousLicenseId = existing?.previousLicenseId
    ?? (current?.licenseId && current.licenseId !== licenseId ? current.licenseId : null);
  data.licenses[licenseId] = {
    ...(existing || {
      id: licenseId,
      seats: 1,
      billingPeriod: "monthly",
      linkedServerIds: [],
      createdAt: nowIso,
      durationMonths: 1,
      activatedBy: "discord",
      contactEmail: "",
      preferredLanguage: getDefaultLanguage(),
    }),
    plan: tier,
    active: running,
    updatedAt: nowIso,
    expiresAt,
    note: `Discord-Abo (${tier === "ultimate" ? "Ultimate" : "Pro"})`,
    discord: { entitlementId: fields.id, skuId: fields.skuId, guildId: fields.guildId, userId: fields.userId || null },
    previousLicenseId,
  };
  save(data);

  if (running) {
    const linked = linkServerToLicense(fields.guildId, licenseId);
    if (!linked.ok) log("WARN", `[discord-shop] Server ${fields.guildId} nicht mit ${licenseId} verknüpft: ${linked.message}`);
    return { changed: true, state: existing ? "updated" : "linked", licenseId, tier };
  }

  // Ended: the server gets its license from before, if it is still valid.
  unlinkServerFromLicense(fields.guildId, licenseId);
  const previous = previousLicenseId ? load().licenses[previousLicenseId] : null;
  if (previous && previous.active !== false && !isExpired(previous)) linkServerToLicense(fields.guildId, previousLicenseId);
  return { changed: true, state: "ended", licenseId, tier };
}

/** Every Discord license the store still counts as running, by entitlement id. */
function runningDiscordLicenses(now) {
  const data = load();
  return Object.values(data.licenses)
    .filter((license) => String(license?.id || "").startsWith(DISCORD_LICENSE_PREFIX) && license.active !== false && !isExpired(license, now))
    .map((license) => license.discord)
    .filter((discord) => discord?.entitlementId);
}

/**
 * The store against Discord: every running entitlement applied, every Discord
 * license without one ended. `fetchEntitlements()` returns plain or discord.js
 * entitlements that have not ended.
 */
export async function reconcileDiscordEntitlements(fetchEntitlements, { shop = discordShopSettings(), now = Date.now() } = {}) {
  if (!shop.enabled) return { skipped: true };
  const entitlements = await fetchEntitlements();
  const seen = new Set();
  let applied = 0;
  for (const entitlement of entitlements) {
    const result = applyDiscordEntitlement(entitlement, { shop, now });
    if (result.licenseId) seen.add(result.licenseId.slice(DISCORD_LICENSE_PREFIX.length));
    if (result.changed) applied += 1;
  }
  let ended = 0;
  for (const discord of runningDiscordLicenses(now)) {
    if (seen.has(discord.entitlementId)) continue;
    const result = applyDiscordEntitlement({ id: discord.entitlementId, skuId: discord.skuId, guildId: discord.guildId }, { shop, now, deleted: true });
    if (result.state === "ended") ended += 1;
  }
  return { applied, ended };
}

/** All entitlements of the app that have not ended, page by page (100 each). */
export async function fetchAllEntitlements(application) {
  const all = [];
  let after;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- one page after the other
    const page = await application.entitlements.fetch({ excludeEnded: true, limit: 100, after, cache: false });
    const list = [...page.values()];
    all.push(...list);
    if (list.length < 100) return all;
    after = list.map((entry) => entry.id).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).at(-1);
  }
}

let timer = null;

/** The commander: Discord's events, and a comparison at start and every 6 hours. */
export function startDiscordShopSync(runtime) {
  const client = runtime?.client;
  if (!client || timer) return;
  const handle = (deleted) => (entitlement) => {
    const shop = discordShopSettings();
    if (!shop.enabled) return;
    try {
      const result = applyDiscordEntitlement(entitlement, { shop, deleted });
      if (result.changed) log("INFO", `[discord-shop] Server ${entitlement?.guildId}: ${result.state} (${result.tier})`);
    } catch (err) {
      log("ERROR", `[discord-shop] Entitlement ${entitlement?.id} nicht übernommen: ${err?.message || err}`);
    }
  };
  client.on("entitlementCreate", handle(false));
  client.on("entitlementUpdate", (_old, entitlement) => handle(false)(entitlement));
  client.on("entitlementDelete", handle(true));
  const run = () => reconcileDiscordEntitlements(() => fetchAllEntitlements(client.application))
    .then((result) => {
      if (!result.skipped && (result.applied || result.ended)) log("INFO", `[discord-shop] Abgleich: ${result.applied} übernommen, ${result.ended} beendet.`);
    })
    .catch((err) => log("WARN", `[discord-shop] Abgleich mit Discord fehlgeschlagen: ${err?.message || err}`));
  run();
  timer = setInterval(run, RECONCILE_EVERY_MS);
  timer.unref?.();
}

export function stopDiscordShopSync() {
  if (timer) clearInterval(timer);
  timer = null;
}
