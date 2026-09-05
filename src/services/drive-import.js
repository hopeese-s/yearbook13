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
const VIDEO_MIME_PREFIX = 'video/';
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
      // Check if this is a virus scan / large file warning rather than a permission issue
      const isVirusWarning = /cannotdownloadfile|virus|too large/i.test(raw);
      let message;
      if (isVirusWarning) {
        message = raw;
      } else if (res.status === 404 || res.status === 403) {
        message = `${raw} — ${sharingHint()}`;
      } else {
        message = raw;
      }
      throw new DriveImportError('DRIVE_API_ERROR', message, res.status === 403 || res.status === 404 ? 422 : 502);
    }
    return res;
  }

  async function listFolder(folderId, depth = 0) {
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,size,thumbnailLink,videoMediaMetadata,imageMediaMetadata),nextPageToken',
        pageSize: '200',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await driveFetch(`/files?${params.toString()}`);
      const body = await res.json();
      const pageFiles = body.files ?? [];
      for (const item of pageFiles) {
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          if (depth < 2 && files.length < MAX_FILES_PER_IMPORT) {
            try {
              const subFiles = await listFolder(item.id, depth + 1);
              files.push(...subFiles);
            } catch {
              // ignore subfolder traversal failures
            }
          }
        } else {
          files.push(item);
        }
      }
      pageToken = body.nextPageToken;
    } while (pageToken && files.length < MAX_FILES_PER_IMPORT);
    return files.slice(0, MAX_FILES_PER_IMPORT);
  }

  async function fileMetadata(fileId) {
    const res = await driveFetch(
      `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,thumbnailLink,videoMediaMetadata,imageMediaMetadata&supportsAllDrives=true`,
    );
    return res.json();
  }

  async function downloadFile(fileId) {
    const res = await driveFetch(
      `/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`,
    );
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
      if (entries.length === 0) {
        const saEmail = serviceAccount?.client_email;
        const msg = saEmail
          ? `Google Drive API requires sharing this folder directly with ${saEmail} (Viewer access). In Google Drive, right-click the folder, click Share, and add this email.`
          : 'No photos or videos found in that folder. Please make sure the folder is shared as "Anyone with the link".';
        throw new DriveImportError('NO_IMAGES', msg, 422);
      }
    } else {
      entries = [await fileMetadata(link.id)];
    }

    const isCandidateMedia = (file) => {
      const mime = file.mimeType ?? '';
      const name = file.name ?? '';
      if (mime.startsWith(GOOGLE_APP_MIME_PREFIX)) return false;
      if (mime.startsWith(IMAGE_MIME_PREFIX) || mime.startsWith(VIDEO_MIME_PREFIX)) return true;
      return /\.(jpe?g|png|webp|gif|avif|heic|mp4|webm|mov|m4v|mkv)$/i.test(name);
    };

    const isVideoMedia = (file) => {
      const mime = file.mimeType ?? '';
      const name = file.name ?? '';
      return mime.startsWith(VIDEO_MIME_PREFIX) || /\.(mp4|webm|mov|m4v|mkv)$/i.test(name);
    };

    const allCandidates = entries.filter(isCandidateMedia);

    if (allCandidates.length === 0) {
      throw new DriveImportError(
        'NO_IMAGES',
        'No usable photos or videos found in that link (photos & videos only: JPEG/PNG/WebP/MP4/WebM/MOV). Check the file or folder is shared.',
        422,
      );
    }

    const maxBytes = config.storage.maxUploadBytes;
    // For videos: streaming directly from Google Drive (Approach 2) uses zero local/R2 storage,
    // so no file size limit is imposed. For images: upload size limits still apply.
    const mediaFiles = allCandidates
      .filter((file) => {
        if (isVideoMedia(file)) return true;
        return Number(file.size ?? 0) <= maxBytes;
      })
      .slice(0, MAX_FILES_PER_IMPORT);

    if (mediaFiles.length === 0) {
      const first = allCandidates[0];
      const sizeMb = (Number(first.size ?? 0) / (1024 * 1024)).toFixed(1);
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      throw new DriveImportError(
        'PAYLOAD_TOO_LARGE',
        `File "${first.name}" (${sizeMb} MB) exceeds maximum upload limit of ${maxMb} MB.`,
        413,
      );
    }

    const uploaded = [];
    const failed = [];
    for (let index = 0; index < mediaFiles.length; index += CONCURRENCY) {
      const chunk = mediaFiles.slice(index, index + CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (file) => {
          const isVideo = isVideoMedia(file);
          if (isVideo && typeof uploadService.createExternalMediaRecord === 'function') {
            const embedUrl = `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/preview`;
            const externalThumbUrl = file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+$/, '=s640') : '';
            const width = file.videoMediaMetadata?.width || 640;
            const height = file.videoMediaMetadata?.height || 360;

            return uploadService.createExternalMediaRecord({
              originalName: file.name,
              mimeType: file.mimeType || 'video/mp4',
              externalUrl: embedUrl,
              embedUrl,
              externalThumbUrl,
              driveFileId: file.id,
              width,
              height,
              metadata,
            });
          }

          const buffer = await downloadFile(file.id);
          return uploadService.uploadPhoto({
            buffer,
            originalName: file.name,
            mimeType: file.mimeType,
            metadata,
          });
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

    return { uploaded, failed, total: mediaFiles.length };
  }

  return { importFromDrive, enabled, mode, serviceAccountEmail: serviceAccount?.client_email ?? '' };
}
