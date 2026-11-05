import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

/**
 * Minimal S3-compatible client (Cloudflare R2) - zero dependencies.
 *
 * Why: @aws-sdk/client-s3 adds ~30 MB of resident memory just by being
 * loaded, which on a pay-per-MB host (Railway) costs more than everything
 * else this app does at idle. We only need four object operations, so this
 * module signs requests with AWS Signature V4 itself and talks HTTPS through
 * node:https (which lets uploads stream from disk with a known length).
 *
 * The API deliberately mirrors the SDK's `client.send(new XxxCommand(input))`
 * shape so the R2 driver (and its injected test doubles) stay unchanged.
 */

class Command {
  constructor(input) {
    this.input = input;
  }
}
export class PutObjectCommand extends Command {}
export class GetObjectCommand extends Command {}
export class HeadObjectCommand extends Command {}
export class DeleteObjectCommand extends Command {}

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as required by SigV4 (keeps "/" when encoding paths). */
function uriEncode(value, keepSlash = false) {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replaceAll('%2F', '/') : encoded;
}

/**
 * AWS Signature V4. Pure function so it can be checked against AWS's
 * published test vectors. `headers` keys must be lower-case and include host.
 * Returns the Authorization header value.
 */
export function signV4({ method, path, query = '', headers, payloadHash, accessKeyId, secretAccessKey, region, service, amzDate }) {
  const dateStamp = amzDate.slice(0, 8);
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = names.map((h) => `${h}:${String(headers[h]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function s3Error(statusCode, body) {
  const code = /<Code>([^<]+)<\/Code>/.exec(body ?? '')?.[1];
  const err = new Error(code ? `${code} (HTTP ${statusCode})` : `S3 request failed (HTTP ${statusCode})`);
  err.name = statusCode === 404 ? 'NotFound' : code || 'S3Error';
  err.$metadata = { httpStatusCode: statusCode };
  return err;
}

async function drain(stream, limit = 64 * 1024) {
  let text = '';
  for await (const chunk of stream) {
    if (text.length < limit) text += chunk.toString('utf8');
  }
  return text;
}

/** Attach the SDK-style helper the driver uses to buffer small objects. */
function withByteArray(stream) {
  stream.transformToByteArray = async () => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return new Uint8Array(Buffer.concat(chunks));
  };
  return stream;
}

export function createS3LiteClient({ endpoint, accessKeyId, secretAccessKey, region = 'auto', agent } = {}) {
  const base = new URL(endpoint);
  const transport = base.protocol === 'http:' ? http : https;
  // keepAlive reuses TLS sessions between uploads; idle sockets close quickly
  // so the process does not hold connections open while the app sleeps.
  const httpAgent = agent ?? new transport.Agent({ keepAlive: true, maxSockets: 4, timeout: 15_000 });

  function request(method, bucket, key, { body, contentLength, contentType } = {}) {
    const path = `/${uriEncode(bucket)}/${uriEncode(key, true)}`;
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const headers = {
      host: base.host,
      'x-amz-date': amzDate,
      // Payload signing is unnecessary over TLS and would force us to read
      // (and hash) whole files before uploading them.
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    };
    if (contentType) headers['content-type'] = contentType;
    if (body !== undefined) headers['content-length'] = String(contentLength ?? body.length);
    headers.authorization = signV4({
      method,
      path,
      headers,
      payloadHash: 'UNSIGNED-PAYLOAD',
      accessKeyId,
      secretAccessKey,
      region,
      service: 's3',
      amzDate,
    });

    return new Promise((resolve, reject) => {
      const req = transport.request(
        { protocol: base.protocol, hostname: base.hostname, port: base.port || undefined, method, path, headers, agent: httpAgent },
        (res) => resolve(res),
      );
      req.on('error', reject);
      req.setTimeout(120_000, () => req.destroy(new Error('S3 request timed out')));
      if (body instanceof Readable) {
        body.on('error', (err) => req.destroy(err));
        body.pipe(req);
      } else {
        req.end(body);
      }
    });
  }

  async function expectOk(res) {
    if (res.statusCode >= 200 && res.statusCode < 300) return res;
    throw s3Error(res.statusCode, await drain(res));
  }

  return {
    async send(command) {
      const { Bucket, Key } = command.input;
      if (command instanceof PutObjectCommand) {
        const { Body, ContentLength, ContentType } = command.input;
        const body = Body instanceof Readable ? Body : Buffer.isBuffer(Body) ? Body : Buffer.from(Body ?? '');
        const res = await expectOk(await request('PUT', Bucket, Key, { body, contentLength: ContentLength, contentType: ContentType }));
        res.resume();
        return { ETag: res.headers.etag };
      }
      if (command instanceof GetObjectCommand) {
        const res = await expectOk(await request('GET', Bucket, Key));
        const length = Number(res.headers['content-length']);
        return { Body: withByteArray(res), ContentLength: Number.isFinite(length) ? length : undefined };
      }
      if (command instanceof HeadObjectCommand) {
        const res = await request('HEAD', Bucket, Key);
        res.resume();
        if (res.statusCode < 200 || res.statusCode >= 300) throw s3Error(res.statusCode, '');
        return { ContentLength: Number(res.headers['content-length']) };
      }
      if (command instanceof DeleteObjectCommand) {
        const res = await expectOk(await request('DELETE', Bucket, Key));
        res.resume();
        return {};
      }
      throw new Error(`Unsupported command: ${command?.constructor?.name}`);
    },
  };
}
