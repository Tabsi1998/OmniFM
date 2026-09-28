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
    body: 'O OmniFM usa o armazenamento necessário para idioma, segurança e sessões do painel. A tag do Google funciona com o modo de consentimento; o armazenamento de estatísticas só é permitido se você concordar.',
    necessaryTitle: 'Necessários',
    necessaryBody: 'Indispensáveis para o idioma escolhido, as sessões seguras do painel e o funcionamento técnico. Esta categoria não pode ser desativada.',
    analyticsTitle: 'Estatísticas',
    analyticsBody: 'Permite o Google Analytics 4 com o modo de consentimento para medir de forma geral as visualizações e o uso. Sem consentimento, o armazenamento de estatísticas continua negado.',
    acceptAll: 'Aceitar tudo',
    reject: 'Recusar',
    save: 'Salvar seleção',
    manage: 'Configurações de cookies',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Sua rádio',
    titleAccent: 'no Discord.',
    titleTail: '24/7 ao vivo.',
    subtitleLead: 'Rádio no Discord 24/7 com mais de 120 estações, a confiabilidade dos workers, controle pelo painel e reconexão limpa. Convide o commander, adicione um worker e use',
    subtitleTail: '.',
    ctaInvite: 'Convidar o commander',
    ctaFlow: 'Como funciona',
    stats: {
      servers: 'Servidores',
      stations: 'Estações',
      bots: 'Bots',
    },
  },
  trustBar: {
    items: {
      stations: {
        label: 'Estações',
        detail: 'Catálogo ao vivo para Free e Pro, com prévia direto no site.',
      },
      network: {
        label: 'Atividade ao vivo',
        detail: 'Transmissões ativas e uma rede de bots pronta mostram que o OmniFM roda de verdade em produção, não só numa página inicial.',
      },
      dashboard: {
        label: 'Painel',
        detail: 'Visão ao vivo, estatísticas, permissões por cargo e alertas de queda a partir do Pro.',
      },
      reliability: {
        label: 'Confiabilidade',
        detail: 'Reconexão, planos claros e um caminho simples para servidores que crescem.',
      },
    },
    values: {
      dashboard: 'Free+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} free · ${pro} pro`,
      network: ({ bots, servers }) => `${bots} bots · ${servers} servidores`,
      dashboard: 'Eventos · permissões · status',
      reliability: 'Reconexão · workers · planos claros',
    },
  },
  whyOmniFM: {
    eyebrow: 'Por que OmniFM',
    title: 'Não é só um bot de rádio, é uma estrutura de Discord bem feita',
    subtitle: 'O OmniFM dá o seu melhor quando música, confiabilidade e gestão do servidor trabalham juntas.',
    cards: {
      radio: {
        label: 'Rádio',
        title: 'Começo rápido',
        desc: 'Convide o commander, adicione um worker, use /play e ouça na hora. Sem configuração pesada antes de aproveitar.',
      },
      workers: {
        label: 'Workers',
        title: 'Mais que um só bot',
        desc: 'A arquitetura de workers distribui as transmissões de forma limpa e torna previsível o uso em paralelo em comunidades grandes.',
      },
      control: {
        label: 'Controle',
        title: 'Controle para os admins',
        desc: 'Painel, eventos, permissões por cargo e visões de status dão aos servidores Pro controle de verdade, não só mais estações.',
      },
      growth: {
        label: 'Crescimento',
        title: 'Crescer sem atrito',
        desc: 'Free, Pro e Ultimate se baseiam no mesmo núcleo, do começo rápido até uma estrutura de nível operador.',
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
    subtitle: 'O primeiro uso deve ser rápido, o caminho de upgrade claro e a arquitetura fácil de entender.',
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
        answer: 'O Free é um ótimo ponto de partida: até 2 bots, 20 estações gratuitas, os comandos principais e todo o fluxo de commander e worker.',
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
        key: 'workers',
        question: 'Como funcionam o commander e os workers?',
        answer: 'O commander cuida dos comandos e dos convites de workers. Os workers fazem as transmissões. Assim o OmniFM distribui várias transmissões em paralelo de forma limpa e as mantém estáveis.',
      },
    ],
  },
  useCases: {
    eyebrow: 'Para quem é o OmniFM?',
    title: 'Cada plano tem uma função clara',
    subtitle: 'Não só preços: qual plano combina de verdade com qual servidor.',
    cards: {
      free: {
        title: 'Free para uma rádio da comunidade rápida',
        desc: 'Se você quer rádio 24/7 num servidor pequeno ou privado, o Free é o ponto de partida mais simples.',
        fit: 'Ideal para comunidades menores, grupos de amigos e a primeira estrutura sem trabalho de administração.',
      },
      pro: {
        title: 'Pro para admins de comunidade',
        desc: 'Quando eventos, permissões e painel viram parte do dia a dia, o Pro passa a ser o verdadeiro plano de gestão.',
        fit: 'Ideal para servidores de eventos, comunidades médias e equipes com sessões recorrentes e cargos claros.',
      },
      ultimate: {
        title: 'Ultimate para estruturas de operador',
        desc: 'Quando ferramentas de confiabilidade, estações próprias, estatísticas detalhadas e automação importam, o Ultimate é o plano certo.',
        fit: 'Ideal para comunidades grandes, usuários avançados e operadores que querem que o OmniFM funcione como um sistema gerenciado.',
      },
    },
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
