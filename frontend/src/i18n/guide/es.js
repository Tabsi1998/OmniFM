// OmniFM: the texts of the page "Erste Schritte" (/start, #434), Spanish.
// Loaded with that page only (StartGuide.js), so the start page does not carry them.
const guide = {
  eyebrow: 'Primeros pasos',
  title: 'Configura OmniFM en cinco minutos',
  intro: 'Paso a paso, desde la invitación hasta la primera canción, y qué hacer si algo no funciona.',
  toc: 'En esta página',
  steps: [
    {
      id: 'commander',
      title: '1. Invitar al commander',
      body: 'El commander es el bot «OmniFM DJ». Recibe tus comandos y se encarga de los workers. Puede invitarlo quien tenga permiso para «Gestionar el servidor».',
      tips: ['Haz clic en «Invitar al commander», elige tu servidor y confirma con «Autorizar».', 'Deja los permisos sugeridos tal cual: sin ellos, OmniFM no puede entrar en los canales de voz.'],
    },
    {
      id: 'worker',
      title: '2. Añadir un worker',
      body: '¿Por qué dos bots? El commander escucha y los workers ponen la música. Así un servidor puede tener varios canales de voz sonando a la vez, cada uno con su propia emisión.',
      tips: ['Escribe /invite en un canal de texto.', 'Elige «OmniFM 1» e invítalo con el botón.', 'Free tiene 2 workers, Pro 8 y Ultimate 16.'],
    },
    {
      id: 'play',
      title: '3. Poner la radio',
      body: 'Entra en un canal de voz y escribe /play. Mientras escribes, Discord sugiere emisoras, por ejemplo para «lofi».',
      tips: ['/play lofi pone una emisora lofi.', 'Sin nombre de emisora, /play te guía paso a paso.', 'OmniFM sigue sonando las 24 horas hasta que escribas /stop.'],
    },
    {
      id: 'panel',
      title: '4. Panel y favoritas',
      body: 'Para cada emisora, OmniFM muestra un panel (en inglés): lo que suena y botones para pausar, parar, cambiar de emisora y tus emisoras favoritas.',
      tips: ['Marca tus favoritas con la estrella en el explorador de emisoras; luego aparecen como botones en el panel.', '«Save» te guarda una canción, «Share» publica una tarjeta en el canal.', '«Report a problem» nos avisa cuando una emisora falla.'],
    },
    {
      id: 'dashboard',
      title: '5. Panel web',
      body: 'El panel web muestra qué suena y dónde, y te deja configurar tu servidor. Solo inicias sesión con Discord.',
      tips: ['Idioma: en qué idioma responde OmniFM en tu servidor.', 'Voice Guard: qué hace OmniFM cuando alguien lo mueve a otro canal.', 'Eventos: programar emisiones de radio a horas fijas.'],
    },
  ],
  inviteLabel: 'Invitar al commander',
  dashboardLink: 'Ir al panel web',
  helpTitle: 'Si algo no funciona',
  helpIntro: 'Los tropiezos más comunes, cada uno con su solución.',
  help: [
    {
      key: 'join',
      question: 'El bot no entra en el canal de voz',
      answer: 'Casi siempre faltan permisos. Clic derecho en el canal de voz → Editar canal → Permisos: OmniFM necesita «Conectar» y «Hablar». Si el canal está lleno, tiene que quedar un hueco.',
    },
    {
      key: 'silent',
      question: 'No se oye nada',
      answer: 'Comprueba primero que haya un worker en el canal de voz; si no, invita uno con /invite. Si está pero con el micrófono tachado, alguien lo silenció en el servidor: clic derecho sobre él y quita ese silencio. Mira también que no lo hayas bajado tú.',
    },
    {
      key: 'station',
      question: 'Una emisora no funciona',
      answer: 'Si una emisora falla, OmniFM pone automáticamente una parecida y vuelve en cuanto funcione. Si una emisora falla a menudo, pulsa «Report a problem» en el panel y la revisamos.',
    },
    {
      key: 'commands',
      question: 'Faltan los comandos',
      answer: 'Ajustes del servidor → Integraciones → OmniFM DJ: ahí los comandos deben estar permitidos para tu rol y el canal. ¿Recién invitado? Discord puede tardar unos minutos en mostrar los comandos; reiniciar Discord ayuda.',
    },
  ],
  more: '¿Más preguntas? Pregunta en nuestra comunidad de Discord.',
  community: 'Ir a la comunidad',
};

export default guide;
