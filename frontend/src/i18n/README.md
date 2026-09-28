# Website and dashboard languages (#306)

The site speaks German, English, French, Spanish, Italian, Polish, Turkish,
Portuguese (Brazil) and Dutch. The visitor's browser picks the language; a
`?lang=fr` in the link wins.

| File | Holds |
| --- | --- |
| `de-site.js`, `de-pages.js` | German, written in full |
| `en-site.js`, `en-pages.js` | English, written in full; the model for every other language |
| `<code>-site.js`, `<code>-pages.js` | the same keys as English, in that language (legal pages, SEO texts and the note that only German is binding included) |
| `ui/<code>.js` | the dashboard: the English text of every `t('Deutsch', 'English')` call and its translation |
| `languages.js` | the list of languages; loads the seven others as their own download |
| `../../../src/config/plan-feature-texts.js` | the Free/Pro/Ultimate lines of the other languages |

German and English are part of every page. The other languages are downloaded
only by visitors who read them; until then (or if the download fails) the page
shows English, and so does every text a language leaves out.

## A new or changed text

1. Write it in German and English (the site texts, or `t('…', '…')` in the
   dashboard). A value that changes goes in as `{name}`:
   `t('Läuft jetzt: {station}', 'Now playing: {station}', { station })`.
   Never build the text from pieces, the tables can only find whole texts.
2. Add the translation to the seven other languages.
3. `node --test test/website-languages.test.js` lists what is missing, what
   is left over and where a `{placeholder}` got lost.
   `node scripts/extract-ui-strings.mjs` lists every dashboard text.

The owner console stays German only and is not part of the languages.

## The legal pages

A change to the texts of the privacy policy or the terms (`privacy`, `terms`
in `<code>-pages.js`) also moves `LEGAL_TEXTS_UPDATED` in
`../components/LegalDocument.js`: that date is the "Stand" above both pages.
German stays the binding version; the other languages translate it.
