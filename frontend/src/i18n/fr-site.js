// OmniFM website texts, French: navigation, start page sections, stations, FAQ (#306).
// The same keys as en-site.js; put together in ./languages.js.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Fonctionnement', href: '#features' },
      { key: 'why', label: 'Pourquoi OmniFM', href: '#why-omnifm' },
      { key: 'stations', label: 'Stations', page: 'stations' },
      { key: 'pricing', label: 'Tarifs', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Communauté Discord',
  },
  cookieConsent: {
    title: 'Cookies et statistiques',
    short: 'Nous ne stockons que ce dont le site a besoin (langue, connexion). Google Analytics ne dépose des cookies qu’avec ton accord.',
    privacyLink: 'Confidentialité',
    necessaryTitle: 'Nécessaires',
    necessaryBody: 'Pour ta langue, la connexion sécurisée au tableau de bord et le bon fonctionnement du site. Impossible à désactiver.',
    analyticsTitle: 'Statistiques (Google Analytics)',
    analyticsBody: 'Compte en gros quelles pages sont visitées, pour que nous puissions améliorer le site. Sans ton accord, Google Analytics ne dépose aucun cookie.',
    acceptAll: 'Tout accepter',
    reject: 'Refuser',
    settings: 'Paramètres',
    save: 'Enregistrer la sélection',
    manage: 'Réglages des cookies',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Ta radio',
    titleAccent: 'Discord.',
    titleTail: '24/7 en direct.',
    subtitleLead: 'La radio 24 h/24 dans ton salon vocal Discord : des stations de tous les genres, un tableau de bord pour tout piloter, et si un flux coupe, OmniFM se reconnecte tout seul. Invite le commander, ajoute un worker et lance',
    subtitleTail: '.',
    ctaInvite: 'Inviter le commander',
    ctaFlow: 'Comment ça marche',
  },
  trustBar: {
    live: 'Chiffres en direct',
    items: {
      servers: { label: 'Serveurs', detail: 'utilisent OmniFM' },
      stations: { label: 'Stations', detail: 'à écouter, aussi ici' },
      bots: { label: 'Bots', detail: 'prêts à jouer' },
      listeners: { label: 'À l’écoute', detail: 'sur tous les serveurs' },
    },
  },
  whyOmniFM: {
    eyebrow: 'Pourquoi OmniFM',
    title: 'Plus qu’un bot radio',
    subtitle: 'De la musique qui tourne sans accroc, et tout ce qu’il faut pour gérer ton serveur.',
    cards: {
      radio: {
        label: 'Radio',
        title: 'Démarrage rapide',
        desc: 'Invite le commander, ajoute un worker, lance /play et écoute tout de suite. Pas de configuration lourde avant d’en profiter.',
      },
      workers: {
        label: 'Workers',
        title: 'Plus qu’un seul bot',
        desc: 'Plusieurs bots se partagent le travail : chaque worker joue dans son propre salon vocal, ainsi un grand serveur peut diffuser plusieurs stations en même temps.',
      },
      control: {
        label: 'Contrôle',
        title: 'Le contrôle pour les admins',
        desc: 'Le tableau de bord montre ce qui joue et où, règle la langue et planifie les événements. Pro ajoute la vue en direct, les statistiques, les droits par rôle et les alertes de panne.',
      },
      growth: {
        label: 'Croissance',
        title: 'Grandir sans friction',
        desc: 'Free, Pro et Ultimate s’emboîtent : quand tu passes au niveau supérieur, tout reste configuré et tu obtiens simplement plus.',
      },
    },
  },
  stations: {
    eyebrow: 'Annuaire des stations en direct',
    title: 'Stations OmniFM',
    summary: ({ count, free, pro, ultimate }) => `${count} stations (${free} free, ${pro} pro, ${ultimate} ultimate). Clique pour un aperçu ou utilise /play dans Discord.`,
    nowPlaying: 'Aperçu en cours',
    searchPlaceholder: 'Chercher une station...',
    filters: {
      all: 'Toutes',
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
    filterSummary: ({ count, free, pro, ultimate }) => `${count} stations (${free} free, ${pro} pro, ${ultimate} ultimate)`,
    loading: 'Chargement des stations...',
    empty: 'Aucune station trouvée.',
    loadMore: ({ remaining }) => `Afficher plus (encore ${remaining})`,
    visible: ({ visible, total }) => `${visible} stations affichées sur ${total}`,
    previewVolume: 'Volume',
    stopPreview: 'Arrêter l’aperçu',
    tiers: {
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Les questions essentielles avant de commencer',
    subtitle: 'En bref : comment démarrer, ce qu’apportent les offres et comment fonctionne OmniFM.',
    items: [
      {
        key: 'start',
        question: 'Quelle est la façon la plus simple de démarrer OmniFM ?',
        answer: 'En général en moins d’une minute : invite le commander, ajoute au moins un worker, rejoins un salon vocal, puis lance /play et choisis une station.',
      },
      {
        key: 'workerRequired',
        question: 'Ai-je besoin d’un worker avant /play ?',
        answer: 'Oui. Le commander reçoit les commandes, mais le flux passe par un worker. /play ne fonctionne correctement qu’une fois qu’un worker est sur le serveur.',
      },
      {
        key: 'free',
        question: 'Que comprend l’offre Free ?',
        answer: 'Free suffit pour démarrer : jusqu’à 2 bots, 20 stations et toutes les commandes pour écouter la radio.',
      },
      {
        key: 'dashboard',
        question: 'Ai-je besoin du tableau de bord tout de suite ?',
        answer: 'Non, tout fonctionne aussi dans Discord. Avec Free, le tableau de bord montre ce qui joue où, change ou arrête la station, règle la langue et planifie un événement. Pro ajoute la vue en direct, les statistiques, des événements illimités, les droits par rôle et les alertes de panne.',
      },
      {
        key: 'pro',
        question: 'Quand Pro vaut-il le coup ?',
        answer: 'Dès que tu veux façonner et gérer ton serveur : toutes les stations du catalogue, 8 salons vocaux en même temps, le tableau de bord avec vue en direct, des événements illimités, les droits par rôle et les alertes de panne dans Discord.',
      },
      {
        key: 'ultimate',
        question: 'Quand ai-je besoin d’Ultimate ?',
        answer: 'Quand tu fais tourner ta propre radio : jusqu’à 50 stations à toi avec logo, une apparence du bot propre à chaque serveur, tes propres chaînes de secours, des webhooks et des statistiques détaillées, plus 16 salons vocaux en même temps.',
      },
      {
        key: 'planStatus',
        question: 'Comment savoir quelle offre a mon serveur ?',
        answer: 'Dans le tableau de bord : connecte-toi avec Discord, choisis ton serveur et ouvre « Abonnement et licence ». Tu y vois l’offre et jusqu’à quand elle court. Dans Discord, la commande /premium l’affiche aussi.',
        link: { label: 'Ouvrir le tableau de bord', page: 'dashboard' },
      },
      {
        key: 'workers',
        question: 'Comment fonctionnent le commander et les workers ?',
        answer: 'Le commander reçoit tes commandes ; /invite te donne les liens pour les workers. Les workers jouent la radio dans les salons vocaux. Ainsi, un serveur peut écouter plusieurs stations en même temps.',
      },
    ],
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Directement dans Discord',
    titleLead: 'Joue dans ton ',
    titleAccent: 'salon vocal',
    titleTail: ', piloté par commandes slash.',
    body: 'Sur le site, tu écoutes juste un extrait – OmniFM tourne 24/7 directement dans ton salon vocal Discord, avec panneau Now Playing, boutons et reconnexion automatique.',
    cmds: [
      ['/play synthwave', 'Lance le flux dans ton salon vocal'],
      ['/now', 'Affiche le titre en direct, la pochette et les auditeurs'],
      ['/stations', 'Parcours plus de 120 stations sélectionnées'],
    ],
    nowPlaying: 'Now Playing', genre: 'Genre', bitrate: 'Débit', listeners: 'Auditeurs',
    liveStream: 'Flux radio en direct', liveRadio: 'Radio en direct',
    time: 'aujourd’hui à 21:14',
  },
  // How to start OmniFM in Discord (HowToDiscord.js).
  howTo: {
    eyebrow: 'Mode d’emploi · en moins de 60 secondes',
    title: 'Comment lancer OmniFM dans Discord',
    subtitle: 'Trois étapes et ta radio tourne 24/7 directement dans le salon vocal.',
    steps: [
      { n: '01', cmd: 'Ajouter l’app', title: 'Inviter le commander', desc: 'Ajoute le commander OmniFM à ton serveur. Il gère toutes les commandes slash et tes workers.' },
      { n: '02', cmd: '/invite', title: 'Ajouter un bot worker', desc: 'Invite au moins un worker. C’est lui qui diffuse le flux vocal — plus de workers = plus de salons en parallèle.' },
      { n: '03', cmd: '/play lofi', title: 'Lancer la radio', desc: 'Choisis une station et OmniFM rejoint ton salon vocal. Message Now Playing, boutons et reconnexion compris.' },
    ],
    permsTitle: 'Permissions',
    perms: ['Rejoindre le vocal et parler', 'Envoyer des messages et des embeds', 'Utiliser les commandes slash'],
    addServer: 'Ajouter au serveur',
    workerHint: 'Worker prêt',
    invite: 'Inviter',
    connected: 'connecté',
    nowPlaying: 'Now Playing',
  },
};

export default messages;
