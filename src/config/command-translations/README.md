# Slash command translations

OmniFM's slash commands are written in English and German in `src/commands.js`.
Every other language lives here, one JSON file per language:

| File | Discord locales |
|---|---|
| `fr.json` | `fr` |
| `es.json` | `es-ES`, `es-419` |
| `it.json` | `it` |
| `pl.json` | `pl` |
| `tr.json` | `tr` |
| `pt-BR.json` | `pt-BR` |
| `nl.json` | `nl` |

Each file maps the English text of a description or choice to its translation:

```json
{
  "Start a radio stream in your voice channel": "Lancer une radio dans ton salon vocal"
}
```

## Fixing or adding a translation

1. Change the text on the right-hand side. Never change the English key on the
   left; it has to match `src/commands.js` exactly.
2. Keep these tokens exactly as they are, because the commands read them:
   `HH:MM`, `DD.MM.YYYY`, `YYYY-MM-DD`, `{event}` and the other `{…}`
   placeholders, `today/tomorrow`, `clear`, `OMNI-XXXX-XXXX-XXXX`, `[Pro]`,
   `[Ultimate]`, and `/`.
3. Stay within 100 characters per text (Discord's limit).
4. Run `node --test test/command-translations.test.js`. It checks that every
   language has every description, that the tokens are kept, that no text is
   left over and that every command stays within Discord's size limit.

## A new language

Add `<code>.json` with every key of `fr.json` translated, and add the Discord
locale to `COMMAND_LOCALE_FILES` in `src/config/command-translations.js`. The
Discord locale codes are listed at
https://discord.com/developers/docs/reference#locales.

The bot's answers stay in English for these languages: OmniFM speaks German
and English, and every other language falls back to English.
