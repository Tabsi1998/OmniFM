// ============================================================
// OmniFM: a "song" that is an advert (#548)
// ============================================================
// During an ad break many stations send the spot as the stream title, mostly
// with the advertiser's website as the artist ("www.lutz.at - Ein bisschen
// Verbraucherinformationen ..."). The same spot runs in every break, so it
// beat every real hit in the charts. A title counts as an advert when it
// carries a link or a website, or a word only adverts use. Kept narrow on
// purpose: a real song must never fall out (will.i.am, Mr. Saxobeat, "Dot").

const LINK = /(?:^|[^\p{L}\p{N}])(?:https?:\/\/|www\.)/iu;
// A bare domain as its own word: "mazda.at", "lutz.at/angebot".
const DOMAIN = /(?:^|[\s([/|"'])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:at|de|ch|li|eu|com|net|org|info|biz|shop|online|store)(?=$|[\s)\]/|,!?:;"']|\.(?:\s|$))/i;
const WORDS = /(?:^|[^\p{L}])(?:werbung|werbespot|werbepause|werbeblock|dauerwerbesendung|verbraucherinfo\p{L}*|advertisement|commercial break)(?![\p{L}])/iu;

function textOf(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * True when a now-playing title is an advert, not a song.
 * @param {{ artist?: string, title?: string, displayTitle?: string } | string} song
 */
export function isAdvertTitle(song) {
  const parts = typeof song === "string"
    ? [song]
    : [song?.artist, song?.title, song?.displayTitle];
  return parts.map(textOf).filter(Boolean).some((text) => LINK.test(text) || DOMAIN.test(text) || WORDS.test(text));
}
