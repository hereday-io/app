// Google service-account → OAuth2 access token, using the JWT bearer
// flow (RFC 7523). No googleapis SDK: it's a signed JWT and one POST,
// and Deno's Web Crypto does RS256 natively.
//
// Setup (once, see agents/search-console-setup.md):
//   1. Google Cloud project → enable "Google Search Console API"
//   2. Create a service account, create a JSON key
//   3. Search Console → property → Settings → Users and permissions →
//      add the service account's client_email as a Full/Restricted user
//   4. supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)"

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch seconds
}

// Warm invocations reuse the token instead of re-signing a JWT and
// round-tripping to Google on every request. Module scope dies with the
// isolate, which is exactly the lifetime we want.
const tokenCache = new Map<string, CachedToken>();

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function getServiceAccount(): ServiceAccount {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not configured");
  }
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }
  // Secrets pasted through a shell or a web form often arrive with the
  // newlines escaped. JSON.parse already unescapes a real JSON key; this
  // catches the double-escaped case rather than failing at importKey.
  parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

/** Mint (or reuse) an access token for the given OAuth scope. */
export async function getGoogleAccessToken(scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const sa = getServiceAccount();
  const claims = {
    iss: sa.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  });

  const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Google token exchange failed: ${body.error_description ?? body.error ?? res.status}`,
    );
  }

  tokenCache.set(scope, {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
  });
  return body.access_token;
}
