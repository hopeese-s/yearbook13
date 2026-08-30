/**
 * Native, zero-dependency ZIP archive builder (STORE / uncompressed mode).
 * Perfect for archiving already-compressed photo formats (JPEG, PNG, WebP).
 */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

export function crc32(buffer) {
  let crc = 0xffffffff;
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
