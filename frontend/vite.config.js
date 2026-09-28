import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

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
      // plans come from the bot's plan file (#413); only these files outside
      // frontend/ are served.
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fileURLToPath(new URL('../src/lib/voice-status-template.js', import.meta.url)),
        fileURLToPath(new URL('../src/config/plan-features.js', import.meta.url)),
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
      output: {
        manualChunks(id) {
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
          return 'vendor';
        },
      },
    },
  },
});
