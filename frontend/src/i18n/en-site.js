// OmniFM website texts, English: the website: navigation, start page sections, stations, commands, FAQ (#296).
// Put together in ../i18n.js; one file per language and part keeps each readable.
const messages = {
  meta: {
    title: 'OmniFM | 24/7 Radio for Discord',
    description: 'OmniFM brings 24/7 radio streams, worker bots, and premium audio to your Discord server.',
  },
  navbar: {
    links: [
      { key: 'flow', label: 'Flow', href: '#features' },
      { key: 'why', label: 'Why OmniFM', href: '#why-omnifm' },
      { key: 'dashboard', label: 'Dashboard', href: '#dashboard-showcase' },
      { key: 'stations', label: 'Stations', page: 'stations' },
      { key: 'pricing', label: 'Pricing', page: 'premium' },
      { key: 'faq', label: 'FAQ', page: 'faq' },
    ],
    discord: 'Discord Community',
    language: 'Language',
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
    ctaNote: 'Free starts with the same clean flow: invite the commander, add a worker, run /play. Pro and Ultimate expand that exact setup later with dashboard control, operations, and stronger reliability.',
    stats: {
      servers: 'Servers',
      stations: 'Stations',
      bots: 'Bots',
    },
    highlights: [
      { key: 'speed', label: 'Start in under 1 minute' },
      { key: 'catalog', label: '120+ stations ready to play' },
      { key: 'dashboard', label: 'Dashboard from Pro' },
    ],
    proofRail: [
      {
        key: 'free',
        label: 'Free',
        value: 'Go live fast',
        desc: '24/7 radio with a clean setup flow: invite the commander, add a worker, run /play.',
      },
      {
        key: 'pro',
        label: 'Pro',
        value: 'Add control',
        desc: 'Dashboard, events, and role permissions for active communities.',
      },
      {
        key: 'ultimate',
        label: 'Ultimate',
        value: 'Operator grade',
        desc: 'Custom stations, deeper analytics, and automation inside the same product path.',
      },
    ],
    panel: {
      eyebrow: 'Quick start',
      title: 'Your first stream in under a minute',
      steps: [
        {
          key: 'invite',
          title: 'Invite the commander',
          desc: 'The commander is your entry point and handles commands plus worker invites.',
        },
        {
          key: 'worker',
          title: 'Add a worker',
          desc: 'Add at least one worker. It takes over the stream as soon as you run /play.',
        },
        {
          key: 'play',
          title: 'Run /play',
          desc: 'Choose a station and start directly in voice without prefix setup.',
        },
      ],
      proofTitle: 'Why this is more professional',
      proofItems: [
        'Slash commands instead of awkward bot handling',
        'Workers carry parallel streams cleanly',
        'Clear upgrade stages for growing communities',
      ],
    },
  },
  trustBar: {
    introEyebrow: 'Live proof',
    introBody: 'These signals show right on the homepage that OmniFM is not just positioned well, but already operates as a live Discord radio product.',
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
      dashboard: 'Pro+',
      reliability: '24/7',
    },
    support: {
      stations: ({ free, pro }) => `${free} free · ${pro} pro`,
      network: ({ bots, servers }) => `${bots} bots · ${servers} servers`,
      dashboard: 'Events · permissions · health',
      reliability: 'Reconnect · workers · clear tiers',
    },
    proofChecks: [
      'Live numbers come from the product instead of static marketing copy.',
      'Dashboard and reliability are positioned before pricing, not hidden behind it.',
      'Free, Pro, and Ultimate share one product core instead of feeling like separate tools.',
    ],
  },
  features: {
    eyebrow: 'How it works',
    title: 'Radio in 3 steps',
    steps: [
      {
        step: '01',
        title: 'Invite the commander',
        desc: 'Invite the OmniFM DJ bot to your Discord server. It handles commands and organizes the setup.',
      },
      {
        step: '02',
        title: 'Add a worker',
        desc: 'Add at least one worker. It takes over the stream as soon as you run /play.',
      },
      {
        step: '03',
        title: 'Run /play',
        desc: 'Choose a station and start the radio directly in voice. Add more workers whenever you need more parallel streams.',
      },
    ],
    architecture: {
      flowLabel: 'System flow',
      commander: 'Commander',
      commanderDesc: 'Handles commands and worker invites',
      workers: 'Workers 1-16',
      workersDesc: 'Execute the streams',
      channel: 'Your channel',
      channelDesc: 'Radio runs in your voice channel',
    },
    gridEyebrow: 'Features',
    gridTitle: 'Built for quality',
    grid: [
      {
        title: '24/7 streaming',
        desc: 'Nonstop music around the clock so your server never falls silent.',
      },
      {
        title: 'Multi-bot system',
        desc: 'Up to 16 workers in parallel with isolated streams and clean handoff.',
      },
      {
        title: 'Slash commands',
        desc: 'No prefix required. /play, /stats, and /event are ready immediately.',
      },
      {
        title: 'HQ audio',
        desc: 'Opus transcoding up to 320k bitrate for stable, clear playback.',
      },
      {
        title: 'Auto-reconnect',
        desc: 'If a connection drops, OmniFM reconnects in a controlled way.',
      },
      {
        title: 'Scalable',
        desc: 'Add more workers and higher tiers without changing the underlying setup.',
      },
    ],
  },
  whyOmniFM: {
    eyebrow: 'Why OmniFM',
    title: 'Not just a radio bot, but a clean Discord operating setup',
    subtitle: 'OmniFM is strongest when music, reliability, and server management work together. The website should make that combination obvious.',
    comparisonEyebrow: 'The difference',
    comparisonTitle: 'What separates OmniFM from a generic bot',
    comparisonHeaders: {
      basic: 'Typical bot',
      omnifm: 'OmniFM',
    },
    comparisonRows: [
      {
        label: 'Start',
        basic: 'A bot gets invited and eventually starts some audio.',
        omnifm: 'A clear entry path takes you from invite and /play to a stable 24/7 radio setup.',
      },
      {
        label: 'Operation',
        basic: 'More usage often means more load on one single bot.',
        omnifm: 'Commander and workers split responsibility cleanly and make parallel streams more predictable.',
      },
      {
        label: 'Growth',
        basic: 'Premium often feels like a second product without a clear transition.',
        omnifm: 'Free, Pro, and Ultimate extend the same core with control, analytics, and operator features.',
      },
    ],
    cards: {
      radio: {
        title: 'Fast to start',
        desc: 'Invite the commander, add a worker, run /play, and start listening immediately. No heavy setup before the first real value appears.',
      },
      workers: {
        title: 'More than a single bot',
        desc: 'The worker architecture distributes streams cleanly and makes parallel usage predictable for larger communities.',
      },
      control: {
        title: 'Control for admins',
        desc: 'Dashboard access, events, role permissions, and status views give Pro servers real control instead of only more stations.',
      },
      growth: {
        title: 'Growth without friction',
        desc: 'Free, Pro, and Ultimate build on the same product core, from quick entry to operator-grade setup.',
      },
    },
  },
  workers: {
    eyebrow: 'Architecture',
    title: 'Commander / Worker System',
    subtitle: 'The commander accepts commands while workers carry the actual streams. That keeps the setup stable for multiple channels, events, and larger servers.',
    tierCards: {
      free: { name: 'Free', maxWorkers: 'Max worker bots' },
      pro: { name: 'Pro', maxWorkers: 'Max worker bots' },
      ultimate: { name: 'Ultimate', maxWorkers: 'Max worker bots' },
    },
    labels: {
      server: 'Servers',
      streams: 'Streams',
      workersTotal: 'Workers total',
      workersOnline: 'Workers online',
      activeStreams: 'Active streams',
      commanderServers: 'Commander servers',
    },
    status: {
      online: 'Online',
      offline: 'Offline',
      commander: 'Commander',
      workerPrefix: 'Worker #',
    },
    delegated: 'Delegated to workers',
    empty: 'No workers configured yet. Add more worker tokens in your .env file (BOT_2_TOKEN, BOT_3_TOKEN, ...).',
    loading: 'Loading worker status...',
  },
  dashboardShowcase: {
    eyebrow: 'Dashboard and operations',
    title: 'Pro and Ultimate add real server control',
    subtitle: 'OmniFM is not only a bot that starts streams. The dashboard turns it into a manageable system for events, permissions, health, analytics, and automation.',
    proofPanel: {
      eyebrow: 'Operations over guesswork',
      title: 'From invite to live server control',
      items: [
        {
          value: 'Discord SSO',
          label: 'Guild access without extra tooling',
          desc: 'Admins sign in with Discord and land directly on their servers without a second setup flow.',
        },
        {
          value: 'Role Rules',
          label: 'Command control per server',
          desc: 'Events, permissions, and sensitive actions stay tied to the right roles and operators.',
        },
        {
          value: 'Health View',
          label: 'More visibility in operation',
          desc: 'Status, weekly digest, and upgrade context show early where your setup is stable or needs more control.',
        },
      ],
      note: 'Dashboard access starts with Pro and continues into Ultimate without a second workflow. Your existing bot setup stays intact.',
    },
    cards: {
      events: {
        title: 'Event scheduler',
        desc: 'Plan automatic starts for recurring sessions, community nights, or fixed music slots.',
      },
      permissions: {
        title: 'Role permissions per command',
        desc: 'Define exactly who can use /event, /perm, and other sensitive commands on your server.',
      },
      health: {
        title: 'Health and analytics',
        desc: 'Track server status, core metrics, and in Ultimate also deeper analytics views.',
      },
      automation: {
        title: 'Custom stations and webhooks',
        desc: 'Ultimate expands OmniFM for power users with custom stations, exports, and automation hooks.',
      },
    },
    primaryCta: 'Open dashboard',
    secondaryCta: 'Compare plans',
    ctaNote: 'Dashboard access starts with Pro. Upgrading adds control, not a second product path.',
    tags: ['Discord SSO', 'Event scheduler', 'Role permissions', 'Health'],
    workflow: {
      eyebrow: 'Ops flow',
      steps: [
        {
          title: 'Select server',
          desc: 'Choose a guild via Discord SSO and immediately see current status, tier, and the main control surface.',
        },
        {
          title: 'Enable control',
          desc: 'Plan events, assign role rules, and manage weekly digest or health without bot-side chaos.',
        },
        {
          title: 'Scale cleanly',
          desc: 'Ultimate extends the same workflow with custom stations, exports, and deeper analytics instead of adding a second tool.',
        },
      ],
    },
    preview: {
      eyebrow: 'Operations preview',
      title: 'One server, clearly managed',
      serverLabel: 'Server',
      serverValue: 'OmniFM Community Hub',
      status: 'active',
      proofLabel: 'Why this feels like a product',
      proofItems: [
        'A server is not only monitored, but actively managed.',
        'Health, digest, and recovery stay visible in the same place.',
        'Pro and Ultimate extend the same workflow instead of replacing it.',
      ],
      metrics: [
        { label: 'Events', value: '4' },
        { label: 'Role rules', value: '12' },
        { label: 'Health', value: 'OK' },
      ],
      rows: [
        { label: 'Weekly digest', value: 'Enabled' },
        { label: 'Fallback / recovery', value: 'Ready' },
        { label: 'Analytics access', value: 'Pro / Ultimate' },
      ],
    },
    tiers: [
      {
        key: 'pro',
        badge: 'Pro',
        title: 'Management layer',
        desc: 'Dashboard, events, role permissions, and health turn OmniFM into a controllable server setup.',
      },
      {
        key: 'ultimate',
        badge: 'Ultimate',
        title: 'Operator layer',
        desc: 'Custom stations, exports, webhooks, and deeper analytics extend the system without breaking the workflow.',
      },
    ],
  },
  reliability: {
    eyebrow: 'Reliability',
    title: 'OmniFM is built for continuous operation',
    subtitle: 'The architecture is not there for show. It helps distribute streams cleanly, handle outages in a controlled way, and operate larger servers with less friction.',
    cards: {
      uptime: {
        title: '24/7 instead of lucky uptime',
        desc: 'OmniFM is designed to keep voice channels running with radio over time instead of only starting music for a short moment.',
      },
      workers: {
        title: 'Parallel instead of overloaded',
        desc: 'Workers split the actual streaming load. That matters most when multiple channels or active communities use the bot at once.',
      },
      reconnect: {
        title: 'Reconnect with a plan',
        desc: 'If a stream or connection drops, OmniFM responds in a controlled way instead of failing chaotically. Higher tiers improve this recovery path even further.',
      },
      visibility: {
        title: 'No blind operations',
        desc: 'Dashboard views, health, and analytics show how your setup behaves and where an upgrade creates real operational value.',
      },
    },
    proofLabel: 'Live proof',
    proofBody: 'The live commander and worker overview below shows that the architecture is not just marketing copy. It is visible in the product runtime.',
  },
  bots: {
    eyebrow: 'Commander Bot',
    title: 'Invite OmniFM',
    subtitleLead: 'Invite the commander bot to your server. You can add extra worker bots with the',
    subtitleTail: 'command in Discord.',
    loading: 'Loading bot details...',
    empty: 'No bot configured yet.',
    statsTitle: 'Bot stats',
    stats: {
      servers: 'Servers',
      users: 'Users',
      connections: 'Connections',
      listeners: 'Listeners',
    },
    status: {
      online: 'Online',
      configurable: 'Configurable',
    },
    actions: {
      invite: 'Invite',
      copy: 'Copy link',
      copied: 'Copied',
      required: 'required',
    },
    networkTitle: 'Live network',
    networkSubtitle: 'Commander and workers are not a gimmick. They create a clear invite and scaling model for real operation.',
    networkMetrics: {
      readyBots: 'Ready',
      totalServers: 'Servers total',
      totalConnections: 'Connections',
    },
    proofListTitle: 'Why this matters',
    proofChecks: [
      'One commander stays the clear entry point for new servers.',
      'Workers carry parallel streams instead of overloading a single bot.',
      'Free, Pro, and Ultimate keep the same invite logic and scale without a product reset.',
    ],
    networkHint: 'That makes OmniFM feel like a running Discord radio system, not a single bot with oversized promises.',
    workerTiersTitle: 'Worker bots by tier',
    workerTiers: [
      { tier: 'Free', bots: 'Bot 1-2', desc: 'Enough for the initial rollout and the first parallel streams.' },
      { tier: 'Pro', bots: 'Bot 3-8', desc: 'More headroom for active communities, events, and predictable load.' },
      { tier: 'Ultimate', bots: 'Bot 9-16', desc: 'Operator-level capacity for larger networks, stronger resilience, and power setups.' },
    ],
    workerHintLead: 'Use',
    workerHintTail: 'in Discord to invite worker bots.',
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
        answer: 'No. Free works without the dashboard, and one scheduled event already works with /event. From Pro you manage events, role permissions, the weekly recap and outage alerts in one place.',
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
    subtitle: 'The website should not only show prices. It should explain which plan actually fits which kind of server.',
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
};

export default messages;
