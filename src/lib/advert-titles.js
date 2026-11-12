// ============================================================
// OmniFM: a "song" that is an advert (#548)
// ============================================================
// During an ad break many stations send the spot as the stream title, mostly
// with the advertiser's website as the artist ("www.lutz.at - Ein bisschen
// Verbraucherinformationen ..."). The same spot runs in every break, so it
// beat every real hit in the charts. A title counts as an advert when it
// carries a link, a website with its ending, or a word only adverts use.
// Kept narrow on purpose: a real song must never fall out (will.i.am,
// Mr. Saxobeat, Prozzäk "www.nevergetoveryou").
//
// One pattern for JavaScript and MongoDB alike (no \p classes, no lookbehind),
// so the stored plays can be left out before they are counted and cut.

const TLD = "(?:at|de|ch|li|eu|com|net|org|info|biz|shop|online|store)";
// A link, or a "www." host that has a real ending: "www.lutz.at", not "www.nevergetoveryou".
const LINK = "(?:^|[^a-z0-9])(?:https?://|www\\.[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.[a-z]{2,})";
// A bare domain as its own word: "mazda.at", "lutz.at/angebot".
const DOMAIN = `(?:^|[\\s(\\[/|"'])[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.${TLD}(?=$|[\\s)\\]/|,!?:;"']|\\.(?:\\s|$))`;
const LETTER = "a-zäöüß";
const WORDS = `(?:^|[^${LETTER}])(?:werbung|werbespot|werbepause|werbeblock|dauerwerbesendung|verbraucherinfo[${LETTER}]*|advertisement|commercial break)(?![${LETTER}])`;

/** Case-insensitive; usable in MongoDB queries: `{ displayTitle: { $not: ADVERT_TITLE_REGEX } }`. */
export const ADVERT_TITLE_REGEX = new RegExp(`${LINK}|${DOMAIN}|${WORDS}`, "i");

function textOf(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * True when a now-playing title is an advert, not a song.
 * @param {{ artist?: string, title?: string, displayTitle?: string, streamTitle?: string } | string} song
 */
export function isAdvertTitle(song) {
  const parts = typeof song === "string"
    ? [song]
    : [song?.artist, song?.title, song?.displayTitle, song?.streamTitle];
  return parts.map(textOf).filter(Boolean).some((text) => ADVERT_TITLE_REGEX.test(text));
}

/** A MongoDB filter on `displayTitle` that leaves adverts out (plays counted before #548). */
export const NOT_ADVERT_FILTER = Object.freeze({ displayTitle: { $not: ADVERT_TITLE_REGEX } });

/** The same for the song history, whose entries keep every title field. */
export const NOT_ADVERT_HISTORY_FILTER = Object.freeze({
  $nor: ["displayTitle", "streamTitle", "artist", "title"].map((field) => ({ [field]: ADVERT_TITLE_REGEX })),
});

/**
 * The track fields of a now-playing update, all empty when they are an
 * advert: the panel, the share card and the song counts never show a spot.
 * @template {{ artist?: any, title?: any, streamTitle?: any, displayTitle?: any }} T
 * @param {T} track
 * @returns {T}
 */
export function withoutAdvertTrack(track) {
  if (!isAdvertTitle(track)) return track;
  return { ...track, artist: null, title: null, streamTitle: null, displayTitle: null };
}
