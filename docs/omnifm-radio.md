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

_Folgt mit #592._
