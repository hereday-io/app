// IndexNow: tell Bing (and Yandex, Seznam, Naver — they share submissions)
// that hereday.io's pages changed, instead of waiting for a recrawl. Bing's
// index is what ChatGPT search and Copilot cite from, so this is the
// fastest way for a page edit to reach those answers.
//
// The key is public by design: IndexNow proves ownership by fetching
// https://hereday.io/<key>.txt and checking it holds the key. The file
// lives in public/.

export const SITE = 'https://hereday.io';
export const INDEXNOW_KEY = '9cc9be75758efc3615a7a58232e65949';
export const KEY_LOCATION = `${SITE}/${INDEXNOW_KEY}.txt`;
export const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** Every <loc> in a sitemap, deduped, limited to our own host. */
export function sitemapUrls(xml) {
  const host = new URL(SITE).host;
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  return [...new Set(urls)].filter((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
}

/**
 * True if the key file is really live. A wrong path on Vercel still
 * answers 200 with the SPA's index.html, so the body has to be checked,
 * not the status.
 */
export function keyFileIsLive(status, body) {
  return status === 200 && body.trim() === INDEXNOW_KEY;
}

export function payload(urls) {
  return {
    host: new URL(SITE).host,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls,
  };
}

/** IndexNow answers 200 (done) or 202 (accepted, key check pending). */
export function describeResponse(status) {
  if (status === 200 || status === 202) return { ok: true, message: `accepted (${status})` };
  const reasons = {
    400: 'bad request: the payload is malformed',
    403: `key rejected: ${KEY_LOCATION} must serve exactly the key`,
    422: `URLs don't belong to ${SITE} or don't match the key`,
    429: 'too many requests: IndexNow thinks this is spam; submit less often',
  };
  return { ok: false, message: reasons[status] ?? `unexpected status ${status}` };
}
