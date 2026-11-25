# OmniFM Radio

OmniFM hat einen eigenen Sender (#572). AzuraCast auf dem eigenen Server sendet. Normalerweise spielt der Auto-DJ, und wenn DJ Tabsi live geht, übernimmt die Live-Sendung. Die Bots spielen den Stream wie jeden anderen Katalog-Sender.

Alle Einstellungen stehen in `.env.example` im Abschnitt „OmniFM Radio“. Gelesen werden sie an einer Stelle: `src/services/omnifm-radio-config.js`.

## Katalog-Sender und Sichtbarkeit (#591)

OmniFM Radio ist ein fester Sender im Katalog: Name „OmniFM Radio“, Genre „OmniFM“, für alle Pläne, in jeder Liste ganz oben. Er steht nicht in `stations.json` und nicht in MongoDB, sondern kommt beim Abrufen aus den Einstellungen dazu (`src/services/omnifm-radio-station.js`).

- **Wer ihn sieht:** Mit `OMNIFM_RADIO_PUBLIC=0` nur die Server aus `OMNIFM_RADIO_TEST_GUILD_IDS`. Andere Server finden ihn nirgends und können ihn weder über den Key noch über die Stream-Adresse abspielen. Mit `OMNIFM_RADIO_PUBLIC=1` sehen ihn alle Server und die Website. `OMNIFM_RADIO_ENABLED=0` blendet ihn überall aus.
- **Wo:** `/play` samt Autovervollständigung, `/stations`, Schnellstart, Favoriten, Ereignisse und Dashboard (Senderliste, Abspielen, eigener Ersatzsender). Auf der Website erst, wenn er öffentlich ist.
- **Kein automatischer Ersatz:** Fällt ein anderer Sender aus, springt OmniFM nie von selbst auf OmniFM Radio. Als eigenen Ersatzsender kann ein Server ihn aber wählen. Er ist auch nie der Standard-Sender eines Servers.
- **Key und Adresse reserviert:** `omnifm-radio` (auch `omnifm_radio` oder `omnifmradio`) kann niemand anders belegen, weder im Sender-Editor noch als eigener Sender. Dasselbe gilt für jede Adresse auf dem Server von OmniFM Radio (Host aus `OMNIFM_RADIO_BASE_URL` und `OMNIFM_RADIO_STREAM_URL`, egal welcher Pfad). Katalog-Einträge mit diesem Key oder dieser Adresse werden ignoriert.
- **Jetzt läuft:** Titel und Interpret kommen aus der AzuraCast-API, nach spätestens 5 Sekunden ist Schluss. Antwortet sie nicht, nimmt OmniFM wie bei jedem Sender den Titel aus dem Stream (ICY). Im Panel steht als Quelle „Sender-API“.
- **Öffentliche Adresse nötig:** Die Abfrage läuft über `safeFetch`, und das sperrt private und LAN-Adressen. `OMNIFM_RADIO_BASE_URL` muss deshalb die öffentliche Adresse sein, auch wenn AzuraCast im selben Netz wie der Bot läuft.
- **Server im Heimnetz ohne Hairpin-NAT (#599):** Erreicht der Server seine eigene öffentliche Adresse nicht (das Cockpit meldet dann „Der Server erreicht … nicht selbst“), kommt er auch nicht an `radio.omnifm.xyz`. Dann bleibt die Live-Erkennung stumm, und die Bots können den Stream nicht spielen. Abhilfe ohne Router-Umbau: `OMNIFM_RADIO_INTERNAL_URL=http://192.168.2.253:8080`, also die Adresse, unter der der Server AzuraCast im eigenen Netz erreicht. Am besten eine IP-Adresse, kein Name.
  - Umgeleitet wird nur, was der Bot selbst braucht: GET auf `/api/nowplaying/<station>` und auf `/listen/<station>/…` am öffentlichen Radio-Host (dazu der Pfad von `OMNIFM_RADIO_STREAM_URL`, wenn er auf diesem Host liegt), mit gleichem Schema und Port und ohne Zugangsdaten. Alles andere geht wie bisher an die öffentliche Adresse. Ein Stream auf einem anderen Host wird nicht umgeleitet.
  - Erlaubt ist genau dieser eine interne Ursprung und nur für umgeleitete Anfragen. Wer die interne Adresse direkt einträgt (eigener Sender, Stream-Test, Webhook), wird weiter abgelehnt. `OMNIFM_RADIO_ENABLED=0` schaltet auch die Umleitung ab.
  - Im eigenen Netz läuft die Verbindung über http statt https. Wer im Heimnetz mitlesen oder Pakete umleiten kann, könnte also Ton oder Live-Status fälschen. Für ein Heimnetz ist das vertretbar.
  - Anzeige und Links behalten die öffentliche Adresse.
  - Scheitert die Abfrage, steht das einmal im Log und im Cockpit („Abfrage von AzuraCast scheitert seit …“).
  - Der Webhook von AzuraCast an `https://omnifm.xyz/...` scheitert aus demselben Grund. Dann bleibt es bei der Abfrage alle 30 s, das reicht. Die Sperre lokaler Webhook-Adressen in AzuraCast bitte nicht abschalten: Das vergrößert die Angriffsfläche von AzuraCast, und das Geheimnis ginge per http durchs Netz.
- **Schalter:** `OMNIFM_RADIO_ENABLED` und `OMNIFM_RADIO_PUBLIC` verstehen `1/true/yes/on` und `0/false/no/off`. `OMNIFM_RADIO_STATION_KEY` darf nur a-z, 0-9 und `-` enthalten. Sonst bleibt es bei `omnifm-radio`, und im Log steht eine Warnung.

## Live-Erkennung und Betreiber-Meldung (#592)

OmniFM merkt innerhalb weniger Sekunden, wenn DJ Tabsi live geht oder aufhört. Der Zustand (live ja/nein, DJ, Titel, Beginn, Ende) liegt in MongoDB (`omnifm_radio_live`) und ist die eine Quelle für alle Anzeigen und Meldungen; dazu kommen die letzten 50 Sendungen.

- **Webhook:** AzuraCast meldet „DJ verbunden/getrennt“ an `POST /api/radio/webhook`. Den Endpunkt gibt es nur mit `OMNIFM_RADIO_WEBHOOK_SECRET` (mindestens 16 Zeichen, sonst bleibt er aus). Ohne Geheimnis antwortet er 404, mit falschem 401.
- **Abfrage als Rückfall:** Alle `OMNIFM_RADIO_POLL_MS` (Standard 30 s, mindestens 5 s) fragt OmniFM die Now-Playing-API. Antwortet sie nicht, bleibt der Zustand, wie er ist.
- **Kurze Aussetzer:** Bricht die Verbindung kürzer als `OMNIFM_RADIO_LIVE_GRACE_MS` (Standard 60 s) weg, läuft dieselbe Sendung weiter. Melden Webhook und Abfrage dieselbe Sendung, gibt es trotzdem nur einen Beginn. Eine Abfrage, die vor dem letzten Webhook gestartet ist, zählt nicht.
- **Verpasste Lücke:** War OmniFM länger weg und meldet AzuraCast eine neue Sendung (`broadcast_start` deutlich nach dem letzten Live-Stand), endet die alte zum letzten Live-Stand und die neue beginnt. Ein `broadcast_start` in der Zukunft (Uhr von AzuraCast vorgestellt) zählt höchstens bis jetzt.
- **Titel:** Der Song kurz vor dem Live-Gehen ist meist noch vom Auto-DJ. Als Titel zählt erst ein anderer Text nach dem Beginn, sonst bleibt er leer.
- **Datenbank weg:** Solange der gespeicherte Zustand nicht lesbar ist, speichert und meldet OmniFM nichts. So bleibt der Verlauf ganz, und eine laufende Sendung wird nicht doppelt gemeldet. Der Webhook antwortet dann 503, das Cockpit zeigt „Zustand nicht lesbar (Datenbank)“.
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
