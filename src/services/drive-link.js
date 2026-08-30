/**
 * Google Drive link parsing (Drive import feature).
 * Pure functions — no network. Accepts the link shapes users actually paste:
 *
 *   https://drive.google.com/drive/folders/<ID>?usp=sharing
 *   https://drive.google.com/drive/u/0/folders/<ID>
 *   https://drive.google.com/drive/mobile/folders/<ID>
 *   https://drive.google.com/file/d/<ID>/view?usp=sharing
 *   https://drive.google.com/open?id=<ID>
 *   https://drive.google.com/uc?id=<ID>
 *   docs.google.com/leaf?id=<ID>
 *   <bare ID>
 */

const ID = '([A-Za-z0-9_-]{10,})';

const FOLDER_PATTERNS = [
  new RegExp(`drive\\.google\\.com/drive/(?:u/\\d+/|mobile/)?folders/${ID}`),
  new RegExp(`drive\\.google\\.com/embeddedfolderview/${ID}`),
];

const FILE_PATTERNS = [
  new RegExp(`drive\\.google\\.com/file/d/${ID}`),
  new RegExp(`drive\\.google\\.com/open\\?id=${ID}`),
  new RegExp(`drive\\.google\\.com/uc\\?(?:[^#]*&)?id=${ID}`),
  new RegExp(`docs\\.google\\.com/leaf\\?id=${ID}`),
];

/**
 * Parse a pasted Drive link into { kind: 'folder'|'file', id } or null.
 * A bare resource ID is treated as a folder (the common case for album links).
 */
export function parseDriveLink(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  if (new RegExp(`^${ID}$`).test(raw)) return { kind: 'folder', id: raw };

  for (const pattern of FOLDER_PATTERNS) {
    const match = raw.match(pattern);
    if (match) return { kind: 'folder', id: match[1] };
  }
  for (const pattern of FILE_PATTERNS) {
    const match = raw.match(pattern);
    if (match) return { kind: 'file', id: match[1] };
  }
  return null;
}
