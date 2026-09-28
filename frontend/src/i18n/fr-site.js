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
    body: 'OmniFM utilise le stockage nécessaire pour la langue, la sécurité et les sessions du tableau de bord. La balise Google est active avec le mode consentement ; le stockage pour les statistiques n’est autorisé que si tu y consens.',
    necessaryTitle: 'Nécessaires',
    necessaryBody: 'Indispensables pour la langue choisie, les sessions sécurisées du tableau de bord et le fonctionnement technique. Cette catégorie ne peut pas être désactivée.',
    analyticsTitle: 'Statistiques',
    analyticsBody: 'Autorise Google Analytics 4 avec le mode consentement pour mesurer de façon globale les pages vues et l’utilisation. Sans consentement, le stockage pour les statistiques reste refusé.',
    acceptAll: 'Tout accepter',
    reject: 'Refuser',
    save: 'Enregistrer la sélection',
    manage: 'Réglages des cookies',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Ta radio',
    titleAccent: 'Discord.',
    titleTail: '24/7 en direct.',
    subtitleLead: 'Radio Discord 24/7 avec plus de 120 stations, la fiabilité des workers, le contrôle par tableau de bord et une reconnexion propre. Invite le commander, ajoute un worker et lance',
    subtitleTail: '.',
    ctaInvite: 'Inviter le commander',
    ctaFlow: 'Comment ça marche',
    stats: {
      servers: 'Serveurs',
      stations: 'Stations',
      bots: 'Bots',
    },
  },
  trustBar: {
    items: {
      stations: {
        label: 'Stations',
        detail: 'Catalogue en direct pour Free et Pro, avec aperçu directement sur le site.',
      },
      network: {
        label: 'Activité en direct',
        detail: 'Des flux actifs et un réseau de bots prêt montrent qu’OmniFM tourne vraiment en production, pas seulement sur une page d’accueil.',
      },
      dashboard: {
        label: 'Tableau de bord',
        detail: 'Vue en direct, statistiques, droits par rôle et alertes de panne à partir de Pro.',
      },
      reliability: {
        label: 'Fiabilité',
        detail: 'Reconnexion, offres claires et un chemin d’évolution simple pour les serveurs qui grandissent.',
      },
    },
    values: {
      dashboard: 'Free+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} free · ${pro} pro`,
      network: ({ bots, servers }) => `${bots} bots · ${servers} serveurs`,
      dashboard: 'Événements · droits · état',
      reliability: 'Reconnexion · workers · offres claires',
    },
  },
  whyOmniFM: {
    eyebrow: 'Pourquoi OmniFM',
    title: 'Pas juste un bot radio, mais une vraie installation Discord bien rodée',
    subtitle: 'OmniFM est à son meilleur quand la musique, la fiabilité et la gestion du serveur travaillent ensemble.',
    cards: {
      radio: {
        label: 'Radio',
        title: 'Démarrage rapide',
        desc: 'Invite le commander, ajoute un worker, lance /play et écoute tout de suite. Pas de configuration lourde avant d’en profiter.',
      },
      workers: {
        label: 'Workers',
        title: 'Plus qu’un seul bot',
        desc: 'L’architecture à workers répartit proprement les flux et rend l’utilisation en parallèle prévisible pour les grandes communautés.',
      },
      control: {
        label: 'Contrôle',
        title: 'Le contrôle pour les admins',
        desc: 'Tableau de bord, événements, droits par rôle et vues d’état donnent aux serveurs Pro un vrai contrôle, pas seulement plus de stations.',
      },
      growth: {
        label: 'Croissance',
        title: 'Grandir sans friction',
        desc: 'Free, Pro et Ultimate reposent sur le même cœur, du démarrage rapide jusqu’à l’installation de niveau opérateur.',
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
    subtitle: 'Le premier lancement doit être rapide, l’évolution claire et l’architecture compréhensible.',
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
        answer: 'Free couvre un vrai point de départ : jusqu’à 2 bots, 20 stations gratuites, les commandes essentielles et tout le déroulé commander plus worker.',
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
        key: 'workers',
        question: 'Comment fonctionnent le commander et les workers ?',
        answer: 'Le commander gère les commandes et les invitations des workers. Les workers diffusent les flux. OmniFM peut ainsi répartir proprement plusieurs flux en parallèle et les garder stables.',
      },
    ],
  },
  useCases: {
    eyebrow: 'Pour qui est OmniFM ?',
    title: 'Chaque offre a un rôle clair',
    subtitle: 'Pas seulement des prix : quelle offre convient vraiment à quel serveur.',
    cards: {
      free: {
        title: 'Free pour une radio communautaire rapide',
        desc: 'Si tu veux une radio 24/7 sur un petit serveur ou un serveur privé, Free est le point de départ le plus simple.',
        fit: 'Idéal pour les petites communautés, les groupes d’amis et une première installation sans charge d’administration.',
      },
      pro: {
        title: 'Pro pour les admins de communauté',
        desc: 'Dès que les événements, les droits et le tableau de bord font partie du quotidien, Pro devient la vraie offre de gestion.',
        fit: 'Idéal pour les serveurs d’événements, les communautés de taille moyenne et les équipes avec des sessions régulières et des rôles clairs.',
      },
      ultimate: {
        title: 'Ultimate pour les installations d’opérateur',
        desc: 'Quand les outils de fiabilité, les stations personnelles, les statistiques détaillées et l’automatisation comptent, Ultimate est la bonne offre.',
        fit: 'Idéal pour les grandes communautés, les utilisateurs avancés et les opérateurs qui veulent qu’OmniFM se comporte comme un système géré.',
      },
    },
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
