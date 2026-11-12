/**
 * Keeps the last N seconds of a video recorded by the phone's own camera app (MP4 / MOV, H.264 or HEVC + AAC)
 * without re-encoding, so the camera's quality stays exactly as it was.
 *
 * Only the movie's index (moov) is read into memory. The new file is ftyp + a new moov + one mdat whose data is a
 * slice of the original file, joined lazily with Blob — so even a long 4K recording is not loaded into memory.
 * The cut starts at the key frame at or before the requested start (like `ffmpeg -c copy`), and an edit list
 * hides the frames before the exact start time. Extra tracks (timecode, metadata) are dropped.
 */

/* ---------- reading ---------- */
async function readBytes(b: Blob, start: number, len: number): Promise<Uint8Array> {
  return new Uint8Array(await b.slice(start, start + len).arrayBuffer());
}
const str4 = (u: Uint8Array, o: number) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);

interface Box { type: string; start: number; size: number; hdr: number } // start/size: whole box within its buffer
function children(u: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [], dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let o = from;
  while (o + 8 <= to) {
    let size = dv.getUint32(o), hdr = 8;
    const type = str4(u, o + 4);
    if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = to - o;
    if (size < hdr || o + size > to) break;
    out.push({ type, start: o, size, hdr });
    o += size;
  }
  return out;
}
const find = (u: Uint8Array, b: Box, type: string) => children(u, b.start + b.hdr, b.start + b.size).find(c => c.type === type);
const path = (u: Uint8Array, b: Box | undefined, ...types: string[]) => { for (const t of types) { if (!b) return undefined; b = find(u, b, t); } return b; };

/** the top-level boxes of the file, read from their headers only */
async function topLevel(file: Blob): Promise<{ type: string; start: number; size: number }[]> {
  const out: { type: string; start: number; size: number }[] = [];
  let o = 0;
  while (o + 8 <= file.size) {
    const h = await readBytes(file, o, 16), dv = new DataView(h.buffer);
    let size = dv.getUint32(0);
    const type = str4(h, 4);
    if (size === 1) size = Number(dv.getBigUint64(8)); else if (size === 0) size = file.size - o;
    if (size < 8) break;
    out.push({ type, start: o, size });
    o += size;
  }
  return out;
}

interface Track {
  kind: 'vide' | 'soun';
  timescale: number;
  /** presentation shift in seconds from the source's edit list: time = (pts - mediaTime)/timescale + empty */
  mediaTime: number; empty: number;
  dts: Float64Array; cto: Int32Array; dur: Uint32Array; size: Uint32Array; off: Float64Array; sync: Uint8Array | null;
  raw: { tkhd: Uint8Array; hdlr: Uint8Array; mhd: Uint8Array | null; dinf: Uint8Array | null; stsd: Uint8Array; language: number };
  width: number; height: number; matrix: Uint8Array; trackId: number; volume: number;
}

export interface Movie { file: Blob; ftyp: Uint8Array | null; movieTs: number; video: Track; audio: Track | null; duration: number; type: string }

