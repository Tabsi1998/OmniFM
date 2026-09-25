// ============================================================
// OmniFM: "💾 Save" and the personal list of saved songs (#272)
// ============================================================
// Builds the song card (DM, or privately in the channel when DMs are
// closed), the answer to the button and the /merkliste list with pages,
// delete menu and "delete all". Plain data in, payloads out; the runtime
// side is runtime-methods/saved-songs.js.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";

import * as ui from "../discord/ui/index.js";
import { SAVED_SONGS_MAX_PER_USER } from "../saved-songs-store.js";

export const SAVED_SONGS_PREFIX = "omnifm:saved:";
export const SAVED_SONGS_PAGE_SIZE = 10;
const ACTIONS = new Set(["page", "delete", "clear", "clearyes", "clearno"]);

function clip(value, max) {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function savedSongsCustomId(action, page = 0) {
  return `${SAVED_SONGS_PREFIX}${action}:${Math.max(0, Number(page) || 0)}`;
}

/** "omnifm:saved:page:2" -> { action: "page", page: 2 }; null for others. */
export function parseSavedSongsCustomId(customId) {
  const value = String(customId || "");
  if (!value.startsWith(SAVED_SONGS_PREFIX)) return null;
  const [action, rawPage] = value.slice(SAVED_SONGS_PREFIX.length).split(":");
  if (!ACTIONS.has(action)) return null;
  return { action, page: Math.max(0, Number.parseInt(String(rawPage || "0"), 10) || 0) };
}

export function songHeadline(song) {
  return song?.title || song?.displayTitle || "-";
}

export function songSearchQuery(song) {
  const query = song?.artist && song?.title ? `${song.artist} ${song.title}` : (song?.displayTitle || "");
  return clip(query, 180);
}

/** Plain search pages at the four services: no API, no account, nothing sent to them by OmniFM. */
export function musicSearchLinks(song) {
  const query = encodeURIComponent(songSearchQuery(song));
  if (!query) return [];
  return [
    { label: "Spotify", url: `https://open.spotify.com/search/${query}` },
    { label: "Apple Music", url: `https://music.apple.com/search?term=${query}` },
    { label: "YouTube Music", url: `https://music.youtube.com/search?q=${query}` },
    { label: "Deezer", url: `https://www.deezer.com/search/${query}` },
  ];
}

function unixSeconds(value) {
  const time = new Date(value || Date.now()).getTime();
  return Math.floor((Number.isFinite(time) ? time : Date.now()) / 1000);
}

/** The card: cover, title, artist, station, time and the search links. */
export function buildSongCard({ t, song, savedAt = new Date(), note = "", applicationId = null }) {
  const lines = [
    ui.subtext(`${ui.icon("save", applicationId)} ${t("Gemerkt", "Saved")}`),
    ui.heading(clip(songHeadline(song), 110)),
  ];
  if (song?.artist && song?.title) lines.push(clip(song.artist, 120));
  lines.push(ui.subtext(ui.statusLine([
    song?.stationName ? `${ui.icon("radio", applicationId)} ${clip(song.stationName, 80)}` : null,
    `<t:${unixSeconds(savedAt)}:f>`,
  ])));
  const head = song?.artworkUrl
    ? ui.section({ content: lines.join("\n"), thumbnailUrl: song.artworkUrl })
    : ui.text(lines.join("\n"));
  const links = musicSearchLinks(song).map((link) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(link.label).setURL(link.url));
  return ui.container({
    blocks: [
      head,
      note ? ui.text(`> ${note}`) : null,
      links.length ? ui.separator() : null,
      links.length ? new ActionRowBuilder().addComponents(...links) : null,
      ui.brandLine(t("Deine Merkliste: /merkliste", "Your list: /saved")),
    ],
  });
}

/**
 * The private answer to "💾 Save": saved (card in the DMs), already saved,
 * or the card itself when the DMs are closed.
 */
export function buildSaveSongReply({ t, song, duplicate = false, dmSent = false, savedAt = new Date(), applicationId = null }) {
  const name = `**${clip(songHeadline(song), 100)}**${song?.artist && song?.title ? ` – ${clip(song.artist, 80)}` : ""}`;
  if (duplicate) {
    return ui.reply(ui.notice("info", {
      title: t("Schon gemerkt", "Already saved"),
      body: t(`${name} steht schon auf deiner Merkliste (/merkliste).`, `${name} is already on your list (/saved).`),
      applicationId,
    }));
  }
  if (dmSent) {
    return ui.reply(ui.notice("success", {
      title: t("Gemerkt", "Saved"),
      body: t(
        `${name} liegt jetzt in deinen Direktnachrichten und auf deiner Merkliste (/merkliste).`,
        `${name} is now in your direct messages and on your list (/saved).`
      ),
      applicationId,
    }));
  }
  return ui.reply(buildSongCard({
    t,
    song,
    savedAt,
    applicationId,
    note: t(
      "Deine Direktnachrichten sind zu, darum kommt die Karte hier. Gemerkt ist der Song trotzdem.",
      "Your direct messages are closed, so the card comes here. The song is saved all the same."
    ),
  }));
}

/** /merkliste: ten songs per page, a menu to delete one, "delete all". */
export function buildSavedSongsListPayload({ t, songs = [], page = 0, applicationId = null }) {
  const pages = Math.max(1, Math.ceil(songs.length / SAVED_SONGS_PAGE_SIZE));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const shown = songs.slice(current * SAVED_SONGS_PAGE_SIZE, (current + 1) * SAVED_SONGS_PAGE_SIZE);

  const body = shown.length
    ? shown.map((song, index) => {
      const number = current * SAVED_SONGS_PAGE_SIZE + index + 1;
      const artist = song.artist && song.title ? ` – ${clip(song.artist, 60)}` : "";
      const spotify = musicSearchLinks(song)[0];
      const meta = ui.statusLine([
        song.stationName ? `📻 ${clip(song.stationName, 50)}` : null,
        `<t:${unixSeconds(song.savedAt)}:R>`,
        spotify ? `[Spotify](${spotify.url})` : null,
      ]);
      return `**${number}.** ${clip(songHeadline(song), 80)}${artist}\n${ui.subtext(meta)}`;
    }).join("\n")
    : t(
      "Noch nichts gemerkt. Tippe im Now-Playing-Panel auf „💾 Merken“, dann landet der Song hier.",
      "Nothing saved yet. Tap “💾 Save” in the now-playing panel and the song lands here."
    );

  const actions = [];
  if (shown.length) {
    actions.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(savedSongsCustomId("delete", current))
        .setPlaceholder(t("🗑 Einen Song löschen", "🗑 Delete one song"))
        .addOptions(shown.map((song) => ({
          label: clip(`${songHeadline(song)}${song.artist && song.title ? ` – ${song.artist}` : ""}`, 100),
          value: String(song.id),
          ...(song.stationName ? { description: clip(song.stationName, 100) } : {}),
        })))
    ));
  }
  const nav = [];
  if (pages > 1) {
    nav.push(
      new ButtonBuilder().setCustomId(savedSongsCustomId("page", current - 1)).setStyle(ButtonStyle.Secondary)
        .setLabel(t("◀ Zurück", "◀ Back")).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(`${SAVED_SONGS_PREFIX}position`).setStyle(ButtonStyle.Secondary)
        .setLabel(`${current + 1} / ${pages}`).setDisabled(true),
      new ButtonBuilder().setCustomId(savedSongsCustomId("page", current + 1)).setStyle(ButtonStyle.Secondary)
        .setLabel(t("Weiter ▶", "Next ▶")).setDisabled(current >= pages - 1),
    );
  }
  if (songs.length) {
    nav.push(new ButtonBuilder().setCustomId(savedSongsCustomId("clear", current)).setStyle(ButtonStyle.Danger)
      .setLabel(t("Alles löschen", "Delete all")));
  }
  if (nav.length) actions.push(new ActionRowBuilder().addComponents(...nav));

  return ui.reply(ui.panel({
    title: `${ui.icon("save", applicationId)} ${t("Deine Merkliste", "Your saved songs")}`,
    subtitle: ui.subtext(t(
      `${songs.length} von höchstens ${SAVED_SONGS_MAX_PER_USER} · nur du siehst sie`,
      `${songs.length} of at most ${SAVED_SONGS_MAX_PER_USER} · only you see them`
    )),
    body: [ui.text(body)],
    actions,
  }));
}

export function buildClearSavedSongsConfirm({ t, count = 0, page = 0 }) {
  return ui.reply(ui.confirm({
    title: t("Ganze Merkliste löschen?", "Delete your whole list?"),
    body: t(
      `Alle ${count} Songs werden gelöscht. Danach ist nichts mehr davon bei OmniFM gespeichert, das lässt sich nicht rückgängig machen.`,
      `All ${count} songs will be deleted. After that OmniFM keeps nothing of them; this cannot be undone.`
    ),
    confirmId: savedSongsCustomId("clearyes", page),
    cancelId: savedSongsCustomId("clearno", page),
    confirmLabel: t("Ja, alles löschen", "Yes, delete all"),
    danger: true,
    t,
  }));
}

export function buildSavedSongsClearedPayload({ t, deleted = 0, applicationId = null }) {
  return ui.reply(ui.notice("success", {
    title: t("Merkliste gelöscht", "List deleted"),
    body: t(
      `${deleted} Songs gelöscht. Von deiner Merkliste ist nichts mehr gespeichert.`,
      `${deleted} songs deleted. Nothing of your list is stored any more.`
    ),
    applicationId,
  }));
}
