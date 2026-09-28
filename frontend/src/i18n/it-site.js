// OmniFM website texts, Italian: navigation, start page sections, stations, FAQ (#306).
// The same keys as en-site.js; put together in ./languages.js.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Come funziona', href: '#features' },
      { key: 'why', label: 'Perché OmniFM', href: '#why-omnifm' },
      { key: 'dashboard', label: 'Dashboard', href: '#dashboard-showcase' },
      { key: 'stations', label: 'Stazioni', page: 'stations' },
      { key: 'pricing', label: 'Prezzi', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Community Discord',
  },
  cookieConsent: {
    title: 'Cookie e statistiche',
    body: 'OmniFM usa la memoria necessaria per la lingua, la sicurezza e le sessioni della dashboard. Il tag di Google è attivo con la modalità di consenso; la memoria per le statistiche è consentita solo se dai il tuo consenso.',
    necessaryTitle: 'Necessari',
    necessaryBody: 'Indispensabili per la lingua scelta, le sessioni sicure della dashboard e il funzionamento tecnico. Questa categoria non si può disattivare.',
    analyticsTitle: 'Statistiche',
    analyticsBody: 'Consente Google Analytics 4 con la modalità di consenso per misurare in modo generale le visite e l’uso. Senza consenso, la memoria per le statistiche resta negata.',
    acceptAll: 'Accetta tutto',
    reject: 'Rifiuta',
    save: 'Salva la selezione',
    manage: 'Impostazioni cookie',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'La tua radio',
    titleAccent: 'su Discord.',
    titleTail: '24/7 in diretta.',
    subtitleLead: 'Radio su Discord 24/7 con oltre 120 stazioni, l’affidabilità dei worker, il controllo dalla dashboard e una riconnessione pulita. Invita il commander, aggiungi un worker e usa',
    subtitleTail: '.',
    ctaInvite: 'Invita il commander',
    ctaFlow: 'Come funziona',
    stats: {
      servers: 'Server',
      stations: 'Stazioni',
      bots: 'Bot',
    },
  },
  trustBar: {
    items: {
      stations: {
        label: 'Stazioni',
        detail: 'Catalogo live per Free e Pro, con anteprima direttamente sul sito.',
      },
      network: {
        label: 'Attività live',
        detail: 'Stream attivi e una rete di bot pronta mostrano che OmniFM gira davvero in produzione, non solo su una landing page.',
      },
      dashboard: {
        label: 'Dashboard',
        detail: 'Vista live, statistiche, permessi per ruolo e avvisi di interruzione da Pro in su.',
      },
      reliability: {
        label: 'Affidabilità',
        detail: 'Riconnessione, piani chiari e un percorso semplice per i server che crescono.',
      },
    },
    values: {
      dashboard: 'Free+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} free · ${pro} pro`,
      network: ({ bots, servers }) => `${bots} bot · ${servers} server`,
      dashboard: 'Eventi · permessi · stato',
      reliability: 'Riconnessione · worker · piani chiari',
    },
  },
  whyOmniFM: {
    eyebrow: 'Perché OmniFM',
    title: 'Non solo un bot radio, ma un’installazione Discord fatta bene',
    subtitle: 'OmniFM dà il meglio quando musica, affidabilità e gestione del server lavorano insieme.',
    cards: {
      radio: {
        title: 'Si parte subito',
        desc: 'Invita il commander, aggiungi un worker, usa /play e ascolta subito. Nessuna configurazione pesante prima di goderselo.',
      },
      workers: {
        title: 'Più di un solo bot',
        desc: 'L’architettura a worker distribuisce gli stream in modo pulito e rende prevedibile l’uso in parallelo nelle community grandi.',
      },
      control: {
        title: 'Controllo per gli admin',
        desc: 'Dashboard, eventi, permessi per ruolo e viste di stato danno ai server Pro un controllo vero, non solo più stazioni.',
      },
      growth: {
        title: 'Crescere senza attriti',
        desc: 'Free, Pro e Ultimate si basano sullo stesso nucleo, dall’avvio rapido fino a un’installazione da operatore.',
      },
    },
  },
  dashboardShowcase: {
    eyebrow: 'Dashboard e gestione',
    title: 'Pro e Ultimate aggiungono un vero controllo del server',
    subtitle: 'OmniFM non è solo un bot che avvia stream. La dashboard lo trasforma in un sistema gestibile per eventi, permessi, stato, statistiche e automazione.',
    cards: {
      events: {
        title: 'Pianificatore di eventi',
        desc: 'Programma avvii automatici per sessioni ricorrenti, serate della community o fasce musicali fisse.',
      },
      permissions: {
        title: 'Permessi per ruolo e comando',
        desc: 'Stabilisci esattamente chi può usare /event, /perm e gli altri comandi delicati sul tuo server.',
      },
      health: {
        title: 'Stato e statistiche',
        desc: 'Segui lo stato del server, i numeri chiave e, con Ultimate, statistiche più dettagliate.',
      },
      automation: {
        title: 'Stazioni personali e webhook',
        desc: 'Ultimate estende OmniFM per gli utenti avanzati con stazioni personali, esportazioni e webhook di automazione.',
      },
    },
    primaryCta: 'Apri la dashboard',
    secondaryCta: 'Confronta i piani',
    ctaNote: 'Ogni server ha le basi. Passare a un piano superiore aggiunge controllo, non un secondo prodotto.',
  },
  stations: {
    eyebrow: 'Elenco delle stazioni live',
    title: 'Stazioni OmniFM',
    summary: ({ count, free, pro, ultimate }) => `${count} stazioni (${free} free, ${pro} pro, ${ultimate} ultimate). Clicca per l’anteprima o usa /play su Discord.`,
    nowPlaying: 'Anteprima in riproduzione',
    searchPlaceholder: 'Cerca stazioni...',
    filters: {
      all: 'Tutte',
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
    filterSummary: ({ count, free, pro, ultimate }) => `${count} stazioni (${free} free, ${pro} pro, ${ultimate} ultimate)`,
    loading: 'Caricamento delle stazioni...',
    empty: 'Nessuna stazione trovata.',
    loadMore: ({ remaining }) => `Mostra altre (ne restano ${remaining})`,
    visible: ({ visible, total }) => `${visible} stazioni su ${total}`,
    previewVolume: 'Volume',
    stopPreview: 'Ferma l’anteprima',
    tiers: {
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Le domande più importanti prima di iniziare',
    subtitle: 'Il primo avvio deve essere rapido, il percorso di upgrade chiaro e l’architettura comprensibile.',
    items: [
      {
        key: 'start',
        question: 'Qual è il modo più semplice per iniziare con OmniFM?',
        answer: 'Di solito in meno di un minuto: invita il commander, aggiungi almeno un worker, entra in un canale vocale, poi usa /play e scegli una stazione.',
      },
      {
        key: 'workerRequired',
        question: 'Mi serve un worker prima di /play?',
        answer: 'Sì. Il commander riceve i comandi, ma lo stream passa da un worker. /play funziona bene solo quando c’è un worker sul server.',
      },
      {
        key: 'free',
        question: 'Cosa include il piano Free?',
        answer: 'Free copre un ottimo punto di partenza: fino a 2 bot, 20 stazioni gratuite, i comandi principali e tutto il flusso commander più worker.',
      },
      {
        key: 'dashboard',
        question: 'Mi serve subito la dashboard?',
        answer: 'No, tutto funziona anche su Discord. Con Free la dashboard mostra cosa suona dove, cambia o ferma la stazione, imposta la lingua e programma un evento. Pro aggiunge la vista live, le statistiche, eventi illimitati, i permessi per ruolo e gli avvisi di interruzione.',
      },
      {
        key: 'pro',
        question: 'Quando conviene Pro?',
        answer: 'Appena vuoi dare forma al tuo server e gestirlo: tutte le stazioni del catalogo, 8 canali vocali contemporaneamente, la dashboard con vista live, eventi illimitati, i permessi per ruolo e gli avvisi di interruzione su Discord.',
      },
      {
        key: 'ultimate',
        question: 'Quando mi serve Ultimate?',
        answer: 'Quando gestisci una radio tua: fino a 50 stazioni tue con logo, un aspetto del bot tutto tuo per ogni server, le tue catene di riserva, webhook e statistiche dettagliate, più 16 canali vocali contemporaneamente.',
      },
      {
        key: 'workers',
        question: 'Come funzionano il commander e i worker?',
        answer: 'Il commander gestisce i comandi e gli inviti dei worker. I worker trasmettono gli stream. Così OmniFM può distribuire più stream in parallelo in modo pulito e mantenerli stabili.',
      },
    ],
  },
  useCases: {
    eyebrow: 'Per chi è OmniFM?',
    title: 'Ogni piano ha un compito chiaro',
    subtitle: 'Non solo prezzi: quale piano si adatta davvero a quale server.',
    cards: {
      free: {
        title: 'Free per una radio della community veloce',
        desc: 'Se vuoi una radio 24/7 su un server piccolo o privato, Free è il punto di partenza più semplice.',
        fit: 'Ideale per community piccole, gruppi di amici e la prima installazione senza carico di amministrazione.',
      },
      pro: {
        title: 'Pro per gli admin delle community',
        desc: 'Appena eventi, permessi e dashboard entrano nella gestione quotidiana, Pro diventa il vero piano di gestione.',
        fit: 'Ideale per server di eventi, community di medie dimensioni e team con sessioni ricorrenti e ruoli chiari.',
      },
      ultimate: {
        title: 'Ultimate per installazioni da operatore',
        desc: 'Quando contano gli strumenti di affidabilità, le stazioni personali, le statistiche dettagliate e l’automazione, Ultimate è il piano giusto.',
        fit: 'Ideale per community grandi, utenti avanzati e operatori che vogliono che OmniFM si comporti come un sistema gestito.',
      },
    },
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Direttamente su Discord',
    titleLead: 'Suona nel tuo ',
    titleAccent: 'canale vocale',
    titleTail: ', controllato con i comandi slash.',
    body: 'Nessun player nel browser, nessuna riproduzione sul sito. OmniFM trasmette 24/7 direttamente nel tuo canale vocale Discord — con messaggi Now Playing curati, pulsanti e riconnessione.',
    cmds: [
      ['/play synthwave', 'Avvia lo stream nel tuo canale vocale'],
      ['/now', 'Mostra il brano in diretta, la copertina e gli ascoltatori'],
      ['/stations', 'Sfoglia oltre 120 stazioni selezionate'],
    ],
    nowPlaying: 'Now Playing', genre: 'Genere', bitrate: 'Bitrate', listeners: 'Ascoltatori',
    liveStream: 'Radio in diretta', liveRadio: 'Radio in diretta',
    time: 'oggi alle 21:14',
  },
  // How to start OmniFM in Discord (HowToDiscord.js).
  howTo: {
    eyebrow: 'Guida · in meno di 60 secondi',
    title: 'Come avviare OmniFM su Discord',
    subtitle: 'Nessun player nel browser. Tre passaggi e la tua radio suona 24/7 direttamente nel canale vocale.',
    steps: [
      { n: '01', cmd: 'Aggiungi app', title: 'Invita il commander', desc: 'Aggiungi il commander di OmniFM al tuo server. Gestisce tutti i comandi slash e i tuoi worker.' },
      { n: '02', cmd: '/invite', title: 'Aggiungi un bot worker', desc: 'Invita almeno un worker. È lui che porta lo stream vocale — più worker = più canali in parallelo.' },
      { n: '03', cmd: '/play lofi', title: 'Avvia la radio', desc: 'Scegli una stazione e OmniFM entra nel tuo canale vocale. Messaggio Now Playing, pulsanti e riconnessione inclusi.' },
    ],
    permsTitle: 'Permessi',
    perms: ['Entrare in vocale e parlare', 'Inviare messaggi ed embed', 'Usare i comandi slash'],
    addServer: 'Aggiungi al server',
    workerHint: 'Worker pronto',
    invite: 'Invita',
    connected: 'connesso',
    nowPlaying: 'Now Playing',
  },
};

export default messages;
