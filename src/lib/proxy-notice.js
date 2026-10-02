// ============================================================
// OmniFM: a reverse proxy the API does not trust (#484)
// ============================================================
// Behind a proxy every request comes from the proxy's address. Unless
// backend/.env names it (TRUST_PROXY_HEADERS=1, TRUSTED_PROXY_IPS=<its
// address>), the API cannot see the visitor and all visitors share one
// request budget: a busy minute empties the website for everyone. The API
// notes such a proxy once in the log and in MongoDB, where the owner
// cockpit (in the commander process) finds it.
import ipaddr from "ipaddr.js";
import { getDb, isConnected } from "./db.js";
import { log } from "./logging.js";

export const PROXY_NOTICE_COLLECTION = "runtime_notices";
export const PROXY_NOTICE_ID = "untrusted-proxy";
// How long the cockpit counts a sighting; while the proxy stays untrusted,
// every visit writes again at most this often.
export const PROXY_NOTICE_FRESH_MS = 2 * 60 * 60 * 1000;
const WRITE_EVERY_MS = 10 * 60 * 1000;

const logged = new Set();
let lastWrite = 0;

/** Loopback, a private network, link-local, unique local or carrier-grade NAT: a proxy, not a visitor. */
export function isInternalAddress(address) {
  try {
    return ["loopback", "private", "linkLocal", "uniqueLocal", "carrierGradeNat"].includes(ipaddr.process(String(address || "")).range());
  } catch {
    return false;
  }
}

/** The lines that make the API trust this proxy. */
export function trustLinesFor(address) {
  const loopback = ["127.0.0.1", "::1"].includes(address);
  return `TRUST_PROXY_HEADERS=1\nTRUSTED_PROXY_IPS=${loopback ? "127.0.0.1,::1" : address}`;
}

/**
 * A request came with X-Forwarded-For from an address the API does not
 * trust. Only an internal address counts: from the internet the header may
 * be made up. Returns whether it was noted.
 */
export function noteUntrustedProxy(address, { now = Date.now(), db = isConnected() ? getDb() : null } = {}) {
  if (!address || !isInternalAddress(address)) return false;
  if (!logged.has(address)) {
    logged.add(address);
    log("WARN", `Anfragen kommen über einen Proxy (${address}), dem die API nicht vertraut: alle Besucher teilen sich ein Anfrage-Limit. `
      + `In backend/.env eintragen: ${trustLinesFor(address).replace("\n", " und ")}, dann ./update.sh.`);
  }
  if (db && now - lastWrite >= WRITE_EVERY_MS) {
    lastWrite = now;
    void db.collection(PROXY_NOTICE_COLLECTION)
      .updateOne({ _id: PROXY_NOTICE_ID }, { $set: { address, lastSeenAt: new Date(now) } }, { upsert: true })
      .catch(() => {});
  }
  return true;
}

/** For the tests: forget what was logged and written. */
export function resetProxyNotice() {
  logged.clear();
  lastWrite = 0;
}
