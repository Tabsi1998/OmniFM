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
- Für weitere Meldungen (#593, #594, #595): `onOmnifmRadioLiveEvent(({ type, show }) => …)` aus `src/services/omnifm-radio-live.js`. `type` ist `start` oder `end`, `show.source` ist `webhook`, `poll` oder `test`; im Zustand steht es unter `current.source`. Eine Test-Sendung bitte überspringen; die DMs (#594) gehen bei einer Test-Sendung nur an die Besitzer der Test-Server.

## DMs an Server-Besitzer (#594)

Geht DJ Tabsi live, bekommt der Besitzer jedes Servers mit OmniFM, auf dem OmniFM Radio sichtbar ist, eine kurze DM: „🔴 DJ Tabsi ist live auf OmniFM Radio“, der Titel, warum er sie bekommt, die Knöpfe „Jetzt hören“ (öffentlicher Player `<OMNIFM_RADIO_BASE_URL>/public/<OMNIFM_RADIO_STATION>`) und „Abbestellen“. Die Sprache ist die des Servers. Admins bekommen keine DM. Code: `src/services/omnifm-radio-dm.js`, Nachricht und Knöpfe in `src/bot/omnifm-radio-dm-message.js`, Zustand pro Person in `src/omnifm-radio-dm-store.js` (MongoDB `omnifm_radio_dm`).

**Risiko:** Ungefragte Massen-DMs wertet Discord als Spam. Dafür werden Bots eingeschränkt oder gesperrt, und das träfe ganz OmniFM. Deshalb:

- Nur beim Beginn einer Sendung, nie beim Ende. Wer mehrere Server besitzt, bekommt eine DM.
- Höchstens **eine DM pro Person in 12 Stunden**, gespeichert, also auch über einen Neustart. Vor dem Senden wird der Platz belegt; scheitert das Senden, gibt es trotzdem keine zweite.
- **Langsam:** eine Warteschlange für alle, eine DM alle 5 Sekunden. Gesendet wird über einen eigenen REST-Client mit dem Commander-Token, ohne Wiederholung (eine Anfrage, die in die Zeitüberschreitung läuft, könnte sonst doppelt ankommen) und ohne Warten auf ein echtes 429 (das ginge am Not-Aus vorbei). Sperrt der REST-Client selbst kurz, bevor er Discord fragt, wartet die Verteilung das ab (höchstens eine Minute, sonst stoppt sie mit „Rate-Limit zu lang“); gesendet war dann noch nichts. Not-Aus und Sendungsende brechen auch eine DM ab, die gerade rausgeht. Lehnt Discord ab (50007, 10013 oder 403, DMs geschlossen), lässt OmniFM die Person 30 Tage in Ruhe, aber nur, wenn in dieser Verteilung mindestens eine DM ankam und nicht gebremst wurde.
- **Not-Bremse:** Meldet Discord 40003, 40004 oder ein echtes 429, schlagen fünf DMs hintereinander aus anderem Grund fehl, oder sind ab 20 Versuchen mehr als 90 % fehlgeschlagen (geschlossene DMs mitgezählt), stoppt die Verteilung, der Modus springt auf `off` und der Betreiber-Webhook meldet es, immer, unabhängig von den Alarm-Schaltern. Geschlossene DMs allein lösen die Fünf-in-Folge-Grenze nicht aus. Wieder einschalten nur von Hand.
- **Abbestellen** löscht auch die Zeiten der letzten DMs und der geschlossenen DMs; gespeichert bleiben nur die Wahl und wann sie getroffen wurde.
- Jede DM wird vor dem Belegen gebaut. Ist eine Einstellung kaputt (etwa `OMNIFM_RADIO_BASE_URL` ohne `https://`), stoppt die Verteilung mit „Einstellung fehlerhaft“, und niemandem werden die 12 Stunden angerechnet.
- **„Abbestellen“** gilt dauerhaft, auch nach Neustarts. Die DM zeigt danach „Wieder abonnieren“.
- **/meine-daten** zeigt den Zustand (abbestellt, letzte DM, DMs geschlossen bis) und schickt ihn in der Datei mit. „Alles löschen“ löscht ihn; wer abbestellt hat, behält nur `{ _id, unsubscribed: true }` ohne Zeiten, damit die Abmeldung weiter gilt. Wer weder abbestellt noch wieder abonniert hat, verliert den Eintrag 30 Tage nach der letzten DM von selbst (TTL-Index auf `expiresAt`). Steht so auch in der Datenschutzerklärung.
- Endet die Sendung, während noch DMs ausstehen, gehen die restlichen nicht mehr raus.
- **Test-Sendung:** DMs nur an die Besitzer der Server aus `OMNIFM_RADIO_TEST_GUILD_IDS`, mit dem Hinweis „🧪 Test-Sendung“. Eigene Grenze von einer DM in 10 Minuten, die 12 Stunden bleiben unberührt.

**Not-Aus und Modus:** Owner-Konsole → Cockpit → Karte „OmniFM Radio · DMs an Server-Besitzer“ (nur Rolle Owner schaltet, gespeichert in `owner_config.radioDm.mode`). Ohne Wert dort gilt `OMNIFM_RADIO_DM_MODE`, sonst `owners`.

- `owners`: alle Besitzer wie oben (Standard).
- `optin`: nur wer nach dem Abbestellen „Wieder abonnieren“ gedrückt hat. Einen anderen Weg zum Anmelden gibt es vorerst bewusst nicht.
- `off`: keine DMs. Der Modus wird vor **jeder einzelnen** DM gelesen, „Aus“ stoppt also auch eine laufende Verteilung sofort, noch bevor es gespeichert ist; antwortet die Datenbank nicht, bleibt „Aus“ im Speicher, bis das Speichern klappt. Ein unbekannter Wert und eine Datenbank, die nicht antwortet, zählen wie `off`.

Die Karte zeigt außerdem die letzte Verteilung: gesendet, übersprungen, fehlgeschlagen, offen und warum sie gestoppt hat. Gesendet wird von OmniFM 1 (dem Commander, im Monolith ebenso), die Worker schicken nie DMs.
