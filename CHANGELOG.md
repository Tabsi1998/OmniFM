# Changelog

Alle Versionen von OmniFM. Neue Versionen stehen oben. Die Versionsnummer
folgt [SemVer](https://semver.org/lang/de/): Die erste Zahl steigt bei
Änderungen, die bestehende Einrichtungen brechen können, die zweite bei neuen
Funktionen, die dritte bei reinen Fehlerbehebungen. Wie ein Release entsteht,
steht in `scripts/release.mjs`.

## 3.9.0 – 2026-09-28

Neu: Sender-Vorschläge aus der Community und eine Live-Ansicht im Dashboard.
Außerdem hebt OmniFM ab jetzt Monatswerte für den Jahresrückblick im Dezember
auf.

### Neu

- **Sender vorschlagen (`/sender-vorschlagen`):** Jeder kann einen Sender für
  den Katalog vorschlagen. Der Stream wird sofort getestet; ein toter Link wird
  gar nicht erst gespeichert. Was schon im Katalog steht oder schon
  vorgeschlagen wurde, erkennt OmniFM an der Stream-Adresse, auch wenn sie
  anders geschrieben ist. Pro Person sind höchstens 3 Vorschläge gleichzeitig
  offen. Der Commander prüft jeden offenen Stream stündlich.
  In der Owner-Konsole unter „Sender › Vorschläge“ siehst du die Warteschlange
  mit der Erreichbarkeit der letzten 24 Stunden. „Annehmen“ nimmt den Sender
  über dieselben Prüfungen wie das Sender-Formular in den Katalog, „Ablehnen“
  geht mit Begründung. Wer den Sender vorgeschlagen hat, bekommt die
  Entscheidung einmal per DM. Die Owner-Konsole zeigt nur den Namen, nie die
  Discord-ID; `/meine-daten` zeigt die eigenen Vorschläge und löscht einen
  daraus. (#303, #411)
- **Live-Ansicht im Dashboard (Pro und Ultimate):** zeigt für einen Server,
  was jeder Bot in den letzten 24 Stunden gespielt hat, mit Aussetzern und
  Wiederverbindungen. Ein hängender Bot lässt sich dort neu starten oder neu
  mit dem Sprachkanal verbinden. (#304, #409)
- **Monatswerte für den Jahresrückblick:** MongoDB löscht Hör-Sitzungen nach
  180 Tagen und gezählte Songs nach 21 Tagen; im Dezember fehlte sonst das
  halbe Jahr. Deshalb hebt OmniFM jetzt pro Server und Monat auf:
  - wie lange zugehört wurde,
  - die meistgehörten Sender und Genres,
  - die meistgespielten Songs,
  - zu welchen Uhrzeiten gehört wurde,
  - die längste Hör-Sitzung.

  Personen stehen darin nicht. Die Monatswerte werden 400 Tage nach
  Monatsende gelöscht, und gezählte Songs bleiben jetzt 45 statt 21 Tage. Die
  Rückblick-Karten in Discord kommen mit dem nächsten Teil. Die
  Datenschutzerklärung ist ergänzt. (#301, #412)

### Intern

- 6.500 Zeilen Frontend entfernt, die die Website nie geladen hat. (#410)

### Nach dem Update

- `/sender-vorschlagen` meldet sich beim Start bei Discord an; bis der Befehl
  überall in der Befehlsliste steht, kann es ein paar Minuten dauern.
- Drei Minuten nach dem Start zählt der Commander die Monate ab April nach
  (Logzeile „[Jahresrückblick] Monate nachgezählt: …“). Je früher das Update
  läuft, desto mehr vom April ist noch da.

## 3.8.0 – 2026-09-28

Neu: eine öffentliche Statusseite, die OmniFM-Charts und OmniFM als App.
Dazu zwei Fehler behoben, die still Daten betrafen.

### Neu

- **Statusseite (omnifm.xyz/status):** zeigt, ob OmniFM selbst läuft: jeder
  Bot mit seiner Verfügbarkeit über 90 Tage, aktuelle Störungen, geplante
  Wartungen und die Vorfälle der letzten 14 Tage. Servernamen und Hörerzahlen
  einzelner Server stehen dort nie. Gemessen wird jede Minute; ein Ausfall
  unter 2 Minuten (ein Neustart) ist keine Störung. Störungen mit Erklärung und
  geplante Wartungen trägst du in der Owner-Konsole unter „Bots & Discord ›
  Statusseite“ ein. `/status` im Bot hat einen Knopf zur Statusseite. (#299,
  #396)
- **OmniFM-Charts (omnifm.xyz/charts):** oben die meistgehörten Sender der
  letzten Woche (nach Hörstunden, also wie lange Menschen zugehört haben),
  darunter die meistgespielten Songs, gezählt über alle Server. Hinein kommt
  nur, was auf mindestens 3 Servern lief, bei den Sendern nur Sender aus dem
  OmniFM-Katalog mit mindestens einer Hörstunde; so lässt sich kein einzelner
  Server erkennen. Jeder Sender
  lässt sich auf der Seite direkt anhören. Auf Wunsch postet der Commander die
  Charts jeden Montag ab 10 Uhr in einen Kanal deiner Wahl: Owner-Konsole ›
  „Bots & Discord › OmniFM-Charts“. (#300, #401)
- **OmniFM als App:** auf dem Handy „Zum Startbildschirm hinzufügen“, am
  Rechner das Installieren-Symbol in der Adressleiste. Die App öffnet direkt
  das Dashboard. (#305, #406)

### Behoben

- **Sender-CLI (`npm run stations`):** Sie hat Änderungen nicht abgewartet (im
  Assistenten schlug jede zweite Änderung fehl) und nie mit MongoDB
  gesprochen: In Produktion landeten Änderungen in einer Datei, die weder der
  Bot noch die Owner-Konsole liest, obwohl „hinzugefuegt“ dastand. Jetzt
  speichert sie dort, wo Bot und Owner-Konsole lesen. (#298, #399)
- **Hör-Sitzungen wurden nie gelöscht:** Die Löschung nach 180 Tagen griff
  nicht, weil Start und Ende als Text gespeichert waren. Neue Sitzungen haben
  jetzt Datumswerte, ältere werden beim Start einmal umgewandelt. Die Summen
  der Statistik bleiben, sie liegen getrennt. (#407)

### Intern

- Frontend aufgeteilt: Die Startseite lädt nur, was sie zeigt; Dashboard,
  Owner-Konsole und Diagramme kommen erst auf ihren Seiten. Keine Datei im
  Frontend hat mehr als 800 Zeilen. (#296, #394, #395)
- ESLint: kein Befund mehr im ganzen Projekt, und ein neuer lässt sich nicht
  mehr in die Liste aufnehmen. (#297, #397, #400)
- Typprüfung erweitert um die Discord-Oberfläche, Premium, die Stores und die
  Sender-CLI. Dabei gefunden: Der Discord-Shop übergab einen Zeitpunkt, den die
  Ablaufprüfung ignorierte; live ohne Wirkung, jetzt richtig. (#298, #398,
  #399)
- Dependabot schlägt keine Node-Typen für eine neuere Node-Version mehr vor;
  der Bot läuft auf Node 22. (#403)

### Nach dem Update

- Beim ersten Start wandelt der Bot die alten Hör-Sitzungen um (Logzeile
  „Listening-Sessions: … umgewandelt“). Danach löscht MongoDB Sitzungen, die
  älter als 180 Tage sind.
- Die Statusseite füllt ihre Balken ab dem Update-Tag; ältere Tage zeigen
  „keine Messung“.

## 3.7.0 – 2026-09-27

Auf der Website wird nichts mehr verkauft: Stripe ist raus, Premium kommt
direkt in Discord. Bis Discord verkaufen darf, gibt es Premium über
Lizenzen und Gratis-Codes aus der Owner-Konsole und den Testmonat.

### Neu

- **Premium in Discord (vorbereitet):** In der Owner-Konsole unter
  „Server & Lizenzen › Premium in Discord“ gibt es einen Schalter und die
  SKU-IDs für Pro und Ultimate. Ist er an, wird ein Kauf in Discord sofort
  zur Lizenz des Servers; Verlängerung, Kündigung und Rückerstattung ändern
  sie mit, und eine Lizenz von vorher kommt nach dem Abo zurück, solange sie
  gilt. `/premium` zeigt dann Discords Kaufknöpfe, die Website verlinkt auf
  die Store-Seite. Eingeschaltet wird erst, wenn Discord die App freigibt
  (ab 75 Servern). (#320, #393)

### Geändert

- **Kein Kauf mehr über Stripe:** Auf der Website und im Server-Dashboard
  heißt der Knopf jetzt „Code einlösen“. Gratis-Codes und der Pro-Testmonat
  funktionieren wie bisher; ein Kaufversuch bekommt die Antwort, dass
  Premium bald direkt in Discord kommt. Stripe hat nur Einmalzahlungen
  abgewickelt, es verlängert sich also nichts automatisch, und laufende
  Lizenzen gelten bis zu ihrem Ende. (#321, #391)
- **Owner-Konsole:** Die Seite „Zahlungen“ ist weg (Stripe-Schlüssel und
  der PayPal-Platzhalter). Die Einstellungen für den Discord-Shop kommen mit
  #320. Die Rolle „Abrechnung“ darf weiter Pläne und Preise ändern. (#391)
- **Datenschutz und AGB:** sagen jetzt in einfachen Worten, dass auf der
  Website nichts verkauft wird und Discord künftig der Verkäufer ist, der
  Zahlung und Steuern abwickelt. (#391)

### Behoben

- **Zugänge in der Owner-Konsole:** Eingetragene Discord-Konten wurden
  gespeichert, die Seite zeigte nach dem Neuladen aber 0 an. Wer dann noch
  einmal speicherte, löschte sie wirklich. Die Seite zeigt sie jetzt an.
  Falls Konten verloren gegangen sind: einmal neu eintragen. (#390)

### Intern

- Keine Datei in `src/` hat mehr als 800 Zeilen; zwölf große Dateien sind
  nach Themen aufgeteilt, ein Test hält die Grenze fest. Dabei sind 34
  alte ESLint-Hinweise weggefallen. (#295, #389)
- Der lokale Check nutzt für die Website eigene Ports und stört sich nicht
  mehr mit den Checks anderer Projekte auf demselben Rechner. (#393)

### Nach dem Update

- Die Stripe-Schlüssel liegen noch in der Datenbank, werden aber nicht mehr
  gelesen. Bitte im Stripe-Dashboard widerrufen.

## 3.6.0 – 2026-09-27

Datenschutz zum Selbstbedienen: Jede Person sieht, was OmniFM über sie
speichert, bekommt es als Datei und kann es selbst löschen. Serverdaten
werden 30 Tage nach dem Entfernen des Bots gelöscht.

### Neu

- **`/meine-daten`** (englisch `/mydata`): zeigt privat, was OmniFM über dich
  gespeichert hat: Merkliste, Votes, Dashboard-Anmeldungen, Umfragen und
  Events, die du gestartet hast, und deine Änderungen im Dashboard.
  „Als Datei schicken“ schickt alles per Direktnachricht. „Alles löschen“
  löscht Merkliste, Votes und Anmeldungen sofort; bei Umfragen, Events und
  Dashboard-Änderungen bleibt der Eintrag für den Server, dein Name wird
  entfernt. Premium-Käufe sind ausgenommen, die müssen wir aus steuerlichen
  Gründen aufbewahren. Der Befehl ist immer erlaubt, auch ohne Rechte in
  `/perm`. (#285, #386)
- **Serverdaten nach dem Entfernen:** Wird OmniFM von einem Server entfernt,
  bekommt der Server-Owner eine Direktnachricht mit dem Datum. 30 Tage später
  löschen wir Einstellungen, eigene Sender, Events, Statistiken und den
  Song-Verlauf des Servers. Wird OmniFM vorher wieder eingeladen, bleibt
  alles. Premium-Lizenzen bleiben immer erhalten. Die Owner-Konsole zeigt
  unter „Server & Lizenzen › Übersicht“, welcher Server wann gelöscht wird.
  (#285, #387)

### Geändert

- Verlässt ein Bot einen Server, vergisst er ihn ganz, auch die Lautstärke.
  Wird er wieder eingeladen, startet er mit der Standard-Lautstärke. (#387)
- Die Datenschutzerklärung erklärt beides in einfachen Worten. (#386, #387)

### Intern

- Die Node-API ist in Module aufgeteilt; keine Datei in `src/api` hat mehr
  als 800 Zeilen, ein Test hält das fest. Dabei sind 16 alte
  ESLint-Hinweise weggefallen. (#293, #385)

## 3.5.0 – 2026-09-27

Alle Daten liegen in Produktion nur noch in MongoDB. Vorher schrieben viele
Teile zusätzlich eine JSON-Datei in `runtime-data/`, und Bot, Website und
Konsole konnten dadurch verschiedene Stände sehen.

### Geändert

- **Nur noch MongoDB in Produktion:** Gutscheine, Bot-Listen und Votes,
  Dashboard-Logins, Server-Sprachen, das Owner-Protokoll, der Bot-Zustand
  und der Song-Verlauf liegen jetzt in MongoDB. Premium, Hörstatistik,
  Störungen und Sender schreiben in Produktion keine Datei mehr. Ohne
  MongoDB startet Produktion nicht, mit einer klaren Meldung, statt still
  auf Dateien auszuweichen. Für Entwicklung und Tests bleiben die Dateien
  (`OMNIFM_ALLOW_FILE_STORES=1`). (#292; #379, #380, #381, #382)
- **Einmaliger Import:** Beim ersten Start nach dem Update werden die alten
  Dateien einmal nach MongoDB übernommen. Im Log steht je Bereich, wie viel
  übernommen wurde. Die Dateien bleiben liegen, nichts wird gelöscht. (#382)
- **Dashboard-Logins:** Die Anmelde-Tokens liegen nicht mehr im Klartext in
  der Datenbank, sondern nur als Prüfwert (Hash). Laufende Anmeldungen
  werden mit übernommen, niemand muss sich neu anmelden. (#381)
- **Sprache sofort überall:** Eine mit `/language` geänderte Sprache gilt
  nach spätestens 10 Sekunden auch für die anderen Bots, nicht erst nach
  einem Neustart. (#381)
- **`/history`** zeigt auch Songs von Servern, die ein anderer Bot abspielt.
  (#382)
- **Start ohne systemd:** `start.sh` startet API und Bot auch ohne systemd
  als Produktion, genau wie die systemd-Dienste. (#382)

### Intern

- Die Listen der bekannten Sicherheitslücken, Lizenz-Ausnahmen und
  ShellCheck-Hinweise sind leer. Jeder neue Fund schlägt sofort an. Drei
  Werkzeuge, die nur beim Entwickeln und Bauen laufen und nie ausgeliefert
  werden, stehen einzeln mit Begründung als Ausnahme drin. (#286, #383)
- Ein Test prüft mit Produktions-Einstellungen gegen eine echte MongoDB,
  dass kein Bereich mehr eine Datei schreibt. (#382)

## 3.4.1 – 2026-09-27

Zwei Fehler im Server-Dashboard behoben, die schon länger live waren.

### Behoben

- **Im Dashboard ließ sich nichts speichern:** Eigene Sender, Rollenrechte,
  Events und Abmelden scheiterten seit dem 24.09. mit „CSRF-Kopf fehlt“. Das
  Dashboard schickt ihn jetzt bei jeder Änderung mit. (#374, #376)
- **Dashboard-Einstellungen wieder da:** Panel-Designer, Bot-Aussehen,
  Wochenrückblick, Failover-Kette, Voice Guard, Exporte und Webhooks waren
  seit dem 25.08. nicht erreichbar. Sie stehen jetzt im Bereich
  „Einstellungen“ des Server-Dashboards. (#375, #377)
- Im deutschen Impressum fehlte die Überschrift, wenn Pflichtangaben fehlen.
  (#377)

### Intern

- Frontend-Tests im lokalen Check: Übersetzungen, Owner-Anmeldung, jeder
  Bereich des Server-Dashboards, ein Rundgang über die gebaute Website in
  Chromium und Lighthouse für die Startseite. So fallen solche Fehler vor
  dem Release auf. (#294, #377)

## 3.4.0 – 2026-09-27

Ein Backend statt zwei: Die Website, die Owner-Konsole, Premium und die
Webhooks beantwortet jetzt die Node-API, dieselbe Technik wie der Bot.
FastAPI bleibt zwei Wochen als Rückweg da. Dazu meldet sich der Owner mit
Discord an, mit Rollen für Helfer, und der Checkout bucht den Preis, der in
der Konsole steht.

### Neu

- **Owner-Anmeldung über Discord:** „Mit Discord anmelden“ auf der
  Login-Seite der Owner-Konsole. Unter Einstellungen › Zugänge stehen die
  Discord-Konten mit ihrer Rolle: Owner (alles), Support (alles sehen und
  prüfen, nichts ändern) und Abrechnung (Lizenzen, Zahlungen, Preise). Das
  Audit zeigt, wer etwas getan hat. Der Owner-Token bleibt für Skripte und
  lässt sich abschalten, sobald ein Discord-Konto Owner ist. (#372)
- **Sender in der Konsole ohne Neustart:** Neue oder geänderte Sender sind
  sofort im Bot, nicht erst nach einem Neustart. (#368)

### Geändert

- **Ein öffentlicher Eingang:** Port 8001 beantwortet die Node-API. Das
  Dashboard, der Discord-Login und das Cockpit laufen weiter im Bot; startet
  der Bot neu, laufen Website und Owner-Konsole weiter. Rückweg auf FastAPI:
  `OMNIFM_PUBLIC_BACKEND=fastapi` in `backend/.env`, dann `./update.sh`.
  (#365, #366, #367, #368, #369, #371)
- **Preise:** Der Checkout bucht den Monatspreis aus Einstellungen › Pläne &
  Preise. Vorher zeigte die Website den Konsolen-Preis, Stripe buchte aber
  den eingebauten. Solange dort die Standardpreise stehen, ändert sich für
  Kunden nichts. Stripe-Schlüssel und Webhook-Secret kommen jetzt aus der
  Konsole. (#370)
- **Impressum, Datenschutz, Nutzungsbedingungen** kommen aus Einstellungen ›
  Firma & Recht; Angaben aus `backend/.env` gelten weiter, wo die Konsole
  leer ist. Als Website steht dort nie mehr eine Heimnetz-Adresse. (#368)
- **Die alte Node-Adminseite ist weg** (Anmeldung per Cookie oder `?token=`
  in der Adresse, `.env`-Editor, Skripte starten). Die Owner-Konsole ist die
  einzige Stelle. (#369)

### Behoben

- **Erster Start auf einem neuen Server:** `start.sh` brach ab, weil die
  Prüfung von FastAPI ihre Einstellungen nicht fand, und MongoDB startete
  nicht, wo `systemctl` ohne laufendes systemd vorhanden ist (Container,
  WSL). (#371)
- **Doppelte Stripe-Webhooks:** Ein Test belegt jetzt, dass eine doppelt oder
  gleichzeitig zugestellte Zahlung genau eine Lizenz ergibt. (#370)

## 3.3.0 – 2026-09-25

Werkzeuge für Server-Teams und ein neuer Arbeitsplatz für den Betrieb:
Formulare, Umfragen, Share-Karten, eigenes Aussehen für Bot und Panel, und
eine Owner-Konsole, die selbst prüft, ob alles läuft. Dazu wichtige
Korrekturen am Discord-Login, an Stage-Events und an der Sprache.

### Neu

- **Umfrage:** `/umfrage` (`/poll`) lässt den Server abstimmen, welcher Sender als
  Nächstes läuft. (#338)
- **Formulare in Discord:** Eigenen Sender hinzufügen, Event planen und
  Problem melden gehen per Formular statt langer Befehle. Ein neuer Sender
  wird vor dem Speichern getestet; beim Sender geht jetzt auch ein Logo mit.
  (#341, #351)
- **Teilen:** „Teilen“ im Panel postet eine Karte mit Cover, Sender und
  Farbe. Links zu OmniFM zeigen in Discord eine Vorschau. (#342)
- **Eigenes Bot-Aussehen (Ultimate):** Avatar, Banner und Bio pro Worker,
  nur auf dem eigenen Server. (#343)
- **Panel-Designer (ab Pro):** Im Dashboard festlegen, welche Knöpfe das
  Panel zeigt, eine eigene Akzentfarbe und ob „Zuletzt“ erscheint. Die
  Vorschau daneben ist das echte Panel. (#352)
- **Owner-Cockpit:** Alle 5 Minuten prüft OmniFM selbst, ob Discord-Login,
  Website, Zahlungen, E-Mail, Song-Erkennung, Bots, Bot-Listen und Sender
  wirklich funktionieren – nicht nur, ob etwas eingetragen ist. Wird etwas
  rot, kommt ein Alarm in den Betreiber-Kanal. (#357)
- **Neues Owner-Menü:** Sechs Bereiche statt fünfzehn Reiter, jede
  Einstellung an genau einer Stelle, eine Suche über alle Einstellungen und
  ein Hinweis auf ungespeicherte Änderungen. (#363)

### Geändert

- **Sprache:** Die Sprache des Discord-Servers entscheidet: deutscher Server
  Deutsch, sonst Englisch. `/language` legt sie weiterhin fest. (#347)
- **Senderkatalog:** Sender heißen jetzt nach dem, was sie spielen (zum
  Beispiel „Dance Radio“ statt „Techno Radio“), und kein Stream läuft mehr
  doppelt. Sendet ein Stream plötzlich einen anderen Namen, zeigt das
  Cockpit es an. (#362)

### Behoben

- **Discord-Login:** In der Owner-Konsole ließ sich das Secret nicht mehr
  eintippen; der Login schickte zu `localhost`, und „Mit Discord anmelden“
  im Server-Dashboard zeigte nur Text. Die Weiterleitungsadresse bildet
  OmniFM jetzt selbst aus der öffentlichen Adresse. Share-Links und
  Dashboard-Knöpfe zeigen nicht mehr auf eine Heimnetz-Adresse.
  (#344, #350, #354)
- **Stage-Events:** Events lassen sich in Stage-Kanälen planen. OmniFM
  prüft, ob der Bot dort Stage-Moderator ist, eröffnet die Stage und
  beendet sie am Ende wieder. (#348, #359)
- Die Suche im Sender-Browser kam nicht an. (#339)

### Betrieb

- Der lokale Check ist die Prüfung vor jedem Merge; die GitHub-Workflows
  laufen nur noch auf Knopfdruck. Neu im Check: der Opus-Codec unter Linux
  wie auf dem Server und die Vertragstests gegen die Node-API. (#360, #361)

### Hinweis zum Update

- Für Events in Stage-Kanälen muss ein Bot im Stage-Kanal Stage-Moderator
  sein: Stage-Kanal bearbeiten → Berechtigungen → Stage-Moderatoren → Bot
  hinzufügen.

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
