export interface BrowserZipEntry { name: string; base64Data: string; }

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  return { time, day };
}

function writeU16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function writeU32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }

export function createStoredZip(entries: BrowserZipEntry[]): Uint8Array {
  const encoded = entries.map((entry) => ({
    name: entry.name.replace(/\\/g, "/"),
    nameBytes: encoder.encode(entry.name.replace(/\\/g, "/")),
    data: base64ToBytes(entry.base64Data),
  }));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const entry of encoded) {
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + entry.nameBytes.length + entry.data.length);
    const lv = new DataView(local.buffer);
    writeU32(lv, 0, 0x04034b50); writeU16(lv, 4, 20); writeU16(lv, 6, 0x0800); writeU16(lv, 8, 0);
    writeU16(lv, 10, time); writeU16(lv, 12, day); writeU32(lv, 14, crc); writeU32(lv, 18, entry.data.length); writeU32(lv, 22, entry.data.length);
    writeU16(lv, 26, entry.nameBytes.length); writeU16(lv, 28, 0);
    local.set(entry.nameBytes, 30); local.set(entry.data, 30 + entry.nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + entry.nameBytes.length);
    const cv = new DataView(central.buffer);
    writeU32(cv, 0, 0x02014b50); writeU16(cv, 4, 20); writeU16(cv, 6, 20); writeU16(cv, 8, 0x0800); writeU16(cv, 10, 0);
    writeU16(cv, 12, time); writeU16(cv, 14, day); writeU32(cv, 16, crc); writeU32(cv, 20, entry.data.length); writeU32(cv, 24, entry.data.length);
    writeU16(cv, 28, entry.nameBytes.length); writeU16(cv, 30, 0); writeU16(cv, 32, 0); writeU16(cv, 34, 0); writeU16(cv, 36, 0); writeU32(cv, 38, 0); writeU32(cv, 42, offset);
    central.set(entry.nameBytes, 46); centrals.push(central);
    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centrals.reduce((sum, x) => sum + x.length, 0);
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  writeU32(ev, 0, 0x06054b50); writeU16(ev, 4, 0); writeU16(ev, 6, 0); writeU16(ev, 8, entries.length); writeU16(ev, 10, entries.length);
  writeU32(ev, 12, centralSize); writeU32(ev, 16, centralOffset); writeU16(ev, 20, 0);

  const total = [...locals, ...centrals, eocd].reduce((sum, x) => sum + x.length, 0);
  const output = new Uint8Array(total); let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) { output.set(part, cursor); cursor += part.length; }
  return output;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress ZIP files.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function parseZip(bytes: Uint8Array): Promise<BrowserZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const start = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Invalid ZIP archive.");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const output: BrowserZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid ZIP central directory.");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = (flags & 0x0800) !== 0 ? decoder.decode(nameBytes) : decoder.decode(nameBytes);

    if (!name.endsWith("/")) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("Invalid ZIP local header.");
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      let data: Uint8Array;
      if (method === 0) data = compressed.slice();
      else if (method === 8) data = await inflateRaw(compressed);
      else throw new Error(`Unsupported ZIP compression method: ${method}`);
      output.push({ name, base64Data: bytesToBase64(data) });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return output;
}
