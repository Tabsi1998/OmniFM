import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

// Which pages reach a module: the website, the Discord Activity (#308) or
// both. The Activity is its own page; it must not pull the site's vendor chunk.
const reach = new Map();
function pagesReaching(id, getModuleInfo, path = new Set()) {
  const known = reach.get(id);
  if (known) return known;
  const clean = id.replaceAll('\\', '/');
  if (clean.includes('/src/activity/') || clean.endsWith('/activity/index.html')) return new Set(['activity']);
  if (path.has(id)) return new Set();
  path.add(id);
  const info = getModuleInfo(id);
  const importers = [...(info?.importers || []), ...(info?.dynamicImporters || [])];
  const pages = new Set(importers.length ? [] : ['site']);
  for (const importer of importers) {
    for (const page of pagesReaching(importer, getModuleInfo, path)) pages.add(page);
  }
  path.delete(id);
  reach.set(id, pages);
  return pages;
}

const jsxInJs = {
  name: 'omnifm:jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    const cleanId = id.split('?', 1)[0].replaceAll('\\', '/');
    if (!cleanId.includes('/src/') || !cleanId.endsWith('.js')) return null;
    return transformWithOxc(code, cleanId, {
      lang: 'jsx',
      jsx: { runtime: 'automatic' },
    });
  },
};

export default defineConfig({
  // OmniFM historically uses JSX in .js files. Parse those source files as
  // JSX before Vite's regular import analysis while retaining their paths.
  plugins: [jsxInJs, react()],
  // Existing installations already use REACT_APP_* in frontend/.env. Keep
  // that contract while also accepting Vite's native VITE_* prefix.
  envPrefix: ['VITE_', 'REACT_APP_'],
  optimizeDeps: {
    // The dependency scanner runs before application plugins. Tell Rolldown
    // that the historical .js entry files may contain JSX as well.
    rolldownOptions: {
      moduleTypes: { '.js': 'jsx' },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    fs: {
      // The voice status preview uses the bot's own renderer (#277) and the
      // plans come from the bot's plan files (#413, #306), the legal checklist
      // from the list the API checks too (#424); only these files
      // outside frontend/ are served.
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fileURLToPath(new URL('../src/lib/voice-status-template.js', import.meta.url)),
        fileURLToPath(new URL('../src/lib/seasons.js', import.meta.url)), // the season calendar (#425)
        fileURLToPath(new URL('../src/lib/problem-reports.js', import.meta.url)), // reports from Discord (#436)
        fileURLToPath(new URL('../src/config/plan-features.js', import.meta.url)),
        fileURLToPath(new URL('../src/config/plan-feature-texts.js', import.meta.url)),
        fileURLToPath(new URL('../src/config/legal-requirements.js', import.meta.url)),
      ],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
  // Frontend tests (#294): helpers and translations in Node, components in jsdom.
  test: {
    include: ['src/**/*.test.js'],
    environment: 'jsdom',
    restoreMocks: true,
    setupFiles: ['src/test/setup.js'],
  },
  build: {
    // start.sh and the production static server intentionally keep using the
    // established frontend/build directory.
    outDir: 'build',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // The website, and the Discord Activity as a page of its own (#308): it
      // loads none of the site's code, and build/activity/ gets its own frame
      // rules in serve.json.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        activity: fileURLToPath(new URL('./activity/index.html', import.meta.url)),
      },
      output: {
        manualChunks(id, { getModuleInfo }) {
          if (!id.includes('/node_modules/')) return undefined;
          // recharts goes with the pages that draw charts (#296); forcing it into a
          // chunk of its own put a shared helper there, and the start page loaded it all.
          if (id.includes('/lucide-react/')) return 'icons';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'react';
          }
          // The Activity's SDK goes with the Activity; what the site uses too
          // (a few small helpers) gets a small chunk of its own.
          const pages = pagesReaching(id, getModuleInfo);
          if (pages.has('activity')) return pages.has('site') ? 'shared' : undefined;
          return 'vendor';
        },
      },
    },
  },
});
