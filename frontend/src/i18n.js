import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { buildPageHref, resolvePageFromUrl } from './lib/pageRouting.js';
import { applySeoMetadata } from './lib/seo.js';

const STORAGE_KEY = 'omnifm.web.locale';
const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['de', 'en'];

const LOCALE_META = {
  de: {
    label: 'DE',
    switchLabel: 'EN',
    switchTitle: 'Switch to English',
    intl: 'de-DE',
  },
  en: {
    label: 'EN',
    switchLabel: 'DE',
    switchTitle: 'Auf Deutsch umschalten',
    intl: 'en-US',
  },
};

const LOCALE_MESSAGES = {
  de: {
    meta: {
      title: 'OmniFM | 24/7 Radio für Discord',
      description: 'OmniFM bringt 24/7 Radio-Streams, Worker-Bots und Premium-Audio auf deinen Discord-Server.',
    },
    navbar: {
      links: [
        { key: 'flow', label: 'Ablauf', href: '#features' },
        { key: 'why', label: 'Warum', href: '#why-omnifm' },
        { key: 'dashboard', label: 'Dashboard', href: '#dashboard-showcase' },
        { key: 'stations', label: 'Stationen', page: 'stations' },
        { key: 'pricing', label: 'Preise', page: 'premium' },
        { key: 'faq', label: 'FAQ', page: 'faq' },
      ],
      discord: 'Discord Community',
      language: 'Sprache',
    },
    cookieConsent: {
      title: 'Cookies und Analytics',
      body: 'OmniFM nutzt notwendige Speicherungen für Sprache, Sicherheit und Dashboard-Sitzungen. Google Analytics 4 wird nur geladen, wenn du Analytics erlaubst.',
      necessaryTitle: 'Notwendig',
      necessaryBody: 'Erforderlich für Spracheinstellungen, sichere Dashboard-Sitzungen und den technischen Betrieb. Diese Kategorie kann nicht deaktiviert werden.',
      analyticsTitle: 'Analytics',
      analyticsBody: 'Erlaubt Google Analytics 4 mit Consent Mode, um Seitenaufrufe und Nutzung grob auszuwerten. Vor deiner Einwilligung wird kein Google-Analytics-Script geladen.',
      acceptAll: 'Alle akzeptieren',
      reject: 'Ablehnen',
      save: 'Auswahl speichern',
      manage: 'Cookie-Einstellungen',
    },
    hero: {
      badge: 'OmniFM Radio Network',
      titleLead: 'Dein Discord',
      titleAccent: 'Radio.',
      titleTail: '24/7 Live.',
      subtitleLead: '24/7 Discord-Radio mit 120+ Stationen, stabiler Worker-Architektur, Dashboard-Kontrolle und sauberem Reconnect. Lade zuerst den Commander ein, füge dann einen Worker hinzu und führe',
      subtitleTail: 'aus.',
      ctaInvite: 'Commander einladen',
      ctaFlow: 'Wie es funktioniert',
      ctaNote: 'Free startet über denselben sauberen Ablauf: Commander einladen, Worker hinzufügen, /play ausführen. Pro und Ultimate erweitern später genau dieses Setup mit Dashboard, Kontrolle und mehr Betriebssicherheit.',
      stats: {
        servers: 'Server',
        stations: 'Stationen',
        bots: 'Bots',
      },
      highlights: [
        { key: 'speed', label: 'Start in unter 1 Minute' },
        { key: 'catalog', label: '120+ Stationen sofort spielbar' },
        { key: 'dashboard', label: 'Dashboard ab Pro' },
      ],
      proofRail: [
        {
          key: 'free',
          label: 'Free',
          value: 'Sofort live',
          desc: '24/7 Radio mit sauberem Einstieg: Commander einladen, Worker hinzufügen, /play ausführen.',
        },
        {
          key: 'pro',
          label: 'Pro',
          value: 'Mehr Kontrolle',
          desc: 'Dashboard, Events und Rollenrechte für aktive Communities.',
        },
        {
          key: 'ultimate',
          label: 'Ultimate',
          value: 'Operator-Niveau',
          desc: 'Custom Stations, tiefere Analytics und Automatisierung im selben Produktpfad.',
        },
      ],
      panel: {
        eyebrow: 'Schneller Start',
        title: 'In unter einer Minute zum ersten Stream',
        steps: [
          {
            key: 'invite',
            title: 'Commander einladen',
            desc: 'Der Commander ist dein Einstiegspunkt und nimmt Commands sowie Worker-Invites an.',
          },
          {
            key: 'worker',
            title: 'Worker hinzufügen',
            desc: 'Füge mindestens einen Worker hinzu. Er übernimmt den Stream, sobald du /play nutzt.',
          },
          {
            key: 'play',
            title: '/play ausführen',
            desc: 'Wähle eine Station und starte direkt im Voice-Channel ohne Prefix-Setup.',
          },
        ],
        proofTitle: 'Warum das professioneller ist',
        proofItems: [
          'Slash Commands statt umständlicher Bot-Bedienung',
          'Worker entlasten parallele Streams sauber',
          'Klare Upgrade-Stufen für wachsende Communities',
        ],
      },
    },
    trustBar: {
      introEyebrow: 'Live-Proof',
      introBody: 'Diese Signale zeigen direkt auf der Startseite, dass OmniFM nicht nur gut klingt, sondern bereits als laufendes Discord-Radio-Produkt arbeitet.',
      items: {
        stations: {
          label: 'Stationen',
          detail: 'Live-Katalog für Free und Pro, direkt auf der Website vorhörbar.',
        },
        network: {
          label: 'Live-Aktivität',
          detail: 'Aktive Streams und ein bereitstehendes Bot-Netzwerk zeigen, dass OmniFM im Betrieb arbeitet.',
        },
        dashboard: {
          label: 'Dashboard',
          detail: 'Events, Rollenrechte, Health und Server-Steuerung ab Pro.',
        },
        reliability: {
          label: 'Zuverlässigkeit',
          detail: 'Reconnect, klare Tiers und ein sauberer Upgrade-Pfad für wachsende Server.',
        },
      },
      values: {
        dashboard: 'Pro+',
        reliability: '24/7',
      },
      support: {
        stations: ({ free, pro }) => `${free} Free · ${pro} Pro`,
        network: ({ bots, servers }) => `${bots} Bots · ${servers} Server`,
        dashboard: 'Events · Rollenrechte · Health',
        reliability: 'Reconnect · Worker · klare Tiers',
      },
      proofChecks: [
        'Live-Zahlen kommen aus dem Produkt statt aus statischen Werbetexten.',
        'Dashboard und Zuverlässigkeit sind bereits vor dem Pricing sichtbar eingeordnet.',
        'Free, Pro und Ultimate haben einen klaren gemeinsamen Kern statt getrennte Produktwelten.',
      ],
    },
    features: {
      eyebrow: 'So funktioniert es',
      title: 'In 3 Schritten zum Radio',
      steps: [
        {
          step: '01',
          title: 'Commander einladen',
          desc: 'Lade den OmniFM DJ auf deinen Discord-Server ein. Er nimmt Commands an und organisiert dein Setup.',
        },
        {
          step: '02',
          title: 'Worker hinzufügen',
          desc: 'Füge mindestens einen Worker hinzu. Er übernimmt den Stream, sobald du /play startest.',
        },
        {
          step: '03',
          title: '/play ausführen',
          desc: 'Wähle eine Station und starte das Radio direkt im Voice-Channel. Weitere Worker schalten bei Bedarf parallele Streams frei.',
        },
      ],
      architecture: {
        flowLabel: 'Systemablauf',
        commander: 'Commander',
        commanderDesc: 'Nimmt Commands und Worker-Invites an',
        workers: 'Worker 1-16',
        workersDesc: 'Führen die Streams aus',
        channel: 'Dein Channel',
        channelDesc: 'Radio läuft im Voice-Channel',
      },
      gridEyebrow: 'Features',
      gridTitle: 'Gebaut für Qualität',
      grid: [
        {
          title: '24/7 Streaming',
          desc: 'Nonstop Musik rund um die Uhr. Dein Server schläft nie.',
        },
        {
          title: 'Multi-Bot System',
          desc: 'Bis zu 16 Worker-Bots parallel. Jeder Stream bleibt voneinander getrennt.',
        },
        {
          title: 'Slash-Commands',
          desc: 'Kein Prefix nötig. /play, /stats und /event sind sofort einsatzbereit.',
        },
        {
          title: 'HQ Audio',
          desc: 'Opus-Transcoding mit bis zu 320k Bitrate für klare, stabile Streams.',
        },
        {
          title: 'Auto-Reconnect',
          desc: 'Fällt eine Verbindung, verbindet sich OmniFM kontrolliert und sauber neu.',
        },
        {
          title: 'Skalierbar',
          desc: 'Weitere Worker und Premium-Tiers lassen sich ohne Architekturbruch ergänzen.',
        },
      ],
    },
    whyOmniFM: {
      eyebrow: 'Warum OmniFM',
      title: 'Nicht nur ein Radio-Bot, sondern ein sauberes Discord-Setup',
      subtitle: 'OmniFM ist am stärksten, wenn Musik, Stabilität und Server-Verwaltung zusammenkommen. Genau diese Kombination muss die Website klar verkaufen.',
      comparisonEyebrow: 'Der Unterschied',
      comparisonTitle: 'Was OmniFM von einem generischen Bot trennt',
      comparisonHeaders: {
        basic: 'Typischer Bot',
        omnifm: 'OmniFM',
      },
      comparisonRows: [
        {
          label: 'Start',
          basic: 'Ein Bot wird eingeladen und spielt irgendwann Audio ab.',
          omnifm: 'Ein klarer Einstieg führt vom Commander-Invite über den Worker direkt zu einem stabilen 24/7 Radio-Setup.',
        },
        {
          label: 'Betrieb',
          basic: 'Mehr Nutzung bedeutet oft nur mehr Last auf einem einzelnen Bot.',
          omnifm: 'Commander und Worker teilen Verantwortung sauber auf und machen parallele Streams planbarer.',
        },
        {
          label: 'Wachstum',
          basic: 'Premium fühlt sich oft wie ein zweites Produkt ohne klaren Übergang an.',
          omnifm: 'Free, Pro und Ultimate erweitern denselben Kern mit Kontrolle, Analytics und Operator-Funktionen.',
        },
      ],
      cards: {
        radio: {
          title: 'Sofort startklar',
          desc: 'Commander einladen, Worker hinzufügen, /play ausführen und direkt Radio hören. Kein schweres Setup, bevor der erste Nutzen sichtbar wird.',
        },
        workers: {
          title: 'Mehr als ein einzelner Bot',
          desc: 'Die Worker-Architektur verteilt Streams sauber und macht parallele Nutzung für größere Communities planbar.',
        },
        control: {
          title: 'Steuerung für Admins',
          desc: 'Dashboard, Events, Rollenrechte und Statusansichten geben Pro-Servern echte Kontrolle statt nur mehr Sendern.',
        },
        growth: {
          title: 'Wachstum ohne Bruch',
          desc: 'Free, Pro und Ultimate bauen logisch aufeinander auf und decken von Einstieg bis Operator-Setup denselben Produktkern ab.',
        },
      },
    },
    workers: {
      eyebrow: 'Architektur',
      title: 'Commander / Worker System',
      subtitle: 'Der Commander nimmt Befehle an, Worker tragen die eigentlichen Streams. So bleibt das Setup für mehrere Channel, Events und größere Server stabil.',
      tierCards: {
        free: { name: 'Free', maxWorkers: 'Max. Worker-Bots' },
        pro: { name: 'Pro', maxWorkers: 'Max. Worker-Bots' },
        ultimate: { name: 'Ultimate', maxWorkers: 'Max. Worker-Bots' },
      },
      labels: {
        server: 'Server',
        streams: 'Streams',
        workersTotal: 'Worker gesamt',
        workersOnline: 'Worker online',
        activeStreams: 'Aktive Streams',
        commanderServers: 'Commander Server',
      },
      status: {
        online: 'Online',
        offline: 'Offline',
        commander: 'Commander',
        workerPrefix: 'Worker #',
      },
      delegated: 'Delegiert an Worker',
      empty: 'Keine Worker konfiguriert. Lege weitere Worker-Tokens in der .env an (BOT_2_TOKEN, BOT_3_TOKEN, ...).',
      loading: 'Lade Worker-Status...',
    },
    dashboardShowcase: {
      eyebrow: 'Dashboard und Betrieb',
      title: 'Pro und Ultimate bringen echte Server-Steuerung',
      subtitle: 'OmniFM ist nicht nur ein Bot zum Starten von Streams. Mit dem Dashboard wird daraus ein verwaltbares System für Events, Rechte, Health, Analytics und Automatisierung.',
      proofPanel: {
        eyebrow: 'Operations statt Bauchgefühl',
        title: 'Vom Invite zur laufenden Server-Steuerung',
        items: [
          {
            value: 'Discord SSO',
            label: 'Guild-Zugang ohne Zusatztool',
            desc: 'Admins melden sich direkt mit Discord an und landen ohne separates Setup bei ihren Servern.',
          },
          {
            value: 'Role Rules',
            label: 'Command-Kontrolle pro Server',
            desc: 'Events, Permissions und sensible Aktionen bleiben sauber an Rollen und Verantwortliche gebunden.',
          },
          {
            value: 'Health View',
            label: 'Mehr Sichtbarkeit im Betrieb',
            desc: 'Status, Weekly Digest und Upgrade-Hinweise zeigen früh, wo dein Setup stabil ist oder mehr Kontrolle braucht.',
          },
        ],
        note: 'Dashboard-Zugang startet mit Pro und geht in Ultimate ohne zweiten Workflow weiter. Dein bestehendes Bot-Setup bleibt dabei intakt.',
      },
      cards: {
        events: {
          title: 'Event-Scheduler',
          desc: 'Plane automatische Starts für wiederkehrende Sessions, Community-Abende oder feste Musik-Slots.',
        },
        permissions: {
          title: 'Rollenrechte pro Command',
          desc: 'Lege sauber fest, wer /event, /perm oder andere sensible Befehle auf deinem Server nutzen darf.',
        },
        health: {
          title: 'Health und Analytics',
          desc: 'Behalte Server-Status, Basis-Metriken und in Ultimate auch tiefere Analytics im Blick.',
        },
        automation: {
          title: 'Custom Stations und Webhooks',
          desc: 'Ultimate erweitert OmniFM für Power-User mit eigenen Stationen, Exporten und Automatisierungs-Hooks.',
        },
      },
      primaryCta: 'Dashboard ansehen',
      secondaryCta: 'Pläne vergleichen',
      ctaNote: 'Dashboard-Zugang startet mit Pro. Upgrade bedeutet mehr Kontrolle, nicht einen neuen Produktpfad.',
      tags: ['Discord SSO', 'Event-Scheduler', 'Rollenrechte', 'Health'],
      workflow: {
        eyebrow: 'Ops-Flow',
        steps: [
          {
            title: 'Server auswählen',
            desc: 'Guild aus Discord SSO wählen und direkt den aktuellen Status, Tier und die wichtigsten Steuerungen sehen.',
          },
          {
            title: 'Kontrolle aktivieren',
            desc: 'Events planen, Rollenrechte setzen und Weekly Digest oder Health ohne Bot-Chaos verwalten.',
          },
          {
            title: 'Sauber skalieren',
            desc: 'Ultimate erweitert denselben Workflow für Custom Stations, Exporte und tiefere Analytics statt eines zweiten Tools.',
          },
        ],
      },
      preview: {
        eyebrow: 'Operations Preview',
        title: 'Ein Server, sauber verwaltet',
        serverLabel: 'Server',
        serverValue: 'OmniFM Community Hub',
        status: 'aktiv',
        proofLabel: 'Warum das nach Produkt aussieht',
        proofItems: [
          'Ein Server wird nicht nur beobachtet, sondern aktiv gesteuert.',
          'Health, Digest und Recovery bleiben an derselben Stelle sichtbar.',
          'Pro und Ultimate erweitern denselben Arbeitsfluss statt ihn zu ersetzen.',
        ],
        metrics: [
          { label: 'Events', value: '4' },
          { label: 'Rollenregeln', value: '12' },
          { label: 'Health', value: 'OK' },
        ],
        rows: [
          { label: 'Weekly Digest', value: 'Aktiv' },
          { label: 'Fallback / Recovery', value: 'Bereit' },
          { label: 'Analytics-Zugang', value: 'Pro / Ultimate' },
        ],
      },
      tiers: [
        {
          key: 'pro',
          badge: 'Pro',
          title: 'Management-Layer',
          desc: 'Dashboard, Events, Rollenrechte und Health machen aus OmniFM ein administrierbares Server-Setup.',
        },
        {
          key: 'ultimate',
          badge: 'Ultimate',
          title: 'Operator-Layer',
          desc: 'Custom Stations, Exporte, Webhooks und tiefere Analytics erweitern das System ohne Bruch im Bedienfluss.',
        },
      ],
    },
    reliability: {
      eyebrow: 'Stabilitaet',
      title: 'OmniFM ist für dauerhaften Betrieb gebaut',
      subtitle: 'Die Architektur ist nicht Selbstzweck. Sie sorgt dafür, dass Streams sauber verteilt, Ausfälle kontrolliert behandelt und größere Server besser betrieben werden können.',
      cards: {
        uptime: {
          title: '24/7 statt Glueckstreffer',
          desc: 'OmniFM ist darauf ausgelegt, Voice-Channels dauerhaft mit Radio zu versorgen statt nur kurzfristig Musik zu starten.',
        },
        workers: {
          title: 'Parallel statt überladen',
          desc: 'Worker teilen die eigentliche Stream-Last auf. Das ist vor allem bei mehreren Channels oder aktiven Communitys wichtig.',
        },
        reconnect: {
          title: 'Reconnect mit Plan',
          desc: 'Wenn ein Stream oder eine Verbindung wegfaellt, reagiert OmniFM kontrolliert statt chaotisch. Hoehere Tiers verbessern diese Recovery weiter.',
        },
        visibility: {
          title: 'Status nicht im Blindflug',
          desc: 'Dashboard, Health und Analytics machen sichtbar, wie dein Setup laeuft und wo ein Upgrade echten Mehrwert bringt.',
        },
      },
      proofLabel: 'Live-Proof',
      proofBody: 'Direkt darunter zeigt OmniFM sein aktives Commander-/Worker-Setup. Die Architektur ist also nicht nur Marketing, sondern im Produktbetrieb sichtbar.',
    },
    bots: {
      eyebrow: 'Commander Bot',
      title: 'OmniFM einladen',
      subtitleLead: 'Lade den Commander-Bot auf deinen Server ein. Weitere Worker-Bots kannst du per',
      subtitleTail: 'Befehl im Discord hinzufügen.',
      loading: 'Lade Bot-Infos...',
      empty: 'Noch kein Bot konfiguriert.',
      statsTitle: 'Bot-Statistiken',
      stats: {
        servers: 'Server',
        users: 'Nutzer',
        connections: 'Verbindungen',
        listeners: 'Zuhörer',
      },
      status: {
        online: 'Online',
        configurable: 'Konfigurierbar',
      },
      actions: {
        invite: 'Einladen',
        copy: 'Link kopieren',
        copied: 'Kopiert',
        required: 'erforderlich',
      },
      networkTitle: 'Live-Netzwerk',
      networkSubtitle: 'Commander und Worker sind kein Gimmick, sondern ein klares Invite- und Skalierungsmodell für echten Betrieb.',
      networkMetrics: {
        readyBots: 'Bereit',
        totalServers: 'Server gesamt',
        totalConnections: 'Verbindungen',
      },
      proofListTitle: 'Warum das wichtig ist',
      proofChecks: [
        'Ein Commander bleibt der klare Einstiegspunkt für neue Server.',
        'Worker übernehmen parallele Streams, statt einen einzelnen Bot zu überladen.',
        'Free, Pro und Ultimate bauen auf derselben Invite-Logik auf und skalieren ohne Produktbruch.',
      ],
      networkHint: 'So wirkt OmniFM nicht wie ein Einzel-Bot mit vielen Versprechen, sondern wie ein wirklich betriebenes Discord-Radio-System.',
      workerTiersTitle: 'Worker-Bots pro Tier',
      workerTiers: [
        { tier: 'Free', bots: 'Bot 1-2', desc: 'Genug für den Einstieg und die ersten parallelen Streams.' },
        { tier: 'Pro', bots: 'Bot 3-8', desc: 'Mehr Reserve für aktive Communitys, Events und planbare Last.' },
        { tier: 'Ultimate', bots: 'Bot 9-16', desc: 'Operator-Level für größere Netzwerke, mehr Ausfallsicherheit und Power-Setups.' },
      ],
      workerHintLead: 'Nutze',
      workerHintTail: 'im Discord, um Worker-Bots einzuladen.',
    },
    stations: {
      eyebrow: 'Live Station Directory',
      title: 'OmniFM Stationen',
      summary: ({ count, free, pro, ultimate }) => `${count} Stationen (${free} Free, ${pro} Pro, ${ultimate} Ultimate). Klicke zum Vorhören oder nutze /play im Discord.`,
      nowPlaying: 'Vorschau läuft',
      searchPlaceholder: 'Station suchen...',
      filters: {
        all: 'Alle',
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
      filterSummary: ({ count, free, pro, ultimate }) => `${count} Stationen (${free} Free, ${pro} Pro, ${ultimate} Ultimate)`,
      loading: 'Lade Stationen...',
      empty: 'Keine Stationen gefunden.',
      loadMore: ({ shown, remaining }) => `Mehr anzeigen (${shown} von ${remaining})`,
      visible: ({ visible, total }) => `${visible} von ${total} Stationen angezeigt`,
      previewVolume: 'Lautstärke',
      stopPreview: 'Vorschau stoppen',
      tiers: {
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
    },
    commands: {
      eyebrow: 'Slash Commands',
      title: 'Alle Befehle nach Tier',
      subtitle: 'Jedes Tier schaltet weitere Commands frei. Free-Commands sind immer verfügbar.',
      countLabel: ({ count }) => `${count} Commands`,
      loading: 'Lade Commands...',
      empty: 'Keine Commands verfügbar.',
      descriptionMap: {
        help: 'Zeigt alle Befehle und kurze Erklärungen.',
        play: 'Startet einen Radio-Stream in deinem Voice-Channel.',
        pause: 'Pausiert die aktuelle Wiedergabe.',
        resume: 'Setzt die aktuelle Wiedergabe fort.',
        stop: 'Stoppt die Wiedergabe und verlässt den Channel.',
        stations: 'Zeigt alle für deinen Plan verfügbaren Stationen.',
        list: 'Listet Stationen paginiert auf.',
        setvolume: 'Setzt die Lautstärke des Streams.',
        status: 'Zeigt Bot-Status und Uptime an.',
        health: 'Zeigt Stream-Health und Reconnect-Informationen.',
        diag: 'Zeigt Audio-, FFmpeg- und Stream-Diagnosen.',
        premium: 'Zeigt den Premium-Status deines Servers.',
        language: 'Verwaltet die Sprache für diesen Server.',
        license: 'Aktiviert oder zeigt Lizenzdaten an.',
        invite: 'Zeigt Invite-Links für verfügbare Worker-Bots.',
        workers: 'Zeigt das Commander-/Worker-Setup.',
        now: 'Zeigt den aktuell erkannten Titel.',
        stats: 'Zeigt Hör- und Nutzungsstatistiken für diesen Server.',
        history: 'Zeigt die zuletzt erkannten Songs.',
        event: 'Verwaltet geplante Auto-Start-Events.',
        perm: 'Verwaltet rollenbasierte Command-Berechtigungen.',
        addstation: 'Fügt eine eigene Station hinzu.',
        removestation: 'Entfernt eine eigene Station.',
        mystations: 'Zeigt deine eigenen Stationen.',
      },
    },
    planMatrix: {
      eyebrow: 'Free vs Pro vs Ultimate',
      title: 'Klarer Vergleich, keine offenen Fragen',
      subtitle: 'Die Matrix zeigt transparent, was in welchem Plan enthalten ist. Ultimate hebt Zuverlässigkeits-Features, mehr Bot-Slots und erweiterte Analytics sichtbar hervor.',
      featureHeader: 'Feature',
      tiers: {
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
      rows: [
        { key: 'dashboard', label: 'Web-Dashboard (SSO + Server-Auswahl)', free: false, pro: true, ultimate: true },
        { key: 'events', label: 'Event-Scheduler im Web', free: false, pro: true, ultimate: true },
        { key: 'perms', label: 'Rollenrechte pro Command', free: false, pro: true, ultimate: true },
        { key: 'basicStats', label: 'Server-spezifische Basis-Statistiken', free: false, pro: true, ultimate: true },
        { key: 'fallback', label: '/play mit optionalem Fallback', free: false, pro: false, ultimate: true },
        { key: 'advancedStats', label: 'Erweiterte Analytics (Channels + Tagesreport)', free: false, pro: false, ultimate: true },
      ],
    },
    commandMatrix: {
      eyebrow: 'Command-Matrix',
      title: 'Welche Commands in welchem Plan enthalten sind',
      commandHeader: 'Command',
      tiers: {
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
      rows: [
        { command: '/play', free: 'Basis', pro: 'HQ + Worker', ultimate: 'HQ + Fallback' },
        { command: '/event', free: '—', pro: 'Ja', ultimate: 'Ja + erweitert' },
        { command: '/perm', free: '—', pro: 'Ja', ultimate: 'Ja + erweitert' },
        { command: '/stats', free: '—', pro: 'Basis-Stats', ultimate: 'Erweiterte Analytics' },
        { command: '/addstation', free: '—', pro: '—', ultimate: 'Ja (Custom-URL)' },
        { command: '/workers', free: '—', pro: 'Ja', ultimate: 'Priorisiert' },
      ],
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Die wichtigsten Fragen vor dem Start',
      subtitle: 'Der Einstieg soll schnell sein, der Upgrade-Pfad klar und die Architektur verständlich bleiben.',
      items: [
        {
          key: 'start',
          question: 'Wie starte ich OmniFM sauber?',
          answer: 'Im Normalfall in unter einer Minute: zuerst den Commander einladen, dann mindestens einen Worker hinzufügen, danach den Voice-Channel öffnen und /play nutzen.',
        },
        {
          key: 'workerRequired',
          question: 'Brauche ich vor /play schon einen Worker?',
          answer: 'Ja. Der Commander nimmt die Befehle an, aber der eigentliche Stream läuft über einen Worker. Erst wenn ein Worker auf dem Server ist, kann /play sauber starten.',
        },
        {
          key: 'free',
          question: 'Was ist im Free-Plan enthalten?',
          answer: 'Free deckt den starken Einstieg ab: bis zu 2 Bots, 20 freie Stationen, Basis-Commands und den kompletten Commander- plus Worker-Startfluss.',
        },
        {
          key: 'dashboard',
          question: 'Brauche ich das Dashboard sofort?',
          answer: 'Nein. Free funktioniert ohne Dashboard. Ab Pro wird es relevant, wenn du Events, Rollenrechte, Weekly Digest und Health zentral verwalten willst.',
        },
        {
          key: 'pro',
          question: 'Wann lohnt sich Pro?',
          answer: 'Pro lohnt sich, sobald du deinen Server aktiv verwalten willst: Dashboard, Event-Scheduler, Rollenrechte, Weekly Digest und Health sind die Kernargumente.',
        },
        {
          key: 'ultimate',
          question: 'Wann brauche ich Ultimate?',
          answer: 'Ultimate ist für Power-User und Betreiber gedacht, die Custom Stations, tiefere Analytics, Failover und Automatisierung benötigen.',
        },
        {
          key: 'workers',
          question: 'Wie funktionieren Commander und Worker?',
          answer: 'Der Commander nimmt Commands und Worker-Invites an. Worker führen die Streams aus. Dadurch kann OmniFM mehrere parallele Streams sauber verteilen und stabil halten.',
        },
      ],
    },
    useCases: {
      eyebrow: 'Für wen ist OmniFM?',
      title: 'Jeder Plan hat eine klare Rolle',
      subtitle: 'Die Website soll nicht nur Preise zeigen, sondern erklären, welcher Plan für welchen Server-Typ wirklich sinnvoll ist.',
      cards: {
        free: {
          title: 'Free für schnelle Community-Radios',
          desc: 'Wenn du einen kleinen oder privaten Server mit 24/7 Radio versorgen willst, bringt Free den saubersten Einstieg.',
          fit: 'Ideal für kleine Communities, Freundesgruppen und den ersten Live-Einsatz ohne Administrationsaufwand.',
        },
        pro: {
          title: 'Pro für Community-Admins',
          desc: 'Sobald Events, Rollenrechte und Dashboard-Steuerung zum Alltag gehören, wird Pro zum eigentlichen Verwaltungsplan.',
          fit: 'Ideal für Event-Server, mittelgroße Communities und Teams mit klaren Rollen und wiederkehrenden Sessions.',
        },
        ultimate: {
          title: 'Ultimate für Operator-Setups',
          desc: 'Wenn Zuverlässigkeit, Custom Stations, tiefere Analytics und Automatisierung wichtig werden, ist Ultimate die richtige Stufe.',
          fit: 'Ideal für größere Communities, Power-User und Betreiber, die OmniFM als echtes System nutzen wollen.',
        },
      },
    },
    premium: {
      eyebrow: 'Premium',
      title: 'Upgrade dein Setup',
      subtitle: 'Mehr Worker, mehr Stationen, besserer Sound. Wähle den Plan, der zu deinem Server passt.',
      positioningTitle: 'Welcher Plan passt zu deinem Server?',
      positioning: [
          {
            key: 'free',
            title: 'Free für schnellen Einstieg',
            desc: 'Gut für kleine Server, die sofort 24/7 Radio wollen und ohne Reibung starten möchten.',
          },
          {
            key: 'pro',
            title: 'Pro für aktive Communities',
            desc: 'Der richtige Schritt, wenn Dashboard, Events, Rollenrechte und Health wirklich im Alltag gebraucht werden.',
          },
          {
            key: 'ultimate',
            title: 'Ultimate für Operatoren und Power-User',
            desc: 'Für Setups mit Custom Stations, stärkerer Zuverlässigkeit, tieferer Analyse und Automatisierungsbedarf.',
          },
        ],
      pricingFallback: 'Pricing-API nicht erreichbar, Fallback-Daten aktiv.',
      proofTitle: 'Warum der Upgrade-Schritt sauber ist',
      proofCards: {
        trial: {
          title: 'Risikoarm prüfen',
          valueEnabled: ({ months }) => `${months} Monat${months === 1 ? '' : 'e'} Test`,
          valueDisabled: 'Direkter Start',
          desc: 'Teste Pro zuerst mit Dashboard, Events und Rollenrechten, bevor du den Plan für deinen Server fest übernimmst.',
        },
        seats: {
          title: 'Mehrere Server unter Kontrolle',
          value: ({ min, max }) => `${min}-${max} Server-Slots`,
          desc: 'Seat-Bundles halten Upgrade und Lizenzierung für wachsende Communities sauber an einer Stelle.',
        },
        activation: {
          title: 'Discord-first Aktivierung',
          value: '/license activate',
          desc: 'Dein Lizenz-Key kommt per E-Mail und wird direkt im Bot mit dem Server verknüpft.',
        },
        tiers: {
          title: 'Klare Planlogik',
          value: 'Free -> Pro -> Ultimate',
          desc: 'Free bleibt der Einstieg, Pro ist das Management-Upgrade und Ultimate die Operator-Stufe.',
        },
      },
      flowNote: 'Jeder Plan baut auf demselben Bot-Kern auf. Upgrades schalten Kontrolle, Zuverlässigkeit und Skalierung frei, ohne dein Setup neu aufzubauen.',
      planPopular: 'Beliebt',
      planFitLabel: 'Ideal für',
      planUpgradeLabel: 'Upgrade wenn',
      planOutcomes: {
        free: {
          note: 'Der starke Einstieg für 24/7 Radio ohne Admin-Overhead.',
          fit: 'Kleine Communities, Freundesgruppen und Server, die schnell live gehen wollen.',
          upgrade: 'du Dashboard, Event-Scheduler oder rollenbasierte Steuerung brauchst.',
        },
        pro: {
          note: 'Der eigentliche Verwaltungsplan für aktive Server.',
          fit: 'Community-Admins, Event-Server und Teams mit klaren Rollen und wiederkehrenden Sessions.',
          upgrade: 'du Custom Stations, tiefere Analytics oder stärkere Recovery-Funktionen benötigst.',
        },
        ultimate: {
          note: 'Die Operator-Stufe für maximale Kontrolle und tieferen Betrieb.',
          fit: 'Power-User, Multi-Server-Setups und größere Communities mit hohem Anspruch an Zuverlässigkeit.',
          upgrade: 'du OmniFM als verwaltetes System mit maximaler Kontrolle statt nur als Radio-Bot nutzen willst.',
        },
      },
      perMonth: '/Monat',
      freeCta: 'Mit Free starten',
      buy: ({ name }) => `${name} kaufen`,
      trialCta: ({ months }) => `${months} Monat${months === 1 ? '' : 'e'} kostenlos testen`,
      trialActivated: 'Pro-Testmonat aktiviert.',
      emailLabel: 'E-Mail Adresse',
      emailHint: 'Dein Lizenz-Key und die Rechnung werden an diese Adresse gesendet.',
      emailPlaceholder: 'deine@email.de',
      couponLabel: 'Rabattcode (optional)',
      couponPlaceholder: 'z.B. PRO10',
      referralLabel: 'Referral-Code (optional)',
      referralPlaceholder: 'z.B. CREATOR10',
      referralHint: 'Referral-Links können den Code automatisch vorbelegen.',
      seatsLabel: 'Anzahl Server',
      seatsSuffix: 'Server',
      seatsMonthly: ({ amount }) => `${amount}/Monat`,
      seatsHint: 'Lizenziere mehrere Server mit einem Abo. Höhere Bundles senken den Preis pro Server.',
      durationLabel: 'Laufzeit wählen',
      durationMonth: 'Monat',
      durationMonths: 'Monate',
      durationBonus: '+2 gratis',
      bestValue: 'Beste Wahl',
      summary: ({ durationLabel, seatsLabel }) => `${durationLabel}${seatsLabel ? ` · ${seatsLabel}` : ''}`,
      licenseHintLead: 'Nach dem Kauf erhältst du deinen',
      licenseHintKey: 'Lizenz-Key',
      licenseHintMiddle: 'per E-Mail. Nutze',
      licenseHintCommand: '/license activate',
      licenseHintTail: 'im Discord, um deinen Server zu verknüpfen.',
      checkoutRedirect: 'Weiterleitung...',
      payButton: ({ amount }) => `${amount} bezahlen`,
      cancel: 'Abbrechen',
      checkoutTitle: ({ name }) => `OmniFM ${name}`,
      invalidEmail: 'Bitte eine gültige E-Mail-Adresse eingeben.',
      checkoutFailed: 'Checkout fehlgeschlagen. Bitte später erneut versuchen.',
      checkoutUrlMissing: 'Keine Checkout-URL erhalten.',
      trialFailed: 'Testmonat konnte nicht aktiviert werden. Bitte später erneut versuchen.',
      trialWorking: 'Testmonat wird aktiviert...',
      trialActivatedDefault: 'Pro-Testmonat aktiviert.',
      statusTitle: 'Premium-Status prüfen',
      statusHint: 'Schon im Betrieb? Prüfe Tier, Bitrate und Ablauf direkt über deine Discord-Server-ID.',
      serverIdPlaceholder: 'Discord Server ID',
      serverIdInvalid: 'Server-ID muss 17-22 Ziffern haben.',
      checkLoading: 'Prüfe...',
      checkButton: 'Prüfen',
      checkFailed: 'Premium-Status konnte nicht geladen werden.',
      statusResult: ({ tier, bitrate, days, expires }) => `Tier: ${tier} | Bitrate: ${bitrate} | Resttage: ${days} | Ablauf: ${expires}`,
      priceFrom: 'ab',
      freePrice: '0 EUR',
      monthLabel: ({ count }) => count === 1 ? '1 Monat' : `${count} Monate`,
      seatsLabelInline: ({ count }) => count === 1 ? '1 Server' : `${count} Server`,
      fallbackFeatures: {
        free: ['Bis zu 2 Bots', '20 Free Stationen', 'Standard Audio (64k)', 'Standard Reconnect'],
        pro: ['Bis zu 8 Bots', '120 Stationen (Free + Pro)', 'HQ Audio (128k Opus)', 'Priority Reconnect', 'Rollenbasierte Berechtigungen', 'Event-Scheduler'],
        ultimate: ['Bis zu 16 Bots', 'Alle Stationen + Custom URLs', 'Ultra HQ Audio (320k)', 'Instant Reconnect', 'Rollenbasierte Berechtigungen'],
      },
    },
    footer: {
      stats: {
        servers: 'Server',
        users: 'Nutzer',
        connections: 'Verbindungen',
        listeners: 'Zuhörer',
        bots: 'Bots',
        stations: 'Stationen',
      },
      liveNote: 'Die öffentlichen Netzwerkzahlen werden live aus dem Produkt geladen und regelmäßig aktualisiert.',
      operatedBy: ({ operator }) => `Betrieben von ${operator}.`,
      proofTitle: 'Vertrauen am Ende der Seite',
      proofCards: {
        operations: {
          title: 'Live-Netzwerk',
          value: ({ readyBots, totalBots }) => `${readyBots}/${totalBots} Bots bereit`,
          desc: 'Öffentliche Zahlen, aktive Stationen und ein laufendes Bot-Netzwerk zeigen echten Produktbetrieb statt nur Marketing.',
        },
        support: {
          title: 'Direkter Support',
          value: 'Discord Community',
          desc: 'Fragen, Rollout-Hilfe und Troubleshooting bleiben direkt erreichbar.',
        },
        languages: {
          title: 'Zweisprachig',
          value: 'DE / EN',
          desc: 'Website und Produktführung bleiben in Deutsch und Englisch verfügbar.',
        },
        legal: {
          title: 'Rechtlich erreichbar',
          value: 'Impressum + Datenschutz + Terms',
          desc: 'Impressum, Datenschutzerklärung und Nutzungsbedingungen sind von jeder Seite aus direkt verlinkt.',
        },
      },
      links: {
        imprint: 'Impressum',
        privacy: 'Datenschutzerklärung',
        terms: 'Nutzungsbedingungen',
      },
      builtWith: 'Gebaut mit',
      forDiscord: 'für Discord',
      discord: 'Discord Community',
    },
    legal: {
      pageTitle: 'OmniFM | Impressum',
      eyebrow: 'Impressum',
      title: 'Impressum & Offenlegung',
      subtitle: 'Pflichtangaben für den Webauftritt von OmniFM. Die Inhalte werden aus der Server-Konfiguration geladen und können direkt über das Setup-Menü gepflegt werden.',
      cards: {
        provider: 'Diensteanbieter',
        contact: 'Kontakt & Aufsicht',
        company: 'Unternehmensdaten',
        media: 'Medienrechtliche Angaben',
      },
      fields: {
        providerName: 'Name / Firma',
        legalForm: 'Rechtsform',
        representative: 'Vertretungsbefugte Person',
        businessPurpose: 'Unternehmensgegenstand',
        address: 'Anschrift',
        website: 'Webseite',
        email: 'E-Mail',
        phone: 'Telefon',
        supervisoryAuthority: 'Aufsichtsbehörde',
        chamber: 'Kammer / Berufsverband',
        profession: 'Berufsbezeichnung',
        professionRules: 'Berufsrecht / Regelwerk',
        commercialRegisterNumber: 'Firmenbuchnummer',
        commercialRegisterCourt: 'Firmenbuchgericht',
        vatId: 'UID-Nummer',
        mediaOwner: 'Medieninhaber',
        editorialResponsible: 'Redaktionell verantwortlich',
        mediaLine: 'Grundlegende Richtung',
        streetAddress: 'Straße / Hausnummer',
        postalCode: 'PLZ',
        city: 'Ort',
      },
      defaultCountry: 'Österreich',
      notProvided: 'Nicht angegeben',
      warningTitle: 'Pflichtfelder fehlen',
      warningFallback: 'Pflichtangaben',
      warning: ({ fields }) => `Diese Angaben fehlen aktuell noch oder sind unvollständig: ${fields}. Für einen rechtssicheren Betrieb in Österreich solltest du das ergänzen.`,
      noteTitle: 'Rechtlicher Hinweis',
      note: 'Die Seite bildet die üblichen Informations- und Offenlegungspflichten für österreichische Webseiten ab. Je nach Rechtsform, Gewerbe oder redaktioneller Ausrichtung können zusätzliche Angaben erforderlich sein.',
      basis: 'Rechtsgrundlagen: § 5 ECG, § 14 UGB, § 63 GewO und § 25 MedienG.',
    },
    privacy: {
      pageTitle: 'OmniFM | Datenschutzerklärung',
      eyebrow: 'Datenschutzerklärung',
      title: 'Datenschutzerklärung',
      subtitle: 'Diese Erklärung beschreibt, welche personenbezogenen Daten OmniFM im Webauftritt, im Discord-Bot-Betrieb und in Premium-, E-Mail- und Supportprozessen verarbeitet.',
      cards: {
        controller: 'Verantwortlicher',
        contact: 'Kontakt & Datenschutz',
        hosting: 'Hosting & Infrastruktur',
        authority: 'Beschwerdebehörde',
      },
      fields: {
        controllerName: 'Verantwortlicher',
        controllerStreetAddress: 'Straße / Hausnummer',
        controllerPostalCode: 'PLZ',
        controllerCity: 'Ort',
        representative: 'Vertretungsbefugte Person',
        address: 'Anschrift',
        website: 'Webseite',
        email: 'E-Mail',
        phone: 'Telefon',
        dpoName: 'Datenschutzkontakt / DSB',
        dpoEmail: 'Datenschutz-E-Mail',
        hostingProvider: 'Hosting-Anbieter',
        hostingLocation: 'Hosting-Standort',
        authorityName: 'Beschwerdebehörde',
        authorityWebsite: 'Behörden-Website',
        additionalRecipients: 'Weitere Empfänger',
        customNote: 'Zusätzlicher Hinweis',
        logDays: 'Log-Aufbewahrung',
        songHistory: 'Song-Historie',
      },
      defaultCountry: 'Österreich',
      defaultAuthorityName: 'Österreichische Datenschutzbehörde',
      defaultAuthorityWebsite: 'https://www.dsb.gv.at/',
      notProvided: 'Nicht angegeben',
      booleanEnabled: 'Aktiv',
      booleanDisabled: 'Nicht aktiv',
      logDaysValue: ({ days }) => `${days} Tage`,
      songHistoryValue: ({ maxEntries }) => `bis zu ${maxEntries} Einträge pro Server`,
      warningTitle: 'Basisangaben ergänzen',
      warningFallback: 'Datenschutz-Kontaktdaten',
      warning: ({ fields }) => `Diese Angaben fehlen aktuell noch oder sind unvollständig: ${fields}. Ergänze sie, bevor du die Datenschutzerklärung produktiv verwendest.`,
      sections: {
        overviewTitle: 'Kurzüberblick',
        overviewBody: 'OmniFM verwendet notwendige Speicherungen für Sprache, Sicherheit und Dashboard-Sitzungen. Google Analytics 4 wird nur nach Einwilligung geladen; Werbe- oder Remarketing-Cookies werden nicht bewusst eingesetzt.',
        websiteTitle: 'Webseite, Sicherheit und Spracheinstellung',
        websiteBody: ({ localeStorageKey }) => `Beim Aufruf der Webseite verarbeitet OmniFM technische Verbindungsdaten, soweit das für die Auslieferung der Inhalte, CORS-Prüfungen, Rate-Limits und den Schutz vor Missbrauch erforderlich ist. Die Weboberfläche speichert die gewählte Sprache lokal im Browser unter "${localeStorageKey}". Die Cookie-Auswahl wird lokal im Browser gespeichert.`,
        cookiesTitle: 'Cookies, lokale Speicherung und Dashboard-Sitzungen',
        cookiesBody: 'Notwendige Speicherungen umfassen Spracheinstellung, Cookie-Auswahl und technisch erforderliche Dashboard-Sitzungscookies. Dashboard-Sitzungscookies sind von Analytics getrennt und dienen nur Login, Sicherheit und Zugriff auf geschützte Dashboard-Funktionen.',
        analyticsTitle: 'Google Analytics 4',
        analyticsBody: 'Wenn du Analytics erlaubst, lädt OmniFM Google Analytics 4 über das Google-Tag G-J5X0ZZ5E3Z. Dabei können Seitenaufrufe, technische Geräte-/Browserdaten, ungefähre Region, Referrer und Interaktionen verarbeitet werden. Consent Mode v2 wird mit Analytics-Speicherung nur nach Einwilligung genutzt; Anzeigen-Speicherung, personalisierte Werbung und Ad-User-Data bleiben deaktiviert. Empfänger ist Google Ireland Limited bzw. verbundene Google-Gesellschaften. Du kannst die Einwilligung jederzeit über die Cookie-Einstellungen widerrufen; dann wird der Tag deaktiviert und bekannte GA-Cookies werden gelöscht.',
        previewTitle: 'Station-Vorschau und externe Streams',
        previewBody: 'Wenn du auf der Webseite eine Station vorhörst, verbindet sich dein Browser direkt mit dem ausgewählten Stream-Anbieter. Dabei können insbesondere IP-Adresse, Uhrzeit und weitere technische Verbindungsdaten beim jeweiligen Radio- oder CDN-Betreiber anfallen.',
        botTitle: 'Discord-Bot-Betrieb',
        botBody: 'Bei der Nutzung des Bots verarbeitet OmniFM server- und funktionsbezogene Daten wie Guild-/Server-IDs, Channel-IDs, Sprach- und Berechtigungseinstellungen, benutzerdefinierte Stationen, geplante Events, Song-Historien und Listening-Statistiken, soweit die jeweilige Funktion aktiviert ist.',
        premiumTitle: 'Premium, Testmonat und Zahlungen',
        premiumBody: ({ stripeEnabled, smtpEnabled }) => `Für Premium-Checkout, Testmonat und Lizenzverwaltung verarbeitet OmniFM insbesondere E-Mail-Adresse, Server-ID, gewählten Plan, Laufzeit, Seats sowie Rabatt- oder Referral-Codes. ${stripeEnabled ? 'Wenn Stripe aktiviert ist, werden Zahlungs- und Checkout-Daten zusätzlich an Stripe übermittelt.' : 'Stripe ist aktuell nicht aktiviert.'} ${smtpEnabled ? 'Wenn SMTP aktiviert ist, werden Lizenz-, Rechnungs- und Support-E-Mails über den konfigurierten Mail-Anbieter zugestellt.' : 'Ein Mailversand ist aktuell nicht aktiviert.'}`,
        integrationsTitle: 'Empfänger und externe Dienste',
        integrationsBody: ({ stripeEnabled, smtpEnabled, discordBotListEnabled, botsGGEnabled, topGGEnabled, recognitionEnabled }) => `Je nach aktivierten Modulen können Daten an Discord, den Hosting-Anbieter, ausgewählte Radio-Stream-Betreiber${stripeEnabled ? ', Stripe' : ''}${smtpEnabled ? ', den konfigurierten SMTP-Anbieter' : ''}${discordBotListEnabled ? ', DiscordBotList' : ''}${botsGGEnabled ? ', Discord Bots (bots.gg)' : ''}${topGGEnabled ? ', Top.gg' : ''}${recognitionEnabled ? ' sowie Metadaten-/Musikerkennungsdienste' : ''} übermittelt werden.`,
        retentionTitle: 'Speicherdauer',
        retentionBody: ({ logDays, songHistoryMaxPerGuild }) => `Technische Rotationslogs werden standardmäßig bis zu ${logDays} Tage vorgehalten. Song-Historien werden pro Server bis zur konfigurierten Maximalanzahl von ${songHistoryMaxPerGuild} Einträgen gespeichert. Lizenz-, Einstellungs-, Statistik- und Eventdaten bleiben gespeichert, bis sie gelöscht, ersetzt oder aus gesetzlichen Gründen nicht mehr benötigt werden.`,
        basisTitle: 'Rechtsgrundlagen',
        basisBody: 'Je nach Vorgang verarbeitet OmniFM Daten insbesondere auf Basis von Art. 6 Abs. 1 lit. b DSGVO (Vertrag/Service), lit. c DSGVO (rechtliche Pflichten) und lit. f DSGVO (berechtigte Interessen an Sicherheit, Stabilität und Missbrauchsschutz).',
        rightsTitle: 'Deine Rechte',
        rightsBody: 'Du kannst die folgenden Betroffenenrechte geltend machen, soweit die gesetzlichen Voraussetzungen erfüllt sind:',
        rightsItems: [
          'Auskunft über verarbeitete personenbezogene Daten',
          'Berichtigung unrichtiger oder unvollständiger Daten',
          'Löschung oder Einschränkung der Verarbeitung',
          'Datenübertragbarkeit bei passenden Verarbeitungsvorgängen',
          'Widerspruch gegen Verarbeitungen auf Basis berechtigter Interessen',
          'Beschwerde bei der zuständigen Datenschutzbehörde',
        ],
        contactTitle: 'Kontakt und Beschwerden',
        contactBody: ({ authorityName }) => `Für Datenschutzanfragen solltest du zuerst den oben genannten Kontakt verwenden. Wenn du der Meinung bist, dass eine Verarbeitung gegen Datenschutzrecht verstößt, kannst du dich zudem an ${authorityName} oder eine andere zuständige Aufsichtsbehörde wenden.`,
      },
      noteTitle: 'Wichtiger Hinweis',
      note: 'Diese Datenschutzerklärung bildet die typischen Datenflüsse von OmniFM nach aktuellem Code- und Konfigurationsstand ab. Je nach Hosting, Reverse Proxy, Zahlungsabwicklung oder Supportprozess können zusätzliche Angaben notwendig sein.',
      basis: 'Rechtsgrundlagen: Art. 13 DSGVO sowie Art. 15 bis 22 DSGVO. Zuständige österreichische Beschwerdestelle: Österreichische Datenschutzbehörde.',
    },
    terms: {
      pageTitle: 'OmniFM | Nutzungsbedingungen',
      eyebrow: 'Nutzungsbedingungen',
      title: 'Nutzungsbedingungen',
      subtitle: 'Diese Bedingungen regeln die Nutzung der OmniFM-Webseite, des Discord-Bots, des Dashboards und optionaler Premium-Funktionen.',
      cards: {
        operator: 'Anbieter',
        contact: 'Kontakt & Geltung',
        service: 'Dienstumfang',
        billing: 'Premium & Abrechnung',
      },
      fields: {
        providerName: 'Name / Firma',
        representative: 'Vertretungsbefugte Person',
        businessPurpose: 'Unternehmensgegenstand',
        website: 'Webseite',
        contactEmail: 'Kontakt-E-Mail',
        supportWebsite: 'Support / Webseite',
        effectiveDate: 'Gültig ab',
        governingLaw: 'Anwendbares Recht',
        discordBot: 'Discord-Bot',
        dashboard: 'Dashboard',
        stationPreview: 'Station-Vorschau',
        scheduledEvents: 'Event-Scheduler',
        customStations: 'Custom-Stationen',
        premiumCheckout: 'Premium-Checkout',
        paymentProvider: 'Zahlungsanbieter',
        emailDelivery: 'Lizenz- & Support-E-Mails',
        trialMonth: 'Testmonat',
      },
      defaultGoverningLaw: 'Österreichisches Recht',
      notProvided: 'Nicht angegeben',
      booleanEnabled: 'Aktiv',
      booleanDisabled: 'Nicht aktiv',
      warningTitle: 'Basisangaben ergänzen',
      warningFallback: 'Anbieter- und Kontaktangaben',
      warning: ({ fields }) => `Diese Angaben fehlen aktuell noch oder sind unvollständig: ${fields}. Ergänze sie, bevor du diese Nutzungsbedingungen produktiv verlinkst.`,
      sections: {
        overviewTitle: 'Kurzüberblick',
        overviewBody: 'OmniFM ist ein Discord-Radio-Dienst mit Webseite, Bot, Dashboard und optionalen Premium-Funktionen. Die Nutzungsbedingungen beschreiben den vertraglichen Rahmen für diese Komponenten.',
        scopeTitle: 'Leistungsumfang',
        scopeBody: 'OmniFM umfasst den Webauftritt, die Bot-Funktionen in Discord, das Dashboard, Statistik- und Event-Funktionen sowie je nach Konfiguration Premium-, E-Mail- und Integrationsfunktionen. Der genaue Umfang kann je nach Plan, Server-Setup und aktivierten Modulen variieren.',
        discordTitle: 'Discord als Drittplattform',
        discordBody: 'OmniFM setzt für wesentliche Funktionen auf Discord. Verfügbarkeit, API-Verhalten, Rollen, Berechtigungen, Voice-Verbindungen und App-Richtlinien hängen auch von Discord als Drittplattform ab und können sich außerhalb des Einflussbereichs von OmniFM ändern.',
        previewTitle: 'Web-Vorschau und externe Streams',
        previewBody: 'Wenn du auf der Webseite eine Station vorhörst, verbindet sich dein Browser direkt mit dem ausgewählten Stream-Anbieter. Auch im Bot-Betrieb stammen Streams, Metadaten oder Coverdaten teilweise von Drittanbietern, für deren Inhalte und technische Verfügbarkeit OmniFM nicht allein verantwortlich ist.',
        customStationsTitle: 'Custom-Stationen und nutzereingetragene Inhalte',
        customStationsBody: 'Soweit OmniFM das Hinterlegen eigener Stream-URLs, Stationsnamen, Bilder, Beschreibungen, Webhooks oder anderer Inhalte erlaubt, bist du dafür verantwortlich, dass diese Angaben rechtmäßig sind, keine Rechte Dritter verletzen und technisch sicher genutzt werden dürfen.',
        acceptableUseTitle: 'Zulässige Nutzung',
        acceptableUseBody: 'OmniFM darf nur rechtmäßig und im Rahmen der jeweils geltenden Plattform- und Gesetzesvorgaben genutzt werden.',
        acceptableUseItems: [
          'keine missbräuchliche, störende oder sicherheitsgefährdende Nutzung',
          'keine Umgehung von Limits, Zugriffsbeschraenkungen oder technischen Schutzmechanismen',
          'keine Nutzung für rechtswidrige, urheberrechtsverletzende oder irreführende Streams und Inhalte',
          'keine Weitergabe falscher, fremder oder unzulässiger Daten im Rahmen von Premium, Support oder Dashboard-Funktionen',
        ],
        premiumTitle: 'Premium, digitale Leistungen und Checkout',
        premiumBody: ({ premiumCheckoutEnabled, paymentProvider }) => `Premium-Funktionen sind digitale Leistungen. ${premiumCheckoutEnabled ? `Wenn kostenpflichtige Checkouts aktiviert sind, erfolgt die Zahlungsabwicklung über ${paymentProvider || 'den konfigurierten Zahlungsanbieter'}.` : 'Ein Online-Checkout ist aktuell nicht aktiviert.'} Vor Abschluss werden Plan, Laufzeit, Seats und Preis angezeigt. Maßgeblich ist jeweils der konkrete Checkout- und Lizenzstatus.`,
        streamRightsTitle: 'Radio-Streams, Rechte und Lizenzen',
        streamRightsBody: 'Wichtig: Diese Nutzungsbedingungen lösen keine eventuellen Urheber-, Leistungsschutz-, Senderecht- oder Lizenzfragen für Radio-Streams. Wenn über OmniFM Drittstreams oder nutzergelieferte Streams über Discord verbreitet werden, ist das ein separates Rechtsrisiko. Diese Bedingungen regeln das Verhalten im Dienst, machen eine unzulässige Nutzung aber nicht automatisch legal.',
        availabilityTitle: 'Verfügbarkeit und Änderungen',
        availabilityBody: 'OmniFM wird mit dem Ziel eines stabilen Betriebs bereitgestellt, schuldet aber keine jederzeitige, fehlerfreie oder unterbrechungsfreie Verfügbarkeit. Wartung, Updates, Discord-Änderungen, Netzwerkausfälle, Stream-Ausfälle oder Sicherheitsmaßnahmen können Funktionen vorübergehend einschränken oder ändern.',
        suspensionTitle: 'Sperrung und Beendigung',
        suspensionBody: 'OmniFM kann den Zugriff auf einzelne Funktionen, Server, Lizenzen oder Nutzerkontexte einschränken oder beenden, wenn objektive Gründe dafür bestehen.',
        suspensionItems: [
          'Verstöße gegen diese Nutzungsbedingungen oder gegen Discord-Richtlinien',
          'Hinweise auf missbräuchliche, rechtswidrige oder sicherheitskritische Nutzung',
          'offensichtlich unzulässige Custom-Streams oder Inhalte',
          'technische oder betriebliche Gründe, die eine Einschränkung erforderlich machen',
        ],
        liabilityTitle: 'Haftung',
        liabilityBody: 'Soweit gesetzlich zulässig, haftet OmniFM nicht für Ausfälle oder Inhalte externer Streams, Discord-Störungen, Drittanbieter-Integrationen oder Konfigurationsfehler außerhalb des eigenen Verantwortungsbereichs. Zwingende Haftungsregeln, insbesondere bei Vorsatz, grober Fahrlässigkeit, Personenschäden oder nach zwingendem Verbraucherrecht, bleiben unberührt.',
        lawTitle: 'Anwendbares Recht',
        lawBody: ({ governingLaw }) => `Soweit gesetzlich zulässig gilt ${governingLaw}. Zwingende verbraucherschützende Vorschriften und zwingende Gerichtsstände bleiben unberührt.`,
        contactTitle: 'Kontakt',
        contactBody: ({ email, website }) => `Fragen zu diesen Nutzungsbedingungen kannst du an ${email || 'den oben genannten Kontakt'} richten.${website ? ` Weitere Informationen findest du unter ${website}.` : ''}`,
      },
      noteTitle: 'Wichtiger Hinweis',
      note: 'Diese Nutzungsbedingungen bilden die typische Produktstruktur von OmniFM nach aktuellem Code- und Konfigurationsstand ab. Je nach Geschäftsmodell, Rechtsform, Zahlungsablauf oder individueller Supportzusage kann eine zusätzliche rechtliche Prüfung sinnvoll sein.',
      basis: 'Hinweis: Diese Seite ergänzt Impressum und Datenschutzerklärung um den vertraglichen Nutzungsrahmen des Dienstes.',
    },
  },
  en: {
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
      body: 'OmniFM uses necessary storage for language, security, and dashboard sessions. Google Analytics 4 is loaded only when you allow analytics.',
      necessaryTitle: 'Necessary',
      necessaryBody: 'Required for language preferences, secure dashboard sessions, and technical operation. This category cannot be disabled.',
      analyticsTitle: 'Analytics',
      analyticsBody: 'Allows Google Analytics 4 with Consent Mode to measure page views and usage at a high level. No Google Analytics script is loaded before your consent.',
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
          detail: 'Events, permissions, health, and server control from Pro upward.',
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
      loadMore: ({ shown, remaining }) => `Show more (${shown} of ${remaining})`,
      visible: ({ visible, total }) => `Showing ${visible} of ${total} stations`,
      previewVolume: 'Volume',
      stopPreview: 'Stop preview',
      tiers: {
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
    },
    commands: {
      eyebrow: 'Slash Commands',
      title: 'Commands by tier',
      subtitle: 'Each tier unlocks more commands. Free commands are always available.',
      countLabel: ({ count }) => `${count} commands`,
      loading: 'Loading commands...',
      empty: 'No commands available.',
      descriptionMap: {
        help: 'Shows all commands and short explanations.',
        play: 'Starts a radio stream in your current voice channel.',
        pause: 'Pauses the current playback.',
        resume: 'Resumes the current playback.',
        stop: 'Stops playback and leaves the channel.',
        stations: 'Shows the stations available for your plan.',
        list: 'Lists stations with pagination.',
        setvolume: 'Sets the stream volume.',
        status: 'Shows bot status and uptime.',
        health: 'Shows stream health and reconnect details.',
        diag: 'Shows audio, FFmpeg, and stream diagnostics.',
        premium: 'Shows your server premium status.',
        language: 'Manages the language for this server.',
        license: 'Activates or shows license details.',
        invite: 'Shows invite links for available worker bots.',
        workers: 'Shows the commander/worker setup.',
        now: 'Shows the currently detected track.',
        stats: 'Shows listening and usage stats for this server.',
        history: 'Shows the most recently detected songs.',
        event: 'Manages scheduled auto-start events.',
        perm: 'Manages role-based command permissions.',
        addstation: 'Adds a custom radio station.',
        removestation: 'Removes a custom radio station.',
        mystations: 'Lists your custom stations.',
      },
    },
    planMatrix: {
      eyebrow: 'Free vs Pro vs Ultimate',
      title: 'Clear comparison, no open questions',
      subtitle: 'The matrix shows exactly what each plan includes. Ultimate clearly adds reliability features, more bot slots, and expanded analytics.',
      featureHeader: 'Feature',
      tiers: {
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
      rows: [
        { key: 'dashboard', label: 'Web dashboard (SSO + guild picker)', free: false, pro: true, ultimate: true },
        { key: 'events', label: 'Web event scheduler', free: false, pro: true, ultimate: true },
        { key: 'perms', label: 'Role permissions per command', free: false, pro: true, ultimate: true },
        { key: 'basicStats', label: 'Guild-specific basic statistics', free: false, pro: true, ultimate: true },
        { key: 'fallback', label: '/play with optional fallback', free: false, pro: false, ultimate: true },
        { key: 'advancedStats', label: 'Advanced analytics (channels + daily report)', free: false, pro: false, ultimate: true },
      ],
    },
    commandMatrix: {
      eyebrow: 'Command matrix',
      title: 'Which commands are included in each plan',
      commandHeader: 'Command',
      tiers: {
        free: 'Free',
        pro: 'Pro',
        ultimate: 'Ultimate',
      },
      rows: [
        { command: '/play', free: 'Basic', pro: 'HQ + worker', ultimate: 'HQ + fallback' },
        { command: '/event', free: '—', pro: 'Yes', ultimate: 'Yes + advanced' },
        { command: '/perm', free: '—', pro: 'Yes', ultimate: 'Yes + advanced' },
        { command: '/stats', free: '—', pro: 'Basic stats', ultimate: 'Advanced analytics' },
        { command: '/addstation', free: '—', pro: '—', ultimate: 'Yes (custom URL)' },
        { command: '/workers', free: '—', pro: 'Yes', ultimate: 'Prioritized' },
      ],
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
          answer: 'No. Free works without the dashboard. It starts to matter from Pro onward when you need events, role permissions, weekly digests, and health in one place.',
        },
        {
          key: 'pro',
          question: 'When is Pro worth it?',
          answer: 'Pro becomes valuable as soon as you actively manage a server: dashboard access, event scheduling, role permissions, weekly digest, and health are the key reasons.',
        },
        {
          key: 'ultimate',
          question: 'When do I need Ultimate?',
          answer: 'Ultimate is for power users and operators who need custom stations, deeper analytics, failover behavior, and automation options.',
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
    premium: {
      eyebrow: 'Premium',
      title: 'Upgrade your setup',
      subtitle: 'More workers, more stations, better audio. Pick the plan that fits your server.',
      positioningTitle: 'Which plan fits your server?',
      positioning: [
        {
          key: 'free',
          title: 'Free for a fast start',
          desc: 'Best for smaller servers that want instant 24/7 radio and a low-friction first setup.',
        },
        {
          key: 'pro',
          title: 'Pro for active communities',
          desc: 'The right step when dashboard control, events, role permissions, and health matter in daily operation.',
        },
        {
          key: 'ultimate',
          title: 'Ultimate for operators and power users',
          desc: 'For setups that need custom stations, stronger reliability tooling, deeper analytics, and automation.',
        },
      ],
      pricingFallback: 'Pricing API unreachable, fallback pricing is active.',
      proofTitle: 'Why the upgrade step feels safe',
      proofCards: {
        trial: {
          title: 'Low-risk evaluation',
          valueEnabled: ({ months }) => `${months} month${months === 1 ? '' : 's'} trial`,
          valueDisabled: 'Direct start',
          desc: 'Test Pro with dashboard control, events, and permissions before you fully roll it out on your server.',
        },
        seats: {
          title: 'Multiple servers, one flow',
          value: ({ min, max }) => `${min}-${max} server seats`,
          desc: 'Seat bundles keep licensing and upgrades tidy as your community expands across more servers.',
        },
        activation: {
          title: 'Discord-first activation',
          value: '/license activate',
          desc: 'Your license key arrives by email and is linked to the server directly inside the bot.',
        },
        tiers: {
          title: 'Clear plan logic',
          value: 'Free -> Pro -> Ultimate',
          desc: 'Free stays the entry tier, Pro adds management, and Ultimate becomes the operator layer.',
        },
      },
      flowNote: 'Every plan builds on the same bot core. Upgrades add control, reliability, and scale without forcing you into a new setup.',
      planPopular: 'Popular',
      planFitLabel: 'Best for',
      planUpgradeLabel: 'Upgrade when',
      planOutcomes: {
        free: {
          note: 'The strong entry point for 24/7 radio without admin overhead.',
          fit: 'Smaller communities, friend groups, and servers that want to get live fast.',
          upgrade: 'you need dashboard control, event scheduling, or role-based command management.',
        },
        pro: {
          note: 'The real management tier for active servers.',
          fit: 'Community admins, event servers, and teams with recurring sessions and clear roles.',
          upgrade: 'you need custom stations, deeper analytics, or stronger recovery and operator tooling.',
        },
        ultimate: {
          note: 'The operator tier for maximum control and deeper operations.',
          fit: 'Power users, multi-server setups, and larger communities with a higher reliability bar.',
          upgrade: 'you want OmniFM to behave like managed infrastructure instead of only a radio bot.',
        },
      },
      perMonth: '/month',
      freeCta: 'Start with Free',
      buy: ({ name }) => `Buy ${name}`,
      trialCta: ({ months }) => `Try ${months} month${months === 1 ? '' : 's'} for free`,
      trialActivated: 'Pro trial activated.',
      emailLabel: 'Email address',
      emailHint: 'Your license key and invoice will be sent to this address.',
      emailPlaceholder: 'you@example.com',
      couponLabel: 'Discount code (optional)',
      couponPlaceholder: 'e.g. PRO10',
      referralLabel: 'Referral code (optional)',
      referralPlaceholder: 'e.g. CREATOR10',
      referralHint: 'Referral links can prefill this code automatically.',
      seatsLabel: 'Number of servers',
      seatsSuffix: 'servers',
      seatsMonthly: ({ amount }) => `${amount} / month`,
      seatsHint: 'License multiple servers with one subscription. Larger bundles reduce the cost per server.',
      durationLabel: 'Choose duration',
      durationMonth: 'month',
      durationMonths: 'months',
      durationBonus: '+2 free',
      bestValue: 'Best',
      summary: ({ durationLabel, seatsLabel }) => `${durationLabel}${seatsLabel ? ` · ${seatsLabel}` : ''}`,
      licenseHintLead: 'After purchase you will receive your',
      licenseHintKey: 'license key',
      licenseHintMiddle: 'by email. Use',
      licenseHintCommand: '/license activate',
      licenseHintTail: 'inside Discord to link your server.',
      checkoutRedirect: 'Redirecting...',
      payButton: ({ amount }) => `Pay ${amount}`,
      cancel: 'Cancel',
      checkoutTitle: ({ name }) => `OmniFM ${name}`,
      invalidEmail: 'Please enter a valid email address.',
      checkoutFailed: 'Checkout failed. Please try again later.',
      checkoutUrlMissing: 'No checkout URL was returned.',
      trialFailed: 'The trial could not be activated. Please try again later.',
      trialWorking: 'Activating trial...',
      trialActivatedDefault: 'Pro trial activated.',
      statusTitle: 'Check premium status',
      statusHint: 'Already running OmniFM? Check the exact tier, bitrate, and expiry directly with your Discord server ID.',
      serverIdPlaceholder: 'Discord server ID',
      serverIdInvalid: 'Server ID must contain 17-22 digits.',
      checkLoading: 'Checking...',
      checkButton: 'Check',
      checkFailed: 'Premium status could not be loaded.',
      statusResult: ({ tier, bitrate, days, expires }) => `Tier: ${tier} | Bitrate: ${bitrate} | Days left: ${days} | Expires: ${expires}`,
      priceFrom: 'from',
      freePrice: '0 EUR',
      monthLabel: ({ count }) => count === 1 ? '1 month' : `${count} months`,
      seatsLabelInline: ({ count }) => count === 1 ? '1 server' : `${count} servers`,
      fallbackFeatures: {
        free: ['Up to 2 bots', '20 free stations', 'Standard audio (64k)', 'Standard reconnect'],
        pro: ['Up to 8 bots', '120 stations (free + pro)', 'HQ audio (128k Opus)', 'Priority reconnect', 'Role-based permissions', 'Event scheduler'],
        ultimate: ['Up to 16 bots', 'All stations + custom URLs', 'Ultra HQ audio (320k)', 'Instant reconnect', 'Role-based permissions'],
      },
    },
    footer: {
      stats: {
        servers: 'Servers',
        users: 'Users',
        connections: 'Connections',
        listeners: 'Listeners',
        bots: 'Bots',
        stations: 'Stations',
      },
      liveNote: 'Public network numbers are loaded from the live product and refreshed regularly.',
      operatedBy: ({ operator }) => `Operated by ${operator}.`,
      proofTitle: 'Trust signals at the bottom',
      proofCards: {
        operations: {
          title: 'Live network',
          value: ({ readyBots, totalBots }) => `${readyBots}/${totalBots} bots ready`,
          desc: 'Public numbers, active stations, and a running bot network show real operation instead of placeholder marketing.',
        },
        support: {
          title: 'Direct support',
          value: 'Discord Community',
          desc: 'Questions, rollout help, and troubleshooting stay directly reachable.',
        },
        languages: {
          title: 'Bilingual',
          value: 'DE / EN',
          desc: 'Website copy and product navigation remain available in German and English.',
        },
        legal: {
          title: 'Legal basics',
          value: 'Imprint + Privacy + Terms',
          desc: 'Imprint, privacy, and terms pages stay directly linked from every page.',
        },
      },
      links: {
        imprint: 'Imprint',
        privacy: 'Privacy policy',
        terms: 'Terms of service',
      },
      builtWith: 'Built with',
      forDiscord: 'for Discord',
      discord: 'Discord Community',
    },
    legal: {
      pageTitle: 'OmniFM | Imprint',
      eyebrow: 'Imprint',
      title: 'Imprint & disclosure',
      subtitle: 'Required provider details for the OmniFM website. The content is loaded from the server configuration and can be maintained from the setup menu.',
      cards: {
        provider: 'Service provider',
        contact: 'Contact & authority',
        company: 'Company details',
        media: 'Media law details',
      },
      fields: {
        providerName: 'Name / company',
        legalForm: 'Legal form',
        representative: 'Authorized representative',
        businessPurpose: 'Business purpose',
        address: 'Address',
        website: 'Website',
        email: 'Email',
        phone: 'Phone',
        supervisoryAuthority: 'Supervisory authority',
        chamber: 'Chamber / professional body',
        profession: 'Professional title',
        professionRules: 'Professional rules',
        commercialRegisterNumber: 'Commercial register number',
        commercialRegisterCourt: 'Commercial register court',
        vatId: 'VAT ID',
        mediaOwner: 'Media owner',
        editorialResponsible: 'Editorially responsible',
        mediaLine: 'Editorial line',
        streetAddress: 'Street / number',
        postalCode: 'Postal code',
        city: 'City',
      },
      defaultCountry: 'Austria',
      notProvided: 'Not provided',
      warningTitle: 'Required fields are missing',
      warningFallback: 'required details',
      warning: ({ fields }) => `These details are still missing or incomplete: ${fields}. For an Austrian production website you should complete them before relying on this imprint.`,
      noteTitle: 'Legal note',
      note: 'This page covers the common provider and disclosure requirements for Austrian websites. Depending on your legal form, trade license, or editorial setup, you may need additional information.',
      basis: 'Legal basis: Section 5 ECG, Section 14 UGB, Section 63 GewO, and Section 25 MedienG.',
    },
    privacy: {
      pageTitle: 'OmniFM | Privacy policy',
      eyebrow: 'Privacy policy',
      title: 'Privacy policy',
      subtitle: 'This notice explains which personal data OmniFM processes across the website, Discord bot runtime, and Premium, email, and support workflows.',
      cards: {
        controller: 'Controller',
        contact: 'Contact & privacy',
        hosting: 'Hosting & infrastructure',
        authority: 'Supervisory authority',
      },
      fields: {
        controllerName: 'Controller',
        controllerStreetAddress: 'Street / number',
        controllerPostalCode: 'Postal code',
        controllerCity: 'City',
        representative: 'Authorized representative',
        address: 'Address',
        website: 'Website',
        email: 'Email',
        phone: 'Phone',
        dpoName: 'Privacy contact / DPO',
        dpoEmail: 'Privacy email',
        hostingProvider: 'Hosting provider',
        hostingLocation: 'Hosting location',
        authorityName: 'Supervisory authority',
        authorityWebsite: 'Authority website',
        additionalRecipients: 'Additional recipients',
        customNote: 'Additional note',
        logDays: 'Log retention',
        songHistory: 'Song history',
      },
      defaultCountry: 'Austria',
      defaultAuthorityName: 'Austrian Data Protection Authority',
      defaultAuthorityWebsite: 'https://www.dsb.gv.at/',
      notProvided: 'Not provided',
      booleanEnabled: 'Enabled',
      booleanDisabled: 'Not enabled',
      logDaysValue: ({ days }) => `${days} days`,
      songHistoryValue: ({ maxEntries }) => `up to ${maxEntries} entries per server`,
      warningTitle: 'Complete the privacy basics',
      warningFallback: 'privacy contact details',
      warning: ({ fields }) => `These details are still missing or incomplete: ${fields}. Complete them before relying on this privacy policy in production.`,
      sections: {
        overviewTitle: 'Overview',
        overviewBody: 'OmniFM uses necessary storage for language, security, and dashboard sessions. Google Analytics 4 is loaded only after consent; advertising or remarketing cookies are not intentionally used.',
        websiteTitle: 'Website, security, and language preference',
        websiteBody: ({ localeStorageKey }) => `When the website is opened, OmniFM processes technical connection data to deliver content, enforce CORS checks, apply rate limiting, and protect the service from abuse. The web frontend stores the selected language locally in the browser under "${localeStorageKey}". The cookie choice is stored locally in the browser.`,
        cookiesTitle: 'Cookies, local storage, and dashboard sessions',
        cookiesBody: 'Necessary storage includes the language preference, cookie choice, and technically required dashboard session cookies. Dashboard session cookies are separate from analytics and are used only for login, security, and access to protected dashboard features.',
        analyticsTitle: 'Google Analytics 4',
        analyticsBody: 'If you allow analytics, OmniFM loads Google Analytics 4 through the Google tag G-J5X0ZZ5E3Z. Page views, technical device/browser data, approximate region, referrer, and interactions may be processed. Consent Mode v2 is used with analytics storage only after consent; ad storage, personalized advertising, and ad user data remain disabled. The recipient is Google Ireland Limited or affiliated Google companies. You can withdraw consent at any time through the cookie settings; then the tag is disabled and known GA cookies are deleted.',
        previewTitle: 'Station previews and external streams',
        previewBody: 'When you preview a station on the website, your browser connects directly to the selected stream provider. That provider may receive your IP address, request time, and other technical connection data.',
        botTitle: 'Discord bot runtime',
        botBody: 'When the bot is used, OmniFM processes server- and feature-related data such as guild/server IDs, channel IDs, language and permission settings, custom stations, scheduled events, song history, and listening statistics to the extent required by the enabled feature set.',
        premiumTitle: 'Premium, trial month, and payments',
        premiumBody: ({ stripeEnabled, smtpEnabled }) => `For Premium checkout, the trial month, and license management, OmniFM processes data such as email address, server ID, selected plan, duration, seats, and coupon or referral codes. ${stripeEnabled ? 'If Stripe is enabled, checkout and payment data are additionally transmitted to Stripe.' : 'Stripe is currently not enabled.'} ${smtpEnabled ? 'If SMTP is enabled, license, invoice, and support emails are delivered through the configured mail provider.' : 'Email delivery is currently not enabled.'}`,
        integrationsTitle: 'Recipients and external services',
        integrationsBody: ({ stripeEnabled, smtpEnabled, discordBotListEnabled, botsGGEnabled, topGGEnabled, recognitionEnabled }) => `Depending on which modules are enabled, data may be shared with Discord, the hosting provider, selected radio stream operators${stripeEnabled ? ', Stripe' : ''}${smtpEnabled ? ', the configured SMTP provider' : ''}${discordBotListEnabled ? ', DiscordBotList' : ''}${botsGGEnabled ? ', Discord Bots (bots.gg)' : ''}${topGGEnabled ? ', Top.gg' : ''}${recognitionEnabled ? ', and metadata or audio-recognition services' : ''}.`,
        retentionTitle: 'Retention',
        retentionBody: ({ logDays, songHistoryMaxPerGuild }) => `Technical rotated logs are typically retained for up to ${logDays} days. Song history is retained per server up to the configured maximum of ${songHistoryMaxPerGuild} entries. License, settings, statistics, and event data remain stored until they are deleted, replaced, or no longer required for legal reasons.`,
        basisTitle: 'Legal bases',
        basisBody: 'Depending on the processing activity, OmniFM primarily relies on Article 6(1)(b) GDPR (contract/service), Article 6(1)(c) GDPR (legal obligations), and Article 6(1)(f) GDPR (legitimate interests in security, service stability, and abuse prevention).',
        rightsTitle: 'Your rights',
        rightsBody: 'You may exercise the following rights where the legal requirements are met:',
        rightsItems: [
          'Access to the personal data being processed',
          'Rectification of inaccurate or incomplete data',
          'Erasure or restriction of processing',
          'Data portability where applicable',
          'Objection to processing based on legitimate interests',
          'Complaint to the competent supervisory authority',
        ],
        contactTitle: 'Contact and complaints',
        contactBody: ({ authorityName }) => `For privacy-related questions, use the contact details above first. If you believe processing infringes data-protection law, you can also lodge a complaint with ${authorityName} or another competent supervisory authority.`,
      },
      noteTitle: 'Important note',
      note: 'This privacy policy reflects the typical OmniFM data flows based on the current code and configuration. Additional details may be required depending on your hosting, reverse proxy, payment setup, or support workflow.',
      basis: 'Legal basis: GDPR Article 13 and Articles 15 to 22. Austrian complaint authority: Austrian Data Protection Authority.',
    },
    terms: {
      pageTitle: 'OmniFM | Terms of service',
      eyebrow: 'Terms of service',
      title: 'Terms of service',
      subtitle: 'These terms govern the use of the OmniFM website, Discord bot, dashboard, and optional Premium features.',
      cards: {
        operator: 'Operator',
        contact: 'Contact & scope',
        service: 'Service scope',
        billing: 'Premium & billing',
      },
      fields: {
        providerName: 'Name / company',
        representative: 'Authorized representative',
        businessPurpose: 'Business purpose',
        website: 'Website',
        contactEmail: 'Contact email',
        supportWebsite: 'Support / website',
        effectiveDate: 'Effective date',
        governingLaw: 'Governing law',
        discordBot: 'Discord bot',
        dashboard: 'Dashboard',
        stationPreview: 'Station preview',
        scheduledEvents: 'Event scheduler',
        customStations: 'Custom stations',
        premiumCheckout: 'Premium checkout',
        paymentProvider: 'Payment provider',
        emailDelivery: 'License & support emails',
        trialMonth: 'Trial month',
      },
      defaultGoverningLaw: 'Austrian law',
      notProvided: 'Not provided',
      booleanEnabled: 'Enabled',
      booleanDisabled: 'Not enabled',
      warningTitle: 'Complete the basics',
      warningFallback: 'operator and contact details',
      warning: ({ fields }) => `These details are still missing or incomplete: ${fields}. Complete them before relying on these terms in production.`,
      sections: {
        overviewTitle: 'Overview',
        overviewBody: 'OmniFM is a Discord radio service with a website, bot runtime, dashboard, and optional Premium features. These terms define the contractual framework for those components.',
        scopeTitle: 'Service scope',
        scopeBody: 'OmniFM includes the website, Discord bot features, dashboard access, statistics and event tooling, and, depending on configuration, Premium, email, and integration features. The exact scope may vary by plan, server setup, and enabled modules.',
        discordTitle: 'Discord as a third-party platform',
        discordBody: 'OmniFM depends on Discord for core functionality. Availability, API behavior, permissions, voice connections, and platform rules are therefore also shaped by Discord as a third-party platform and may change outside OmniFM\'s direct control.',
        previewTitle: 'Web previews and external streams',
        previewBody: 'When you preview a station on the website, your browser connects directly to the selected stream provider. During bot usage, streams, metadata, or artwork may also come from third parties whose content and availability are not solely controlled by OmniFM.',
        customStationsTitle: 'Custom stations and user-supplied content',
        customStationsBody: 'Where OmniFM allows you to add your own stream URLs, station names, images, descriptions, webhooks, or other content, you are responsible for ensuring that those inputs are lawful, do not infringe third-party rights, and may be used safely within the service.',
        acceptableUseTitle: 'Acceptable use',
        acceptableUseBody: 'OmniFM may only be used lawfully and in line with the applicable platform rules and laws.',
        acceptableUseItems: [
          'no abusive, disruptive, or security-threatening use',
          'no circumvention of limits, access restrictions, or technical safeguards',
          'no use for unlawful, infringing, or misleading streams and content',
          'no submission of false, third-party, or otherwise impermissible data through Premium, support, or dashboard flows',
        ],
        premiumTitle: 'Premium, digital services, and checkout',
        premiumBody: ({ premiumCheckoutEnabled, paymentProvider }) => `Premium features are digital services. ${premiumCheckoutEnabled ? `If paid checkout is enabled, payment processing is handled through ${paymentProvider || 'the configured payment provider'}.` : 'Online checkout is currently not enabled.'} The selected plan, duration, seats, and price are shown before checkout. The concrete checkout and license status remains decisive.`,
        streamRightsTitle: 'Radio streams, rights, and licensing',
        streamRightsBody: 'Important: these terms do not resolve any copyright, neighboring-rights, broadcast, or licensing issues related to radio streams. If third-party streams or user-supplied streams are distributed via OmniFM and Discord, that remains a separate legal risk. These terms regulate conduct within the service, but they do not make an unlawful use lawful.',
        availabilityTitle: 'Availability and changes',
        availabilityBody: 'OmniFM is provided with the goal of stable operation, but it does not guarantee uninterrupted, error-free, or always-available service. Maintenance, updates, Discord changes, network issues, stream outages, or security measures may temporarily limit or change functionality.',
        suspensionTitle: 'Suspension and termination',
        suspensionBody: 'OmniFM may limit or end access to individual features, servers, licenses, or usage contexts where there are objective reasons to do so.',
        suspensionItems: [
          'violations of these terms or Discord policies',
          'indications of abusive, unlawful, or security-critical use',
          'obviously impermissible custom streams or content',
          'technical or operational reasons that require restrictions',
        ],
        liabilityTitle: 'Liability',
        liabilityBody: 'To the extent permitted by law, OmniFM is not liable for outages or content of external streams, Discord disruptions, third-party integrations, or configuration errors outside its own sphere of responsibility. Mandatory liability rules, especially for intent, gross negligence, personal injury, or mandatory consumer law, remain unaffected.',
        lawTitle: 'Governing law',
        lawBody: ({ governingLaw }) => `To the extent permitted by law, ${governingLaw} applies. Mandatory consumer-protection rules and mandatory venue rules remain unaffected.`,
        contactTitle: 'Contact',
        contactBody: ({ email, website }) => `Questions about these terms can be sent to ${email || 'the contact listed above'}.${website ? ` Further information is available at ${website}.` : ''}`,
      },
      noteTitle: 'Important note',
      note: 'These terms reflect the typical OmniFM product setup based on the current code and configuration. Depending on your business model, legal form, payment flow, or support commitments, additional legal review may still be advisable.',
      basis: 'Note: this page complements the imprint and privacy policy with the contractual usage framework of the service.',
    },
  },
};

const I18nContext = createContext(null);

function normalizeLocale(rawLocale) {
  const value = String(rawLocale || '').trim().toLowerCase();
  if (!value) return DEFAULT_LOCALE;
  if (value.startsWith('de')) return 'de';
  if (value.startsWith('en')) return 'en';
  return SUPPORTED_LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

function readStoredLocale() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return '';
  }
}

function writeStoredLocale(locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore storage failures
  }
}

function syncLocaleToUrl(locale) {
  try {
    const url = new URL(window.location.href);
    const page = resolvePageFromUrl(url);
    const params = new URLSearchParams(url.search);
    const nextHref = buildPageHref(locale, page, params);
    window.history.replaceState({}, '', `${nextHref}${url.hash}`);
  } catch {
    // ignore URL update failures
  }
}

function readQueryLocale() {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('lang') || '';
  } catch {
    return '';
  }
}

function resolveInitialLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const queryValue = readQueryLocale();
  const queryLocale = normalizeLocale(queryValue);
  if (queryValue) {
    writeStoredLocale(queryLocale);
    return queryLocale;
  }

  const storedValue = readStoredLocale();
  const storedLocale = normalizeLocale(storedValue);
  if (storedValue) return storedLocale;

  const htmlValue = document?.documentElement?.lang || '';
  if (htmlValue) return normalizeLocale(htmlValue);

  return normalizeLocale(window.navigator?.language || DEFAULT_LOCALE);
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(resolveInitialLocale);
  const copy = LOCALE_MESSAGES[locale] || LOCALE_MESSAGES[DEFAULT_LOCALE];
  const intlLocale = LOCALE_META[locale]?.intl || LOCALE_META[DEFAULT_LOCALE].intl;

  const setLocale = useCallback((nextLocale) => {
    const normalized = normalizeLocale(nextLocale);
    writeStoredLocale(normalized);
    syncLocaleToUrl(normalized);
    setLocaleState(normalized);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'de' ? 'en' : 'de');
  }, [locale, setLocale]);

  const formatNumber = useCallback((value) => {
    const amount = Number(value) || 0;
    return new Intl.NumberFormat(intlLocale).format(amount);
  }, [intlLocale]);

  const formatDecimal = useCallback((value, minimumFractionDigits = 2, maximumFractionDigits = 2) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '-';
    return new Intl.NumberFormat(intlLocale, {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(amount);
  }, [intlLocale]);

  const formatDate = useCallback((value, options) => {
    if (!value) return '-';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat(intlLocale, options).format(date);
  }, [intlLocale]);

  const translateCommandDescription = useCallback((commandName, fallbackText) => {
    const normalizedName = String(commandName || '').replace(/^\//, '').trim().toLowerCase();
    return copy?.commands?.descriptionMap?.[normalizedName] || fallbackText;
  }, [copy]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    applySeoMetadata({ locale, url: window.location.href });
  }, [copy, locale]);

  const contextValue = useMemo(() => ({
    locale,
    localeMeta: LOCALE_META[locale] || LOCALE_META[DEFAULT_LOCALE],
    copy,
    setLocale,
    toggleLocale,
    formatNumber,
    formatDecimal,
    formatDate,
    translateCommandDescription,
  }), [
    copy,
    formatDate,
    formatDecimal,
    formatNumber,
    locale,
    setLocale,
    toggleLocale,
    translateCommandDescription,
  ]);

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return value;
}
