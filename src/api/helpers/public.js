// OmniFM API: the binary health probe and the public legal pages.
// Split out of src/api/server.js (#293).
import { spawnSync } from "node:child_process";
import { legalNotice, privacyNotice, termsNotice } from "../../lib/owner-public.js";
import { loadOwnerConfigRaw } from "../../lib/owner-config.js";

let binaryHealthCache = null;

export function getHealthBinaryProbe() {
  const cacheAgeMs = 30_000;
  if (binaryHealthCache && (Date.now() - binaryHealthCache.checkedAt) < cacheAgeMs) {
    return binaryHealthCache;
  }

  const probe = (command, variants = [["-version"], ["--version"]]) => {
    for (const args of variants) {
      try {
        const result = spawnSync(command, args, {
          encoding: "utf8",
          timeout: 2_000,
          windowsHide: true,
        });
        if (result.error) continue;
        const firstLine = String(result.stdout || result.stderr || "").split(/\r?\n/).find(Boolean) || "";
        return {
          available: result.status === 0,
          version: firstLine.trim() || null,
          status: result.status,
        };
      } catch {}
    }
    return {
      available: false,
      version: null,
      status: null,
    };
  };

  binaryHealthCache = {
    checkedAt: Date.now(),
    ffmpeg: probe("ffmpeg"),
    fpcalc: probe("fpcalc"),
  };
  return binaryHealthCache;
}

// The legal texts read the company section of the owner console (#288),
// like FastAPI; LEGAL_* and PRIVACY_* stay as fallbacks.
export async function buildPublicLegalNotice() {
  return legalNotice(await loadOwnerConfigRaw());
}

export async function buildPublicPrivacyNotice() {
  return privacyNotice(await loadOwnerConfigRaw());
}

export async function buildPublicTermsNotice() {
  return termsNotice(await loadOwnerConfigRaw());
}
