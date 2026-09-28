// OmniFM: the texts of the page "Erste Schritte" (/start, #434), Portuguese.
// Loaded with that page only (StartGuide.js), so the start page does not carry them.
const guide = {
  eyebrow: 'Primeiros passos',
  title: 'Configure o OmniFM em cinco minutos',
  intro: 'Passo a passo, do convite à primeira música, e o que ajuda quando algo não funciona.',
  toc: 'Nesta página',
  steps: [
    {
      id: 'commander',
      title: '1. Convidar o commander',
      body: 'O commander é o bot “OmniFM DJ”. Ele recebe os seus comandos e cuida dos workers. Pode convidá-lo quem tiver a permissão “Gerenciar servidor”.',
      tips: ['Clique em “Convidar o commander”, escolha o seu servidor e confirme com “Autorizar”.', 'Deixe as permissões sugeridas como estão: sem elas, o OmniFM não entra nos canais de voz.'],
    },
    {
      id: 'worker',
      title: '2. Adicionar um worker',
      body: 'Por que dois bots? O commander ouve, os workers tocam. Assim um servidor pode tocar em vários canais de voz ao mesmo tempo, cada um com a sua própria transmissão.',
      tips: ['Digite /invite em um canal de texto.', 'Escolha “OmniFM 1” e convide-o com o botão.', 'O Free tem 2 workers, o Pro 8 e o Ultimate 16.'],
    },
    {
      id: 'play',
      title: '3. Ligar a rádio',
      body: 'Entre em um canal de voz e digite /play. Enquanto você digita, o Discord sugere estações, por exemplo para “lofi”.',
      tips: ['/play lofi liga uma estação lofi.', 'Sem o nome da estação, o /play guia você passo a passo.', 'O OmniFM continua tocando 24 horas até você digitar /stop.'],
    },
    {
      id: 'panel',
      title: '4. Painel e favoritas',
      body: 'Para cada estação, o OmniFM mostra um painel (em inglês): o que está tocando e botões para pausar, parar, trocar de estação e as suas favoritas.',
      tips: ['Marque as favoritas com a estrela no navegador de estações; elas aparecem então como botões no painel.', '“Save” guarda uma música para você, “Share” publica um cartão no canal.', '“Report a problem” nos avisa quando uma estação falha.'],
    },
    {
      id: 'dashboard',
      title: '5. Painel no site',
      body: 'O painel no site mostra o que toca e onde e permite configurar o seu servidor. É só entrar com o Discord.',
      tips: ['Idioma: em que idioma o OmniFM responde no seu servidor.', 'Voice Guard: o que o OmniFM faz quando alguém o move para outro canal.', 'Eventos: programar transmissões de rádio em horários fixos.'],
    },
  ],
  inviteLabel: 'Convidar o commander',
  dashboardLink: 'Abrir o painel',
  helpTitle: 'Quando algo não funciona',
  helpIntro: 'Os tropeços mais comuns, cada um com a solução.',
  help: [
    {
      key: 'join',
      question: 'O bot não entra no canal de voz',
      answer: 'Geralmente faltam permissões. Clique com o botão direito no canal de voz → Editar canal → Permissões: o OmniFM precisa de “Conectar” e “Falar”. Se o canal estiver cheio, precisa haver uma vaga.',
    },
    {
      key: 'silent',
      question: 'Não se ouve nada',
      answer: 'Veja primeiro se há um worker no canal de voz; se não, convide um com /invite. Se ele está lá, mas com o microfone riscado, alguém o silenciou no servidor: clique com o botão direito nele e tire esse silêncio. Veja também se você não abaixou o volume dele para você.',
    },
    {
      key: 'station',
      question: 'Uma estação não funciona',
      answer: 'Se uma estação cair, o OmniFM toca automaticamente uma parecida e volta assim que ela voltar. Se uma estação falha com frequência, toque em “Report a problem” no painel e nós verificamos.',
    },
    {
      key: 'commands',
      question: 'Os comandos não aparecem',
      answer: 'Configurações do servidor → Integrações → OmniFM DJ: ali os comandos precisam estar liberados para o seu cargo e o canal. Acabou de convidar? O Discord pode levar alguns minutos para mostrar os comandos; reiniciar o Discord ajuda.',
    },
  ],
  more: 'Mais perguntas? Pergunte na nossa comunidade do Discord.',
  community: 'Ir para a comunidade',
};

export default guide;
