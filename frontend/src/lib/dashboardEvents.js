import { intlLocaleFor, translatorFor } from '../i18n/languages.js';

export const EVENT_PLACEHOLDERS = ['{event}', '{station}', '{voice}', '{time}', '{end}', '{timezone}'];

export const DASHBOARD_EVENT_REPEAT_OPTIONS = [
  { value: 'none', de: 'Keine Wiederholung', en: 'No repeat' },
  { value: 'daily', de: 'Täglich', en: 'Daily' },
  { value: 'weekdays', de: 'Werktags (Mo-Fr)', en: 'Weekdays (Mon-Fri)' },
  { value: 'weekly', de: 'Wöchentlich', en: 'Weekly' },
  { value: 'biweekly', de: 'Alle 2 Wochen', en: 'Every 2 weeks' },
  { value: 'yearly', de: 'Jährlich', en: 'Yearly' },
  { value: 'monthly_first_weekday', de: 'Monatlich (1. Wochentag)', en: 'Monthly (1st weekday)' },
  { value: 'monthly_second_weekday', de: 'Monatlich (2. Wochentag)', en: 'Monthly (2nd weekday)' },
  { value: 'monthly_third_weekday', de: 'Monatlich (3. Wochentag)', en: 'Monthly (3rd weekday)' },
  { value: 'monthly_fourth_weekday', de: 'Monatlich (4. Wochentag)', en: 'Monthly (4th weekday)' },
  { value: 'monthly_last_weekday', de: 'Monatlich (letzter Wochentag)', en: 'Monthly (last weekday)' },
];

export const DASHBOARD_EVENT_TIMEZONE_OPTIONS = [
  'Europe/Vienna',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/London',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Toronto',
  'Asia/Tokyo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney',
];

export function renderEventTemplate(template, values = {}) {
  return String(template || '')
    .replace(/\{event\}/gi, String(values.event || '-'))
    .replace(/\{station\}/gi, String(values.station || '-'))
    .replace(/\{voice\}/gi, String(values.voice || '-'))
    .replace(/\{time\}/gi, String(values.time || '-'))
    .replace(/\{end\}/gi, String(values.end || '-'))
    .replace(/\{timezone\}/gi, String(values.timeZone || values.timezone || '-'))
    .trim();
}

function padDatePart(value) {
  return String(value || 0).padStart(2, '0');
}

function formatLocalDateTimeInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-') + `T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function withLocalTime(date, hour, minute) {
  const next = new Date(date.getTime());
  next.setHours(hour, minute, 0, 0);
  return next;
}

function addLocalDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function findNextWeekdayOccurrence(now, weekday, hour, minute) {
  const targetWeekday = Number(weekday);
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const candidateDate = addLocalDays(now, dayOffset);
    if (candidateDate.getDay() !== targetWeekday) continue;
    const candidate = withLocalTime(candidateDate, hour, minute);
    if (candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  return withLocalTime(addLocalDays(now, 7), hour, minute);
}

function findNextWorkdayOccurrence(now, hour, minute) {
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const candidateDate = addLocalDays(now, dayOffset);
    const weekday = candidateDate.getDay();
    if (weekday === 0 || weekday === 6) continue;
    const candidate = withLocalTime(candidateDate, hour, minute);
    if (candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  return withLocalTime(addLocalDays(now, 1), hour, minute);
}

export function buildDashboardEventTemplatePresets(t) {
  return [
    {
      id: 'prime_time',
      label: t('Prime Time', 'Prime Time'),
      summary: t('2h Show mit Discord-Event und klarer Ankündigung', '2h show with Discord event and clear announcement'),
      title: t('Prime Time Radio', 'Prime Time Radio'),
      durationMinutes: '120',
      announceMessage: '**{event}** startet jetzt mit **{station}** in {voice}.\nStart: {time}',
      description: 'Live-Show mit **{station}**.\n\nStart: {time}\nEnde: {end}\nOrt: {voice}',
      stageTopic: '{event} | {station}',
      createDiscordEvent: true,
    },
    {
      id: 'drive_time',
      label: t('Drive Time', 'Drive Time'),
      summary: t('90 Min. kompakter Slot für Feierabend oder Morning Run', '90 min compact slot for after-work or morning runs'),
      title: t('Drive Time', 'Drive Time'),
      durationMinutes: '90',
      announceMessage: 'Jetzt live: **{event}** mit **{station}** in {voice}.',
      description: 'Schneller Radio-Slot mit **{station}**.\n\nStart: {time}\nVoice: {voice}',
      stageTopic: '{event} - {station}',
      createDiscordEvent: true,
    },
    {
      id: 'listener_picks',
      label: t('Listener Picks', 'Listener Picks'),
      summary: t('Interaktive Session mit Requests und Voting-Hinweis', 'Interactive session with requests and voting note'),
      title: t('Listener Picks', 'Listener Picks'),
      durationMinutes: '120',
      announceMessage: '**{event}** läuft jetzt. Postet eure Wünsche und hört **{station}** in {voice}.',
      description: 'Community-Session mit **{station}**.\n\nWünsche und Reaktionen direkt im Discord sammeln.\nStart: {time}',
      stageTopic: '{event} | Community',
      createDiscordEvent: true,
    },
    {
      id: 'night_shift',
      label: t('Night Shift', 'Night Shift'),
      summary: t('Längerer Abendblock mit ruhiger Discord-Ankündigung', 'Longer evening block with softer Discord announcement'),
      title: t('Night Shift', 'Night Shift'),
      durationMinutes: '180',
      announceMessage: '**{event}** ist jetzt live. Lehne dich zurück und höre **{station}** in {voice}.',
      description: 'Abendprogramm mit **{station}**.\n\nStart: {time}\nGeplantes Ende: {end}',
      stageTopic: '{event} - {station}',
      createDiscordEvent: false,
    },
  ];
}

export function buildDashboardSchedulePresets(t, now = new Date()) {
  const current = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const tonight = withLocalTime(current, 20, 0);
  const tonightOrTomorrow = tonight.getTime() > current.getTime() ? tonight : withLocalTime(addLocalDays(current, 1), 20, 0);
  const tomorrow = withLocalTime(addLocalDays(current, 1), 18, 0);
  const nextWorkday = findNextWorkdayOccurrence(current, 8, 0);
  const nextFriday = findNextWeekdayOccurrence(current, 5, 20, 0);
  const nextSaturday = findNextWeekdayOccurrence(current, 6, 18, 0);

  return [
    {
      id: 'tonight_20',
      label: t('Nächster Slot 20:00', 'Next slot 20:00'),
      summary: t('Einmalig am nächsten möglichen Abend-Slot', 'One-time on the next possible evening slot'),
      startsAt: formatLocalDateTimeInput(tonightOrTomorrow),
      repeat: 'none',
    },
    {
      id: 'tomorrow_18',
      label: t('Morgen 18:00', 'Tomorrow 18:00'),
      summary: t('Einmalig morgen Abend', 'One-time tomorrow evening'),
      startsAt: formatLocalDateTimeInput(tomorrow),
      repeat: 'none',
    },
    {
      id: 'workdays_08',
      label: t('Werktags 08:00', 'Weekdays 08:00'),
      summary: t('Nächster Werktag plus Wiederholung Mo-Fr', 'Next workday plus Mon-Fri recurrence'),
      startsAt: formatLocalDateTimeInput(nextWorkday),
      repeat: 'weekdays',
    },
    {
      id: 'friday_20',
      label: t('Freitag 20:00', 'Friday 20:00'),
      summary: t('Nächster Freitag mit wöchentlicher Wiederholung', 'Next Friday with weekly recurrence'),
      startsAt: formatLocalDateTimeInput(nextFriday),
      repeat: 'weekly',
    },
    {
      id: 'saturday_18',
      label: t('Samstag 18:00', 'Saturday 18:00'),
      summary: t('Nächster Samstag mit wöchentlicher Wiederholung', 'Next Saturday with weekly recurrence'),
      startsAt: formatLocalDateTimeInput(nextSaturday),
      repeat: 'weekly',
    },
  ];
}

export function applyDashboardEventTemplate(currentForm, template) {
  const form = currentForm && typeof currentForm === 'object' ? currentForm : {};
  const preset = template && typeof template === 'object' ? template : {};
  return {
    ...form,
    title: String(preset.title || form.title || ''),
    durationMinutes: String(preset.durationMinutes || form.durationMinutes || ''),
    announceMessage: String(preset.announceMessage || ''),
    description: String(preset.description || ''),
    stageTopic: String(preset.stageTopic || ''),
    createDiscordEvent: preset.createDiscordEvent === true,
  };
}

export function applyDashboardSchedulePreset(currentForm, preset) {
  const form = currentForm && typeof currentForm === 'object' ? currentForm : {};
  const schedulePreset = preset && typeof preset === 'object' ? preset : {};
  return {
    ...form,
    startsAt: String(schedulePreset.startsAt || form.startsAt || ''),
    repeat: String(schedulePreset.repeat || form.repeat || 'none'),
  };
}

function resolveCalendarSource(startsAt) {
  const text = String(startsAt || '').trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return {
      year: Number.parseInt(isoMatch[1], 10),
      month: Number.parseInt(isoMatch[2], 10),
      day: Number.parseInt(isoMatch[3], 10),
    };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

function getCalendarDate(startsAt) {
  const parts = resolveCalendarSource(startsAt);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
}

function getWeekdayLabel(startsAt, language = 'de') {
  const date = getCalendarDate(startsAt);
  if (!date) return null;
  return new Intl.DateTimeFormat(intlLocaleFor(language), { timeZone: 'UTC', weekday: 'long' }).format(date);
}

function getMonthDayLabel(startsAt, language = 'de') {
  const date = getCalendarDate(startsAt);
  if (!date) return null;
  return new Intl.DateTimeFormat(intlLocaleFor(language), { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(date);
}

export function getDashboardRepeatLabel(raw, language = 'de', { startsAt = '' } = {}) {
  const repeat = String(raw || 'none').trim().toLowerCase();
  const t = translatorFor(language);
  const weekday = getWeekdayLabel(startsAt, language);
  const monthDay = getMonthDayLabel(startsAt, language);
  const day = weekday || t('Wochentag', 'weekday');

  if (repeat === 'daily') return t('Jeden Tag', 'Every day');
  if (repeat === 'weekdays') return t('Werktäglich (Montag bis Freitag)', 'Weekdays (Monday to Friday)');
  if (repeat === 'weekly') return weekday ? t('Jeden {weekday}', 'Every {weekday}', { weekday }) : t('Wöchentlich', 'Weekly');
  if (repeat === 'biweekly') return weekday ? t('Alle 2 Wochen ({weekday})', 'Every 2 weeks ({weekday})', { weekday }) : t('Alle 2 Wochen', 'Every 2 weeks');
  if (repeat === 'yearly') return monthDay ? t('Jährlich am {date}', 'Yearly on {date}', { date: monthDay }) : t('Jährlich', 'Yearly');
  if (repeat === 'monthly_first_weekday') return t('Jeden 1. {weekday} im Monat', 'Every 1st {weekday} of the month', { weekday: day });
  if (repeat === 'monthly_second_weekday') return t('Jeden 2. {weekday} im Monat', 'Every 2nd {weekday} of the month', { weekday: day });
  if (repeat === 'monthly_third_weekday') return t('Jeden 3. {weekday} im Monat', 'Every 3rd {weekday} of the month', { weekday: day });
  if (repeat === 'monthly_fourth_weekday') return t('Jeden 4. {weekday} im Monat', 'Every 4th {weekday} of the month', { weekday: day });
  if (repeat === 'monthly_last_weekday') return t('Jeden letzten {weekday} im Monat', 'Every last {weekday} of the month', { weekday: day });
  return t('Keine Wiederholung', 'No repeat');
}

export function buildDiscordCustomEmojiToken(emoji) {
  const name = String(emoji?.name || '').trim();
  const id = String(emoji?.id || '').trim();
  if (!name || !/^\d{2,32}$/.test(id)) return '';
  return emoji?.animated
    ? `<a:${name}:${id}>`
    : `<:${name}:${id}>`;
}

export function expandDiscordEmojiAliases(text, serverEmojis = []) {
  const source = String(text || '');
  if (!source) return '';

  const emojiTokensByName = new Map();
  for (const emoji of Array.isArray(serverEmojis) ? serverEmojis : []) {
    const name = String(emoji?.name || '').trim();
    const token = buildDiscordCustomEmojiToken(emoji);
    if (!name || !token || emojiTokensByName.has(name)) continue;
    emojiTokensByName.set(name, token);
  }
  if (!emojiTokensByName.size) return source;

  const protectedFullTokens = [];
  let normalized = source.replace(/<(a?):([a-zA-Z0-9_]+):(\d+)>/g, (match) => {
    const token = `@@DISCORD_FULL_EMOJI_${protectedFullTokens.length}@@`;
    protectedFullTokens.push({ token, match });
    return token;
  });

  normalized = normalized.replace(/(^|[^<\w]):([A-Za-z0-9_]{2,32}):(?!\d+>)/g, (match, prefix, name) => {
    const token = emojiTokensByName.get(name);
    if (!token) return match;
    return `${prefix}${token}`;
  });

  for (const { token, match } of protectedFullTokens) {
    normalized = normalized.replaceAll(token, match);
  }

  return normalized;
}

export function renderDiscordMarkdown(text, options = {}) {
  if (!text) return '';
  const normalizedText = expandDiscordEmojiAliases(text, options.serverEmojis || []);
  const emojiTokens = [];
  let rendered = String(normalizedText || '').replace(/<(a?):([a-zA-Z0-9_]+):(\d+)>/g, (_, anim, name, id) => {
    const token = `@@DISCORD_EMOJI_${emojiTokens.length}@@`;
    const ext = anim === 'a' ? 'gif' : 'webp';
    emojiTokens.push({
      token,
      html: `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=48" alt=":${name}:" title=":${name}:" style="width:22px;height:22px;vertical-align:middle;margin:0 1px" />`,
    });
    return token;
  });

  const escapeHtmlAttribute = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const decodeBasicEntities = (value) => String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const sanitizeLinkHref = (rawHref) => {
    const decoded = decodeBasicEntities(rawHref).trim();
    // eslint-disable-next-line no-control-regex -- an address with control characters is refused
  if (!decoded || /[\u0000-\u001F\u007F\s]/.test(decoded)) return '';
    try {
      const parsed = new URL(decoded);
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') return '';
      return parsed.toString();
    } catch {
      return '';
    }
  };

  rendered = rendered
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```([^`]*?)```/gs, '<pre style="background:#1a1a2e;padding:8px;border-radius:4px;overflow-x:auto;margin:4px 0"><code>$1</code></pre>')
    .replace(/`([^`\n]+?)`/g, '<code style="background:#1a1a2e;padding:1px 6px;border-radius:3px;font-size:0.9em">$1</code>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/^> (.+)$/gm, '<div style="border-left:3px solid #4f545c;padding-left:10px;color:#a1a1aa">$1</div>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = sanitizeLinkHref(href);
      if (!safeHref) return `<span style="color:#a1a1aa">${label}</span>`;
      return `<a href="${escapeHtmlAttribute(safeHref)}" style="color:#5865F2;text-decoration:none" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/\n/g, '<br/>');

  for (const { token, html } of emojiTokens) {
    rendered = rendered.replaceAll(token, html);
  }

  return rendered;
}

export function buildDiscordEventDescriptionPreview(description, stationName, options = {}) {
  const base = String(description || '').trim();
  const details = String(
    options.detailsLine
      || `${String(options.detailsPrefix || 'OmniFM Auto-Event | Station').trim()}: ${String(stationName || '-').trim() || '-'}`
  ).trim();
  return base ? `${base}\n\n${details}` : details;
}