function parseTrack(u: Uint8Array, trak: Box, movieTs: number): Track | null {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const mdia = find(u, trak, 'mdia'), hdlr = mdia && find(u, mdia, 'hdlr'), mdhd = mdia && find(u, mdia, 'mdhd');
  if (!mdia || !hdlr || !mdhd) return null;
  const kind = str4(u, hdlr.start + hdlr.hdr + 8);
  if (kind !== 'vide' && kind !== 'soun') return null;
  const minf = find(u, mdia, 'minf'), stbl = minf && find(u, minf, 'stbl');
  const tkhd = find(u, trak, 'tkhd');
  if (!stbl || !tkhd) return null;
  const sub = (b: Box) => u.slice(b.start, b.start + b.size);
  const box = (t: string) => find(u, stbl, t);

  const mv = u[mdhd.start + mdhd.hdr], mb = mdhd.start + mdhd.hdr + 4;
  const timescale = dv.getUint32(mb + (mv === 1 ? 16 : 8));
  const language = dv.getUint16(mb + (mv === 1 ? 28 : 16));

  const tv = u[tkhd.start + tkhd.hdr], tb = tkhd.start + tkhd.hdr + 4;
  const trackId = dv.getUint32(tb + (tv === 1 ? 16 : 8));
  const after = tb + (tv === 1 ? 32 : 20); // reserved(8) layer(2) group(2) volume(2) reserved(2) matrix(36) w(4) h(4)
  const volume = dv.getUint16(after + 12);
  const matrix = u.slice(after + 16, after + 52);
  const width = dv.getUint32(after + 52) / 65536, height = dv.getUint32(after + 56) / 65536;

  // edit list: first empty edits shift the start, the first real edit says where the media starts
  let mediaTime = 0, empty = 0;
  const elst = path(u, trak, 'edts', 'elst');
  if (elst) {
    const ev = u[elst.start + elst.hdr], n = dv.getUint32(elst.start + elst.hdr + 4);
    let o = elst.start + elst.hdr + 8;
    for (let i = 0; i < n; i++) {
      const segDur = ev === 1 ? Number(dv.getBigUint64(o)) : dv.getUint32(o);
      const mt = ev === 1 ? Number(dv.getBigInt64(o + 8)) : dv.getInt32(o + 4);
      o += ev === 1 ? 20 : 12;
      if (mt === -1) { empty += segDur / movieTs; continue; }
      mediaTime = mt; break;
    }
  }

  // sample tables
  const stsz = box('stsz'), stz2 = box('stz2'), stts = box('stts'), stsc = box('stsc'), stco = box('stco') || box('co64');
  const stsd = box('stsd');
  if (!stts || !stsc || !stco || !stsd || (!stsz && !stz2)) return null;
  let n: number, size: Uint32Array;
  if (stsz) {
    const b = stsz.start + stsz.hdr + 4, fixed = dv.getUint32(b);
    n = dv.getUint32(b + 4); size = new Uint32Array(n);
    for (let i = 0; i < n; i++) size[i] = fixed || dv.getUint32(b + 8 + i * 4);
  } else {
    const b = stz2!.start + stz2!.hdr + 4, bits = u[b + 3];
    n = dv.getUint32(b + 4); size = new Uint32Array(n);
    for (let i = 0; i < n; i++) size[i] = bits === 16 ? dv.getUint16(b + 8 + i * 2) : bits === 8 ? u[b + 8 + i] : (u[b + 8 + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15;
  }
  const dts = new Float64Array(n), dur = new Uint32Array(n), cto = new Int32Array(n), off = new Float64Array(n);
  { // stts
    const b = stts.start + stts.hdr + 4, e = dv.getUint32(b);
    let i = 0, t = 0;
    for (let k = 0; k < e && i < n; k++) {
      const c = dv.getUint32(b + 4 + k * 8), d = dv.getUint32(b + 8 + k * 8);
      for (let j = 0; j < c && i < n; j++, i++) { dts[i] = t; dur[i] = d; t += d; }
    }
  }
  const ctts = box('ctts');
  if (ctts) {
    const b = ctts.start + ctts.hdr + 4, e = dv.getUint32(b);
    let i = 0;
    for (let k = 0; k < e && i < n; k++) {
      const c = dv.getUint32(b + 4 + k * 8), v = dv.getInt32(b + 8 + k * 8); // v0 is unsigned, but real values fit
      for (let j = 0; j < c && i < n; j++, i++) cto[i] = v;
    }
  }
  { // chunk offsets via stsc
    const is64 = stco.type === 'co64', cb = stco.start + stco.hdr + 4, chunks = dv.getUint32(cb);
    const co = (k: number) => (is64 ? Number(dv.getBigUint64(cb + 4 + k * 8)) : dv.getUint32(cb + 4 + k * 4));
    const sb = stsc.start + stsc.hdr + 4, se = dv.getUint32(sb);
    let i = 0;
    for (let k = 0; k < se; k++) {
      const first = dv.getUint32(sb + 4 + k * 12) - 1, per = dv.getUint32(sb + 8 + k * 12);
      const last = k + 1 < se ? dv.getUint32(sb + 4 + (k + 1) * 12) - 1 : chunks;
      for (let c = first; c < last && i < n; c++) {
        let o = co(c);
        for (let j = 0; j < per && i < n; j++, i++) { off[i] = o; o += size[i]; }
      }
    }
  }
  let sync: Uint8Array | null = null;
  const stss = box('stss');
  if (stss) {
    sync = new Uint8Array(n);
    const b = stss.start + stss.hdr + 4, e = dv.getUint32(b);
    for (let k = 0; k < e; k++) { const s = dv.getUint32(b + 4 + k * 4) - 1; if (s < n) sync[s] = 1; }
  }
  const mhd = minf && (find(u, minf, 'vmhd') || find(u, minf, 'smhd'));
  const dinf = minf && find(u, minf, 'dinf');
  return {
    kind, timescale, mediaTime, empty, dts, cto, dur, size, off, sync,
    raw: { tkhd: sub(tkhd), hdlr: sub(hdlr), mhd: mhd ? sub(mhd) : null, dinf: dinf ? sub(dinf) : null, stsd: sub(stsd), language },
    width, height, matrix, trackId, volume,
  };
}

/** time in seconds when sample i is shown */
const showAt = (t: Track, i: number) => (t.dts[i] + t.cto[i] - t.mediaTime) / t.timescale + t.empty;
const isSync = (t: Track, i: number) => !t.sync || t.sync[i] === 1;

export async function readMovie(file: Blob): Promise<Movie> {
  const top = await topLevel(file);
  const moovB = top.find(b => b.type === 'moov');
  if (!moovB) throw new Error('영상 정보(moov)를 찾지 못했어요');
  if (moovB.size > 200 * 1024 * 1024) throw new Error('영상 정보가 너무 커요');
  const u = await readBytes(file, moovB.start, moovB.size);
  const root: Box = { type: 'moov', start: 0, size: u.length, hdr: moovB.size > 0xffffffff ? 16 : 8 };
  const dv = new DataView(u.buffer);
  const mvhd = find(u, root, 'mvhd');
  const movieTs = mvhd ? dv.getUint32(mvhd.start + mvhd.hdr + 4 + (u[mvhd.start + mvhd.hdr] === 1 ? 16 : 8)) : 1000;
  const tracks = children(u, root.hdr, u.length).filter(b => b.type === 'trak').map(b => parseTrack(u, b, movieTs)).filter((t): t is Track => !!t && t.size.length > 0);
  const video = tracks.find(t => t.kind === 'vide');
  if (!video) throw new Error('영상 트랙이 없어요');
  const audio = tracks.find(t => t.kind === 'soun') || null;
  const ftypB = top.find(b => b.type === 'ftyp');
  const ftyp = ftypB && ftypB.size < 4096 ? await readBytes(file, ftypB.start, ftypB.size) : null;
  let end = 0;
  for (let i = 0; i < video.dts.length; i++) end = Math.max(end, showAt(video, i) + video.dur[i] / video.timescale);
  const brand = ftyp ? str4(ftyp, 8) : '';
  const type = file.type || (brand === 'qt  ' ? 'video/quicktime' : 'video/mp4');
  return { file, ftyp, movieTs, video, audio, duration: end, type };
}

/* ---------- writing ---------- */
class W {
  buf = new Uint8Array(1 << 16); n = 0;
  private dv = new DataView(this.buf.buffer);
  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    let c = this.buf.length * 2; while (c < this.n + k) c *= 2;
    const b = new Uint8Array(c); b.set(this.buf.subarray(0, this.n)); this.buf = b; this.dv = new DataView(b.buffer);
  }
  u8(v: number) { this.room(1); this.buf[this.n++] = v; return this; }
  u16(v: number) { this.room(2); this.dv.setUint16(this.n, v); this.n += 2; return this; }
  u32(v: number) { this.room(4); this.dv.setUint32(this.n, v >>> 0); this.n += 4; return this; }
  i32(v: number) { this.room(4); this.dv.setInt32(this.n, v); this.n += 4; return this; }
  u64(v: number) { this.room(8); this.dv.setBigUint64(this.n, BigInt(Math.round(v))); this.n += 8; return this; }
  bytes(b: Uint8Array) { this.room(b.length); this.buf.set(b, this.n); this.n += b.length; return this; }
  str(s: string) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); return this; }
  zeros(k: number) { this.room(k); this.buf.fill(0, this.n, this.n + k); this.n += k; return this; }
  box(type: string, body: (w: W) => void, full?: { v: number; f: number }) {
    const at = this.n; this.u32(0).str(type);
    if (full) this.u32((full.v << 24) | full.f);
    body(this);
    this.dv.setUint32(at, this.n - at);
    return this;
  }
  out() { return this.buf.slice(0, this.n); }
}
const IDENTITY = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0]);

