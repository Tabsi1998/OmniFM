// OmniFM: server dashboard settings: the weekdays and a sample song for previews.
// Split out of frontend/src/components/DashboardSettings.js (#296).


export const VOICE_STATUS_SAMPLE = {
  station: 'Groove Salad',
  title: 'Cafe del Mar',
  artist: 'Energy 52',
  listeners: 5,
  genre: 'Ambient',
  bot: 'OmniFM',
};

export const DAYS = [
  { value: 0, de: 'Sonntag', en: 'Sunday' },
  { value: 1, de: 'Montag', en: 'Monday' },
  { value: 2, de: 'Dienstag', en: 'Tuesday' },
  { value: 3, de: 'Mittwoch', en: 'Wednesday' },
  { value: 4, de: 'Donnerstag', en: 'Thursday' },
  { value: 5, de: 'Freitag', en: 'Friday' },
  { value: 6, de: 'Samstag', en: 'Saturday' },
];
