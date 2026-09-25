# Changelog

Alle Versionen von OmniFM. Neue Versionen stehen oben. Die Versionsnummer
folgt [SemVer](https://semver.org/lang/de/): Die erste Zahl steigt bei
Änderungen, die bestehende Einrichtungen brechen können, die zweite bei neuen
Funktionen, die dritte bei reinen Fehlerbehebungen. Wie ein Release entsteht,
steht in `scripts/release.mjs`.

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
  erschöpfte Failover-Ketten, Wiedergabe im Kreis, Autoheal-Neustarts und
  wenig Speicherplatz. Einstellbar in der Owner-Konsole, mit Testalarm. (#315)
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
