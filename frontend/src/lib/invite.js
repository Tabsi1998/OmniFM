import { buildPageHref } from './pageRouting.js';

// Until the bot list is there (it is loading, or the API does not answer), the
// invite buttons lead to the guide's first step, which explains the
// invitation and has the button too (#455), instead of an anchor that no
// longer exists.
function guideStep(locale) {
  return `${buildPageHref(locale, 'start')}#commander`;
}

export function resolvePrimaryInviteUrl(bots, locale = '') {
  if (!Array.isArray(bots) || bots.length === 0) return guideStep(locale);

  const commanderBot = bots.find((bot) => String(bot?.role || '').toLowerCase() === 'commander')
    || bots.find((bot) => String(bot?.name || '').toLowerCase().includes('dj'))
    || bots.find((bot) => String(bot?.requiredTier || 'free').toLowerCase() === 'free' && (bot?.inviteUrl || bot?.invite_url))
    || bots[0];

  return commanderBot?.inviteUrl || commanderBot?.invite_url || guideStep(locale);
}
