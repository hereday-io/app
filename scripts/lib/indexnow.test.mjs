// npm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  INDEXNOW_KEY,
  KEY_LOCATION,
  describeResponse,
  keyFileIsLive,
  payload,
  sitemapUrls,
} from './indexnow.mjs';

test('sitemapUrls reads every loc, dedupes, and drops other hosts', () => {
  const xml = `<urlset>
    <url><loc>https://hereday.io/</loc></url>
    <url><loc> https://hereday.io/faq </loc></url>
    <url><loc>https://hereday.io/faq</loc></url>
    <url><loc>https://www.hereday.io/pro</loc></url>
    <url><loc>not a url</loc></url>
  </urlset>`;
  assert.deepEqual(sitemapUrls(xml), ['https://hereday.io/', 'https://hereday.io/faq']);
});

test('the committed sitemap yields URLs', () => {
  const urls = sitemapUrls(readFileSync('public/sitemap.xml', 'utf8'));
  assert.ok(urls.includes('https://hereday.io/'));
  assert.ok(urls.length >= 5);
});

test('the key file ships in public/ and holds exactly the key', () => {
  const path = `public/${INDEXNOW_KEY}.txt`;
  assert.ok(existsSync(path), `${path} is missing`);
  assert.equal(readFileSync(path, 'utf8').trim(), INDEXNOW_KEY);
  assert.equal(KEY_LOCATION, `https://hereday.io/${INDEXNOW_KEY}.txt`);
});

test("keyFileIsLive won't accept the SPA fallback's 200", () => {
  assert.equal(keyFileIsLive(200, `${INDEXNOW_KEY}\n`), true);
  assert.equal(keyFileIsLive(200, '<!doctype html><div id="root"></div>'), false);
  assert.equal(keyFileIsLive(404, INDEXNOW_KEY), false);
});

test('payload names the host, key and key location', () => {
  assert.deepEqual(payload(['https://hereday.io/']), {
    host: 'hereday.io',
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: ['https://hereday.io/'],
  });
});

test('describeResponse treats 200 and 202 as success', () => {
  assert.equal(describeResponse(200).ok, true);
  assert.equal(describeResponse(202).ok, true);
  assert.equal(describeResponse(403).ok, false);
  assert.match(describeResponse(403).message, /must serve exactly the key/);
  assert.match(describeResponse(500).message, /unexpected status 500/);
});
