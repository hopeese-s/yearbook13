/**
 * Native, zero-dependency ZIP archive builder (STORE / uncompressed mode).
 * Perfect for archiving already-compressed photo formats (JPEG, PNG, WebP).
 *
 * Two flavours:
 *   buildZip(entries)       -> Buffer (small archives / tests)
 *   zipStream(entries)      -> async iterable of Buffers. Each entry's bytes
 *                              are streamed through with a running CRC and a
 *                              trailing data descriptor, so memory stays flat
 *                              no matter how big the backup is.
 */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

/** Incremental CRC-32: pass the previous result as `previous` to continue. */
export function crc32(buffer, previous = 0) {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2) & 0x1f));
  const d =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, d };
}

/**
 * Build a single Buffer containing a valid ZIP archive of entries.
 * entries = Array of { name: string, data: Buffer, date?: Date }
 */
export function buildZip(entries) {
  const parts = [];
  const cdEntries = [];
  let offset = 0;

  for (const entry of entries) {
    const filename = String(entry.name ?? 'file').replace(/\\/g, '/');
    const nameBuffer = Buffer.from(filename, 'utf8');
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
    const checksum = crc32(dataBuffer);
    const { time, d } = dosDateTime(entry.date);

    // Local file header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(0, 8); // Compression method (0 = STORE)
    localHeader.writeUInt16LE(time, 10); // Last mod file time
    localHeader.writeUInt16LE(d, 12); // Last mod file date
    localHeader.writeUInt32LE(checksum, 14); // CRC-32
    localHeader.writeUInt32LE(dataBuffer.length, 18); // Compressed size
    localHeader.writeUInt32LE(dataBuffer.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // Filename length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBuffer.copy(localHeader, 30);

    parts.push(localHeader, dataBuffer);

    cdEntries.push({
      filename,
      nameBuffer,
      checksum,
      size: dataBuffer.length,
      offset,
      time,
      d,
    });

    offset += localHeader.length + dataBuffer.length;
  }

  const cdOffset = offset;
  let cdSize = 0;

  // Central Directory
  for (const cd of cdEntries) {
    const cdHeader = Buffer.alloc(46 + cd.nameBuffer.length);
    cdHeader.writeUInt32LE(0x02014b50, 0); // Central directory header signature
    cdHeader.writeUInt16LE(20, 4); // Version made by
    cdHeader.writeUInt16LE(20, 6); // Version needed to extract
    cdHeader.writeUInt16LE(0, 8); // General purpose bit flag
    cdHeader.writeUInt16LE(0, 10); // Compression method
    cdHeader.writeUInt16LE(cd.time, 12); // Mod time
    cdHeader.writeUInt16LE(cd.d, 14); // Mod date
    cdHeader.writeUInt32LE(cd.checksum, 16); // CRC-32
    cdHeader.writeUInt32LE(cd.size, 20); // Compressed size
    cdHeader.writeUInt32LE(cd.size, 24); // Uncompressed size
    cdHeader.writeUInt16LE(cd.nameBuffer.length, 28); // Filename length
    cdHeader.writeUInt16LE(0, 30); // Extra field length
    cdHeader.writeUInt16LE(0, 32); // File comment length
    cdHeader.writeUInt16LE(0, 34); // Disk number start
    cdHeader.writeUInt16LE(0, 36); // Internal file attributes
    cdHeader.writeUInt32LE(0, 38); // External file attributes
    cdHeader.writeUInt32LE(cd.offset, 42); // Relative offset of local header
    cd.nameBuffer.copy(cdHeader, 46);

    parts.push(cdHeader);
    cdSize += cdHeader.length;
  }

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where CD starts
  eocd.writeUInt16LE(cdEntries.length, 8); // Number of CD records on this disk
  eocd.writeUInt16LE(cdEntries.length, 10); // Total number of CD records
  eocd.writeUInt32LE(cdSize, 12); // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16); // Offset of start of CD
  eocd.writeUInt16LE(0, 20); // Comment length

  parts.push(eocd);

  return Buffer.concat(parts);
}

const FLAG_DATA_DESCRIPTOR = 0x08;
const FLAG_UTF8 = 0x800;
const ZIP32_LIMIT = 0xffffffff;

function centralDirectory(cdEntries, cdOffset) {
  const parts = [];
  let cdSize = 0;
  for (const cd of cdEntries) {
    const cdHeader = Buffer.alloc(46 + cd.nameBuffer.length);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(cd.flags, 8);
    cdHeader.writeUInt16LE(0, 10);
    cdHeader.writeUInt16LE(cd.time, 12);
    cdHeader.writeUInt16LE(cd.d, 14);
    cdHeader.writeUInt32LE(cd.checksum, 16);
    cdHeader.writeUInt32LE(cd.size, 20);
    cdHeader.writeUInt32LE(cd.size, 24);
    cdHeader.writeUInt16LE(cd.nameBuffer.length, 28);
    cdHeader.writeUInt32LE(cd.offset, 42);
    cd.nameBuffer.copy(cdHeader, 46);
    parts.push(cdHeader);
    cdSize += cdHeader.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(cdEntries.length, 8);
  eocd.writeUInt16LE(cdEntries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  parts.push(eocd);
  return parts;
}

/**
 * Stream a ZIP archive. `entries` is an (async) iterable of
 * { name, open: async () => AsyncIterable<Buffer|Uint8Array>, date? }.
 * An entry whose open() throws is skipped (e.g. object missing in storage).
 * Throws if the archive would exceed the 4 GB ZIP32 limit rather than emit a
 * corrupt file.
 */
export async function* zipStream(entries) {
  const cdEntries = [];
  let offset = 0;

  for await (const entry of entries) {
    let source;
    try {
      source = await entry.open();
    } catch {
      continue;
    }
    const filename = String(entry.name ?? 'file').replace(/\\/g, '/');
    const nameBuffer = Buffer.from(filename, 'utf8');
    const { time, d } = dosDateTime(entry.date);
    const flags = FLAG_DATA_DESCRIPTOR | FLAG_UTF8;

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(0, 8); // STORE
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(d, 12);
    // CRC + sizes are 0 here and follow the data in the data descriptor.
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(localHeader, 30);
    yield localHeader;

    let checksum = 0;
    let size = 0;
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      checksum = crc32(buf, checksum);
      size += buf.length;
      if (offset + localHeader.length + size > ZIP32_LIMIT) {
        throw new Error('Backup exceeds the 4 GB ZIP limit');
      }
      yield buf;
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    yield descriptor;

    cdEntries.push({ nameBuffer, checksum, size, offset, time, d, flags });
    offset += localHeader.length + size + descriptor.length;
  }

  for (const part of centralDirectory(cdEntries, offset)) yield part;
}
