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
    title: 'Cookies and analytics',
    body: 'OmniFM uses necessary storage for language, security, and dashboard sessions. The Google tag is active with Consent Mode; analytics storage is allowed only when you consent to analytics.',
    necessaryTitle: 'Necessary',
    necessaryBody: 'Required for language preferences, secure dashboard sessions, and technical operation. This category cannot be disabled.',
    analyticsTitle: 'Analytics',
    analyticsBody: 'Allows Google Analytics 4 with Consent Mode to measure page views and usage at a high level. Without consent, analytics storage remains denied.',
    acceptAll: 'Accept all',
    reject: 'Reject',
    save: 'Save selection',
    manage: 'Cookie settings',
  },
  hero: {
    badge: 'OmniFM Radio Network',
    titleLead: 'Your Discord',
    titleAccent: 'Radio.',
    titleTail: '24/7 Live.',
    subtitleLead: '24/7 Discord radio with 120+ stations, worker-based reliability, dashboard control, and clean reconnect behavior. Invite the commander, add a worker, and run',
    subtitleTail: '.',
    ctaInvite: 'Invite commander',
    ctaFlow: 'How it works',
    stats: {
      servers: 'Servers',
      stations: 'Stations',
      bots: 'Bots',
    },
  },
  trustBar: {
    items: {
      stations: {
        label: 'Stations',
        detail: 'Live catalog for Free and Pro, with direct preview on the website.',
      },
      network: {
        label: 'Live activity',
        detail: 'Active streams and a ready bot network show that OmniFM is operating in production, not only on a landing page.',
      },
      dashboard: {
        label: 'Dashboard',
        detail: 'Live view, statistics, role permissions and outage alerts from Pro upward.',
      },
      reliability: {
        label: 'Reliability',
        detail: 'Reconnect, clear tiers, and a clean upgrade path for growing servers.',
      },
    },
    values: {
      dashboard: 'Free+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} free · ${pro} pro`,
      network: ({ bots, servers }) => `${bots} bots · ${servers} servers`,
      dashboard: 'Events · permissions · health',
      reliability: 'Reconnect · workers · clear tiers',
    },
  },
  whyOmniFM: {
    eyebrow: 'Why OmniFM',
    title: 'Not just a radio bot, but a clean Discord operating setup',
    subtitle: 'OmniFM is strongest when music, reliability, and server management work together.',
    cards: {
      radio: {
        label: 'Radio',
        title: 'Fast to start',
        desc: 'Invite the commander, add a worker, run /play, and start listening immediately. No heavy setup before the first real value appears.',
      },
      workers: {
        label: 'Workers',
        title: 'More than a single bot',
        desc: 'The worker architecture distributes streams cleanly and makes parallel usage predictable for larger communities.',
      },
      control: {
        label: 'Control',
        title: 'Control for admins',
        desc: 'Dashboard access, events, role permissions, and status views give Pro servers real control instead of only more stations.',
      },
      growth: {
        label: 'Growth',
        title: 'Growth without friction',
        desc: 'Free, Pro, and Ultimate build on the same product core, from quick entry to operator-grade setup.',
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
    subtitle: 'The first run should be fast, the upgrade path should be clear, and the architecture should stay understandable.',
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
        answer: 'Free covers the strong entry point: up to 2 bots, 20 free stations, core commands, and the full commander-plus-worker entry flow.',
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
        key: 'workers',
        question: 'How do commander and workers work?',
        answer: 'The commander handles commands and worker invites. Workers execute the streams. That allows OmniFM to distribute multiple parallel streams cleanly and keep them stable.',
      },
    ],
  },
  useCases: {
    eyebrow: 'Who is OmniFM for?',
    title: 'Each plan has a clear job',
    subtitle: 'Not just prices: which plan really fits which kind of server.',
    cards: {
      free: {
        title: 'Free for fast community radio',
        desc: 'If you want 24/7 radio on a small or private server, Free gives you the cleanest possible starting point.',
        fit: 'Ideal for smaller communities, friend groups, and the first live setup without admin overhead.',
      },
      pro: {
        title: 'Pro for community admins',
        desc: 'As soon as events, permissions, and dashboard control become part of normal operation, Pro turns into the real management plan.',
        fit: 'Ideal for event servers, mid-sized communities, and teams with recurring sessions and clear roles.',
      },
      ultimate: {
        title: 'Ultimate for operator setups',
        desc: 'When reliability tooling, custom stations, deeper analytics, and automation matter, Ultimate is the right tier.',
        fit: 'Ideal for larger communities, power users, and operators who want OmniFM to behave like a managed system.',
      },
    },
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
