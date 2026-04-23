/**
 * HMAC-signed tokens for unsubscribe URLs embedded in organizer emails.
 *
 * Token format:  v1.<payload-b64url>.<signature-b64url>
 *
 * Payload fields (short keys to keep URLs short):
 *   a = audience: 's' (subscriber) | 'v' (volunteer)
 *   e = event_id (UUID string)
 *   i = subscriber_id (stringified bigserial) OR volunteer_id (uuid)
 *   x = expires_at (unix seconds) — we use ~365 days; race emails can
 *       legitimately be opened months later
 *
 * The HMAC-SHA256 signature covers the raw payload string. Secret is
 * read from env `UNSUBSCRIBE_HMAC_SECRET` and must be at least 32 bytes.
 */

export type UnsubscribeAudience = 's' | 'v';

export interface UnsubscribePayload {
  a: UnsubscribeAudience;
  e: string; // event_id
  i: string; // subscriber id (as string) or volunteer entry id
  x: number; // expires_at unix seconds
}

const TOKEN_PREFIX = 'v1.';

function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('UNSUBSCRIBE_HMAC_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error('UNSUBSCRIBE_HMAC_SECRET not configured or too short (need 32+ chars)');
  }
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signUnsubscribeToken(payload: Omit<UnsubscribePayload, 'x'> & Partial<Pick<UnsubscribePayload, 'x'>>): Promise<string> {
  const full: UnsubscribePayload = {
    ...payload,
    x: payload.x ?? Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  };
  const payloadStr = JSON.stringify(full);
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const payloadB64 = b64urlEncode(payloadBytes);

  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = b64urlEncode(sig);

  return `${TOKEN_PREFIX}${payloadB64}.${sigB64}`;
}

export async function verifyUnsubscribeToken(token: string): Promise<UnsubscribePayload | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const rest = token.slice(TOKEN_PREFIX.length);
  const [payloadB64, sigB64] = rest.split('.');
  if (!payloadB64 || !sigB64) return null;

  try {
    const key = await getKey();
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecodeToBytes(sigB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!ok) return null;

    const payloadStr = new TextDecoder().decode(b64urlDecodeToBytes(payloadB64));
    const payload = JSON.parse(payloadStr) as UnsubscribePayload;
    if (payload.x && payload.x < Math.floor(Date.now() / 1000)) return null;
    if (payload.a !== 's' && payload.a !== 'v') return null;
    if (!payload.e || !payload.i) return null;
    return payload;
  } catch {
    return null;
  }
}
