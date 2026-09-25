# Changelog

Alle Versionen von OmniFM. Neue Versionen stehen oben. Die Versionsnummer
folgt [SemVer](https://semver.org/lang/de/): Die erste Zahl steigt bei
Änderungen, die bestehende Einrichtungen brechen können, die zweite bei neuen
Funktionen, die dritte bei reinen Fehlerbehebungen. Wie ein Release entsteht,
steht in `scripts/release.mjs`.

## 3.2.0 – 2026-09-25

Das neue Gesicht in Discord: Alle wichtigen Nachrichten des Bots sind neu
gestaltet, dazu Funktionen für Hörer und Server-Teams (Milestone M8).

### Neu

- **Neues Now-Playing-Panel:** Cover, Titel, Sender in seiner eigenen Farbe,
  Hörer, Lautstärke und die Knöpfe in einer Nachricht. Die OmniFM-Symbole
  sind eigene Emojis des Bots, mit animiertem Equalizer. `/now` zeigt
  dasselbe Panel. (#322, #323, #324)
- **Einrichtung in drei Schritten:** Nach dem Einladen kommt eine Begrüßung
  in den Systemkanal. Mit einem Knopf wählen Server-Verwalter Sprachkanal,
  Sender und Panel-Kanal, ganz ohne Befehl. Fehlt dem Bot ein Recht, steht
  genau da, welches. (#330)
- **Sender-Browser:** `/stations` zeigt alle Sender mit Genre-Auswahl, Suche
  und Abspielen-Knopf; gesperrte Sender zeigen, ab welchem Plan sie gehen.
  Jeder Sender hat jetzt Genre, Farbe und, wo vorhanden, ein Logo. (#326, #327)
- **Hilfe zum Durchklicken:** `/help` ist ein Panel mit Themen (Abspielen,
  Sender, Events, Einstellungen, Premium, Probleme lösen) und passenden
  Knöpfen. (#329)
- **Klare Hinweise:** Jede bekannte Fehlermeldung sagt in einem Satz, was los
  ist, und hat – wo möglich – einen Knopf, der es behebt. (#328)
- **Song merken:** „💾 Merken“ im Panel schickt den Song als Karte per
  Direktnachricht, mit Links zu Spotify, Apple Music, YouTube Music und
  Deezer. `/merkliste` zeigt die letzten 50 Songs; einzeln oder alle
  löschbar. (#331)
- **Sleep-Timer:** `/sleep` schaltet das Radio nach 15 Minuten bis 2 Stunden
  leise aus. Eine Minute vorher kommt ein Hinweis mit „+30 min“; der Timer
  übersteht einen Neustart. (#335)
- **Favoriten-Leiste:** Bis zu fünf Lieblingssender als Knöpfe im Panel
  (Free drei). Gepflegt mit ⭐ im Sender-Browser oder im Dashboard. (#336)
- **Sprachkanal-Status nach Wunsch:** Den Text oben im Sprachkanal legt jeder
  Server im Dashboard selbst fest, mit Platzhaltern für Sender, Titel,
  Interpret und Hörer und einer Vorschau. (#332)
- **Neuer Wochenrückblick:** Hörzeit, meiste Hörer gleichzeitig, Spitzenzeit
  und Top-Sender mit Logo, jeweils im Vergleich zur Vorwoche, dazu die Songs,
  die am öftesten liefen. Wahlweise fürs Team oder öffentlich. (#333)
- **Test-Instanz:** Neben dem Live-Betrieb lässt sich eine zweite Instanz zum
  Ausprobieren einrichten. (#319)

### Behoben

- Der Wochenrückblick zählte „die letzten 7 Tage mit Daten“ statt der
  letzten Woche und kam im geteilten Betrieb noch im alten Aussehen. (#333)
- Fünf Sender spielten gar nicht oder etwas anderes (einer war ein
  Polizeifunk); sie haben jetzt die richtigen Streams. (#326)
- Seltener Fehler beim Speichern der Senderliste unter Windows. (#334)

## 3.1.0 – 2026-09-25

Die große Stabilitätsrunde: Wiedergabe, Betrieb und Werkzeuge, umgesetzt in
den Milestones M1 bis M7.

### Neu

- **Zurück zum Wunschsender:** Nach einem Failover prüft der Bot den
  eigentlichen Sender regelmäßig und wechselt zurück, sobald er wieder stabil
  läuft. Früher blieb er für immer auf dem Ersatzsender. (#221)
- **Failover sichtbar:** Dashboard und Owner-Konsole zeigen Server auf
  Ersatzsendern, stummgeschaltete und pausierte Server. Hörer können mit einem
  Knopf zurückwechseln. Die Owner-Konsole zeigt den Failover-Verlauf. (#233, #240, #241)
- **Recovery-Werte einstellbar:** Alle Schwellen für Neustart, Failover und
  Rückkehr lassen sich in der Owner-Konsole ändern. (#241)
- **Wiedergabe-Phasen:** Der Bot benennt, wo die Wiedergabe gerade steht
  (verbindet, spielt, erholt sich, geparkt …), zeigt den Verlauf in `/diag`
  und meldet Übergänge, die nicht vorkommen dürften. (#255)
- **Dashboard aus einem Guss:** Dashboard und Login laufen über dieselben
  Module wie der Bot. Doppelte Logik zwischen zwei Servern entfällt. (#242)
- **Nächtliches Backup:** Jede Nacht werden Datenbank und Laufzeitdaten
  gesichert, alte Stände ausgedünnt (14 Tage, 8 Wochen, 6 Monate), auf Wunsch
  auf einen zweiten Rechner kopiert und alle vier Wochen testweise
  wiederhergestellt. (#314)
- **Betreiber-Alarme:** Ein Discord-Webhook meldet Worker ohne Lebenszeichen,
  erschöpfte Failover-Ketten, Wiedergabe im Kreis, Autoheal-Neustarts,
  wenig Speicherplatz, fehlgeschlagene Backups und das Ergebnis jedes
  Updates. Einstellbar in der Owner-Konsole, mit Testalarm. (#315, #317)
- **Versionen und Rückweg:** Diese Datei, Versionsnummern mit Tags, die
  Version in `/api/health` und in der Owner-Konsole und
  `./update.sh --rollback` zurück auf den Stand vor dem letzten Update. (#261)

### Verbessert

- **Website 15 MB → 2,4 MB:** Bilder in der Größe, in der sie angezeigt
  werden. Die Seite lädt auf dem Handy deutlich schneller. (#313)
- **Senderwechsel ohne Lücke** und nur noch ein Neustart pro Wechsel. (#221)
- **Weniger Last:** Server auf demselben Sender teilen sich eine
  Titel-Abfrage, Health-Daten werden seltener geschrieben, Befehle nur in
  Server geschrieben, deren Befehlsliste sich geändert hat. (#224, #235, #246)
- **Schnellere Worker-Befehle:** Neue Befehle erreichen die Worker sofort
  statt beim nächsten Abfragen. (#239)
- **Aufgeräumter Code:** Bot, Befehle und FastAPI in überschaubare Module
  zerlegt, keine Backend-Datei über 800 Zeilen. (#248, #249, #250, #252, #256)
- **Betrieb mit systemd:** Jeder Teil läuft als eigener Dienst mit
  Neustart bei Absturz und wartet beim Hochfahren auf MongoDB. (#225)

### Behoben

- Der Bot sprang dauerhaft auf „Groove Salad“ und kam nie zurück. (#221)
- Nicht erreichbare Sprachkanäle werden geparkt statt vergessen; Sender, die
  aus dem Tarif fallen, werden ersetzt. (#222)
- Failover nur noch bei echtem Tonausfall, nicht bei kurzen Aussetzern. (#224)
- Kaputte Umlaute (doppelt kodiertes UTF-8) repariert. (#231)
- Knöpfe am Now-Playing-Panel beachten die `/perm`-Rechte. (#234)
- Ein kurz unlesbarer Dashboard-Speicher wird nie mehr überschrieben. (#243)
- Laufzeitdateien liegen in `runtime-data/` und sind damit im Backup. (#244)
- Das Update-Backup bricht nicht mehr ab, wenn der Bot währenddessen
  schreibt. (#254)
- Die Website sendet Sicherheits-Header (CSP, HSTS …), `/favicon.ico` ist ein
  echtes Icon, fehlende Dateien liefern 404 statt der Startseite. (#311, #312)

### Intern

- Lokaler Prüflauf mit 29 Schritten: Unit-Tests gegen echte MongoDB,
  Vertragstests, ESLint und TypeScript, Semgrep-Sicherheitsanalyse, Live-Test
  von omnifm.xyz, Bildgrößen. (#182, #230, #236, #237, #238, #251, #310, #313)
- React 19, gebündelte Abhängigkeits-Updates, eine einzige
  Voice-Verschlüsselung. (#218, #220, #245, #247)
