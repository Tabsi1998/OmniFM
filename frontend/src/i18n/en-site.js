// OmniFM website texts, English: the website: navigation, start page sections, stations, commands, FAQ (#296).
// Put together in ../i18n.js; one file per language and part keeps each readable.
const messages = {
  navbar: {
    links: [
      { key: 'flow', label: 'Flow', href: '#features' },
      { key: 'why', label: 'Why OmniFM', href: '#why-omnifm' },
      { key: 'stations', label: 'Stations', page: 'stations' },
      { key: 'pricing', label: 'Pricing', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Discord Community',
  },
  cookieConsent: {
    title: 'Cookies and statistics',
    short: 'We only store what the site needs (language, sign-in). Google Analytics sets cookies only after you agree.',
    privacyLink: 'Privacy',
    necessaryTitle: 'Necessary',
    necessaryBody: 'For your language, the secure dashboard sign-in and for the site to work. Cannot be switched off.',
    analyticsTitle: 'Statistics (Google Analytics)',
    analyticsBody: 'Roughly counts which pages are visited so we can improve the site. Without your consent, Google Analytics sets no cookies.',
    acceptAll: 'Accept all',
    reject: 'Reject',
    settings: 'Settings',
    save: 'Save selection',
    manage: 'Cookie settings',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Your Discord',
    titleAccent: 'Radio.',
    titleTail: '24/7 Live.',
    subtitleLead: 'Radio around the clock in your Discord voice channel: stations from every genre, a dashboard to control it, and if a stream drops, OmniFM reconnects on its own. Invite the commander, add a worker, and run',
    subtitleTail: '.',
    ctaInvite: 'Invite commander',
    ctaFlow: 'How it works',
  },
  trustBar: {
    live: 'Live numbers',
    items: {
      servers: { label: 'Servers', detail: 'use OmniFM' },
      stations: { label: 'Stations', detail: 'to listen to, also right here' },
      bots: { label: 'Bots', detail: 'ready to play' },
      listeners: { label: 'Listening now', detail: 'across all servers' },
    },
  },
  whyOmniFM: {
    eyebrow: 'Why OmniFM',
    title: 'More than a radio bot',
    subtitle: 'Music that keeps playing, and everything you need to run your server.',
    cards: {
      radio: {
        label: 'Radio',
        title: 'Fast to start',
        desc: 'Invite the commander, add a worker, run /play, and start listening immediately. No heavy setup before the first real value appears.',
      },
      workers: {
        label: 'Workers',
        title: 'More than a single bot',
        desc: 'Several bots share the work: each worker plays in its own voice channel, so big servers can run several stations at once.',
      },
      control: {
        label: 'Control',
        title: 'Control for admins',
        desc: 'The dashboard shows what plays where, sets the language and plans events. Pro adds the live view, statistics, role permissions and outage alerts.',
      },
      growth: {
        label: 'Growth',
        title: 'Growth without friction',
        desc: 'Free, Pro and Ultimate build on each other: when you move up, everything stays set up and you simply get more.',
      },
    },
  },
  stations: {
    eyebrow: 'Live Station Directory',
    title: 'OmniFM Stations',
    summary: ({ count, free, pro, ultimate }) => `${count} stations (${free} free, ${pro} pro, ${ultimate} ultimate). Click to preview or use /play in Discord.`,
    nowPlaying: 'Preview is playing',
    searchPlaceholder: 'Search stations...',
    filters: {
      all: 'All',
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
    filterSummary: ({ count, free, pro, ultimate }) => `${count} stations (${free} free, ${pro} pro, ${ultimate} ultimate)`,
    loading: 'Loading stations...',
    empty: 'No stations found.',
    loadMore: ({ remaining }) => `Show more (${remaining} remaining)`,
    visible: ({ visible, total }) => `Showing ${visible} of ${total} stations`,
    previewVolume: 'Volume',
    stopPreview: 'Stop preview',
    tiers: {
      free: 'Free',
      pro: 'Pro',
      ultimate: 'Ultimate',
    },
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'The most important questions before you start',
    subtitle: 'Short answers: how to start, what the plans bring and how OmniFM works.',
    items: [
      {
        key: 'start',
        question: 'What is the cleanest way to start OmniFM?',
        answer: 'Usually in under a minute: invite the commander, add at least one worker, open a voice channel, then run /play and choose a station.',
      },
      {
        key: 'workerRequired',
        question: 'Do I need a worker before /play?',
        answer: 'Yes. The commander accepts commands, but the actual stream runs through a worker. /play only works cleanly once a worker is on the server.',
      },
      {
        key: 'free',
        question: 'What is included in the Free plan?',
        answer: 'Free is enough to get started: up to 2 bots, 20 stations and every command you need to listen to radio.',
      },
      {
        key: 'dashboard',
        question: 'Do I need the dashboard right away?',
        answer: 'No, everything works in Discord too. With Free the dashboard shows what plays where, switches or stops the station, sets the language and plans one event. Pro adds the live view, statistics, unlimited events, role permissions and outage alerts.',
      },
      {
        key: 'pro',
        question: 'When is Pro worth it?',
        answer: 'As soon as you want to shape and run your server: every catalogue station, 8 voice channels at once, the dashboard with live view, unlimited events, role permissions and outage alerts in Discord.',
      },
      {
        key: 'ultimate',
        question: 'When do I need Ultimate?',
        answer: 'When you run your own radio: up to 50 stations of your own with logo, your own bot look per server, your own fallback chains, webhooks and detailed statistics, plus 16 voice channels at once.',
      },
      {
        key: 'planStatus',
        question: 'How do I see which plan my server has?',
        answer: 'In the dashboard: sign in with Discord, pick your server and open “Subscription & License”. It shows the plan and how long it runs. In Discord, the /premium command shows it too.',
        link: { label: 'Open the dashboard', page: 'dashboard' },
      },
      {
        key: 'workers',
        question: 'How do commander and workers work?',
        answer: 'The commander takes your commands; /invite gives you the links for the workers. The workers play the radio in the voice channels. That way one server can listen to several stations at once.',
      },
    ],
  },
  // The Discord preview on the start page (DiscordShowcase.js).
  discordShowcase: {
    eyebrow: 'Right in Discord',
    titleLead: 'Runs in your ',
    titleAccent: 'voice channel',
    titleTail: ', controlled by slash commands.',
    body: 'On the website you just get a taste – OmniFM itself runs 24/7 right in your Discord voice channel, with a now-playing panel, buttons and automatic reconnect.',
    cmds: [
      ['/play synthwave', 'Starts the stream in your voice channel'],
      ['/now', 'Shows the live track, cover & listeners'],
      ['/stations', 'Browse 120+ curated stations'],
    ],
    nowPlaying: 'Now Playing', genre: 'Genre', bitrate: 'Bitrate', listeners: 'Listeners',
    liveStream: 'Live radio stream', liveRadio: 'Live radio',
    time: 'today at 21:14',
  },
  // How to start OmniFM in Discord (HowToDiscord.js).
  howTo: {
    eyebrow: 'How-To · in under 60 seconds',
    title: 'How to start OmniFM in Discord',
    subtitle: 'Three steps and your radio runs 24/7 straight in your voice channel.',
    steps: [
      { n: '01', cmd: 'Add App', title: 'Invite the commander', desc: 'Add the OmniFM commander to your server. It handles every slash command and manages your workers.' },
      { n: '02', cmd: '/invite', title: 'Add a worker bot', desc: 'Invite at least one worker. It carries the actual voice stream — more workers = more parallel channels.' },
      { n: '03', cmd: '/play lofi', title: 'Start the radio', desc: 'Pick a station and OmniFM joins your voice channel. Now-playing embed, buttons and reconnect included.' },
    ],
    permsTitle: 'Permissions',
    perms: ['Join voice & speak', 'Send messages & embeds', 'Use slash commands'],
    addServer: 'Add to server',
    workerHint: 'Worker ready',
    invite: 'Invite',
    connected: 'connected',
    nowPlaying: 'Now Playing',
  },
};

export default messages;
