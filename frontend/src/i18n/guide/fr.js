// OmniFM: the texts of the page "Erste Schritte" (/start, #434), French.
// Loaded with that page only (StartGuide.js), so the start page does not carry them.
const guide = {
  eyebrow: 'Premiers pas',
  title: 'Installer OmniFM en cinq minutes',
  intro: 'Étape par étape, de l’invitation au premier morceau, et ce qui aide quand quelque chose ne marche pas.',
  toc: 'Sur cette page',
  steps: [
    {
      id: 'commander',
      title: '1. Inviter le commander',
      body: 'Le commander est le bot « OmniFM DJ ». Il reçoit tes commandes et s’occupe des workers. Toute personne autorisée à « Gérer le serveur » peut l’inviter.',
      tips: ['Clique sur « Inviter le commander », choisis ton serveur et confirme avec « Autoriser ».', 'Laisse les permissions proposées telles quelles : sans elles, OmniFM ne peut pas rejoindre les salons vocaux.'],
    },
    {
      id: 'worker',
      title: '2. Ajouter un worker',
      body: 'Pourquoi deux bots ? Le commander écoute, les workers jouent. Ainsi, un serveur peut faire jouer plusieurs salons vocaux en même temps, chacun avec son propre flux.',
      tips: ['Tape /invite dans un salon textuel.', 'Choisis « OmniFM 1 » et invite-le avec le bouton.', 'Free a 2 workers, Pro 8 et Ultimate 16.'],
    },
    {
      id: 'play',
      title: '3. Lancer la radio',
      body: 'Rejoins un salon vocal et tape /play. Pendant la saisie, Discord propose des stations, par exemple pour « lofi ».',
      tips: ['/play lofi lance une station lofi.', 'Sans nom de station, /play te guide pas à pas.', 'OmniFM joue 24 h/24 jusqu’à ce que tu tapes /stop.'],
    },
    {
      id: 'panel',
      title: '4. Panneau et favoris',
      body: 'Pour chaque station, OmniFM affiche un panneau (en anglais) : ce qui passe, et des boutons pour pause, stop, d’autres stations et tes stations préférées.',
      tips: ['Marque tes stations préférées avec l’étoile dans le navigateur de stations ; elles apparaissent alors en boutons dans le panneau.', '« Save » garde un morceau pour toi, « Share » publie une carte dans le salon.', '« Report a problem » nous prévient quand une station coince.'],
    },
    {
      id: 'dashboard',
      title: '5. Tableau de bord',
      body: 'Le tableau de bord montre ce qui joue et où, et te permet de régler ton serveur. Tu te connectes simplement avec Discord.',
      tips: ['Langue : la langue dans laquelle OmniFM répond sur ton serveur.', 'Voice Guard : ce que fait OmniFM quand quelqu’un le déplace dans un autre salon.', 'Événements : planifier des émissions radio à heure fixe.'],
    },
  ],
  inviteLabel: 'Inviter le commander',
  dashboardLink: 'Ouvrir le tableau de bord',
  helpTitle: 'Quand quelque chose ne marche pas',
  helpIntro: 'Les pièges les plus fréquents, chacun avec sa solution.',
  help: [
    {
      key: 'join',
      question: 'Le bot ne rejoint pas le salon vocal',
      answer: 'Il manque souvent des permissions. Clic droit sur le salon vocal → Modifier le salon → Permissions : OmniFM y a besoin de « Se connecter » et « Parler ». Si le salon est plein, il faut une place libre.',
    },
    {
      key: 'silent',
      question: 'On n’entend rien',
      answer: 'Vérifie d’abord qu’un worker est dans le salon vocal ; sinon, invites-en un avec /invite. S’il est là avec un micro barré, quelqu’un l’a rendu muet sur le serveur : clic droit dessus et retire cette sourdine. Vérifie aussi que tu ne l’as pas baissé pour toi.',
    },
    {
      key: 'station',
      question: 'Une station ne marche pas',
      answer: 'Si une station tombe, OmniFM en joue automatiquement une semblable et revient dès qu’elle rejoue. Si une station coince souvent, appuie sur « Report a problem » dans le panneau, et on s’en occupe.',
    },
    {
      key: 'commands',
      question: 'Les commandes manquent',
      answer: 'Paramètres du serveur → Intégrations → OmniFM DJ : les commandes doivent y être autorisées pour ton rôle et le salon. Tout juste invité ? Discord peut mettre quelques minutes à afficher les commandes ; redémarrer Discord aide.',
    },
  ],
  more: 'Encore des questions ? Pose-les dans notre communauté Discord.',
  community: 'Rejoindre la communauté',
};

export default guide;
