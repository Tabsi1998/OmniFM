# OmniFM Radio

OmniFM hat einen eigenen Sender (#572). AzuraCast auf dem eigenen Server sendet. Normalerweise spielt der Auto-DJ, und wenn DJ Tabsi live geht, übernimmt die Live-Sendung. Die Bots spielen den Stream wie jeden anderen Katalog-Sender.

Alle Einstellungen stehen in `.env.example` im Abschnitt „OmniFM Radio“. Gelesen werden sie an einer Stelle: `src/services/omnifm-radio-config.js`.

## Katalog-Sender und Sichtbarkeit (#591)

OmniFM Radio ist ein fester Sender im Katalog: Name „OmniFM Radio“, Genre „OmniFM“, für alle Pläne, in jeder Liste ganz oben. Er steht nicht in `stations.json` und nicht in MongoDB, sondern kommt beim Abrufen aus den Einstellungen dazu (`src/services/omnifm-radio-station.js`).

- **Wer ihn sieht:** Mit `OMNIFM_RADIO_PUBLIC=0` nur die Server aus `OMNIFM_RADIO_TEST_GUILD_IDS`. Andere Server finden ihn nirgends und können ihn auch nicht über den Key abspielen. Mit `OMNIFM_RADIO_PUBLIC=1` sehen ihn alle Server und die Website. `OMNIFM_RADIO_ENABLED=0` blendet ihn überall aus.
- **Wo:** `/play` samt Autovervollständigung, `/stations`, Schnellstart, Favoriten, Ereignisse und Dashboard (Senderliste, Abspielen, eigener Ersatzsender). Auf der Website erst, wenn er öffentlich ist.
- **Kein automatischer Ersatz:** Fällt ein anderer Sender aus, springt OmniFM nie von selbst auf OmniFM Radio. Als eigenen Ersatzsender kann ein Server ihn aber wählen.
- **Key reserviert:** `omnifm-radio` (auch `omnifm_radio` oder `omnifmradio`) kann niemand anders belegen, weder im Sender-Editor noch als eigener Sender. Ein Katalog-Eintrag mit diesem Key wird ignoriert.
- **Jetzt läuft:** Titel und Interpret kommen aus der AzuraCast-API. Antwortet sie nicht, nimmt OmniFM wie bei jedem Sender den Titel aus dem Stream (ICY).

## Live-Erkennung und Betreiber-Meldung (#592)

_Folgt mit #592._
