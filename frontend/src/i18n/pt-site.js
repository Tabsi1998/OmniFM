// OmniFM website texts, Portuguese (Brazil): navigation, start page sections, stations, FAQ (#306).
// The same keys as en-site.js; put together in ./languages.js.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Como funciona', href: '#features' },
      { key: 'why', label: 'Por que OmniFM', href: '#why-omnifm' },
      { key: 'stations', label: 'Estações', page: 'stations' },
      { key: 'pricing', label: 'Preços', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Comunidade no Discord',
  },
  cookieConsent: {
    title: 'Cookies e estatísticas',
    short: 'Só guardamos o que o site precisa (idioma, login). O Google Analytics só usa cookies se você concordar.',
    privacyLink: 'Privacidade',
    necessaryTitle: 'Necessários',
    necessaryBody: 'Para o seu idioma, o login seguro no painel e para o site funcionar. Não pode ser desativado.',
    analyticsTitle: 'Estatísticas (Google Analytics)',
    analyticsBody: 'Conta de forma aproximada quais páginas são visitadas, para melhorarmos o site. Sem o seu consentimento, o Google Analytics não usa cookies.',
    acceptAll: 'Aceitar tudo',
    reject: 'Recusar',
    settings: 'Configurações',
    save: 'Salvar seleção',
    manage: 'Configurações de cookies',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Sua rádio',
    titleAccent: 'no Discord.',
    titleTail: '24/7 ao vivo.',
    subtitleLead: 'Rádio 24 horas no seu canal de voz do Discord: estações de todos os gêneros, um painel para controlar tudo e, se uma transmissão cair, o OmniFM se reconecta sozinho. Convide o commander, adicione um worker e use',
    subtitleTail: '.',
    ctaInvite: 'Convidar o commander',
    ctaFlow: 'Como funciona',
  },
  trustBar: {
    live: 'Números ao vivo',
    items: {
      servers: { label: 'Servidores', detail: 'usam o OmniFM' },
      stations: { label: 'Estações', detail: 'para ouvir, também aqui' },
      bots: { label: 'Bots', detail: 'prontos para tocar' },
      listeners: { label: 'Ouvindo agora', detail: 'em todos os servidores' },
    },
  },
  whyOmniFM: {
    eyebrow: 'Por que OmniFM',
    title: 'Mais que um bot de rádio',
    subtitle: 'Música que não para e tudo o que você precisa para gerenciar o seu servidor.',
    cards: {
      radio: {
        label: 'Rádio',
        title: 'Começo rápido',
        desc: 'Convide o commander, adicione um worker, use /play e ouça na hora. Sem configuração pesada antes de aproveitar.',
      },
      workers: {
        label: 'Workers',
        title: 'Mais que um só bot',
        desc: 'Vários bots dividem o trabalho: cada worker toca no seu próprio canal de voz, então um servidor grande pode ter várias estações ao mesmo tempo.',
      },
      control: {
        label: 'Controle',
        title: 'Controle para os admins',
        desc: 'O painel mostra o que toca e onde, ajusta o idioma e planeja eventos. O Pro acrescenta a visão ao vivo, estatísticas, permissões por cargo e alertas de queda.',
      },
      growth: {
        label: 'Crescimento',
        title: 'Crescer sem atrito',
        desc: 'Free, Pro e Ultimate se complementam: ao subir de plano, tudo continua configurado e você simplesmente ganha mais.',
      },
    },
  },
  stations: {
    eyebrow: 'Diretório de estações ao vivo',
    title: 'Estações do OmniFM',
    summary: ({ count, free, pro, ultimate }) => `${count} estações (${free} free, ${pro} pro, ${ultimate} ultimate). Clique para ouvir uma prévia ou use /play no Discord.`,
    nowPlaying: 'Tocando a prévia',
    searchPlaceholder: 'Buscar estações...',
    filters: {
      all: 'Todas',
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
    filterSummary: ({ count, free, pro, ultimate }) => `${count} estações (${free} free, ${pro} pro, ${ultimate} ultimate)`,
    loading: 'Carregando estações...',
    empty: 'Nenhuma estação encontrada.',
    loadMore: ({ remaining }) => `Mostrar mais (faltam ${remaining})`,
    visible: ({ visible, total }) => `Mostrando ${visible} de ${total} estações`,
    previewVolume: 'Volume',
    stopPreview: 'Parar prévia',
    tiers: {
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'As perguntas mais importantes antes de começar',
    subtitle: 'Em poucas palavras: como começar, o que os planos trazem e como o OmniFM funciona.',
    items: [
      {
        key: 'start',
        question: 'Qual é o jeito mais simples de começar com o OmniFM?',
        answer: 'Normalmente em menos de um minuto: convide o commander, adicione pelo menos um worker, entre num canal de voz, depois use /play e escolha uma estação.',
      },
      {
        key: 'workerRequired',
        question: 'Preciso de um worker antes do /play?',
        answer: 'Sim. O commander recebe os comandos, mas a transmissão passa por um worker. O /play só funciona direito quando há um worker no servidor.',
      },
      {
        key: 'free',
        question: 'O que o plano Free inclui?',
        answer: 'O Free basta para começar: até 2 bots, 20 estações e todos os comandos de que você precisa para ouvir rádio.',
      },
      {
        key: 'dashboard',
        question: 'Preciso do painel logo de cara?',
        answer: 'Não, tudo funciona também no Discord. No Free, o painel mostra o que toca onde, troca ou para a estação, define o idioma e agenda um evento. O Pro adiciona a visão ao vivo, estatísticas, eventos ilimitados, permissões por cargo e alertas de queda.',
      },
      {
        key: 'pro',
        question: 'Quando vale a pena o Pro?',
        answer: 'Assim que você quiser moldar e administrar seu servidor: todas as estações do catálogo, 8 canais de voz ao mesmo tempo, o painel com visão ao vivo, eventos ilimitados, permissões por cargo e alertas de queda no Discord.',
      },
      {
        key: 'ultimate',
        question: 'Quando preciso do Ultimate?',
        answer: 'Quando você toca a sua própria rádio: até 50 estações próprias com logo, visual próprio do bot em cada servidor, suas próprias cadeias de estações reserva, webhooks e estatísticas detalhadas, além de 16 canais de voz ao mesmo tempo.',
      },
      {
        key: 'planStatus',
        question: 'Como vejo qual plano o meu servidor tem?',
        answer: 'No painel: entre com o Discord, escolha o seu servidor e abra “Assinatura e licença”. Lá aparecem o plano e até quando ele vale. No Discord, o comando /premium também mostra.',
        link: { label: 'Abrir o painel', page: 'dashboard' },
      },
      {
        key: 'workers',
        question: 'Como funcionam o commander e os workers?',
        answer: 'O commander recebe os seus comandos; /invite dá os links para os workers. Os workers tocam a rádio nos canais de voz. Assim um servidor pode ouvir várias estações ao mesmo tempo.',
      },
    ],
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Direto no Discord',
    titleLead: 'Toca no seu ',
    titleAccent: 'canal de voz',
    titleTail: ', controlado por comandos de barra.',
    body: 'No site você só ouve uma prévia – o OmniFM toca 24/7 direto no seu canal de voz do Discord, com painel Now Playing, botões e reconexão automática.',
    cmds: [
      ['/play synthwave', 'Inicia a transmissão no seu canal de voz'],
      ['/now', 'Mostra a música ao vivo, a capa e os ouvintes'],
      ['/stations', 'Navegue por mais de 120 estações selecionadas'],
    ],
    nowPlaying: 'Now Playing', genre: 'Gênero', bitrate: 'Bitrate', listeners: 'Ouvintes',
    liveStream: 'Rádio ao vivo', liveRadio: 'Rádio ao vivo',
    time: 'hoje às 21:14',
  },
  // How to start OmniFM in Discord (HowToDiscord.js).
  howTo: {
    eyebrow: 'Guia · em menos de 60 segundos',
    title: 'Como iniciar o OmniFM no Discord',
    subtitle: 'Três passos e sua rádio toca 24/7 direto no canal de voz.',
    steps: [
      { n: '01', cmd: 'Adicionar app', title: 'Convidar o commander', desc: 'Adicione o commander do OmniFM ao seu servidor. Ele cuida de todos os comandos de barra e dos seus workers.' },
      { n: '02', cmd: '/invite', title: 'Adicionar um bot worker', desc: 'Convide pelo menos um worker. É ele que leva a transmissão de voz — mais workers = mais canais em paralelo.' },
      { n: '03', cmd: '/play lofi', title: 'Iniciar a rádio', desc: 'Escolha uma estação e o OmniFM entra no seu canal de voz. Mensagem Now Playing, botões e reconexão inclusos.' },
    ],
    permsTitle: 'Permissões',
    perms: ['Entrar na voz e falar', 'Enviar mensagens e embeds', 'Usar comandos de barra'],
    addServer: 'Adicionar ao servidor',
    workerHint: 'Worker pronto',
    invite: 'Convidar',
    connected: 'conectado',
    nowPlaying: 'Now Playing',
  },
};

export default messages;
