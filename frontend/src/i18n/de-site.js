// OmniFM website texts, German: the website: navigation, start page sections, stations, commands, FAQ (#296).
// Put together in ../i18n.js; one file per language and part keeps each readable.
const messages = {
  meta: {
    title: 'OmniFM | 24/7 Radio für Discord',
    description: 'OmniFM bringt 24/7 Radio-Streams, Worker-Bots und Premium-Audio auf deinen Discord-Server.',
  },
  navbar: {
    links: [
      { key: 'flow', label: 'Ablauf', href: '#features' },
      { key: 'why', label: 'Warum', href: '#why-omnifm' },
      { key: 'dashboard', label: 'Dashboard', href: '#dashboard-showcase' },
      { key: 'stations', label: 'Stationen', page: 'stations' },
      { key: 'pricing', label: 'Preise', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Discord Community',
    language: 'Sprache',
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
    ctaNote: 'Free startet über denselben sauberen Ablauf: Commander einladen, Worker hinzufügen, /play ausführen. Pro und Ultimate erweitern später genau dieses Setup mit Dashboard, Kontrolle und mehr Betriebssicherheit.',
    stats: {
      servers: 'Server',
      stations: 'Stationen',
      bots: 'Bots',
    },
    highlights: [
      { key: 'speed', label: 'Start in unter 1 Minute' },
      { key: 'catalog', label: '120+ Stationen sofort spielbar' },
      { key: 'dashboard', label: 'Dashboard ab Pro' },
    ],
    proofRail: [
      {
        key: 'free',
        label: 'Free',
        value: 'Sofort live',
        desc: '24/7 Radio mit sauberem Einstieg: Commander einladen, Worker hinzufügen, /play ausführen.',
      },
      {
        key: 'pro',
        label: 'Pro',
        value: 'Mehr Kontrolle',
        desc: 'Dashboard, Events und Rollenrechte für aktive Communities.',
      },
      {
        key: 'ultimate',
        label: 'Ultimate',
        value: 'Operator-Niveau',
        desc: 'Custom Stations, tiefere Analytics und Automatisierung im selben Produktpfad.',
      },
    ],
    panel: {
      eyebrow: 'Schneller Start',
      title: 'In unter einer Minute zum ersten Stream',
      steps: [
        {
          key: 'invite',
          title: 'Commander einladen',
          desc: 'Der Commander ist dein Einstiegspunkt und nimmt Commands sowie Worker-Invites an.',
        },
        {
          key: 'worker',
          title: 'Worker hinzufügen',
          desc: 'Füge mindestens einen Worker hinzu. Er übernimmt den Stream, sobald du /play nutzt.',
        },
        {
          key: 'play',
          title: '/play ausführen',
          desc: 'Wähle eine Station und starte direkt im Voice-Channel ohne Prefix-Setup.',
        },
      ],
      proofTitle: 'Warum das professioneller ist',
      proofItems: [
        'Slash Commands statt umständlicher Bot-Bedienung',
        'Worker entlasten parallele Streams sauber',
        'Klare Upgrade-Stufen für wachsende Communities',
      ],
    },
  },
  trustBar: {
    introEyebrow: 'Live-Proof',
    introBody: 'Diese Signale zeigen direkt auf der Startseite, dass OmniFM nicht nur gut klingt, sondern bereits als laufendes Discord-Radio-Produkt arbeitet.',
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
        detail: 'Events, Rollenrechte, Health und Server-Steuerung ab Pro.',
      },
      reliability: {
        label: 'Zuverlässigkeit',
        detail: 'Reconnect, klare Tiers und ein sauberer Upgrade-Pfad für wachsende Server.',
      },
    },
    values: {
      dashboard: 'Pro+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} Free · ${pro} Pro`,
      network: ({ bots, servers }) => `${bots} Bots · ${servers} Server`,
      dashboard: 'Events · Rollenrechte · Health',
      reliability: 'Reconnect · Worker · klare Tiers',
    },
    proofChecks: [
      'Live-Zahlen kommen aus dem Produkt statt aus statischen Werbetexten.',
      'Dashboard und Zuverlässigkeit sind bereits vor dem Pricing sichtbar eingeordnet.',
      'Free, Pro und Ultimate haben einen klaren gemeinsamen Kern statt getrennte Produktwelten.',
    ],
  },
  features: {
    eyebrow: 'So funktioniert es',
    title: 'In 3 Schritten zum Radio',
    steps: [
      {
        step: '01',
        title: 'Commander einladen',
        desc: 'Lade den OmniFM DJ auf deinen Discord-Server ein. Er nimmt Commands an und organisiert dein Setup.',
      },
      {
        step: '02',
        title: 'Worker hinzufügen',
        desc: 'Füge mindestens einen Worker hinzu. Er übernimmt den Stream, sobald du /play startest.',
      },
      {
        step: '03',
        title: '/play ausführen',
        desc: 'Wähle eine Station und starte das Radio direkt im Voice-Channel. Weitere Worker schalten bei Bedarf parallele Streams frei.',
      },
    ],
    architecture: {
      flowLabel: 'Systemablauf',
      commander: 'Commander',
      commanderDesc: 'Nimmt Commands und Worker-Invites an',
      workers: 'Worker 1-16',
      workersDesc: 'Führen die Streams aus',
      channel: 'Dein Channel',
      channelDesc: 'Radio läuft im Voice-Channel',
    },
    gridEyebrow: 'Features',
    gridTitle: 'Gebaut für Qualität',
    grid: [
      {
        title: '24/7 Streaming',
        desc: 'Nonstop Musik rund um die Uhr. Dein Server schläft nie.',
      },
      {
        title: 'Multi-Bot System',
        desc: 'Bis zu 16 Worker-Bots parallel. Jeder Stream bleibt voneinander getrennt.',
      },
      {
        title: 'Slash-Commands',
        desc: 'Kein Prefix nötig. /play, /stats und /event sind sofort einsatzbereit.',
      },
      {
        title: 'HQ Audio',
        desc: 'Opus-Transcoding mit bis zu 320k Bitrate für klare, stabile Streams.',
      },
      {
        title: 'Auto-Reconnect',
        desc: 'Fällt eine Verbindung, verbindet sich OmniFM kontrolliert und sauber neu.',
      },
      {
        title: 'Skalierbar',
        desc: 'Weitere Worker und Premium-Tiers lassen sich ohne Architekturbruch ergänzen.',
      },
    ],
  },
  whyOmniFM: {
    eyebrow: 'Warum OmniFM',
    title: 'Nicht nur ein Radio-Bot, sondern ein sauberes Discord-Setup',
    subtitle: 'OmniFM ist am stärksten, wenn Musik, Stabilität und Server-Verwaltung zusammenkommen. Genau diese Kombination muss die Website klar verkaufen.',
    comparisonEyebrow: 'Der Unterschied',
    comparisonTitle: 'Was OmniFM von einem generischen Bot trennt',
    comparisonHeaders: {
      basic: 'Typischer Bot',
      omnifm: 'OmniFM',
    },
    comparisonRows: [
      {
        label: 'Start',
        basic: 'Ein Bot wird eingeladen und spielt irgendwann Audio ab.',
        omnifm: 'Ein klarer Einstieg führt vom Commander-Invite über den Worker direkt zu einem stabilen 24/7 Radio-Setup.',
      },
      {
        label: 'Betrieb',
        basic: 'Mehr Nutzung bedeutet oft nur mehr Last auf einem einzelnen Bot.',
        omnifm: 'Commander und Worker teilen Verantwortung sauber auf und machen parallele Streams planbarer.',
      },
      {
        label: 'Wachstum',
        basic: 'Premium fühlt sich oft wie ein zweites Produkt ohne klaren Übergang an.',
        omnifm: 'Free, Pro und Ultimate erweitern denselben Kern mit Kontrolle, Analytics und Operator-Funktionen.',
      },
    ],
    cards: {
      radio: {
        title: 'Sofort startklar',
        desc: 'Commander einladen, Worker hinzufügen, /play ausführen und direkt Radio hören. Kein schweres Setup, bevor der erste Nutzen sichtbar wird.',
      },
      workers: {
        title: 'Mehr als ein einzelner Bot',
        desc: 'Die Worker-Architektur verteilt Streams sauber und macht parallele Nutzung für größere Communities planbar.',
      },
      control: {
        title: 'Steuerung für Admins',
        desc: 'Dashboard, Events, Rollenrechte und Statusansichten geben Pro-Servern echte Kontrolle statt nur mehr Sendern.',
      },
      growth: {
        title: 'Wachstum ohne Bruch',
        desc: 'Free, Pro und Ultimate bauen logisch aufeinander auf und decken von Einstieg bis Operator-Setup denselben Produktkern ab.',
      },
    },
  },
  workers: {
    eyebrow: 'Architektur',
    title: 'Commander / Worker System',
    subtitle: 'Der Commander nimmt Befehle an, Worker tragen die eigentlichen Streams. So bleibt das Setup für mehrere Channel, Events und größere Server stabil.',
    tierCards: {
      free: { name: 'Free', maxWorkers: 'Max. Worker-Bots' },
      pro: { name: 'Pro', maxWorkers: 'Max. Worker-Bots' },
      ultimate: { name: 'Ultimate', maxWorkers: 'Max. Worker-Bots' },
    },
    labels: {
      server: 'Server',
      streams: 'Streams',
      workersTotal: 'Worker gesamt',
      workersOnline: 'Worker online',
      activeStreams: 'Aktive Streams',
      commanderServers: 'Commander Server',
    },
    status: {
      online: 'Online',
      offline: 'Offline',
      commander: 'Commander',
      workerPrefix: 'Worker #',
    },
    delegated: 'Delegiert an Worker',
    empty: 'Keine Worker konfiguriert. Lege weitere Worker-Tokens in der .env an (BOT_2_TOKEN, BOT_3_TOKEN, ...).',
    loading: 'Lade Worker-Status...',
  },
  dashboardShowcase: {
    eyebrow: 'Dashboard und Betrieb',
    title: 'Pro und Ultimate bringen echte Server-Steuerung',
    subtitle: 'OmniFM ist nicht nur ein Bot zum Starten von Streams. Mit dem Dashboard wird daraus ein verwaltbares System für Events, Rechte, Health, Analytics und Automatisierung.',
    proofPanel: {
      eyebrow: 'Operations statt Bauchgefühl',
      title: 'Vom Invite zur laufenden Server-Steuerung',
      items: [
        {
          value: 'Discord SSO',
          label: 'Guild-Zugang ohne Zusatztool',
          desc: 'Admins melden sich direkt mit Discord an und landen ohne separates Setup bei ihren Servern.',
        },
        {
          value: 'Role Rules',
          label: 'Command-Kontrolle pro Server',
          desc: 'Events, Permissions und sensible Aktionen bleiben sauber an Rollen und Verantwortliche gebunden.',
        },
        {
          value: 'Health View',
          label: 'Mehr Sichtbarkeit im Betrieb',
          desc: 'Status, Weekly Digest und Upgrade-Hinweise zeigen früh, wo dein Setup stabil ist oder mehr Kontrolle braucht.',
        },
      ],
      note: 'Dashboard-Zugang startet mit Pro und geht in Ultimate ohne zweiten Workflow weiter. Dein bestehendes Bot-Setup bleibt dabei intakt.',
    },
    cards: {
      events: {
        title: 'Event-Scheduler',
        desc: 'Plane automatische Starts für wiederkehrende Sessions, Community-Abende oder feste Musik-Slots.',
      },
      permissions: {
        title: 'Rollenrechte pro Command',
        desc: 'Lege sauber fest, wer /event, /perm oder andere sensible Befehle auf deinem Server nutzen darf.',
      },
      health: {
        title: 'Health und Analytics',
        desc: 'Behalte Server-Status, Basis-Metriken und in Ultimate auch tiefere Analytics im Blick.',
      },
      automation: {
        title: 'Custom Stations und Webhooks',
        desc: 'Ultimate erweitert OmniFM für Power-User mit eigenen Stationen, Exporten und Automatisierungs-Hooks.',
      },
    },
    primaryCta: 'Dashboard ansehen',
    secondaryCta: 'Pläne vergleichen',
    ctaNote: 'Dashboard-Zugang startet mit Pro. Upgrade bedeutet mehr Kontrolle, nicht einen neuen Produktpfad.',
    tags: ['Discord SSO', 'Event-Scheduler', 'Rollenrechte', 'Health'],
    workflow: {
      eyebrow: 'Ops-Flow',
      steps: [
        {
          title: 'Server auswählen',
          desc: 'Guild aus Discord SSO wählen und direkt den aktuellen Status, Tier und die wichtigsten Steuerungen sehen.',
        },
        {
          title: 'Kontrolle aktivieren',
          desc: 'Events planen, Rollenrechte setzen und Weekly Digest oder Health ohne Bot-Chaos verwalten.',
        },
        {
          title: 'Sauber skalieren',
          desc: 'Ultimate erweitert denselben Workflow für Custom Stations, Exporte und tiefere Analytics statt eines zweiten Tools.',
        },
      ],
    },
    preview: {
      eyebrow: 'Operations Preview',
      title: 'Ein Server, sauber verwaltet',
      serverLabel: 'Server',
      serverValue: 'OmniFM Community Hub',
      status: 'aktiv',
      proofLabel: 'Warum das nach Produkt aussieht',
      proofItems: [
        'Ein Server wird nicht nur beobachtet, sondern aktiv gesteuert.',
        'Health, Digest und Recovery bleiben an derselben Stelle sichtbar.',
        'Pro und Ultimate erweitern denselben Arbeitsfluss statt ihn zu ersetzen.',
      ],
      metrics: [
        { label: 'Events', value: '4' },
        { label: 'Rollenregeln', value: '12' },
        { label: 'Health', value: 'OK' },
      ],
      rows: [
        { label: 'Weekly Digest', value: 'Aktiv' },
        { label: 'Fallback / Recovery', value: 'Bereit' },
        { label: 'Analytics-Zugang', value: 'Pro / Ultimate' },
      ],
    },
    tiers: [
      {
        key: 'pro',
        badge: 'Pro',
        title: 'Management-Layer',
        desc: 'Dashboard, Events, Rollenrechte und Health machen aus OmniFM ein administrierbares Server-Setup.',
      },
      {
        key: 'ultimate',
        badge: 'Ultimate',
        title: 'Operator-Layer',
        desc: 'Custom Stations, Exporte, Webhooks und tiefere Analytics erweitern das System ohne Bruch im Bedienfluss.',
      },
    ],
  },
  reliability: {
    eyebrow: 'Stabilitaet',
    title: 'OmniFM ist für dauerhaften Betrieb gebaut',
    subtitle: 'Die Architektur ist nicht Selbstzweck. Sie sorgt dafür, dass Streams sauber verteilt, Ausfälle kontrolliert behandelt und größere Server besser betrieben werden können.',
    cards: {
      uptime: {
        title: '24/7 statt Glueckstreffer',
        desc: 'OmniFM ist darauf ausgelegt, Voice-Channels dauerhaft mit Radio zu versorgen statt nur kurzfristig Musik zu starten.',
      },
      workers: {
        title: 'Parallel statt überladen',
        desc: 'Worker teilen die eigentliche Stream-Last auf. Das ist vor allem bei mehreren Channels oder aktiven Communitys wichtig.',
      },
      reconnect: {
        title: 'Reconnect mit Plan',
        desc: 'Wenn ein Stream oder eine Verbindung wegfaellt, reagiert OmniFM kontrolliert statt chaotisch. Hoehere Tiers verbessern diese Recovery weiter.',
      },
      visibility: {
        title: 'Status nicht im Blindflug',
        desc: 'Dashboard, Health und Analytics machen sichtbar, wie dein Setup laeuft und wo ein Upgrade echten Mehrwert bringt.',
      },
    },
    proofLabel: 'Live-Proof',
    proofBody: 'Direkt darunter zeigt OmniFM sein aktives Commander-/Worker-Setup. Die Architektur ist also nicht nur Marketing, sondern im Produktbetrieb sichtbar.',
  },
  bots: {
    eyebrow: 'Commander Bot',
    title: 'OmniFM einladen',
    subtitleLead: 'Lade den Commander-Bot auf deinen Server ein. Weitere Worker-Bots kannst du per',
    subtitleTail: 'Befehl im Discord hinzufügen.',
    loading: 'Lade Bot-Infos...',
    empty: 'Noch kein Bot konfiguriert.',
    statsTitle: 'Bot-Statistiken',
    stats: {
      servers: 'Server',
      users: 'Nutzer',
      connections: 'Verbindungen',
      listeners: 'Zuhörer',
    },
    status: {
      online: 'Online',
      configurable: 'Konfigurierbar',
    },
    actions: {
      invite: 'Einladen',
      copy: 'Link kopieren',
      copied: 'Kopiert',
      required: 'erforderlich',
    },
    networkTitle: 'Live-Netzwerk',
    networkSubtitle: 'Commander und Worker sind kein Gimmick, sondern ein klares Invite- und Skalierungsmodell für echten Betrieb.',
    networkMetrics: {
      readyBots: 'Bereit',
      totalServers: 'Server gesamt',
      totalConnections: 'Verbindungen',
    },
    proofListTitle: 'Warum das wichtig ist',
    proofChecks: [
      'Ein Commander bleibt der klare Einstiegspunkt für neue Server.',
      'Worker übernehmen parallele Streams, statt einen einzelnen Bot zu überladen.',
      'Free, Pro und Ultimate bauen auf derselben Invite-Logik auf und skalieren ohne Produktbruch.',
    ],
    networkHint: 'So wirkt OmniFM nicht wie ein Einzel-Bot mit vielen Versprechen, sondern wie ein wirklich betriebenes Discord-Radio-System.',
    workerTiersTitle: 'Worker-Bots pro Tier',
    workerTiers: [
      { tier: 'Free', bots: 'Bot 1-2', desc: 'Genug für den Einstieg und die ersten parallelen Streams.' },
      { tier: 'Pro', bots: 'Bot 3-8', desc: 'Mehr Reserve für aktive Communitys, Events und planbare Last.' },
      { tier: 'Ultimate', bots: 'Bot 9-16', desc: 'Operator-Level für größere Netzwerke, mehr Ausfallsicherheit und Power-Setups.' },
    ],
    workerHintLead: 'Nutze',
    workerHintTail: 'im Discord, um Worker-Bots einzuladen.',
  },
  stations: {
    eyebrow: 'Live Station Directory',
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
        answer: 'Nein. Free funktioniert ohne Dashboard. Ab Pro wird es relevant, wenn du Events, Rollenrechte, Weekly Digest und Health zentral verwalten willst.',
      },
      {
        key: 'pro',
        question: 'Wann lohnt sich Pro?',
        answer: 'Pro lohnt sich, sobald du deinen Server aktiv verwalten willst: Dashboard, Event-Scheduler, Rollenrechte, Weekly Digest und Health sind die Kernargumente.',
      },
      {
        key: 'ultimate',
        question: 'Wann brauche ich Ultimate?',
        answer: 'Ultimate ist für Power-User und Betreiber gedacht, die Custom Stations, tiefere Analytics, Failover und Automatisierung benötigen.',
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
    subtitle: 'Die Website soll nicht nur Preise zeigen, sondern erklären, welcher Plan für welchen Server-Typ wirklich sinnvoll ist.',
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
};

export default messages;
