import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Scratch directory for in-flight uploads. Uploads are spooled to disk (not
 * RAM) so a 25 MB photo/video costs ~nothing in resident memory; every file
 * here is deleted as soon as its request finishes.
 */
export const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'ims13-uploads');

export async function ensureTmpDir() {
  await fs.mkdir(UPLOAD_TMP_DIR, { recursive: true });
  return UPLOAD_TMP_DIR;
}

export async function tmpFilePath(ext = '') {
  await ensureTmpDir();
  return path.join(UPLOAD_TMP_DIR, `${randomUUID()}${ext ? `.${ext}` : ''}`);
}

/** Best-effort delete; never throws. */
export async function removeQuietly(...files) {
  await Promise.allSettled(files.filter(Boolean).map((file) => fs.rm(file, { force: true })));
}

/** Read the first `length` bytes of a file (magic-byte sniffing). */
export async function readHead(filePath, length = 16) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
