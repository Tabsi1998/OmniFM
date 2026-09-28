// OmniFM: the panel designer's preview in the dashboard preview (#432). The
// preview cannot ask the bot, so it takes the bot's own example panel (#431)
// and leaves out what the design switches off, like the bot does;
// test/dashboard-demo.test.js compares both for every switch.

// The parts of the panel each switch of src/lib/panel-design.js removes.
const BUTTON_PARTS = {
  volume: (component) => component.custom_id === 'np:voldown' || component.custom_id === 'np:volup',
  stations: (component) => component.custom_id === 'omnifm:stations:open',
  favorites: (component) => String(component.custom_id || '').startsWith('np:fav:'),
  save: (component) => component.custom_id === 'np:save',
  links: (component) => /^https:\/\/(open\.spotify\.com|www\.youtube\.com)\//.test(String(component.url || '')),
  share: (component) => component.custom_id === 'np:share',
  report: (component) => component.custom_id === 'np:report',
};

// "Earlier": the line with the last songs.
const isRecentLine = (component) => component.type === 10 && String(component.content || '').startsWith('-# 📜');

/**
 * @param {{ components: any[] }} panel the bot's panel with the standard design
 * @param {{ accentColor?: number|null, showRecent?: boolean, buttons?: Record<string, boolean> }} design
 */
export function applyPanelDesign(panel, design = {}) {
  const hidden = Object.entries(BUTTON_PARTS)
    .filter(([key]) => design?.buttons?.[key] === false)
    .map(([, matches]) => matches);
  const keep = (component) => !hidden.some((matches) => matches(component))
    && !(design?.showRecent === false && isRecentLine(component));
  const walk = (components) => components
    .filter(keep)
    .map((component) => (Array.isArray(component.components) ? { ...component, components: walk(component.components) } : component))
    // A row whose buttons are all switched off disappears with them.
    .filter((component) => component.type !== 1 || component.components.length > 0);
  const components = walk(panel?.components || []);
  if (Number.isInteger(design?.accentColor) && components[0]?.type === 17) {
    components[0] = { ...components[0], accent_color: design.accentColor };
  }
  return { ...panel, components };
}
