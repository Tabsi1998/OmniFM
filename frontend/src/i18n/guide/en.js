// OmniFM: the texts of the page "Erste Schritte" (/start, #434), English.
// Loaded with that page only (StartGuide.js), so the start page does not carry them.
const guide = {
  eyebrow: 'Getting started',
  title: 'Set up OmniFM in five minutes',
  intro: 'Step by step from the invitation to the first song, and what helps when something does not work.',
  toc: 'On this page',
  steps: [
    {
      id: 'commander',
      title: '1. Invite the commander',
      body: 'The commander is the bot “OmniFM DJ”. It takes your commands and looks after the workers. Anyone who may “Manage Server” can invite it.',
      tips: ['Click “Invite commander”, pick your server and confirm with “Authorize”.', 'Leave the suggested permissions as they are: without them OmniFM cannot join voice channels.'],
    },
    {
      id: 'worker',
      title: '2. Add a worker',
      body: 'Why two bots? The commander listens, the workers play. That way one server can run several voice channels at once, each with its own stream.',
      tips: ['Type /invite in a text channel.', 'Pick “OmniFM 1” and invite it with the button.', 'Free has 2 workers, Pro 8 and Ultimate 16.'],
    },
    {
      id: 'play',
      title: '3. Start the radio',
      body: 'Join a voice channel and type /play. As you type, Discord suggests matching stations, for example for “lofi”.',
      tips: ['/play lofi starts a lofi station.', 'Without a station name, /play guides you step by step.', 'OmniFM keeps playing around the clock until you type /stop.'],
    },
    {
      id: 'panel',
      title: '4. Panel and favourites',
      body: 'For every station OmniFM shows a panel: what is playing, and buttons for pause, stop, other stations and your favourite stations.',
      tips: ['Mark favourite stations with the star in the station browser; they then appear as buttons in the panel.', '“Save” keeps a song for you, “Share” posts a card in the channel.', '“Report a problem” sends us a note when a station hiccups.'],
    },
    {
      id: 'dashboard',
      title: '5. Dashboard',
      body: 'The dashboard shows what plays where and lets you set up your server. You simply sign in with Discord.',
      tips: ['Language: which language OmniFM answers in on your server.', 'Voice Guard: what OmniFM does when someone moves it to another channel.', 'Events: plan radio shows at fixed times.'],
    },
  ],
  inviteLabel: 'Invite commander',
  dashboardLink: 'Open the dashboard',
  helpTitle: 'When something does not work',
  helpIntro: 'The most common stumbling blocks, each with its fix.',
  help: [
    {
      key: 'join',
      question: 'The bot does not join the voice channel',
      answer: 'Usually permissions are missing. Right-click the voice channel → Edit Channel → Permissions: OmniFM needs “Connect” and “Speak” there. If the channel is full, a seat must be free.',
    },
    {
      key: 'silent',
      question: 'Nothing can be heard',
      answer: 'First check that a worker is in the voice channel; if not, invite one with /invite. If it is there with a crossed-out microphone, someone muted it for the server: right-click it and turn off “Server Mute”. Also check you have not turned it down for yourself.',
    },
    {
      key: 'station',
      question: 'A station does not work',
      answer: 'If a station fails, OmniFM plays a similar one automatically and switches back as soon as it plays again. If a station hiccups often, press “Report a problem” in the panel and we will look into it.',
    },
    {
      key: 'commands',
      question: 'The commands are missing',
      answer: 'Server Settings → Integrations → OmniFM DJ: the commands must be allowed there for your role and the channel. Just invited? It can take a few minutes until Discord shows the commands; restarting Discord helps.',
    },
  ],
  more: 'More questions? Ask in our Discord community.',
  community: 'Join the community',
};

export default guide;
