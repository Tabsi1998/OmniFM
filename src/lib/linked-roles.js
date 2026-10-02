// ============================================================
// OmniFM: linked roles in Discord (#302), the pure part
// ============================================================
// A person connects OmniFM once (Server settings -> Roles -> Links, or the
// connection in their profile). Discord then knows two numbers about them,
// and every server sets its own conditions for its roles:
//   listening_hours   hours listened with OmniFM; counted only after the
//                     person switched it on in /mydata
//   premium_customer  owns a server with OmniFM Pro or Ultimate
// Discord keeps the values; OmniFM sends them when the person connects and
// once a day after that.

export const LINKED_ROLES_SCOPES = "role_connections.write identify";
export const LINKED_ROLES_PATH = "/api/auth/linked-roles";
export const LINKED_ROLES_CALLBACK_PATH = "/api/auth/linked-roles/callback";
export const PLATFORM_NAME = "OmniFM";
const HOUR_MS = 3_600_000;

// Discord's metadata types: 2 = integer greater than or equal, 7 = boolean equal.
/** The records Discord shows server admins when they add a condition to a role. */
export const ROLE_CONNECTION_METADATA = Object.freeze([
  Object.freeze({
    key: "listening_hours",
    type: 2,
    name: "Listening hours",
    name_localizations: {
      de: "Hörstunden",
      fr: "Heures d’écoute",
      "es-ES": "Horas de escucha",
      "es-419": "Horas de escucha",
      it: "Ore di ascolto",
      pl: "Godziny słuchania",
      tr: "Dinleme saati",
      "pt-BR": "Horas ouvidas",
      nl: "Luisteruren",
    },
    description: "Hours listened with OmniFM (counted once switched on in /mydata)",
    description_localizations: {
      de: "Mit OmniFM gehörte Stunden (gezählt, sobald in /meine-daten eingeschaltet)",
      fr: "Heures écoutées avec OmniFM (comptées une fois activé dans /mydata)",
      "es-ES": "Horas escuchadas con OmniFM (se cuentan al activarlo en /mydata)",
      "es-419": "Horas escuchadas con OmniFM (se cuentan al activarlo en /mydata)",
      it: "Ore ascoltate con OmniFM (contate dopo l’attivazione in /mydata)",
      pl: "Godziny słuchania z OmniFM (liczone po włączeniu w /mydata)",
      tr: "OmniFM ile dinlenen saatler (/mydata içinde açılınca sayılır)",
      "pt-BR": "Horas ouvidas com o OmniFM (contadas depois de ativar em /mydata)",
      nl: "Met OmniFM geluisterde uren (geteld zodra aangezet in /mydata)",
    },
  }),
  Object.freeze({
    key: "premium_customer",
    type: 7,
    name: "Premium customer",
    name_localizations: {
      de: "Premium-Kunde",
      fr: "Client Premium",
      "es-ES": "Cliente Premium",
      "es-419": "Cliente Premium",
      it: "Cliente Premium",
      pl: "Klient Premium",
      tr: "Premium müşterisi",
      "pt-BR": "Cliente Premium",
      nl: "Premium-klant",
    },
    description: "Owns a server with OmniFM Pro or Ultimate",
    description_localizations: {
      de: "Besitzt einen Server mit OmniFM Pro oder Ultimate",
      fr: "Possède un serveur avec OmniFM Pro ou Ultimate",
      "es-ES": "Es dueño de un servidor con OmniFM Pro o Ultimate",
      "es-419": "Es dueño de un servidor con OmniFM Pro o Ultimate",
      it: "Possiede un server con OmniFM Pro o Ultimate",
      pl: "Ma serwer z OmniFM Pro lub Ultimate",
      tr: "OmniFM Pro veya Ultimate olan bir sunucunun sahibi",
      "pt-BR": "É dono de um servidor com OmniFM Pro ou Ultimate",
      nl: "Bezit een server met OmniFM Pro of Ultimate",
    },
  }),
]);

/** Whole hours, never negative. */
export function listeningHours(listenedMs) {
  return Math.max(0, Math.floor((Number(listenedMs) || 0) / HOUR_MS));
}

/**
 * What Discord gets for one person: the values as strings, as Discord wants
 * them. Without the switch in /mydata the hours are 0.
 * @param {{ listenedMs?: number, counting?: boolean, premium?: boolean }} input
 */
export function roleConnectionFor({ listenedMs = 0, counting = false, premium = false } = {}) {
  return {
    platform_name: PLATFORM_NAME,
    metadata: {
      listening_hours: String(counting ? listeningHours(listenedMs) : 0),
      premium_customer: premium ? "1" : "0",
    },
  };
}

/** Discord's sign-in page for the linked roles. */
export function linkedRolesAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: String(clientId || ""),
    response_type: "code",
    redirect_uri: String(redirectUri || ""),
    scope: LINKED_ROLES_SCOPES,
    state: String(state || ""),
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/** The callback on the website's own address, e.g. https://omnifm.xyz/api/auth/linked-roles/callback. */
export function linkedRolesRedirectUri(publicUrl) {
  const base = String(publicUrl || "").trim().replace(/\/+$/, "");
  return base ? `${base}${LINKED_ROLES_CALLBACK_PATH}` : "";
}

/**
 * The people who own a server with Pro or Ultimate, from the servers the
 * commander sees. tierOf(guildId) gives "free" | "pro" | "ultimate".
 * @param {Iterable<{ id: string, ownerId?: string | null }>} guilds
 * @param {(guildId: string) => string} tierOf
 */
export function premiumCustomerIds(guilds, tierOf) {
  const owners = new Set();
  for (const guild of guilds || []) {
    const ownerId = String(guild?.ownerId || "").trim();
    if (!ownerId) continue;
    const tier = String(tierOf(String(guild.id)) || "free");
    if (tier === "pro" || tier === "ultimate") owners.add(ownerId);
  }
  return owners;
}

/** Whether a stored token has to be refreshed before it is used: less than a day left. */
export function tokenNeedsRefresh(expiresAt, now = Date.now()) {
  const at = expiresAt instanceof Date ? expiresAt.getTime() : Number(expiresAt) || 0;
  return at - now < 24 * HOUR_MS;
}

/** The owner console's section: the support server and its premium role, IDs only. */
export function normalizeLinkedRolesSettings(raw) {
  const id = (value) => (/^\d{17,22}$/.test(String(value || "").trim()) ? String(value).trim() : "");
  return { supportGuildId: id(raw?.supportGuildId), premiumRoleId: id(raw?.premiumRoleId) };
}