interface Kept { t: Track; from: number; to: number; base: number; mediaTime: number; showLen: number; offsets: number[] }

function writeTrak(w: W, k: Kept, movieTs: number, newId: number) {
  const { t } = k, n = k.to - k.from;
  const mediaDur = t.dts[k.to - 1] + t.dur[k.to - 1] - k.base;
  const segDur = Math.round(k.showLen * movieTs);
  w.box('trak', w => {
    w.box('tkhd', w => {
      w.u32(0).u32(0).u32(newId).u32(0).u32(segDur).zeros(8).u16(0).u16(0).u16(t.kind === 'soun' ? t.volume || 0x0100 : 0).u16(0)
        .bytes(t.kind === 'vide' ? t.matrix : IDENTITY).u32(Math.round(t.width * 65536)).u32(Math.round(t.height * 65536));
    }, { v: 0, f: 3 });
    w.box('edts', w => w.box('elst', w => { w.u32(1).u32(segDur).i32(k.mediaTime).u32(0x00010000); }, { v: 0, f: 0 }));
    w.box('mdia', w => {
      w.box('mdhd', w => { w.u32(0).u32(0).u32(t.timescale).u32(mediaDur).u16(t.raw.language).u16(0); }, { v: 0, f: 0 });
      w.bytes(t.raw.hdlr);
      w.box('minf', w => {
        if (t.raw.mhd) w.bytes(t.raw.mhd);
        else if (t.kind === 'vide') w.box('vmhd', w => w.zeros(8), { v: 0, f: 1 }); else w.box('smhd', w => w.zeros(4), { v: 0, f: 0 });
        if (t.raw.dinf) w.bytes(t.raw.dinf);
        else w.box('dinf', w => w.box('dref', w => { w.u32(1).box('url ', () => {}, { v: 0, f: 1 }); }, { v: 0, f: 0 }));
        w.box('stbl', w => {
          w.bytes(t.raw.stsd);
          // stts: run-length durations
          const runs: [number, number][] = [];
          for (let i = k.from; i < k.to; i++) { const d = t.dur[i], r = runs[runs.length - 1]; if (r && r[1] === d) r[0]++; else runs.push([1, d]); }
          w.box('stts', w => { w.u32(runs.length); runs.forEach(([c, d]) => w.u32(c).u32(d)); }, { v: 0, f: 0 });
          let anyCto = false, neg = false;
          for (let i = k.from; i < k.to; i++) { if (t.cto[i]) anyCto = true; if (t.cto[i] < 0) neg = true; }
          if (anyCto) {
            const cr: [number, number][] = [];
            for (let i = k.from; i < k.to; i++) { const c = t.cto[i], r = cr[cr.length - 1]; if (r && r[1] === c) r[0]++; else cr.push([1, c]); }
            w.box('ctts', w => { w.u32(cr.length); cr.forEach(([c, v]) => w.u32(c).i32(v)); }, { v: neg ? 1 : 0, f: 0 });
          }
          if (t.sync) {
            const s: number[] = [];
            for (let i = k.from; i < k.to; i++) if (t.sync[i]) s.push(i - k.from + 1);
            w.box('stss', w => { w.u32(s.length); s.forEach(v => w.u32(v)); }, { v: 0, f: 0 });
          }
          w.box('stsc', w => { w.u32(1).u32(1).u32(1).u32(1); }, { v: 0, f: 0 }); // one sample per chunk
          w.box('stsz', w => { w.u32(0).u32(n); for (let i = k.from; i < k.to; i++) w.u32(t.size[i]); }, { v: 0, f: 0 });
          w.box('co64', w => { w.u32(n); k.offsets.forEach(o => w.u64(o)); }, { v: 0, f: 0 });
        });
      });
    });
  });
}

