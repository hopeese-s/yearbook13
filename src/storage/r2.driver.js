import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { assertDriverContract, normalizeKey, StorageError } from './driver.js';
import {
  createS3LiteClient,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from './s3-lite.js';

/**
 * Cloudflare R2 storage (S3-compatible API) - PRODUCTION driver.
 * Selected only when STORAGE_DRIVER=r2 (see config/env.js invariants).
 *
 * `s3Client` injection exists for contract tests; production builds a real
 * client from validated R2 credentials. The client is our own dependency-free
 * SigV4 implementation (./s3-lite.js) - the AWS SDK cost ~30 MB of RAM.
 */
export async function createR2Storage(config, { s3Client } = {}) {
  const { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl } = config.storage.r2;
  const client =
    s3Client ??
    createS3LiteClient({
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      accessKeyId,
      secretAccessKey,
    });

  const notFound = (err) => err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound';

  const mimeFromKey = (key = '') => {
    const ext = key.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'mp4':
      case 'm4v': return 'video/mp4';
      case 'webm': return 'video/webm';
      case 'mov': return 'video/quicktime';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'webp': return 'image/webp';
      default: return undefined;
    }
  };

  const driver = {
    name: 'r2',

    async save(key, buffer) {
      const normalized = normalizeKey(key);
      const contentType = mimeFromKey(normalized);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: normalized,
            Body: buffer,
            ...(contentType ? { ContentType: contentType } : {}),
          }),
        );
        return { key: normalized, size: buffer.length };
      } catch (err) {
        throw new StorageError('WRITE_FAILED', `Failed to store "${normalized}" in R2: ${err.message}`, err);
      }
    },

    /** Optional: upload a file from disk without loading it into RAM. */
    async saveFile(key, filePath) {
      const normalized = normalizeKey(key);
      const contentType = mimeFromKey(normalized);
      try {
        const { size } = await fs.stat(filePath);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: normalized,
            Body: createReadStream(filePath),
            ContentLength: size,
            ...(contentType ? { ContentType: contentType } : {}),
          }),
        );
        return { key: normalized, size };
      } catch (err) {
        throw new StorageError('WRITE_FAILED', `Failed to store "${normalized}" in R2: ${err.message}`, err);
      }
    },

    async read(key) {
      const normalized = normalizeKey(key);
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: normalized }));
        return Buffer.from(await response.Body.transformToByteArray());
      } catch (err) {
        if (notFound(err)) throw new StorageError('NOT_FOUND', `Object not found: "${normalized}"`, err);
        throw new StorageError('READ_FAILED', `Failed to read "${normalized}" from R2`, err);
      }
    },

    /** Optional: stream an object without buffering it. -> { stream, size } */
    async readStream(key) {
      const normalized = normalizeKey(key);
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: normalized }));
        return { stream: response.Body, size: response.ContentLength };
      } catch (err) {
        if (notFound(err)) throw new StorageError('NOT_FOUND', `Object not found: "${normalized}"`, err);
        throw new StorageError('READ_FAILED', `Failed to read "${normalized}" from R2`, err);
      }
    },

    async delete(key) {
      const normalized = normalizeKey(key);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: normalized }));
      } catch (err) {
        throw new StorageError('DELETE_FAILED', `Failed to delete "${normalized}" from R2`, err);
      }
    },

    async exists(key) {
      const normalized = normalizeKey(key);
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: normalized }));
        return true;
      } catch (err) {
        if (notFound(err)) return false;
        throw new StorageError('STAT_FAILED', `Failed to stat "${normalized}" in R2`, err);
      }
    },

    async stat(key) {
      const normalized = normalizeKey(key);
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: normalized }));
        return { key: normalized, size: response.ContentLength };
      } catch (err) {
        if (notFound(err)) throw new StorageError('NOT_FOUND', `Object not found: "${normalized}"`, err);
        throw new StorageError('STAT_FAILED', `Failed to stat "${normalized}" in R2`, err);
      }
    },

    publicUrl(key) {
      return publicBaseUrl ? `${publicBaseUrl.replace(/\/+$/, '')}/${normalizeKey(key)}` : null;
    },
  };

  return assertDriverContract(driver);
}
