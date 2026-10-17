// Submit every URL in the live sitemap to IndexNow. Runs from
// .github/workflows/indexnow.yml after each production deploy, or by
// hand: `npm run indexnow`. See scripts/lib/indexnow.mjs.
import {
  ENDPOINT,
  KEY_LOCATION,
  SITE,
  describeResponse,
  keyFileIsLive,
  payload,
  sitemapUrls,
} from './lib/indexnow.mjs';

async function main() {
  const keyRes = await fetch(KEY_LOCATION);
  if (!keyFileIsLive(keyRes.status, await keyRes.text())) {
    throw new Error(
      `${KEY_LOCATION} isn't serving the key (status ${keyRes.status}). Has the deploy that adds it gone live?`,
    );
  }

  const sitemapRes = await fetch(`${SITE}/sitemap.xml`);
  if (!sitemapRes.ok) throw new Error(`sitemap.xml returned ${sitemapRes.status}`);
  const urls = sitemapUrls(await sitemapRes.text());
  if (urls.length === 0) throw new Error('sitemap.xml has no hereday.io URLs');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload(urls)),
  });
  const { ok, message } = describeResponse(res.status);
  console.log(`[indexnow] ${urls.length} URL(s): ${message}`);
  if (!ok) {
    console.error(await res.text().catch(() => ''));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[indexnow] ${err.message}`);
  process.exit(1);
});
