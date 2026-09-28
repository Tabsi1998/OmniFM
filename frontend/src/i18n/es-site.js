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
    short: 'Solo guardamos lo que la web necesita (idioma, inicio de sesión). Google Analytics solo pone cookies si aceptas.',
    privacyLink: 'Privacidad',
    necessaryTitle: 'Necesarias',
    necessaryBody: 'Para tu idioma, el inicio de sesión seguro en el panel y para que la web funcione. No se puede desactivar.',
    analyticsTitle: 'Estadísticas (Google Analytics)',
    analyticsBody: 'Cuenta de forma aproximada qué páginas se visitan para que podamos mejorar la web. Sin tu consentimiento, Google Analytics no pone cookies.',
    acceptAll: 'Aceptar todo',
    reject: 'Rechazar',
    settings: 'Ajustes',
    save: 'Guardar selección',
    manage: 'Ajustes de cookies',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Tu radio',
    titleAccent: 'de Discord.',
    titleTail: '24/7 en directo.',
    subtitleLead: 'Radio las 24 horas en tu canal de voz de Discord: emisoras de todos los géneros, un panel para controlarlo todo y, si una emisión se corta, OmniFM se reconecta solo. Invita al commander, añade un worker y usa',
    subtitleTail: '.',
    ctaInvite: 'Invitar al commander',
    ctaFlow: 'Cómo funciona',
  },
  trustBar: {
    live: 'Cifras en directo',
    items: {
      servers: { label: 'Servidores', detail: 'usan OmniFM' },
      stations: { label: 'Emisoras', detail: 'para escuchar, también aquí' },
      bots: { label: 'Bots', detail: 'listos para sonar' },
      listeners: { label: 'Escuchando ahora', detail: 'en todos los servidores' },
    },
  },
  whyOmniFM: {
    eyebrow: 'Por qué OmniFM',
    title: 'Más que un bot de radio',
    subtitle: 'Música que no se detiene y todo lo que necesitas para gestionar tu servidor.',
    cards: {
      radio: {
        label: 'Radio',
        title: 'Rápido de empezar',
        desc: 'Invita al commander, añade un worker, usa /play y escucha al instante. Sin configuraciones pesadas antes de disfrutarlo.',
      },
      workers: {
        label: 'Workers',
        title: 'Más que un solo bot',
        desc: 'Varios bots se reparten el trabajo: cada worker suena en su propio canal de voz, así un servidor grande puede tener varias emisoras a la vez.',
      },
      control: {
        label: 'Control',
        title: 'Control para los admins',
        desc: 'El panel muestra qué suena y dónde, ajusta el idioma y planifica eventos. Pro añade la vista en directo, estadísticas, permisos por rol y avisos de caídas.',
      },
      growth: {
        label: 'Crecimiento',
        title: 'Crecer sin fricción',
        desc: 'Free, Pro y Ultimate se basan uno en otro: al subir de plan todo sigue configurado y simplemente obtienes más.',
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
    subtitle: 'En pocas palabras: cómo empezar, qué traen los planes y cómo funciona OmniFM.',
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
        answer: 'Free basta para empezar: hasta 2 bots, 20 emisoras y todos los comandos que necesitas para escuchar radio.',
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
        key: 'planStatus',
        question: '¿Cómo veo qué plan tiene mi servidor?',
        answer: 'En el panel: inicia sesión con Discord, elige tu servidor y abre «Suscripción y licencia». Ahí ves el plan y hasta cuándo dura. En Discord también lo muestra el comando /premium.',
        link: { label: 'Ir al panel', page: 'dashboard' },
      },
      {
        key: 'workers',
        question: '¿Cómo funcionan el commander y los workers?',
        answer: 'El commander recibe tus comandos; /invite te da los enlaces para los workers. Los workers ponen la radio en los canales de voz. Así un servidor puede escuchar varias emisoras a la vez.',
      },
    ],
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
