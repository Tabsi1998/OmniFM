# Discord-Design von OmniFM

Jede Nachricht des Bots entsteht mit `src/discord/ui/` (#264). So sieht OmniFM
in Discord überall gleich aus, und neue Nachrichten brauchen keinen eigenen
Aufbau.

## Bausteine

| Baustein | Wofür |
|---|---|
| `panel({ accent, title, subtitle, body, thumbnailUrl, actions, footer })` | die Standard-Nachricht: Überschrift, Inhalt, Knöpfe, Markenzeile |
| `notice(kind, { title, body, actions })` | Hinweise: `info`, `success`, `warning`, `error`, `premium` |
| `list({ title, items, page, customId })` | lange Listen mit Blättern |
| `confirm({ title, confirmId, cancelId, danger })` | Ja/Nein-Fragen |
| `section({ content, thumbnailUrl \| button })` | Text mit Cover/Logo oder Knopf daneben |
| `text`, `field`, `statusLine`, `subtext`, `separator` | Inhalt |
| `reply(...)` / `message(...)` | fertige Nutzlast mit den richtigen Flags |
| `checkDiscordLimits(payload)` | 40 Komponenten, 4.000 Zeichen Text |
| `icon(name, applicationId)` | App-Emoji der sendenden App, sonst Unicode (#265) |

## Regeln

- **Farbe sagt, worum es geht:** Markenorange für normale Nachrichten, Statusfarben
  für Hinweise, die Tarif- bzw. Senderfarbe für Wiedergabe.
- **Kurz und du:** Ein Satz sagt, was los ist, der nächste, was man tun kann.
  Jeder Fehler bekommt nach Möglichkeit einen Knopf, der ihn behebt.
- **Privat oder öffentlich:** Antworten auf Befehle sind privat (`reply`), nur
  Panels, die alle sehen sollen, sind öffentlich (`message`).
- **Unten steht immer die Markenzeile** mit Version, damit man sieht, welcher
  Stand läuft.
- **Components V2 lässt sich nicht zurückverwandeln:** Eine solche Nachricht
  kann nie per `interaction.update()` zu einem Embed werden. Knöpfe darauf
  antworten mit einer neuen Nachricht (`isComponentsV2Message`).
- **Jede Nachricht hat einen Test**, der `checkDiscordLimits` prüft.

## App-Emojis

Die Icons liegen in `assets/discord-emojis/` (Markenfarben, 128×128, der
Equalizer animiert). Jeder Bot lädt sie beim Start als **eigene** App-Emojis
hoch (`omnifm_play_v1` …); bis dahin und wenn das scheitert, steht Unicode da.
Neu zeichnen: `python scripts/generate-app-emojis.py` (braucht Pillow), dann in
`manifest.json` die `version` erhöhen – die Bots ersetzen ihre alten Emojis
beim nächsten Start selbst. Abschalten: `OMNIFM_APP_EMOJIS=0`.
