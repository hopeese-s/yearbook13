import crypto from 'node:crypto';

/**
 * Google service account auth (BUILD-PLAN.md: Drive import is a separate
 * authorization flow — login OAuth never gains Drive scopes).
 *
 * Signs a JWT (RS256) with the service account private key and exchanges it
 * for an access token. Implemented with node:crypto only — NO new dependency.
 *
 * Token is cached in memory until ~60s before expiry. The scope is
 * drive.readonly: the server can LIST and DOWNLOAD, never modify.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_LIFETIME_S = 3600;
const TOKEN_REFRESH_MARGIN_S = 60;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Exchange a service account JSON key for a short-lived access token.
 * serviceAccount = { client_email, private_key } (parsed from the env JSON).
 * Returns a Bearer token string. Throws a clear error on failure.
 */
export async function getServiceAccountToken(serviceAccount, fetchImpl = fetch) {
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error('Service account key is missing client_email or private_key');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + TOKEN_LIFETIME_S,
    }),
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  let signature;
  try {
    signature = signer.sign(serviceAccount.private_key, 'base64url');
  } catch (err) {
    throw new Error(`Could not sign the service account JWT (invalid private_key): ${err.message}`);
  }

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${header}.${claims}.${signature}`,
  });

  let res;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    throw new Error(`Could not reach the Google token endpoint: ${err.message}`);
  }

  const tokenBody = await res.json().catch(() => null);
  if (!res.ok || !tokenBody?.access_token) {
    throw new Error(tokenBody?.error_description ?? tokenBody?.error ?? `Token endpoint returned ${res.status}`);
  }
  return tokenBody.access_token;
}

/** Small cached provider so imports reuse a token instead of re-signing. */
export function createTokenProvider(serviceAccount, fetchImpl = fetch) {
  let cached = null; // { token, expiresAtMs }

  return async function getToken() {
    if (cached && Date.now() < cached.expiresAtMs) return cached.token;
    const token = await getServiceAccountToken(serviceAccount, fetchImpl);
    cached = { token, expiresAtMs: Date.now() + (TOKEN_LIFETIME_S - TOKEN_REFRESH_MARGIN_S) * 1000 };
    return token;
  };
}
