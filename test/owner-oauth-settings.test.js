import test from "node:test";
import assert from "node:assert/strict";

const oauth = await import("../src/lib/discord-oauth-settings.js");
const { secretInputValue, discordRedirectUriFor } = await import("../frontend/src/lib/ownerConfigSecrets.js");

const MASK = String.fromCharCode(0x2022).repeat(8);

test("a stored secret shows empty; whatever the owner types shows as typed", () => {
  // The bug: with clientSecretSet the field stayed empty for good, typing did nothing.
  const stored = { clientSecret: MASK, clientSecretSet: true };
  assert.equal(secretInputValue(stored, "clientSecret"), "");
  assert.equal(secretInputValue({ ...stored, clientSecret: "new-secret" }, "clientSecret"), "new-secret");
  assert.equal(secretInputValue({ ...stored, clientSecret: "" }, "clientSecret"), "");
  assert.equal(secretInputValue({}, "clientSecret"), "");
  assert.equal(secretInputValue({ password: 1234 }, "password"), "");
  assert.equal(discordRedirectUriFor("https://omnifm.xyz/"), "https://omnifm.xyz/api/auth/discord/callback");
});

test("the redirect URI is made from the website's address", () => {
  assert.equal(oauth.resolveDiscordRedirectUri({}), "https://omnifm.xyz/api/auth/discord/callback");
  assert.equal(oauth.resolveDiscordRedirectUri({ PUBLIC_WEB_URL: "https://staging.omnifm.xyz/some/path" }), "https://staging.omnifm.xyz/api/auth/discord/callback");
  assert.equal(oauth.resolveDiscordRedirectUri({ WEB_DOMAIN: "radio.example.org" }), "https://radio.example.org/api/auth/discord/callback");
  assert.equal(
    oauth.resolveDiscordRedirectUri({ PUBLIC_WEB_URL: "https://omnifm.xyz", DISCORD_REDIRECT_URI: "https://login.example.org/api/auth/discord/callback" }),
    "https://login.example.org/api/auth/discord/callback",
    "a public explicit setting wins"
  );
  assert.equal(oauth.publicWebsiteOrigin({ PUBLIC_WEB_URL: "not a url", WEB_DOMAIN: "https://club.example/" }), "https://club.example");
});

test("leftovers of the installation never reach Discord (live, 2026-09-25)", () => {
  // localhost from .env.example, the LAN address from start.sh; the working
  // address was only in the owner console.
  const env = {
    DISCORD_REDIRECT_URI: "http://localhost:8081/api/auth/discord/callback",
    PUBLIC_WEB_URL: "http://192.168.2.253:8001",
  };
  assert.equal(
    oauth.resolveDiscordRedirectUri(env, { stored: "https://omnifm.xyz/api/auth/discord/callback" }),
    "https://omnifm.xyz/api/auth/discord/callback"
  );
  assert.equal(oauth.resolveDiscordRedirectUri({ ...env, WEB_DOMAIN: "omnifm.xyz" }, { stored: "" }), "https://omnifm.xyz/api/auth/discord/callback");
  // Development without any public address keeps its local setting.
  assert.equal(
    oauth.resolveDiscordRedirectUri({ DISCORD_REDIRECT_URI: "http://localhost:8081/api/auth/discord/callback", PUBLIC_WEB_URL: "http://localhost:8081" }, { stored: "" }),
    "http://localhost:8081/api/auth/discord/callback"
  );
});

test("links leaving the server use the public address, not the LAN one", async () => {
  const { isPublicOrigin, preferPublicWebsiteUrl } = await import("../src/lib/public-origin.js");
  for (const local of ["http://localhost:8081", "http://127.0.0.1", "http://192.168.2.253:8001", "http://10.1.2.3", "http://172.20.0.2:8001", "http://omnifm.local", "http://[::1]:8001"]) {
    assert.equal(isPublicOrigin(local), false, local);
  }
  for (const reachable of ["https://omnifm.xyz", "https://radio.example.org:8443", "http://203.0.113.9"]) {
    assert.equal(isPublicOrigin(reachable), true, reachable);
  }
  const env = { PUBLIC_WEB_URL: "http://192.168.2.253:8001" };
  assert.deepEqual(preferPublicWebsiteUrl(env, { storedRedirectUri: "https://omnifm.xyz/api/auth/discord/callback" }), { from: "http://192.168.2.253:8001", to: "https://omnifm.xyz" });
  assert.equal(env.PUBLIC_WEB_URL, "https://omnifm.xyz");
  assert.equal(preferPublicWebsiteUrl(env, { storedRedirectUri: "https://other.example/cb" }), null, "a public PUBLIC_WEB_URL stays");
  const lanOnly = { PUBLIC_WEB_URL: "http://192.168.2.253:8001" };
  assert.equal(preferPublicWebsiteUrl(lanOnly), null, "without a public address nothing changes");
  assert.equal(lanOnly.PUBLIC_WEB_URL, "http://192.168.2.253:8001");
});

function fakeDb(doc) {
  return { collection: () => ({ findOne: async () => doc }) };
}

test("client ID, secret and scopes come live from the owner console", async () => {
  const env = { DISCORD_CLIENT_ID: "old-id", DISCORD_CLIENT_SECRET: "old-secret", DISCORD_OAUTH_SCOPES: "identify guilds" };
  assert.equal(await oauth.syncDiscordOauthFromOwnerConfig(env, {
    db: fakeDb({ system: { discordOAuth: { clientId: " new-id ", clientSecret: "new-secret", scopes: "", redirectUri: "https://old.example/cb" } } }),
  }), true);
  assert.equal(env.DISCORD_CLIENT_ID, "new-id");
  assert.equal(env.DISCORD_CLIENT_SECRET, "new-secret");
  assert.equal(env.DISCORD_OAUTH_SCOPES, "identify guilds", "an empty value changes nothing");
  assert.equal("DISCORD_REDIRECT_URI" in env, false, "the stored redirect URI is not used any more");

  await oauth.syncDiscordOauthFromOwnerConfig(env, { db: fakeDb(null) });
  assert.equal(env.DISCORD_CLIENT_SECRET, "new-secret", "no owner document: everything stays");
  assert.equal(await oauth.syncDiscordOauthFromOwnerConfig(env), false, "without MongoDB nothing happens");
});
