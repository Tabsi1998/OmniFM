// OmniFM: the dashboard preview's requests (#432) with the bot's own example
// panel from the live demos (#431). Loaded only in the preview.
import demoMessages from '../components/demo/demoMessages.json';
import { createDemoApi } from './dashboardDemo.js';

export function createPageDemoApi() {
  return createDemoApi({ panels: { de: demoMessages.panels.de.lofi, en: demoMessages.panels.en.lofi } });
}
