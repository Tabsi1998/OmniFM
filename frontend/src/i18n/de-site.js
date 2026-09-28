// OmniFM website texts, German: the website: navigation, start page sections, stations, commands, FAQ (#296).
// Put together in ../i18n.js; one file per language and part keeps each readable.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Ablauf', href: '#features' },
      { key: 'why', label: 'Warum', href: '#why-omnifm' },
      { key: 'stations', label: 'Stationen', page: 'stations' },
      { key: 'pricing', label: 'Preise', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Discord Community',
  },
  cookieConsent: {
    title: 'Cookies und Statistik',
    short: 'Wir speichern nur, was die Seite braucht (Sprache, Anmeldung). Google Analytics setzt erst Cookies, wenn du zustimmst.',
    privacyLink: 'Datenschutz',
    necessaryTitle: 'Notwendig',
    necessaryBody: 'Für die Sprache, die sichere Anmeldung im Dashboard und damit die Seite funktioniert. Lässt sich nicht abschalten.',
    analyticsTitle: 'Statistik (Google Analytics)',
    analyticsBody: 'Zählt grob, welche Seiten besucht werden, damit wir die Seite verbessern können. Ohne deine Zustimmung setzt Google Analytics keine Cookies.',
    acceptAll: 'Alle akzeptieren',
    reject: 'Ablehnen',
    settings: 'Einstellungen',
    save: 'Auswahl speichern',
    manage: 'Cookie-Einstellungen',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Dein Discord',
    titleAccent: 'Radio.',
    titleTail: '24/7 Live.',
    subtitleLead: 'Radio rund um die Uhr in deinem Discord-Sprachkanal: Sender aus allen Genres, ein Dashboard zum Steuern, und reißt ein Stream ab, verbindet sich OmniFM von selbst neu. Lade zuerst den Commander ein, füge dann einen Worker hinzu und führe',
    subtitleTail: 'aus.',
    ctaInvite: 'Commander einladen',
    ctaFlow: 'Wie es funktioniert',
  },
  trustBar: {
    live: 'Live-Zahlen',
    items: {
      servers: { label: 'Server', detail: 'nutzen OmniFM' },
      stations: { label: 'Sender', detail: 'zum Reinhören, auch hier' },
      bots: { label: 'Bots', detail: 'bereit zum Spielen' },
      listeners: { label: 'Hören gerade zu', detail: 'auf allen Servern' },
    },
  },
  whyOmniFM: {
    eyebrow: 'Warum OmniFM',
    title: 'Mehr als ein Radio-Bot',
    subtitle: 'Musik, die zuverlässig läuft, und alles, was du brauchst, um deinen Server zu verwalten.',
    cards: {
      radio: {
        label: 'Radio',
        title: 'Sofort startklar',
        desc: 'Commander einladen, Worker hinzufügen, /play ausführen und direkt Radio hören. Kein schweres Setup, bevor der erste Nutzen sichtbar wird.',
      },
      workers: {
        label: 'Worker',
        title: 'Mehr als ein einzelner Bot',
        desc: 'Mehrere Bots teilen sich die Arbeit: Jeder Worker spielt in einem eigenen Sprachkanal. So laufen auf großen Servern mehrere Sender gleichzeitig.',
      },
      control: {
        label: 'Steuerung',
        title: 'Steuerung für Admins',
        desc: 'Im Dashboard siehst du, was wo läuft, stellst die Sprache ein und planst Events. Ab Pro kommen Live-Ansicht, Statistik, Rollenrechte und Ausfall-Meldungen dazu.',
      },
      growth: {
        label: 'Wachstum',
        title: 'Wachstum ohne Bruch',
        desc: 'Free, Pro und Ultimate bauen aufeinander auf: Beim Wechsel nach oben bleibt alles eingerichtet, es kommt nur etwas dazu.',
      },
    },
  },
  stations: {
    eyebrow: 'Live-Senderverzeichnis',
    title: 'OmniFM Stationen',
    summary: ({ count, free, pro, ultimate }) => `${count} Stationen (${free} Free, ${pro} Pro, ${ultimate} Ultimate). Klicke zum Vorhören oder nutze /play im Discord.`,
    nowPlaying: 'Vorschau läuft',
    searchPlaceholder: 'Station suchen...',
    filters: {
      all: 'Alle',
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
    filterSummary: ({ count, free, pro, ultimate }) => `${count} Stationen (${free} Free, ${pro} Pro, ${ultimate} Ultimate)`,
    loading: 'Lade Stationen...',
    empty: 'Keine Stationen gefunden.',
    loadMore: ({ remaining }) => `Mehr anzeigen (${remaining} verbleibend)`,
    visible: ({ visible, total }) => `${visible} von ${total} Stationen angezeigt`,
    previewVolume: 'Lautstärke',
    stopPreview: 'Vorschau stoppen',
    tiers: {
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Die wichtigsten Fragen vor dem Start',
    subtitle: 'Kurz beantwortet: wie du startest, was die Pläne bringen und wie OmniFM funktioniert.',
    items: [
      {
        key: 'start',
        question: 'Wie starte ich OmniFM sauber?',
        answer: 'Im Normalfall in unter einer Minute: zuerst den Commander einladen, dann mindestens einen Worker hinzufügen, danach den Voice-Channel öffnen und /play nutzen.',
      },
      {
        key: 'workerRequired',
        question: 'Brauche ich vor /play schon einen Worker?',
        answer: 'Ja. Der Commander nimmt die Befehle an, aber der eigentliche Stream läuft über einen Worker. Erst wenn ein Worker auf dem Server ist, kann /play sauber starten.',
      },
      {
        key: 'free',
        question: 'Was ist im Free-Plan enthalten?',
        answer: 'Free reicht für den Start: bis zu 2 Bots, 20 Sender und alle Befehle, die du zum Radiohören brauchst.',
      },
      {
        key: 'dashboard',
        question: 'Brauche ich das Dashboard sofort?',
        answer: 'Nein, alles geht auch in Discord. Mit Free siehst du im Dashboard, was wo läuft, wechselst oder stoppst den Sender, stellst die Sprache ein und planst ein Event. Ab Pro kommen Live-Ansicht, Statistik, Events ohne Grenze, Rollenrechte und Ausfall-Meldungen dazu.',
      },
      {
        key: 'pro',
        question: 'Wann lohnt sich Pro?',
        answer: 'Sobald du deinen Server gestalten und verwalten willst: alle Sender des Katalogs, 8 Sprachkanäle gleichzeitig, das Dashboard mit Live-Ansicht, Events ohne Grenze, Rollenrechte und Ausfall-Meldungen in Discord.',
      },
      {
        key: 'ultimate',
        question: 'Wann brauche ich Ultimate?',
        answer: 'Wenn du dein eigenes Radio betreibst: bis zu 50 eigene Sender mit Logo, ein eigenes Bot-Aussehen pro Server, eigene Ersatzsender-Ketten, Webhooks und die Detail-Statistik, dazu 16 Sprachkanäle gleichzeitig.',
      },
      {
        key: 'planStatus',
        question: 'Wie sehe ich, welchen Plan mein Server hat?',
        answer: 'Im Dashboard: mit Discord anmelden, deinen Server wählen und „Abo & Lizenz“ öffnen. Dort stehen der Plan und wie lange er läuft. In Discord zeigt es der Befehl /premium.',
        link: { label: 'Zum Dashboard', page: 'dashboard' },
      },
      {
        key: 'workers',
        question: 'Wie funktionieren Commander und Worker?',
        answer: 'Der Commander nimmt deine Befehle an; mit /invite gibt er dir die Links für die Worker. Die Worker spielen das Radio in den Sprachkanälen. So kann ein Server mehrere Sender gleichzeitig hören.',
      },
    ],
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Direkt in Discord',
    titleLead: 'Läuft im ',
    titleAccent: 'Voice-Channel',
    titleTail: ', gesteuert per Slash-Command.',
    body: 'Auf der Website hörst du nur rein – laufen tut OmniFM 24/7 direkt in deinem Discord-Sprachkanal, mit Now-Playing-Panel, Knöpfen und automatischem Wiederverbinden.',
    cmds: [
      ['/play synthwave', 'Startet den Stream im Voice-Channel'],
      ['/now', 'Zeigt Live-Titel, Cover & Hörer'],
      ['/stations', 'Durchsuche 120+ kuratierte Sender'],
    ],
    nowPlaying: 'Now Playing', genre: 'Genre', bitrate: 'Bitrate', listeners: 'Hörer',
    liveStream: 'Live-Radio-Stream', liveRadio: 'Live-Radio',
    time: 'heute um 21:14',
  },
  // How to start OmniFM in Discord (HowToDiscord.js).
  howTo: {
    eyebrow: 'How-To · in unter 60 Sekunden',
    title: 'So startest du OmniFM in Discord',
    subtitle: 'Drei Schritte, dann läuft dein Radio 24/7 direkt im Sprachkanal.',
    steps: [
      { n: '01', cmd: 'App hinzufügen', title: 'Commander einladen', desc: 'Füge den OmniFM Commander zu deinem Server hinzu. Er nimmt alle Slash-Commands entgegen und verwaltet deine Worker.' },
      { n: '02', cmd: '/invite', title: 'Worker-Bot hinzufügen', desc: 'Lade mindestens einen Worker ein. Er übernimmt den eigentlichen Voice-Stream – mehr Worker = mehr parallele Channels.' },
      { n: '03', cmd: '/play lofi', title: 'Radio starten', desc: 'Wähle eine Station und OmniFM verbindet sich in deinen Voice-Channel. Now-Playing-Embed, Buttons und Reconnect inklusive.' },
    ],
    permsTitle: 'Berechtigungen',
    perms: ['Voice beitreten & sprechen', 'Nachrichten & Embeds senden', 'Slash-Commands nutzen'],
    addServer: 'Zum Server hinzufügen',
    workerHint: 'Worker bereit',
    invite: 'Einladen',
    connected: 'verbunden',
    nowPlaying: 'Now Playing',
  },
};

export default messages;