function writeMoov(m: Movie, kept: Kept[], showLen: number): Uint8Array {
  const w = new W();
  w.box('moov', w => {
    w.box('mvhd', w => {
      w.u32(0).u32(0).u32(m.movieTs).u32(Math.round(showLen * m.movieTs)).u32(0x00010000).u16(0x0100).zeros(10)
        .bytes(IDENTITY).zeros(24).u32(kept.length + 1);
    }, { v: 0, f: 0 });
    kept.forEach((k, i) => writeTrak(w, k, m.movieTs, i + 1));
  });
  return w.out();
}

/**
 * The last `seconds` of the movie as a new file (or the whole movie when `seconds` is null or not shorter).
 * Returns the blob and its real length in seconds.
 */
export function cutLast(m: Movie, seconds: number | null): { blob: Blob; len: number } {
  const v = m.video, nv = v.dts.length;
  if (seconds === null || seconds >= m.duration - 0.5) return { blob: m.file, len: m.duration };
  const target = m.duration - seconds;
  // the key frame at or before the start (decode order), else the first one
  let K = -1;
  for (let i = 0; i < nv; i++) if (isSync(v, i) && showAt(v, i) <= target + 1e-6) K = i;
  if (K < 0) K = 0;
  const start = Math.max(showAt(v, K), Math.min(target, m.duration)); // exact start hidden behind the edit list
  const startKey = showAt(v, K);
  const showLen = m.duration - start;

  const vk: Kept = { t: v, from: K, to: nv, base: v.dts[K], mediaTime: 0, showLen, offsets: [] };
  // media time where the shown part starts, in the new track's time (dts of K becomes 0)
  vk.mediaTime = Math.round((start - startKey) * v.timescale + v.cto[K]);
  const kept: Kept[] = [vk];

  const a = m.audio;
  if (a) {
    const na = a.dts.length;
    let J = 0;
    for (let j = 0; j < na; j++) if (showAt(a, j) <= start + 1e-6) J = j; else break;
    let end = J;
    while (end < na && showAt(a, end) < m.duration) end++;
    if (end > J) {
      const ak: Kept = { t: a, from: J, to: end, base: a.dts[J], mediaTime: 0, showLen: 0, offsets: [] };
      ak.mediaTime = Math.max(0, Math.round((start - showAt(a, J)) * a.timescale));
      const aEnd = showAt(a, end - 1) + a.dur[end - 1] / a.timescale;
      ak.showLen = Math.max(0, Math.min(aEnd, m.duration) - start);
      kept.push(ak);
    }
  }

  // one span of the source covers every kept sample; bytes in between that we don't use are just ignored
  let spanStart = Infinity, spanEnd = 0;
  for (const k of kept) for (let i = k.from; i < k.to; i++) { spanStart = Math.min(spanStart, k.t.off[i]); spanEnd = Math.max(spanEnd, k.t.off[i] + k.t.size[i]); }

  const ftyp = m.ftyp || new W().box('ftyp', w => { w.str('isom').u32(0x200).str('isom').str('iso2').str('mp41'); }).out();
  const mdatHdr = 16;
  const fill = (dataStart: number) => kept.forEach(k => { k.offsets = []; for (let i = k.from; i < k.to; i++) k.offsets.push(dataStart + (k.t.off[i] - spanStart)); });
  fill(0);
  const moovLen = writeMoov(m, kept, showLen).length; // offsets are fixed-width, so the size doesn't change
  fill(ftyp.length + moovLen + mdatHdr);
  const moov = writeMoov(m, kept, showLen);
  const span = spanEnd - spanStart;
  const mdat = new W(); mdat.u32(1).str('mdat').u64(mdatHdr + span);
  const blob = new Blob([ftyp as BlobPart, moov as BlobPart, mdat.out() as BlobPart, m.file.slice(spanStart, spanEnd)], { type: m.type });
  return { blob, len: showLen };
}
