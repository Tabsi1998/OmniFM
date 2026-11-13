// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// #543: @discord/embedded-app-sdk ships its own copy of zod 3 inside
// output/lib/zod, so an npm override of zod cannot reach the code the Activity
// runs. Every zod 3 is affected by GHSA-mrhx-c7xc-m3w5 (fixed in 4.6.6), and
// scripts/ci-baseline.json keeps that one finding as known debt
// ("frontend: zod (high)", "frontend: @discord/embedded-app-sdk (high)" and the
// OSV entry). The bundled copy carries no version string, so this test pins
// what can be read: the zod range the SDK declares and the zod 3 class layout of
// its bundled copy. When an SDK update changes either, this test fails: check
// whether the new SDK ships zod >= 4.6.6 (or imports zod from npm instead of
// bundling it) and remove the baseline entries once npm audit and OSV are clean.
const require = createRequire(import.meta.url);
const sdkDir = path.dirname(require.resolve('@discord/embedded-app-sdk/package.json'));
const sdkPackage = JSON.parse(fs.readFileSync(path.join(sdkDir, 'package.json'), 'utf8'));
const bundledZod = path.join(sdkDir, 'output', 'lib', 'zod', 'lib', 'index.mjs');

describe('zod bundled in @discord/embedded-app-sdk (#543)', () => {
  it('still declares zod 3, which has no fix for GHSA-mrhx-c7xc-m3w5', () => {
    expect(sdkPackage.dependencies.zod).toMatch(/^\^?3\./);
  });

  it('still bundles its own zod 3 copy that an npm override cannot replace', () => {
    expect(fs.existsSync(bundledZod)).toBe(true);
    const source = fs.readFileSync(bundledZod, 'utf8');
    expect(source).toContain('class ZodArray extends ZodType');
    expect(source).not.toContain('$ZodArray');
  });
});
