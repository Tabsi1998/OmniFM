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
    title: 'Cookies und Analytics',
    body: 'OmniFM nutzt notwendige Speicherungen für Sprache, Sicherheit und Dashboard-Sitzungen. Das Google-Tag ist mit Consent Mode aktiv; Analytics-Speicherung wird erst erlaubt, wenn du Analytics zustimmst.',
    necessaryTitle: 'Notwendig',
    necessaryBody: 'Erforderlich für Spracheinstellungen, sichere Dashboard-Sitzungen und den technischen Betrieb. Diese Kategorie kann nicht deaktiviert werden.',
    analyticsTitle: 'Analytics',
    analyticsBody: 'Erlaubt Google Analytics 4 mit Consent Mode, um Seitenaufrufe und Nutzung grob auszuwerten. Ohne Einwilligung bleibt Analytics-Speicherung auf denied.',
    acceptAll: 'Alle akzeptieren',
    reject: 'Ablehnen',
    save: 'Auswahl speichern',
    manage: 'Cookie-Einstellungen',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Dein Discord',
    titleAccent: 'Radio.',
    titleTail: '24/7 Live.',
    subtitleLead: '24/7 Discord-Radio mit 120+ Stationen, stabiler Worker-Architektur, Dashboard-Kontrolle und sauberem Reconnect. Lade zuerst den Commander ein, füge dann einen Worker hinzu und führe',
    subtitleTail: 'aus.',
    ctaInvite: 'Commander einladen',
    ctaFlow: 'Wie es funktioniert',
    stats: {
      servers: 'Server',
      stations: 'Stationen',
      bots: 'Bots',
    },
  },
  trustBar: {
    items: {
      stations: {
        label: 'Stationen',
        detail: 'Live-Katalog für Free und Pro, direkt auf der Website vorhörbar.',
      },
      network: {
        label: 'Live-Aktivität',
        detail: 'Aktive Streams und ein bereitstehendes Bot-Netzwerk zeigen, dass OmniFM im Betrieb arbeitet.',
      },
      dashboard: {
        label: 'Dashboard',
        detail: 'Live-Ansicht, Statistik, Rollenrechte und Ausfall-Meldungen ab Pro.',
      },
      reliability: {
        label: 'Zuverlässigkeit',
        detail: 'Reconnect, klare Tiers und ein sauberer Upgrade-Pfad für wachsende Server.',
      },
    },
    values: {
      dashboard: 'Free+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} Free · ${pro} Pro`,
      network: ({ bots, servers }) => `${bots} Bots · ${servers} Server`,
      dashboard: 'Events · Rollenrechte · Health',
      reliability: 'Reconnect · Worker · klare Tiers',
    },
  },
  whyOmniFM: {
    eyebrow: 'Warum OmniFM',
    title: 'Nicht nur ein Radio-Bot, sondern ein sauberes Discord-Setup',
    subtitle: 'OmniFM ist am stärksten, wenn Musik, Stabilität und Server-Verwaltung zusammenkommen.',
    cards: {
      radio: {
        label: 'Radio',
        title: 'Sofort startklar',
        desc: 'Commander einladen, Worker hinzufügen, /play ausführen und direkt Radio hören. Kein schweres Setup, bevor der erste Nutzen sichtbar wird.',
      },
      workers: {
        label: 'Worker',
        title: 'Mehr als ein einzelner Bot',
        desc: 'Die Worker-Architektur verteilt Streams sauber und macht parallele Nutzung für größere Communities planbar.',
      },
      control: {
        label: 'Steuerung',
        title: 'Steuerung für Admins',
        desc: 'Dashboard, Events, Rollenrechte und Statusansichten geben Pro-Servern echte Kontrolle statt nur mehr Sendern.',
      },
      growth: {
        label: 'Wachstum',
        title: 'Wachstum ohne Bruch',
        desc: 'Free, Pro und Ultimate bauen logisch aufeinander auf und decken von Einstieg bis Operator-Setup denselben Produktkern ab.',
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
    subtitle: 'Der Einstieg soll schnell sein, der Upgrade-Pfad klar und die Architektur verständlich bleiben.',
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
        answer: 'Free deckt den starken Einstieg ab: bis zu 2 Bots, 20 freie Stationen, Basis-Commands und den kompletten Commander- plus Worker-Startfluss.',
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
        key: 'workers',
        question: 'Wie funktionieren Commander und Worker?',
        answer: 'Der Commander nimmt Commands und Worker-Invites an. Worker führen die Streams aus. Dadurch kann OmniFM mehrere parallele Streams sauber verteilen und stabil halten.',
      },
    ],
  },
  useCases: {
    eyebrow: 'Für wen ist OmniFM?',
    title: 'Jeder Plan hat eine klare Rolle',
    subtitle: 'Nicht nur Preise: welcher Plan zu welchem Server wirklich passt.',
    cards: {
      free: {
        title: 'Free für schnelle Community-Radios',
        desc: 'Wenn du einen kleinen oder privaten Server mit 24/7 Radio versorgen willst, bringt Free den saubersten Einstieg.',
        fit: 'Ideal für kleine Communities, Freundesgruppen und den ersten Live-Einsatz ohne Administrationsaufwand.',
      },
      pro: {
        title: 'Pro für Community-Admins',
        desc: 'Sobald Events, Rollenrechte und Dashboard-Steuerung zum Alltag gehören, wird Pro zum eigentlichen Verwaltungsplan.',
        fit: 'Ideal für Event-Server, mittelgroße Communities und Teams mit klaren Rollen und wiederkehrenden Sessions.',
      },
      ultimate: {
        title: 'Ultimate für Operator-Setups',
        desc: 'Wenn Zuverlässigkeit, Custom Stations, tiefere Analytics und Automatisierung wichtig werden, ist Ultimate die richtige Stufe.',
        fit: 'Ideal für größere Communities, Power-User und Betreiber, die OmniFM als echtes System nutzen wollen.',
      },
    },
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
