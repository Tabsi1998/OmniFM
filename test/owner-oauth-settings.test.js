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
    oauth.resolveDiscordRedirectUri({ PUBLIC_WEB_URL: "https://omnifm.xyz", DISCORD_REDIRECT_URI: "http://localhost:8081/api/auth/discord/callback" }),
    "http://localhost:8081/api/auth/discord/callback",
    "an explicit setting in the environment still wins (local development)"
  );
  assert.equal(oauth.publicWebsiteOrigin({ PUBLIC_WEB_URL: "not a url", WEB_DOMAIN: "https://club.example/" }), "https://club.example");
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
