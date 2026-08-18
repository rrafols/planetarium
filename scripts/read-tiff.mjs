import { readFileSync } from 'fs';
const TAGS = { 256:'width', 257:'height', 258:'bitsPerSample', 259:'compression',
  262:'photometric', 273:'stripOffsets', 277:'samplesPerPixel', 278:'rowsPerStrip',
  279:'stripByteCounts', 339:'sampleFormat', 317:'predictor' };
const TYPE_SIZE = { 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8 };

export function readIFD(buf) {
  const le = buf.toString('ascii', 0, 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(2) !== 42) throw new Error('not a classic TIFF');
  const ifd = u32(4);
  const n = u16(ifd);
  const out = { le };
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = (TYPE_SIZE[type] || 1) * count;
    const at = size <= 4 ? e + 8 : u32(e + 8);
    const read = (k) => {
      const o = at + k * (TYPE_SIZE[type] || 1);
      if (type === 3) return u16(o);
      if (type === 4) return u32(o);
      if (type === 1 || type === 6) return buf[o];
      return u32(o);
    };
    const vals = [];
    for (let k = 0; k < Math.min(count, 8); k++) vals.push(read(k));
    const name = TAGS[tag];
    if (name) out[name] = count === 1 ? vals[0] : vals;
    if (name === 'stripOffsets' || name === 'stripByteCounts') {
      const all = [];
      for (let k = 0; k < count; k++) all.push(read(k));
      out[name] = all;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2]) {
  const b = readFileSync(process.argv[2]);
  const i = readIFD(b);
  console.log({ le: i.le, width: i.width, height: i.height, bits: i.bitsPerSample,
    samples: i.samplesPerPixel, compression: i.compression, sampleFormat: i.sampleFormat,
    predictor: i.predictor, rowsPerStrip: i.rowsPerStrip, strips: i.stripOffsets?.length,
    firstOffset: i.stripOffsets?.[0], totalBytes: i.stripByteCounts?.reduce((a,c)=>a+c,0),
    fileSize: b.length });
}
