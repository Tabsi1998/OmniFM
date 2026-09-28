// OmniFM: the texts of the page "Erste Schritte" (/start, #434), Italian.
// Loaded with that page only (StartGuide.js), so the start page does not carry them.
const guide = {
  eyebrow: 'Primi passi',
  title: 'Configura OmniFM in cinque minuti',
  intro: 'Passo dopo passo dall’invito alla prima canzone, e cosa fare se qualcosa non funziona.',
  toc: 'In questa pagina',
  steps: [
    {
      id: 'commander',
      title: '1. Invitare il commander',
      body: 'Il commander è il bot «OmniFM DJ». Riceve i tuoi comandi e gestisce i worker. Può invitarlo chi ha il permesso «Gestire il server».',
      tips: ['Clicca su «Invita il commander», scegli il tuo server e conferma con «Autorizza».', 'Lascia i permessi proposti così come sono: senza, OmniFM non può entrare nei canali vocali.'],
    },
    {
      id: 'worker',
      title: '2. Aggiungere un worker',
      body: 'Perché due bot? Il commander ascolta, i worker suonano. Così un server può avere più canali vocali in funzione allo stesso tempo, ognuno con il proprio stream.',
      tips: ['Scrivi /invite in un canale testuale.', 'Scegli «OmniFM 1» e invitalo con il pulsante.', 'Free ha 2 worker, Pro 8 e Ultimate 16.'],
    },
    {
      id: 'play',
      title: '3. Avviare la radio',
      body: 'Entra in un canale vocale e scrivi /play. Mentre scrivi, Discord suggerisce le stazioni, per esempio per «lofi».',
      tips: ['/play lofi avvia una stazione lofi.', 'Senza nome della stazione, /play ti guida passo dopo passo.', 'OmniFM continua a suonare 24 ore su 24 finché non scrivi /stop.'],
    },
    {
      id: 'panel',
      title: '4. Pannello e preferiti',
      body: 'Per ogni stazione OmniFM mostra un pannello (in inglese): cosa suona, e pulsanti per pausa, stop, altre stazioni e le tue stazioni preferite.',
      tips: ['Segna le preferite con la stella nel browser delle stazioni; poi compaiono come pulsanti nel pannello.', '«Save» mette da parte una canzone per te, «Share» pubblica una scheda nel canale.', '«Report a problem» ci avvisa quando una stazione si inceppa.'],
    },
    {
      id: 'dashboard',
      title: '5. Dashboard',
      body: 'La dashboard mostra cosa suona e dove, e ti permette di configurare il server. Accedi semplicemente con Discord.',
      tips: ['Lingua: in che lingua OmniFM risponde sul tuo server.', 'Voice Guard: cosa fa OmniFM quando qualcuno lo sposta in un altro canale.', 'Eventi: programmare trasmissioni radio a orari fissi.'],
    },
  ],
  inviteLabel: 'Invita il commander',
  dashboardLink: 'Apri la dashboard',
  helpTitle: 'Se qualcosa non funziona',
  helpIntro: 'Gli intoppi più comuni, ognuno con la sua soluzione.',
  help: [
    {
      key: 'join',
      question: 'Il bot non entra nel canale vocale',
      answer: 'Di solito mancano i permessi. Clic destro sul canale vocale → Modifica canale → Permessi: OmniFM ha bisogno di «Connettersi» e «Parlare». Se il canale è pieno, deve esserci un posto libero.',
    },
    {
      key: 'silent',
      question: 'Non si sente niente',
      answer: 'Controlla prima che nel canale vocale ci sia un worker; se no, invitane uno con /invite. Se c’è ma ha il microfono barrato, qualcuno l’ha silenziato nel server: clic destro su di lui e togli il silenziamento. Controlla anche di non averlo abbassato tu.',
    },
    {
      key: 'station',
      question: 'Una stazione non funziona',
      answer: 'Se una stazione cade, OmniFM ne suona automaticamente una simile e torna indietro appena riparte. Se una stazione si inceppa spesso, premi «Report a problem» nel pannello e la controlliamo.',
    },
    {
      key: 'commands',
      question: 'Mancano i comandi',
      answer: 'Impostazioni del server → Integrazioni → OmniFM DJ: lì i comandi devono essere consentiti per il tuo ruolo e il canale. Appena invitato? Discord può metterci qualche minuto a mostrare i comandi; riavviare Discord aiuta.',
    },
  ],
  more: 'Altre domande? Chiedi nella nostra community Discord.',
  community: 'Vai alla community',
};

export default guide;
