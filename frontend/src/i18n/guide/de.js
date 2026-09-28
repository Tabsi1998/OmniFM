// OmniFM: the texts of the page "Erste Schritte" (/start, #434), German.
// Loaded with that page only (StartGuide.js), so the start page does not carry them.
const guide = {
  eyebrow: 'Erste Schritte',
  title: 'OmniFM in fünf Minuten einrichten',
  intro: 'Schritt für Schritt vom Einladen bis zum ersten Song, und was hilft, wenn etwas nicht klappt.',
  toc: 'Auf dieser Seite',
  steps: [
    {
      id: 'commander',
      title: '1. Commander einladen',
      body: 'Der Commander ist der Bot „OmniFM DJ“. Er nimmt deine Befehle an und kümmert sich um die Worker. Einladen kann ihn, wer auf dem Server „Server verwalten“ darf.',
      tips: ['Klick auf „Commander einladen“, wähl deinen Server und bestätige mit „Autorisieren“.', 'Die vorgeschlagenen Rechte lässt du so, wie sie sind: Ohne sie kann OmniFM nicht in Sprachkanäle.'],
    },
    {
      id: 'worker',
      title: '2. Worker hinzufügen',
      body: 'Warum zwei Bots? Der Commander hört zu, die Worker spielen. So laufen auf einem Server mehrere Sprachkanäle gleichzeitig, jeder mit seinem eigenen Stream.',
      tips: ['Schreib /invite in einen Textkanal.', 'Wähl „OmniFM 1“ und lade ihn mit dem Knopf ein.', 'Free hat 2 Worker, Pro 8 und Ultimate 16.'],
    },
    {
      id: 'play',
      title: '3. Radio starten',
      body: 'Geh in einen Sprachkanal und schreib /play. Beim Tippen schlägt Discord passende Sender vor, zum Beispiel zu „lofi“.',
      tips: ['/play lofi startet einen Lofi-Sender.', 'Ohne Sendernamen führt dich /play Schritt für Schritt durch die Auswahl.', 'OmniFM spielt rund um die Uhr weiter, bis du /stop schreibst.'],
    },
    {
      id: 'panel',
      title: '4. Panel und Favoriten',
      body: 'Zu jedem Sender zeigt OmniFM ein Panel: was gerade läuft, und Knöpfe für Pause, Stop, andere Sender und deine Lieblingssender.',
      tips: ['Lieblingssender markierst du im Sender-Browser mit dem Stern; sie erscheinen dann als Knöpfe im Panel.', '„Merken“ legt einen Song für dich zur Seite, „Teilen“ postet eine Karte in den Kanal.', '„Problem melden“ schickt uns eine Nachricht, wenn ein Sender hakt.'],
    },
    {
      id: 'dashboard',
      title: '5. Dashboard',
      body: 'Im Dashboard siehst du, was wo läuft, und stellst deinen Server ein. Du meldest dich einfach mit Discord an.',
      tips: ['Sprache: in welcher Sprache OmniFM auf deinem Server antwortet.', 'Voice Guard: was OmniFM tut, wenn ihn jemand in einen anderen Kanal verschiebt.', 'Events: Radio-Sendungen zu festen Zeiten planen.'],
    },
  ],
  inviteLabel: 'Commander einladen',
  dashboardLink: 'Zum Dashboard',
  helpTitle: 'Wenn etwas nicht klappt',
  helpIntro: 'Die häufigsten Stolpersteine, jeweils mit der Lösung.',
  help: [
    {
      key: 'join',
      question: 'Der Bot kommt nicht in den Sprachkanal',
      answer: 'Meist fehlen Rechte. Rechtsklick auf den Sprachkanal → Kanal bearbeiten → Berechtigungen: OmniFM braucht dort „Verbinden“ und „Sprechen“. Ist der Kanal voll, muss ein Platz frei sein.',
    },
    {
      key: 'silent',
      question: 'Es ist nichts zu hören',
      answer: 'Schau zuerst, ob ein Worker im Sprachkanal ist; wenn nicht, lade mit /invite einen ein. Ist er da, aber mit durchgestrichenem Mikrofon, hat ihn jemand auf dem Server stummgeschaltet: Rechtsklick auf ihn und die Stummschaltung wieder aufheben. Prüfe auch, ob du ihn bei dir selbst leise gestellt hast.',
    },
    {
      key: 'station',
      question: 'Ein Sender geht nicht',
      answer: 'Fällt ein Sender aus, spielt OmniFM automatisch einen ähnlichen und wechselt zurück, sobald er wieder läuft. Hakt ein Sender öfter, drück im Panel „Problem melden“, dann schauen wir ihn uns an.',
    },
    {
      key: 'commands',
      question: 'Die Befehle fehlen',
      answer: 'Servereinstellungen → Integrationen → OmniFM DJ: Dort müssen die Befehle für deine Rolle und den Kanal erlaubt sein. Gerade erst eingeladen? Dann kann es ein paar Minuten dauern, bis Discord die Befehle zeigt; ein Neustart von Discord hilft.',
    },
  ],
  more: 'Noch Fragen? Frag in unserer Discord-Community.',
  community: 'Zur Community',
};

export default guide;
