// OmniFM website texts, Dutch: navigation, start page sections, stations, FAQ (#306).
// The same keys as en-site.js; put together in ./languages.js.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Zo werkt het', href: '#features' },
      { key: 'why', label: 'Waarom OmniFM', href: '#why-omnifm' },
      { key: 'dashboard', label: 'Dashboard', href: '#dashboard-showcase' },
      { key: 'stations', label: 'Zenders', page: 'stations' },
      { key: 'pricing', label: 'Prijzen', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Discord-community',
  },
  cookieConsent: {
    title: 'Cookies en statistieken',
    body: 'OmniFM gebruikt noodzakelijke opslag voor taal, beveiliging en dashboardsessies. De Google-tag werkt met de toestemmingsmodus; opslag voor statistieken is alleen toegestaan als je daarmee instemt.',
    necessaryTitle: 'Noodzakelijk',
    necessaryBody: 'Nodig voor je taalkeuze, veilige dashboardsessies en de technische werking. Deze categorie kan niet worden uitgeschakeld.',
    analyticsTitle: 'Statistieken',
    analyticsBody: 'Staat Google Analytics 4 met toestemmingsmodus toe om paginaweergaven en gebruik op hoofdlijnen te meten. Zonder toestemming blijft opslag voor statistieken geweigerd.',
    acceptAll: 'Alles accepteren',
    reject: 'Weigeren',
    save: 'Keuze opslaan',
    manage: 'Cookie-instellingen',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Jouw Discord-',
    titleAccent: 'radio.',
    titleTail: '24/7 live.',
    subtitleLead: '24/7 Discord-radio met meer dan 120 zenders, betrouwbaarheid dankzij workers, bediening via het dashboard en nette herverbinding. Nodig de commander uit, voeg een worker toe en gebruik',
    subtitleTail: '.',
    ctaInvite: 'Commander uitnodigen',
    ctaFlow: 'Zo werkt het',
    stats: {
      servers: 'Servers',
      stations: 'Zenders',
      bots: 'Bots',
    },
  },
  trustBar: {
    items: {
      stations: {
        label: 'Zenders',
        detail: 'Livecatalogus voor Free en Pro, met een voorbeeld direct op de website.',
      },
      network: {
        label: 'Live-activiteit',
        detail: 'Actieve streams en een klaarstaand botnetwerk laten zien dat OmniFM echt in productie draait, niet alleen op een landingspagina.',
      },
      dashboard: {
        label: 'Dashboard',
        detail: 'Liveweergave, statistieken, rolrechten en storingsmeldingen vanaf Pro.',
      },
      reliability: {
        label: 'Betrouwbaarheid',
        detail: 'Herverbinding, duidelijke abonnementen en een eenvoudig pad voor groeiende servers.',
      },
    },
    values: {
      dashboard: 'Free+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} free · ${pro} pro`,
      network: ({ bots, servers }) => `${bots} bots · ${servers} servers`,
      dashboard: 'Evenementen · rechten · status',
      reliability: 'Herverbinding · workers · duidelijke abonnementen',
    },
  },
  whyOmniFM: {
    eyebrow: 'Waarom OmniFM',
    title: 'Niet zomaar een radiobot, maar een goed ingerichte Discord-opzet',
    subtitle: 'OmniFM is op zijn sterkst als muziek, betrouwbaarheid en serverbeheer samenwerken.',
    cards: {
      radio: {
        title: 'Snel van start',
        desc: 'Nodig de commander uit, voeg een worker toe, gebruik /play en luister meteen. Geen zware installatie voordat je ervan geniet.',
      },
      workers: {
        title: 'Meer dan één bot',
        desc: 'De workerarchitectuur verdeelt streams netjes en maakt parallel gebruik in grote community’s voorspelbaar.',
      },
      control: {
        title: 'Controle voor admins',
        desc: 'Dashboard, evenementen, rolrechten en statusweergaven geven Pro-servers echte controle, niet alleen meer zenders.',
      },
      growth: {
        title: 'Groeien zonder gedoe',
        desc: 'Free, Pro en Ultimate bouwen op dezelfde kern, van een snelle start tot een opzet op operatorniveau.',
      },
    },
  },
  dashboardShowcase: {
    eyebrow: 'Dashboard en beheer',
    title: 'Pro en Ultimate voegen echte servercontrole toe',
    subtitle: 'OmniFM is niet alleen een bot die streams start. Het dashboard maakt er een beheersbaar systeem van voor evenementen, rechten, status, statistieken en automatisering.',
    cards: {
      events: {
        title: 'Evenementplanner',
        desc: 'Plan automatische starts voor terugkerende sessies, communityavonden of vaste muziekblokken.',
      },
      permissions: {
        title: 'Rolrechten per commando',
        desc: 'Bepaal precies wie /event, /perm en andere gevoelige commando’s op je server mag gebruiken.',
      },
      health: {
        title: 'Status en statistieken',
        desc: 'Volg de serverstatus, de kerncijfers en met Ultimate ook uitgebreidere statistieken.',
      },
      automation: {
        title: 'Eigen zenders en webhooks',
        desc: 'Ultimate breidt OmniFM uit voor gevorderde gebruikers met eigen zenders, exports en webhooks voor automatisering.',
      },
    },
    primaryCta: 'Dashboard openen',
    secondaryCta: 'Abonnementen vergelijken',
    ctaNote: 'Elke server heeft de basis. Upgraden voegt controle toe, geen tweede product.',
  },
  stations: {
    eyebrow: 'Overzicht van livezenders',
    title: 'OmniFM-zenders',
    summary: ({ count, free, pro, ultimate }) => `${count} zenders (${free} free, ${pro} pro, ${ultimate} ultimate). Klik voor een voorbeeld of gebruik /play in Discord.`,
    nowPlaying: 'Voorbeeld speelt',
    searchPlaceholder: 'Zenders zoeken...',
    filters: {
      all: 'Alle',
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
    filterSummary: ({ count, free, pro, ultimate }) => `${count} zenders (${free} free, ${pro} pro, ${ultimate} ultimate)`,
    loading: 'Zenders laden...',
    empty: 'Geen zenders gevonden.',
    loadMore: ({ remaining }) => `Meer tonen (nog ${remaining})`,
    visible: ({ visible, total }) => `${visible} van ${total} zenders zichtbaar`,
    previewVolume: 'Volume',
    stopPreview: 'Voorbeeld stoppen',
    tiers: {
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'De belangrijkste vragen voordat je begint',
    subtitle: 'De eerste start moet snel gaan, de weg naar een upgrade duidelijk zijn en de architectuur begrijpelijk blijven.',
    items: [
      {
        key: 'start',
        question: 'Wat is de eenvoudigste manier om met OmniFM te beginnen?',
        answer: 'Meestal in minder dan een minuut: nodig de commander uit, voeg minstens één worker toe, ga naar een spraakkanaal, gebruik dan /play en kies een zender.',
      },
      {
        key: 'workerRequired',
        question: 'Heb ik een worker nodig voor /play?',
        answer: 'Ja. De commander neemt de commando’s aan, maar de stream zelf loopt via een worker. /play werkt pas goed als er een worker op de server is.',
      },
      {
        key: 'free',
        question: 'Wat zit er in Free?',
        answer: 'Free is een stevige start: tot 2 bots, 20 gratis zenders, de basiscommando’s en de volledige commander-plus-workerflow.',
      },
      {
        key: 'dashboard',
        question: 'Heb ik het dashboard meteen nodig?',
        answer: 'Nee, alles werkt ook in Discord. Met Free laat het dashboard zien wat waar speelt, wisselt of stopt het de zender, stelt het de taal in en plant het één evenement. Pro voegt de liveweergave, statistieken, onbeperkte evenementen, rolrechten en storingsmeldingen toe.',
      },
      {
        key: 'pro',
        question: 'Wanneer is Pro de moeite waard?',
        answer: 'Zodra je je server wilt vormgeven en beheren: alle zenders uit de catalogus, 8 spraakkanalen tegelijk, het dashboard met liveweergave, onbeperkte evenementen, rolrechten en storingsmeldingen in Discord.',
      },
      {
        key: 'ultimate',
        question: 'Wanneer heb ik Ultimate nodig?',
        answer: 'Als je je eigen radio runt: tot 50 eigen zenders met logo, een eigen uiterlijk van de bot per server, eigen ketens van reservezenders, webhooks en gedetailleerde statistieken, plus 16 spraakkanalen tegelijk.',
      },
      {
        key: 'workers',
        question: 'Hoe werken de commander en de workers?',
        answer: 'De commander regelt de commando’s en de uitnodigingen van workers. De workers verzorgen de streams. Zo kan OmniFM meerdere parallelle streams netjes verdelen en stabiel houden.',
      },
    ],
  },
  useCases: {
    eyebrow: 'Voor wie is OmniFM?',
    title: 'Elk abonnement heeft een duidelijke taak',
    subtitle: 'Niet alleen prijzen: welk abonnement echt bij welke server past.',
    cards: {
      free: {
        title: 'Free voor snelle communityradio',
        desc: 'Wil je 24/7 radio op een kleine of privéserver, dan is Free het eenvoudigste startpunt.',
        fit: 'Ideaal voor kleinere community’s, vriendengroepen en de eerste opzet zonder beheerlast.',
      },
      pro: {
        title: 'Pro voor communitybeheerders',
        desc: 'Zodra evenementen, rechten en het dashboard bij het dagelijkse werk horen, wordt Pro het echte beheerabonnement.',
        fit: 'Ideaal voor eventservers, middelgrote community’s en teams met terugkerende sessies en duidelijke rollen.',
      },
      ultimate: {
        title: 'Ultimate voor operatoropzetten',
        desc: 'Als betrouwbaarheidstools, eigen zenders, gedetailleerde statistieken en automatisering tellen, is Ultimate het juiste abonnement.',
        fit: 'Ideaal voor grote community’s, gevorderde gebruikers en operators die willen dat OmniFM zich gedraagt als een beheerd systeem.',
      },
    },
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Direct in Discord',
    titleLead: 'Speelt in je ',
    titleAccent: 'spraakkanaal',
    titleTail: ', bediend met slash-commando’s.',
    body: 'Geen browserspeler, geen afspelen op de website. OmniFM streamt 24/7 direct in je Discord-spraakkanaal — met nette Now Playing-berichten, knoppen en herverbinding.',
    cmds: [
      ['/play synthwave', 'Start de stream in je spraakkanaal'],
      ['/now', 'Toont het live nummer, de hoes en de luisteraars'],
      ['/stations', 'Blader door meer dan 120 geselecteerde zenders'],
    ],
    nowPlaying: 'Now Playing', genre: 'Genre', bitrate: 'Bitrate', listeners: 'Luisteraars',
    liveStream: 'Liveradiostream', liveRadio: 'Liveradio',
    time: 'vandaag om 21:14',
  },
  // How to start OmniFM in Discord (HowToDiscord.js).
  howTo: {
    eyebrow: 'Handleiding · in minder dan 60 seconden',
    title: 'Zo start je OmniFM in Discord',
    subtitle: 'Geen browserspeler. Drie stappen en je radio speelt 24/7 direct in het spraakkanaal.',
    steps: [
      { n: '01', cmd: 'App toevoegen', title: 'De commander uitnodigen', desc: 'Voeg de OmniFM-commander toe aan je server. Hij neemt alle slash-commando’s aan en beheert je workers.' },
      { n: '02', cmd: '/invite', title: 'Een workerbot toevoegen', desc: 'Nodig minstens één worker uit. Die draagt de eigenlijke spraakstream — meer workers = meer kanalen tegelijk.' },
      { n: '03', cmd: '/play lofi', title: 'De radio starten', desc: 'Kies een zender en OmniFM komt in je spraakkanaal. Now Playing-bericht, knoppen en herverbinding inbegrepen.' },
    ],
    permsTitle: 'Rechten',
    perms: ['Spraak betreden en praten', 'Berichten en embeds versturen', 'Slash-commando’s gebruiken'],
    addServer: 'Aan server toevoegen',
    workerHint: 'Worker klaar',
    invite: 'Uitnodigen',
    connected: 'verbonden',
    nowPlaying: 'Now Playing',
  },
};

export default messages;
