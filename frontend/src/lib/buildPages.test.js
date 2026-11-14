// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import config from '../../vite.config.js';

// The build writes 404.html (#487) and noindex.html (#528) next to index.html:
// the same app with the noindex robots tag.
const plugin = config.plugins.find((entry) => entry?.name === 'omnifm:not-found-page');
let root = '';

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = '';
});

function build(indexHtml) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnifm-build-pages-'));
  fs.mkdirSync(path.join(root, 'build'));
  fs.writeFileSync(path.join(root, 'build', 'index.html'), indexHtml);
  plugin.configResolved({ root, build: { outDir: 'build' } });
  plugin.closeBundle();
  const read = (file) => fs.readFileSync(path.join(root, 'build', file), 'utf8');
  return { notFound: read('404.html'), noindex: read('noindex.html') };
}

describe('build pages', () => {
  it('writes 404.html and noindex.html with the noindex robots tag', () => {
    const { notFound, noindex } = build('<html><head>\n    <meta name="robots" content="index,follow" />\n  </head><body>app</body></html>');
    for (const html of [notFound, noindex]) {
      expect(html).toContain('<meta name="robots" content="noindex,follow" />');
      expect(html).not.toMatch(/content="index,follow"/);
      expect(html).toContain('app');
    }
  });

  it('adds the robots tag when index.html has none', () => {
    const { noindex } = build('<html><head></head><body>app</body></html>');
    expect(noindex).toContain('<meta name="robots" content="noindex,follow" />');
  });
});
