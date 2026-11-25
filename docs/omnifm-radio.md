# OmniFM Radio

OmniFM hat einen eigenen Sender (#572). AzuraCast auf dem eigenen Server sendet. Normalerweise spielt der Auto-DJ, und wenn DJ Tabsi live geht, übernimmt die Live-Sendung. Die Bots spielen den Stream wie jeden anderen Katalog-Sender.

Alle Einstellungen stehen in `.env.example` im Abschnitt „OmniFM Radio“. Gelesen werden sie an einer Stelle: `src/services/omnifm-radio-config.js`.

## Katalog-Sender und Sichtbarkeit (#591)

_Folgt mit #591._

## Live-Erkennung und Betreiber-Meldung (#592)

OmniFM merkt innerhalb weniger Sekunden, wenn DJ Tabsi live geht oder aufhört. Der Zustand (live ja/nein, DJ, Titel, Beginn, Ende) liegt in MongoDB (`omnifm_radio_live`) und ist die eine Quelle für alle Anzeigen und Meldungen; dazu kommen die letzten 50 Sendungen.

- **Webhook:** AzuraCast meldet „DJ verbunden/getrennt“ an `POST /api/radio/webhook`. Den Endpunkt gibt es nur mit `OMNIFM_RADIO_WEBHOOK_SECRET` (mindestens 16 Zeichen, sonst bleibt er aus). Ohne Geheimnis antwortet er 404, mit falschem 401.
- **Abfrage als Rückfall:** Alle `OMNIFM_RADIO_POLL_MS` (Standard 30 s, mindestens 5 s) fragt OmniFM die Now-Playing-API. Antwortet sie nicht, bleibt der Zustand, wie er ist.
- **Kurze Aussetzer:** Bricht die Verbindung kürzer als `OMNIFM_RADIO_LIVE_GRACE_MS` (Standard 60 s) weg, läuft dieselbe Sendung weiter. Melden Webhook und Abfrage dieselbe Sendung, gibt es trotzdem nur einen Beginn. Eine Abfrage, die vor dem letzten Webhook gestartet ist, zählt nicht.
- **Verpasste Lücke:** War OmniFM länger weg und meldet AzuraCast eine neue Sendung (`broadcast_start` deutlich nach dem letzten Live-Stand), endet die alte und die neue beginnt.
- **Titel:** Der Song kurz vor dem Live-Gehen ist meist noch vom Auto-DJ. Als Titel zählt erst ein anderer Text nach dem Beginn, sonst bleibt er leer.
- **Datenbank weg:** Solange der gespeicherte Zustand nicht lesbar ist, speichert und meldet OmniFM nichts. So bleibt der Verlauf ganz, und eine laufende Sendung wird nicht doppelt gemeldet.
- Webhook und Abfrage laufen im Commander (oder im Monolith). Der öffentliche Eingang leitet `/api/radio` dorthin weiter. Staging setzt `OMNIFM_RADIO_ENABLED=0` (`docs/staging.md`).

### Webhook in AzuraCast einrichten

1. Ein Geheimnis erzeugen, z. B. mit `openssl rand -hex 24`, als `OMNIFM_RADIO_WEBHOOK_SECRET` in `backend/.env` eintragen und den Bot neu starten.
2. In AzuraCast: **Station → Webhooks → Webhook hinzufügen → Generic Web Hook**.
3. Auslöser: **Live Streamer/DJ Connected** und **Live Streamer/DJ Disconnected**.
4. Web-Hook-URL: `https://omnifm.xyz/api/radio/webhook`, also die öffentliche Adresse. Interne Adressen kann AzuraCast sperren.
5. Basic-Auth: Benutzername beliebig (z. B. `omnifm`), Passwort ist das Geheimnis. AzuraCast schickt die Anmeldung nur mit, wenn beide Felder gefüllt sind.
6. Speichern und einmal live gehen. Im Cockpit steht dann „zuletzt gemeldet … (Webhook)“.

AzuraCast schickt den ganzen Now-Playing-Stand als JSON, ohne Feld für den Auslöser. OmniFM liest daraus nur `live.is_live`, `live.streamer_name`, `live.broadcast_start` und den Titel. Kommt der Webhook von einer anderen Station (`station.shortcode`), antwortet OmniFM mit 422.

### Meldung und Owner-Konsole

- Der Betreiber-Webhook meldet „🔴 Live gestartet: DJ Tabsi – Titel“ und „Sendung beendet nach 1 h 12 min“. Abschalten: Owner-Konsole → Einstellungen → Alarme → „OmniFM Radio: Sendung gestartet oder beendet“ (oder `OPERATOR_ALERT_RADIO_LIVE=0`).
- Das Cockpit zeigt in der Karte „OmniFM Radio · Live-Erkennung“ den Zustand, wie erkannt wird und die letzten Sendungen.
- **Test-Sendung** (nur Rolle Owner): Der Knopf spielt Beginn und Ende durch (Quelle „Test“), gesendet wird nichts. Die Betreiber-Meldung beginnt dann mit „🧪 Test-Sendung:“. Nach 10 Minuten endet ein Test von selbst. Tests stehen nicht im Verlauf der Sendungen. Während einer echten Sendung geht kein Test; geht DJ Tabsi während eines Tests live, endet der Test und die echte Sendung beginnt.
- Für weitere Meldungen (#593, #594, #595): `onOmnifmRadioLiveEvent(({ type, show }) => …)` aus `src/services/omnifm-radio-live.js`. `type` ist `start` oder `end`, `show.source` ist `webhook`, `poll` oder `test`; im Zustand steht es unter `current.source`. Eine Test-Sendung bitte überspringen.
