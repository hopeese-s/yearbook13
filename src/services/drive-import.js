import { parseDriveLink } from './drive-link.js';
import { createTokenProvider } from './drive-auth.js';

/**
 * Google Drive import (separate flow from login — login OAuth never gains
 * Drive scopes). Two auth modes, service account first:
 *
 *   1. GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON — can read folders shared directly
 *      to the service account's email, so classmates can share PRIVATE
 *      folders (no public link needed).
 *   2. GOOGLE_DRIVE_API_KEY — public ("Anyone with the link") folders only.
 *
 * Every downloaded image runs through the SAME pipeline as manual uploads
 * (validation -> orientation -> EXIF strip -> thumbnail -> storage ->
 * repository), so imported photos are identical to hand-uploaded ones.
 */

const API_BASE = 'https://www.googleapis.com/drive/v3';
const IMAGE_MIME_PREFIX = 'image/';
const GOOGLE_APP_MIME_PREFIX = 'application/vnd.google-apps.';
const MAX_FILES_PER_IMPORT = 100;
const CONCURRENCY = 3;

export class DriveImportError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'DriveImportError';
    this.code = code;
    this.status = status;
  }
}

export function createDriveImportService({ config, uploadService, fetchImpl = fetch }) {
  const apiKey = (config.drive?.apiKey ?? '').trim();
  let serviceAccount = null;
  let getToken = null;
  const saJson = (config.drive?.serviceAccountJson ?? '').trim();
  if (saJson) {
    try {
      serviceAccount = JSON.parse(saJson);
      getToken = createTokenProvider(serviceAccount, fetchImpl);
    } catch {
      serviceAccount = null; // env.js already validates; defensive only
    }
  }

  const mode = serviceAccount ? 'service-account' : apiKey ? 'api-key' : 'none';
  const enabled = mode !== 'none';

  function sharingHint() {
    if (mode === 'service-account') {
      return `Google can't see that folder. The owner must either set sharing to "Anyone with the link" (Viewer) OR share the folder directly to ${serviceAccount.client_email} (Viewer).`;
    }
    return 'Google can\'t see that folder. The owner must set sharing to "Anyone with the link" (Viewer), then send the link again.';
  }

  async function driveFetch(path) {
    let url = `${API_BASE}${path}`;
    const headers = {};
    if (mode === 'service-account') {
      headers.Authorization = `Bearer ${await getToken()}`;
    } else {
      url += `${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
    }

    let res;
    try {
      res = await fetchImpl(url, { headers });
    } catch (err) {
      throw new DriveImportError('DRIVE_UNREACHABLE', 'Could not reach the Google Drive API', 502, err);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const raw = body?.error?.message ?? `Google Drive API error (${res.status})`;
      // 403/404 on Drive almost always means "the server can't see this item"
      // — a sharing problem, not a bug. Say so plainly.
      const message = res.status === 404 || res.status === 403 ? `${raw} — ${sharingHint()}` : raw;
      throw new DriveImportError('DRIVE_API_ERROR', message, res.status === 403 || res.status === 404 ? 422 : 502);
    }
    return res;
  }

  async function listFolder(folderId) {
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,size),nextPageToken',
        pageSize: '200',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await driveFetch(`/files?${params.toString()}`);
      const body = await res.json();
      files.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken && files.length < MAX_FILES_PER_IMPORT);
    return files.slice(0, MAX_FILES_PER_IMPORT);
  }

  async function fileMetadata(fileId) {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`);
    return res.json();
  }

  async function downloadFile(fileId) {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Import every image behind a Drive link. Returns
   * { uploaded: [records], failed: [{name, message}], total }.
   * Per-file failures never abort the batch; cleanup is handled per file
   * inside the upload service.
   */
  async function importFromDrive({ url, metadata = {} }) {
    if (!enabled) {
      throw new DriveImportError(
        'DRIVE_NOT_CONFIGURED',
        'Drive import is not configured on this server. Set GOOGLE_DRIVE_API_KEY in your hosting environment, then redeploy.',
        503,
      );
    }
    const link = parseDriveLink(url);
    if (!link) {
      throw new DriveImportError('INVALID_DRIVE_LINK', 'That does not look like a Google Drive link.', 400);
    }

    let entries;
    if (link.kind === 'folder') {
      entries = await listFolder(link.id);
    } else {
      entries = [await fileMetadata(link.id)];
    }

    const images = entries
      .filter(
        (file) =>
          typeof file.mimeType === 'string' &&
          file.mimeType.startsWith(IMAGE_MIME_PREFIX) &&
          !file.mimeType.startsWith(GOOGLE_APP_MIME_PREFIX),
      )
      .filter((file) => Number(file.size ?? 0) <= config.storage.maxUploadBytes)
      .slice(0, MAX_FILES_PER_IMPORT);

    if (images.length === 0) {
      throw new DriveImportError(
        'NO_IMAGES',
        'No usable photos found in that link (images only: JPEG/PNG/WebP). Check the folder is shared as "Anyone with the link".',
        422,
      );
    }

    const uploaded = [];
    const failed = [];
    for (let index = 0; index < images.length; index += CONCURRENCY) {
      const chunk = images.slice(index, index + CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (file) => {
          const buffer = await downloadFile(file.id);
          return uploadService.uploadPhoto({ buffer, originalName: file.name, metadata });
        }),
      );
      settled.forEach((outcome, position) => {
        if (outcome.status === 'fulfilled') {
          uploaded.push(outcome.value);
        } else {
          failed.push({
            name: chunk[position].name,
            message: outcome.reason?.message ?? 'Import failed',
          });
        }
      });
    }

    return { uploaded, failed, total: images.length };
  }

  return { importFromDrive, enabled, mode, serviceAccountEmail: serviceAccount?.client_email ?? '' };
}
