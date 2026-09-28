function normalizePolicy(value, fallback = 'default', { allowDefault = false } = {}) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'allow' || normalized === 'return' || normalized === 'disconnect') {
    return normalized;
  }
  if (allowDefault && normalized === 'default') {
    return 'default';
  }
  return fallback;
}

function normalizeDurationMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatDurationMs(value) {
  const ms = normalizeDurationMs(value);
  if (ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function normalizeDashboardVoiceGuardConfig(rawConfig) {
  const input = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const defaults = input.defaults && typeof input.defaults === 'object' ? input.defaults : {};
  return {
    policy: normalizePolicy(input.policy, 'default', { allowDefault: true }),
    effectivePolicy: normalizePolicy(input.effectivePolicy, 'return'),
    defaults: {
      policy: normalizePolicy(defaults.policy, 'return'),
      moveConfirmations: Math.max(1, Number(defaults.moveConfirmations || 2) || 2),
      returnCooldownMs: normalizeDurationMs(defaults.returnCooldownMs || 15000),
      moveWindowMs: normalizeDurationMs(defaults.moveWindowMs || 120000),
      maxMovesPerWindow: Math.max(2, Number(defaults.maxMovesPerWindow || 4) || 4),
      escalation: String(defaults.escalation || 'disconnect').trim().toLowerCase() === 'cooldown' ? 'cooldown' : 'disconnect',
      escalationCooldownMs: normalizeDurationMs(defaults.escalationCooldownMs || 600000),
    },
  };
}

function buildDashboardVoiceGuardSummary(rawConfig, t = (de, _en) => de) {
  const config = normalizeDashboardVoiceGuardConfig(rawConfig);
  const policyLabel = config.policy === 'default'
    ? t('Standard', 'Default')
    : config.policy === 'allow'
      ? t('Erlauben', 'Allow')
      : config.policy === 'disconnect'
        ? 'Disconnect'
        : t('Zurückspringen', 'Return');
  const effectiveLabel = config.effectivePolicy === 'allow'
    ? t('Erlauben', 'Allow')
    : config.effectivePolicy === 'disconnect'
      ? 'Disconnect'
      : t('Zurückspringen', 'Return');

  let statusLabel = t('Aktiv', 'Active');
  let statusAccent = '#10B981';
  let description = t(
    'OmniFM schützt aktive Voice-Sessions vor ungewollten Verschiebungen.',
    'OmniFM protects active voice sessions against unwanted moves.'
  );

  if (config.effectivePolicy === 'allow') {
    statusLabel = t('Freigegeben', 'Allowed');
    statusAccent = '#71717A';
    description = t(
      'Fremdverschiebungen werden akzeptiert. OmniFM bleibt im neuen Channel.',
      'Foreign moves are accepted. OmniFM stays in the new channel.'
    );
  } else if (config.effectivePolicy === 'disconnect') {
    statusLabel = 'Disconnect';
    statusAccent = '#EF4444';
    description = t(
      'Bestätigte Fremdverschiebungen können die Session beenden.',
      'Confirmed foreign moves can end the session.'
    );
  }

  return {
    policyLabel,
    effectiveLabel,
    statusLabel,
    statusAccent,
    description,
    thresholdsLabel: t(
      '{confirmations} Bestätigungen | {cooldown} Cooldown | {moves} Moves / {window}',
      '{confirmations} confirmations | {cooldown} cooldown | {moves} moves / {window}',
      {
        confirmations: config.defaults.moveConfirmations,
        cooldown: formatDurationMs(config.defaults.returnCooldownMs),
        moves: config.defaults.maxMovesPerWindow,
        window: formatDurationMs(config.defaults.moveWindowMs),
      }
    ),
    escalationLabel: config.defaults.escalation === 'cooldown'
      ? t('Danach Cooldown ({duration})', 'Then cooldown ({duration})', { duration: formatDurationMs(config.defaults.escalationCooldownMs) })
      : t('Danach Disconnect', 'Then disconnect'),
  };
}

export {
  buildDashboardVoiceGuardSummary,
  formatDurationMs as formatDashboardVoiceGuardDuration,
  normalizeDashboardVoiceGuardConfig,
};
