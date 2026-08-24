// ============================================================
// OmniFM - Plan Configuration (Single Source of Truth)
// ============================================================

export const PLAN_ORDER = ["free", "pro", "ultimate"];

export const CAPABILITIES = {
  dashboard_access: {
    apiKey: "dashboardAccess",
    minPlan: "pro",
    label: "Dashboard-Zugriff",
  },
  event_scheduler: {
    apiKey: "eventScheduler",
    minPlan: "pro",
    label: "Event-Scheduler",
  },
  role_permissions: {
    apiKey: "rolePermissions",
    minPlan: "pro",
    label: "Rollenbasierte Berechtigungen",
  },
  weekly_digest: {
    apiKey: "weeklyDigest",
    minPlan: "pro",
    label: "Woechentlicher Digest",
  },
  basic_health: {
    apiKey: "basicHealth",
    minPlan: "pro",
    label: "Basis-Health-Ansicht",
  },
  custom_station_urls: {
    apiKey: "customStationUrls",
    minPlan: "ultimate",
    label: "Custom-Station-URLs",
  },
  advanced_analytics: {
    apiKey: "advancedAnalytics",
    minPlan: "ultimate",
    label: "Erweiterte Analytics",
  },
  failover_rules: {
    apiKey: "failoverRules",
    minPlan: "ultimate",
    label: "Failover-Regeln",
  },
  license_workspace: {
    apiKey: "licenseWorkspace",
    minPlan: "ultimate",
    label: "Lizenz-Workspace",
  },
  exports_webhooks: {
    apiKey: "exportsWebhooks",
    minPlan: "ultimate",
    label: "Exporte und Webhooks",
  },
  voice_guard: {
    apiKey: "voiceGuard",
    minPlan: "free",
    label: "Voice Guard",
  },
};

export const CAPABILITY_KEYS = Object.freeze(Object.keys(CAPABILITIES));
export const CAPABILITY_API_KEYS = Object.freeze(
  Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, CAPABILITIES[key].apiKey]))
);
export const CAPABILITY_LABELS = Object.freeze(
  Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, CAPABILITIES[key].label]))
);

export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    maxBots: 2,
    bitrate: "64k",
    bitrateNum: 64,
    reconnectMs: 5000,
    features: {
      hqAudio: false,
      ultraAudio: false,
      priorityReconnect: false,
      instantReconnect: false,
      premiumStations: false,
      customStationURLs: false,
      commandPermissions: false,
      scheduledEvents: false,
    },
    capabilities: {
      dashboard_access: false,
      event_scheduler: false,
      role_permissions: false,
      weekly_digest: false,
      basic_health: false,
      custom_station_urls: false,
      advanced_analytics: false,
      failover_rules: false,
      license_workspace: false,
      exports_webhooks: false,
      voice_guard: true,
    },
    limits: {
      maxBots: 2,
      bitrate: "64k",
      bitrateNum: 64,
      reconnectMs: 5000,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    maxBots: 8,
    bitrate: "128k",
    bitrateNum: 128,
    reconnectMs: 1500,
    features: {
      hqAudio: true,
      ultraAudio: false,
      priorityReconnect: true,
      instantReconnect: false,
      premiumStations: true,
      customStationURLs: false,
      commandPermissions: true,
      scheduledEvents: true,
    },
    capabilities: {
      dashboard_access: true,
      event_scheduler: true,
      role_permissions: true,
      weekly_digest: true,
      basic_health: true,
      custom_station_urls: false,
      advanced_analytics: false,
      failover_rules: false,
      license_workspace: false,
      exports_webhooks: false,
      voice_guard: true,
    },
    limits: {
      maxBots: 8,
      bitrate: "128k",
      bitrateNum: 128,
      reconnectMs: 1500,
    },
  },
  ultimate: {
    id: "ultimate",
    name: "Ultimate",
    maxBots: 16,
    bitrate: "320k",
    bitrateNum: 320,
    reconnectMs: 400,
    features: {
      hqAudio: true,
      ultraAudio: true,
      priorityReconnect: true,
      instantReconnect: true,
      premiumStations: true,
      customStationURLs: true,
      commandPermissions: true,
      scheduledEvents: true,
    },
    capabilities: {
      dashboard_access: true,
      event_scheduler: true,
      role_permissions: true,
      weekly_digest: true,
      basic_health: true,
      custom_station_urls: true,
      advanced_analytics: true,
      failover_rules: true,
      license_workspace: true,
      exports_webhooks: true,
      voice_guard: true,
    },
    limits: {
      maxBots: 16,
      bitrate: "320k",
      bitrateNum: 320,
      reconnectMs: 400,
    },
  },
};

export const FEATURE_LABELS = {
  hqAudio:            "HQ Audio (128k Opus)",
  ultraAudio:         "Ultra HQ Audio (320k)",
  priorityReconnect:  "Priority Auto-Reconnect",
  instantReconnect:   "Instant Reconnect",
  premiumStations:    "100+ Premium Stations",
  customStationURLs:  "Custom Station URLs",
  commandPermissions: "Rollenbasierte Command-Berechtigungen",
  scheduledEvents:    "Event-Scheduler mit Auto-Play",
};

export const BRAND = {
  name: "OmniFM",
  tagline: "Streaming the future of radio",
  footer: "OmniFM · 24/7 Discord Radio",
  presence: "Streaming the future of radio | /play",
  color: 0x00E5FF,
  colorHex: "#00E5FF",
  proColor: 0xFF6B00,
  ultimateColor: 0xFF2A5F,
  upgradeUrl: "",
};
