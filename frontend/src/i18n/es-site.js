// OmniFM website texts, Spanish: navigation, start page sections, stations, FAQ (#306).
// The same keys as en-site.js; put together in ./languages.js.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Cómo funciona', href: '#features' },
      { key: 'why', label: 'Por qué OmniFM', href: '#why-omnifm' },
      { key: 'stations', label: 'Emisoras', page: 'stations' },
      { key: 'pricing', label: 'Precios', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Comunidad de Discord',
  },
  cookieConsent: {
    title: 'Cookies y estadísticas',
    body: 'OmniFM usa el almacenamiento necesario para el idioma, la seguridad y las sesiones del panel. La etiqueta de Google funciona con el modo de consentimiento; el almacenamiento para estadísticas solo se permite si das tu consentimiento.',
    necessaryTitle: 'Necesarias',
    necessaryBody: 'Imprescindibles para el idioma elegido, las sesiones seguras del panel y el funcionamiento técnico. Esta categoría no se puede desactivar.',
    analyticsTitle: 'Estadísticas',
    analyticsBody: 'Permite Google Analytics 4 con el modo de consentimiento para medir de forma general las visitas y el uso. Sin consentimiento, el almacenamiento para estadísticas sigue denegado.',
    acceptAll: 'Aceptar todo',
    reject: 'Rechazar',
    save: 'Guardar selección',
    manage: 'Ajustes de cookies',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Tu radio',
    titleAccent: 'de Discord.',
    titleTail: '24/7 en directo.',
    subtitleLead: 'Radio de Discord 24/7 con más de 120 emisoras, la fiabilidad de los workers, control desde el panel y una reconexión limpia. Invita al commander, añade un worker y usa',
    subtitleTail: '.',
    ctaInvite: 'Invitar al commander',
    ctaFlow: 'Cómo funciona',
    stats: {
      servers: 'Servidores',
      stations: 'Emisoras',
      bots: 'Bots',
    },
  },
  trustBar: {
    items: {
      stations: {
        label: 'Emisoras',
        detail: 'Catálogo en directo para Free y Pro, con vista previa directa en la web.',
      },
      network: {
        label: 'Actividad en directo',
        detail: 'Las transmisiones activas y una red de bots lista muestran que OmniFM funciona de verdad en producción, no solo en una página de inicio.',
      },
      dashboard: {
        label: 'Panel',
        detail: 'Vista en directo, estadísticas, permisos por rol y avisos de caídas desde Pro.',
      },
      reliability: {
        label: 'Fiabilidad',
        detail: 'Reconexión, planes claros y un camino sencillo para servidores que crecen.',
      },
    },
    values: {
      dashboard: 'Free+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} free · ${pro} pro`,
      network: ({ bots, servers }) => `${bots} bots · ${servers} servidores`,
      dashboard: 'Eventos · permisos · estado',
      reliability: 'Reconexión · workers · planes claros',
    },
  },
  whyOmniFM: {
    eyebrow: 'Por qué OmniFM',
    title: 'No solo un bot de radio, sino una instalación de Discord bien pensada',
    subtitle: 'OmniFM da lo mejor de sí cuando la música, la fiabilidad y la gestión del servidor funcionan juntas.',
    cards: {
      radio: {
        label: 'Radio',
        title: 'Rápido de empezar',
        desc: 'Invita al commander, añade un worker, usa /play y escucha al instante. Sin configuraciones pesadas antes de disfrutarlo.',
      },
      workers: {
        label: 'Workers',
        title: 'Más que un solo bot',
        desc: 'La arquitectura de workers reparte las transmisiones de forma limpia y hace predecible el uso en paralelo en comunidades grandes.',
      },
      control: {
        label: 'Control',
        title: 'Control para los admins',
        desc: 'El panel, los eventos, los permisos por rol y las vistas de estado dan a los servidores Pro control real, no solo más emisoras.',
      },
      growth: {
        label: 'Crecimiento',
        title: 'Crecer sin fricción',
        desc: 'Free, Pro y Ultimate se basan en el mismo núcleo, desde el inicio rápido hasta una instalación de nivel operador.',
      },
    },
  },
  stations: {
    eyebrow: 'Directorio de emisoras en directo',
    title: 'Emisoras de OmniFM',
    summary: ({ count, free, pro, ultimate }) => `${count} emisoras (${free} free, ${pro} pro, ${ultimate} ultimate). Haz clic para escucharlas o usa /play en Discord.`,
    nowPlaying: 'Suena la vista previa',
    searchPlaceholder: 'Buscar emisoras...',
    filters: {
      all: 'Todas',
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
    filterSummary: ({ count, free, pro, ultimate }) => `${count} emisoras (${free} free, ${pro} pro, ${ultimate} ultimate)`,
    loading: 'Cargando emisoras...',
    empty: 'No se encontraron emisoras.',
    loadMore: ({ remaining }) => `Mostrar más (quedan ${remaining})`,
    visible: ({ visible, total }) => `Mostrando ${visible} de ${total} emisoras`,
    previewVolume: 'Volumen',
    stopPreview: 'Detener vista previa',
    tiers: {
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Las preguntas más importantes antes de empezar',
    subtitle: 'El primer uso debe ser rápido, el camino de mejora claro y la arquitectura comprensible.',
    items: [
      {
        key: 'start',
        question: '¿Cuál es la forma más sencilla de empezar con OmniFM?',
        answer: 'Normalmente en menos de un minuto: invita al commander, añade al menos un worker, entra en un canal de voz y luego usa /play y elige una emisora.',
      },
      {
        key: 'workerRequired',
        question: '¿Necesito un worker antes de /play?',
        answer: 'Sí. El commander recibe los comandos, pero la transmisión pasa por un worker. /play solo funciona bien cuando hay un worker en el servidor.',
      },
      {
        key: 'free',
        question: '¿Qué incluye el plan Free?',
        answer: 'Free cubre un buen punto de partida: hasta 2 bots, 20 emisoras gratuitas, los comandos básicos y todo el flujo de commander y worker.',
      },
      {
        key: 'dashboard',
        question: '¿Necesito el panel desde el principio?',
        answer: 'No, todo funciona también en Discord. Con Free, el panel muestra qué suena dónde, cambia o detiene la emisora, fija el idioma y programa un evento. Pro añade la vista en directo, las estadísticas, eventos ilimitados, permisos por rol y avisos de caídas.',
      },
      {
        key: 'pro',
        question: '¿Cuándo vale la pena Pro?',
        answer: 'En cuanto quieras dar forma a tu servidor y gestionarlo: todas las emisoras del catálogo, 8 canales de voz a la vez, el panel con vista en directo, eventos ilimitados, permisos por rol y avisos de caídas en Discord.',
      },
      {
        key: 'ultimate',
        question: '¿Cuándo necesito Ultimate?',
        answer: 'Cuando llevas tu propia radio: hasta 50 emisoras propias con logo, un aspecto propio del bot en cada servidor, tus propias cadenas de respaldo, webhooks y estadísticas detalladas, además de 16 canales de voz a la vez.',
      },
      {
        key: 'workers',
        question: '¿Cómo funcionan el commander y los workers?',
        answer: 'El commander gestiona los comandos y las invitaciones de workers. Los workers transmiten. Así OmniFM puede repartir varias transmisiones en paralelo de forma limpia y mantenerlas estables.',
      },
    ],
  },
  useCases: {
    eyebrow: '¿Para quién es OmniFM?',
    title: 'Cada plan tiene una función clara',
    subtitle: 'No solo precios: qué plan encaja de verdad con qué servidor.',
    cards: {
      free: {
        title: 'Free para una radio de comunidad rápida',
        desc: 'Si quieres radio 24/7 en un servidor pequeño o privado, Free es el punto de partida más sencillo.',
        fit: 'Ideal para comunidades pequeñas, grupos de amigos y la primera instalación sin carga de administración.',
      },
      pro: {
        title: 'Pro para admins de comunidades',
        desc: 'En cuanto los eventos, los permisos y el panel forman parte del día a día, Pro se convierte en el verdadero plan de gestión.',
        fit: 'Ideal para servidores de eventos, comunidades medianas y equipos con sesiones recurrentes y roles claros.',
      },
      ultimate: {
        title: 'Ultimate para instalaciones de operador',
        desc: 'Cuando importan las herramientas de fiabilidad, las emisoras propias, las estadísticas detalladas y la automatización, Ultimate es el plan adecuado.',
        fit: 'Ideal para comunidades grandes, usuarios avanzados y operadores que quieren que OmniFM funcione como un sistema gestionado.',
      },
    },
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Directamente en Discord',
    titleLead: 'Suena en tu ',
    titleAccent: 'canal de voz',
    titleTail: ', controlado con comandos de barra.',
    body: 'En la web solo escuchas un adelanto – OmniFM suena 24/7 directamente en tu canal de voz de Discord, con panel Now Playing, botones y reconexión automática.',
    cmds: [
      ['/play synthwave', 'Inicia la transmisión en tu canal de voz'],
      ['/now', 'Muestra la canción en directo, la portada y los oyentes'],
      ['/stations', 'Explora más de 120 emisoras seleccionadas'],
    ],
    nowPlaying: 'Now Playing', genre: 'Género', bitrate: 'Bitrate', listeners: 'Oyentes',
    liveStream: 'Radio en directo', liveRadio: 'Radio en directo',
    time: 'hoy a las 21:14',
  },
  // How to start OmniFM in Discord (HowToDiscord.js).
  howTo: {
    eyebrow: 'Guía · en menos de 60 segundos',
    title: 'Cómo iniciar OmniFM en Discord',
    subtitle: 'Tres pasos y tu radio suena 24/7 directamente en el canal de voz.',
    steps: [
      { n: '01', cmd: 'Añadir app', title: 'Invitar al commander', desc: 'Añade el commander de OmniFM a tu servidor. Gestiona todos los comandos de barra y tus workers.' },
      { n: '02', cmd: '/invite', title: 'Añadir un bot worker', desc: 'Invita al menos un worker. Es el que lleva la transmisión de voz — más workers = más canales en paralelo.' },
      { n: '03', cmd: '/play lofi', title: 'Iniciar la radio', desc: 'Elige una emisora y OmniFM entra en tu canal de voz. Mensaje Now Playing, botones y reconexión incluidos.' },
    ],
    permsTitle: 'Permisos',
    perms: ['Unirse a voz y hablar', 'Enviar mensajes y embeds', 'Usar comandos de barra'],
    addServer: 'Añadir al servidor',
    workerHint: 'Worker listo',
    invite: 'Invitar',
    connected: 'conectado',
    nowPlaying: 'Now Playing',
  },
};

export default messages;
