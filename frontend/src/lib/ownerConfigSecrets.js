// Secret fields of the owner console (OAuth secret, SMTP password, API keys,
// webhook URL). A stored secret comes back from the server as "••••••••"
// with a `<key>Set` flag; the field then shows empty with the hint "already
// set". Whatever the owner types is shown as typed: before, a stored secret
// kept the field empty for good, so nothing could be entered.

const MASK_CHAR = String.fromCharCode(0x2022);

/** The value to show in the input: what was typed, never the mask. */
export function secretInputValue(group, key) {
  const value = group?.[key];
  return typeof value === 'string' && !value.startsWith(MASK_CHAR) ? value : '';
}

/** The Discord redirect URI of this website: shown to copy, not edited. */
export function discordRedirectUriFor(origin) {
  return `${String(origin || '').replace(/\/+$/, '')}/api/auth/discord/callback`;
}
