import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

/**
 * Turns encoded samples into an MP4. Kept free of WebCodecs types so it can be tested outside a browser.
 *
 * It does not trust encoder timestamps: video keeps its capture times but is forced to increase, audio gets
 * evenly spaced times from its frame length. It also copes with encoders that hand out H.264 as Annex B
 * (start codes, no avcC) or AAC with ADTS headers / without an AudioSpecificConfig, as some Safari versions do.
 */
export interface RawSample { data: Uint8Array; ts: number; key: boolean; dur?: number }
export interface MuxInput {
  /** paramSets: the latest H.264 SPS/PPS seen, for encoders that only send them once (they may be outside the window) */
  video: { kind: 'avc' | 'vp9'; width: number; height: number; rotation?: 0 | 90 | 180 | 270; decoderConfig: VideoDecoderConfig; samples: RawSample[]; paramSets?: { sps: Uint8Array; pps: Uint8Array } };
  audio?: { kind: 'aac' | 'opus'; sampleRate: number; channels: number; decoderConfig?: AudioDecoderConfig; samples: RawSample[] };
}

/* ---------- H.264 helpers ---------- */
export const isAnnexB = (b: Uint8Array) => b.length > 4 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || (b[2] === 0 && b[3] === 1));

export function splitAnnexB(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let i = 0, start = -1;
  while (i + 2 < b.length) {
    if (b[i] === 0 && b[i + 1] === 0 && (b[i + 2] === 1 || (b[i + 2] === 0 && i + 3 < b.length && b[i + 3] === 1))) {
      if (start >= 0) out.push(b.subarray(start, i));
      i += b[i + 2] === 1 ? 3 : 4;
      start = i;
    } else i++;
  }
  if (start >= 0 && start < b.length) out.push(b.subarray(start));
  // a NAL can't end in zero bytes that belong to the next start code
  return out.map(n => { let e = n.length; while (e > 0 && n[e - 1] === 0) e--; return n.subarray(0, e); }).filter(n => n.length);
}
export const nalType = (n: Uint8Array) => n[0] & 0x1f;

function toLengthPrefixed(nals: Uint8Array[]): Uint8Array {
  const keep = nals.filter(n => { const t = nalType(n); return t !== 7 && t !== 8 && t !== 9; }); // SPS/PPS go to avcC, drop AUD
  const out = new Uint8Array(keep.reduce((a, n) => a + 4 + n.length, 0));
  let o = 0;
  for (const n of keep) { new DataView(out.buffer).setUint32(o, n.length); out.set(n, o + 4); o += 4 + n.length; }
  return out;
}

export function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + sps.length + pps.length);
  out.set([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 0xff], 0);
  out.set(sps, 8);
  out.set([1, pps.length >> 8, pps.length & 0xff], 8 + sps.length);
  out.set(pps, 11 + sps.length);
  return out;
}

/* ---------- AAC helpers ---------- */
const isAdts = (b: Uint8Array) => b.length > 7 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0;
const stripAdts = (b: Uint8Array) => (isAdts(b) ? b.subarray(b[1] & 1 ? 7 : 9) : b);
const FREQS = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
export function buildAacConfig(sampleRate: number, channels: number): Uint8Array {
  const fi = FREQS.indexOf(sampleRate);
  if (fi < 0) throw new Error('unsupported AAC sample rate ' + sampleRate);
  return new Uint8Array([(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (channels << 3)]); // AAC-LC
}

const hasBytes = (d: AllowSharedBufferSource | undefined) => !!d && (d as ArrayBufferLike).byteLength > 0;

export function muxClip(input: MuxInput): Uint8Array {
  const v = input.video;
  if (!v.samples.length) throw new Error('영상이 비어 있어요');
  let vConfig: VideoDecoderConfig = { ...v.decoderConfig };
  let vData = v.samples.map(s => s.data);

  if (v.kind === 'avc' && (isAnnexB(vData[0]) || !hasBytes(vConfig.description))) {
    const nalsPer = vData.map(d => (isAnnexB(d) ? splitAnnexB(d) : null));
    if (!hasBytes(vConfig.description)) {
      const all = nalsPer.flatMap(n => n || []);
      const sps = all.find(n => nalType(n) === 7) || v.paramSets?.sps, pps = all.find(n => nalType(n) === 8) || v.paramSets?.pps;
      if (!sps || !pps) throw new Error('영상 설정 정보(SPS/PPS)를 찾지 못했어요');
      vConfig = { ...vConfig, description: buildAvcC(sps, pps) };
    }
    vData = vData.map((d, i) => (nalsPer[i] ? toLengthPrefixed(nalsPer[i]!) : d));
  }

  // video times: capture times relative to the first frame, forced to increase
  const base = v.samples[0].ts;
  const vt: number[] = [];
  for (const s of v.samples) { const t = Math.max(0, s.ts - base); vt.push(vt.length && t <= vt[vt.length - 1] ? vt[vt.length - 1] + 1 : t); }
  const frameDur = vt.length > 1 ? (vt[vt.length - 1] - vt[0]) / (vt.length - 1) : 33333;
  const videoEnd = vt[vt.length - 1] + frameDur;

  // audio times: start where the first kept sample started, then one frame after another
  let aPrepared: { data: Uint8Array; t: number; d: number }[] = [];
  let aConfig: AudioDecoderConfig | undefined;
  const a = input.audio;
  if (a && a.samples.length) {
    const fd = (s: RawSample) => s.dur && s.dur > 0 ? s.dur : ((a.kind === 'aac' ? 1024 : 960) / a.sampleRate) * 1e6;
    let t = Math.max(0, a.samples[0].ts - base);
    for (const s of a.samples) {
      const d = fd(s);
      if (t >= videoEnd) break;
      aPrepared.push({ data: a.kind === 'aac' ? stripAdts(s.data) : s.data, t, d });
      t += d;
    }
    aConfig = { ...(a.decoderConfig || { codec: a.kind === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate: a.sampleRate, numberOfChannels: a.channels }) };
    if (a.kind === 'aac' && !hasBytes(aConfig.description)) aConfig.description = buildAacConfig(a.sampleRate, a.channels);
  } else aPrepared = [];

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: v.kind, width: v.width, height: v.height, rotation: v.rotation || 0 },
    audio: aPrepared.length && a ? { codec: a.kind, numberOfChannels: a.channels, sampleRate: a.sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'cross-track-offset',
  });
  vData.forEach((d, i) => {
    const dur = i + 1 < vt.length ? vt[i + 1] - vt[i] : frameDur;
    muxer.addVideoChunkRaw(d, v.samples[i].key ? 'key' : 'delta', vt[i], dur, i === 0 ? { decoderConfig: vConfig } : undefined);
  });
  aPrepared.forEach((s, i) => muxer.addAudioChunkRaw(s.data, 'key', s.t, s.d, i === 0 ? { decoderConfig: aConfig } : undefined));
  muxer.finalize();
  return new Uint8Array(target.buffer);
}
