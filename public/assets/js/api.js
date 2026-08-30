/** API client: single JSON contract for the frontend. */

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response; fall through to status check
  }
  if (!res.ok) {
    const message = body?.error?.message ?? `Request failed (${res.status})`;
    const err = new Error(message);
    err.code = body?.error?.code;
    err.status = res.status;
    throw err;
  }
  return body;
}

export function getPhotos(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const qs = search.toString();
  return fetchJSON(`/api/photos${qs ? `?${qs}` : ''}`);
}

export function getPhoto(id) {
  return fetchJSON(`/api/photos/${encodeURIComponent(id)}`);
}

export function authStatus() {
  return fetchJSON('/auth/status');
}
