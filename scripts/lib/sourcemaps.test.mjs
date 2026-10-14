// npm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { removeSourceMaps } from './sourcemaps.mjs';

test('removes every .map file, at any depth, and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sourcemaps-'));
  try {
    mkdirSync(join(dir, 'assets', 'nested'), { recursive: true });
    for (const file of ['index.html', 'assets/index-abc.js', 'assets/index-abc.js.map',
      'assets/index-abc.css.map', 'assets/nested/chunk.js.map', 'assets/sitemap.xml']) {
      writeFileSync(join(dir, file), '');
    }

    const removed = removeSourceMaps(dir).map((p) => p.slice(dir.length + 1).replace(/\\/g, '/'));

    assert.deepEqual(removed.sort(),
      ['assets/index-abc.css.map', 'assets/index-abc.js.map', 'assets/nested/chunk.js.map']);
    assert.ok(existsSync(join(dir, 'index.html')));
    assert.ok(existsSync(join(dir, 'assets', 'index-abc.js')));
    assert.ok(existsSync(join(dir, 'assets', 'sitemap.xml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing directory is not an error', () => {
  assert.deepEqual(removeSourceMaps(join(tmpdir(), 'does-not-exist-sourcemaps')), []);
});
