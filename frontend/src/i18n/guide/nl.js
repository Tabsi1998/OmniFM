// OmniFM: the texts of the page "Erste Schritte" (/start, #434), Dutch.
// Loaded with that page only (StartGuide.js), so the start page does not carry them.
const guide = {
  eyebrow: 'Aan de slag',
  title: 'OmniFM in vijf minuten instellen',
  intro: 'Stap voor stap van de uitnodiging tot het eerste nummer, en wat helpt als iets niet werkt.',
  toc: 'Op deze pagina',
  steps: [
    {
      id: 'commander',
      title: '1. De commander uitnodigen',
      body: 'De commander is de bot ‘OmniFM DJ’. Hij neemt je commando’s aan en regelt de workers. Iedereen die ‘Server beheren’ mag, kan hem uitnodigen.',
      tips: ['Klik op ‘Commander uitnodigen’, kies je server en bevestig met ‘Autoriseren’.', 'Laat de voorgestelde rechten zoals ze zijn: zonder kan OmniFM geen spraakkanalen in.'],
    },
    {
      id: 'worker',
      title: '2. Een worker toevoegen',
      body: 'Waarom twee bots? De commander luistert, de workers spelen. Zo kan één server meerdere spraakkanalen tegelijk laten spelen, elk met een eigen stream.',
      tips: ['Typ /invite in een tekstkanaal.', 'Kies ‘OmniFM 1’ en nodig hem uit met de knop.', 'Free heeft 2 workers, Pro 8 en Ultimate 16.'],
    },
    {
      id: 'play',
      title: '3. De radio starten',
      body: 'Ga een spraakkanaal in en typ /play. Tijdens het typen stelt Discord zenders voor, bijvoorbeeld bij ‘lofi’.',
      tips: ['/play lofi start een lofi-zender.', 'Zonder zendernaam leidt /play je stap voor stap door de keuze.', 'OmniFM speelt de klok rond door tot je /stop typt.'],
    },
    {
      id: 'panel',
      title: '4. Paneel en favorieten',
      body: 'Bij elke zender toont OmniFM een paneel (in het Engels): wat er speelt, en knoppen voor pauze, stop, andere zenders en je favoriete zenders.',
      tips: ['Markeer favoriete zenders met de ster in de zenderbrowser; ze verschijnen dan als knoppen in het paneel.', '‘Save’ legt een nummer voor je opzij, ‘Share’ plaatst een kaart in het kanaal.', '‘Report a problem’ laat het ons weten als een zender hapert.'],
    },
    {
      id: 'dashboard',
      title: '5. Dashboard',
      body: 'Het dashboard laat zien wat waar speelt en regelt je server. Je logt gewoon in met Discord.',
      tips: ['Taal: in welke taal OmniFM op je server antwoordt.', 'Voice Guard: wat OmniFM doet als iemand hem naar een ander kanaal verplaatst.', 'Events: radio-uitzendingen op vaste tijden plannen.'],
    },
  ],
  inviteLabel: 'Commander uitnodigen',
  dashboardLink: 'Naar het dashboard',
  helpTitle: 'Als iets niet werkt',
  helpIntro: 'De meest voorkomende struikelblokken, elk met de oplossing.',
  help: [
    {
      key: 'join',
      question: 'De bot komt het spraakkanaal niet in',
      answer: 'Meestal ontbreken rechten. Rechtsklik op het spraakkanaal → Kanaal bewerken → Rechten: OmniFM heeft daar ‘Verbinden’ en ‘Spreken’ nodig. Is het kanaal vol, dan moet er een plek vrij zijn.',
    },
    {
      key: 'silent',
      question: 'Er is niets te horen',
      answer: 'Kijk eerst of er een worker in het spraakkanaal is; zo niet, nodig er een uit met /invite. Is hij er wel maar met een doorgestreepte microfoon, dan heeft iemand hem op de server gedempt: rechtsklik op hem en hef de demping op. Kijk ook of je hem voor jezelf niet zachter hebt gezet.',
    },
    {
      key: 'station',
      question: 'Een zender werkt niet',
      answer: 'Valt een zender uit, dan speelt OmniFM automatisch een vergelijkbare en schakelt terug zodra hij weer speelt. Hapert een zender vaak, druk dan in het paneel op ‘Report a problem’, dan kijken we ernaar.',
    },
    {
      key: 'commands',
      question: 'De commando’s ontbreken',
      answer: 'Serverinstellingen → Integraties → OmniFM DJ: daar moeten de commando’s voor je rol en het kanaal toegestaan zijn. Net uitgenodigd? Dan kan het een paar minuten duren voor Discord de commando’s toont; Discord herstarten helpt.',
    },
  ],
  more: 'Nog vragen? Stel ze in onze Discord-community.',
  community: 'Naar de community',
};

export default guide;
