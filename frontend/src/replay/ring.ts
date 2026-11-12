import { isAnnexB, muxClip, nalType, splitAnnexB, type MuxInput } from './mux';

/**
 * Exact replay buffer built on WebCodecs.
 *
 * Camera frames are encoded to H.264 with a key frame every second and kept in memory for the longest length the
 * user can pick (plus a little slack). Saving `len` seconds takes the chunks from the key frame at "now − len" up to
 * now and wraps them in an MP4, so a clip is the last `len` seconds (to within one second). No re-encoding.
 * Audio is added when the browser can encode AAC; otherwise clips are silent.
 */
interface VChunk { chunk: EncodedVideoChunk; ts: number; key: boolean }
/** ts: what the encoder says; rt: when it arrived on our clock (used when the encoder's times look wrong) */
interface AChunk { chunk: EncodedAudioChunk; ts: number; rt: number }

const KEY_EVERY_US = 1_000_000;
const SLACK_S = 3;
// H.264 first (plays everywhere, incl. iPhone); VP9 for browsers without an H.264 encoder (e.g. Chromium on Linux)
const CODECS: { codec: string; kind: 'avc' | 'vp9' }[] = [
  ...['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f'].map(codec => ({ codec, kind: 'avc' as const })),
  { codec: 'vp09.00.40.08', kind: 'vp9' }, { codec: 'vp09.00.31.08', kind: 'vp9' },
];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
type Rot = 0 | 90 | 180 | 270;
/** clockwise rotation the frame wants on display (newer WebCodecs); 0 when the browser doesn't say */
const frameRot = (f: VideoFrame): Rot => { const r = (((f as VideoFrame & { rotation?: number }).rotation || 0) % 360 + 360) % 360; return (r === 90 || r === 180 || r === 270 ? r : 0) as Rot; };
/** the pixel size as stored (before any rotation) */
const pixelSize = (f: VideoFrame) => ({ w: even(f.visibleRect?.width || f.displayWidth), h: even(f.visibleRect?.height || f.displayHeight) });

export function exactSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
}

async function pickCodec(width: number, height: number, bitrate: number): Promise<{ cfg: VideoEncoderConfig; kind: 'avc' | 'vp9' } | null> {
  for (const { codec, kind } of CODECS) {
    const cfg: VideoEncoderConfig = { codec, width, height, bitrate, framerate: 30, latencyMode: 'realtime', ...(kind === 'avc' ? { avc: { format: 'avc' as const } } : {}) };
    try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, kind }; } catch { /* try next */ }
  }
  return null;
}

/** true when this browser can H.264-encode at roughly this size — checked before choosing the exact mode */
export async function canEncode(height: number, bitrate: number): Promise<boolean> {
  if (!exactSupported()) return false;
  return !!(await pickCodec(even((height * 16) / 9), even(height), bitrate));
}

export class ExactRing {
  private v: VChunk[] = [];
  private a: AChunk[] = [];
  private vDecoder: VideoDecoderConfig | undefined;
  private aDecoder: AudioDecoderConfig | undefined;
  private venc: VideoEncoder | null = null;
  private aenc: AudioEncoder | null = null;
  private width = 0;
  private height = 0;
  /** rotation written into the MP4 so players show it upright */
  private rotation: Rot = 0;
  private vKind: 'avc' | 'vp9' = 'avc';
  private vCodec = '';
  private paramSets: { sps: Uint8Array; pps: Uint8Array } | undefined;
  private aKind: 'aac' | 'opus' = 'aac';
  private t0 = 0;
  private lastKey = -Infinity;
  private configuring: Promise<void> | null = null;
  private stops: (() => void)[] = [];
  private failed: ((e: unknown) => void) | null = null;
  audio = false;
  sampleRate = 48000;

  constructor(private stream: MediaStream, private len: () => number, private bitrate: number, onFail: (e: unknown) => void) {
    this.failed = onFail;
  }

  /** seconds of footage a save would return right now */
  buffered(): number {
    const k = this.v.find(c => c.key);
    if (!k || !this.v.length) return 0;
    return Math.min(this.len(), (this.v[this.v.length - 1].ts - k.ts) / 1e6);
  }

  async start(withAudio: boolean) {
    this.t0 = performance.now();
    this.startVideo();
    if (withAudio && this.stream.getAudioTracks().length) await this.startAudio().catch(() => { this.audio = false; });
  }

  stop() {
    this.stops.forEach(f => { try { f(); } catch { /* ignore */ } });
    this.stops = [];
    try { if (this.venc && this.venc.state !== 'closed') this.venc.close(); } catch { /* ignore */ }
    try { if (this.aenc && this.aenc.state !== 'closed') this.aenc.close(); } catch { /* ignore */ }
    this.venc = null; this.aenc = null; this.v = []; this.a = [];
    this.failed = null;
  }

  private now() { return Math.round((performance.now() - this.t0) * 1000); }

  /* ---------- video ---------- */
  private startVideo() {
    const track = this.stream.getVideoTracks()[0];
    const W = window as unknown as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> } };
    if (W.MediaStreamTrackProcessor) {
      // Chrome / Android: frames straight from the camera track
      const reader = new W.MediaStreamTrackProcessor({ track }).readable.getReader();
      let alive = true;
      this.stops.push(() => { alive = false; reader.cancel().catch(() => {}); });
      (async () => {
        while (alive) {
          const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
          if (done || !value) break;
          this.onFrame(value);
        }
      })();
      return;
    }
    // Safari: grab frames from a (practically invisible) playing <video>
    const vid = document.createElement('video');
    vid.muted = true; vid.playsInline = true; vid.autoplay = true;
    vid.setAttribute('playsinline', '');
    Object.assign(vid.style, { position: 'fixed', left: '0', bottom: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
    vid.srcObject = this.stream;
    document.body.appendChild(vid);
    vid.play().catch(() => {});
    let alive = true;
    let canvas: HTMLCanvasElement | null = null, ctx: CanvasRenderingContext2D | null = null;
    const grab = () => {
      if (!alive) return;
      if (vid.readyState >= 2 && vid.videoWidth) {
        try {
          const ts = this.now();
          let f = new VideoFrame(vid, { timestamp: ts });
          // iPhone cameras deliver landscape pixels and rotate them for display. If the frame doesn't say so
          // (no rotation) but its shape differs from what the <video> shows, redraw it upright through a canvas.
          const vw = vid.videoWidth, vh = vid.videoHeight, px = pixelSize(f);
          if (!frameRot(f) && (px.w > px.h) !== (vw > vh)) {
            f.close();
            if (!canvas) { canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); }
            if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }
            ctx!.drawImage(vid, 0, 0, vw, vh);
            f = new VideoFrame(canvas, { timestamp: ts });
          }
          this.onFrame(f);
        } catch { /* frame not ready */ }
      }
    };
    const rvfc = (vid as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
    if (rvfc) {
      const loop = () => { grab(); if (alive) rvfc.call(vid, loop); };
      rvfc.call(vid, loop);
    } else {
      const iv = setInterval(grab, 1000 / 30);
      this.stops.push(() => clearInterval(iv));
    }
    this.stops.push(() => { alive = false; vid.srcObject = null; vid.remove(); });
  }

  private onFrame(frame: VideoFrame) {
    const { w, h } = pixelSize(frame), rot = frameRot(frame);
    if (!this.venc || w !== this.width || h !== this.height || rot !== this.rotation) {
      // first frame, or the phone was turned: (re)start the encoder at the new size and drop older footage
      if (!this.configuring) this.configuring = this.configure(w, h, rot).finally(() => { this.configuring = null; });
      frame.close(); return;
    }
    if (this.venc.state !== 'configured' || this.venc.encodeQueueSize > 4) { frame.close(); return; } // device busy: skip a frame
    const ts = this.now();
    let f: VideoFrame = frame;
    try {
      f = new VideoFrame(frame, { timestamp: ts });
      frame.close();
      const key = ts - this.lastKey >= KEY_EVERY_US;
      if (key) this.lastKey = ts;
      this.venc.encode(f, { keyFrame: key });
    } catch (e) { this.failed?.(e); }
    finally { f.close(); }
  }

  private async configure(w: number, h: number, rot: Rot) {
    const picked = await pickCodec(w, h, this.bitrate);
    if (!picked) { this.failed?.(new Error('no supported video encoder at ' + w + 'x' + h)); return; }
    const cfg = picked.cfg; this.vKind = picked.kind; this.vCodec = cfg.codec;
    try { if (this.venc && this.venc.state !== 'closed') this.venc.close(); } catch { /* ignore */ }
    this.v = []; this.vDecoder = undefined; this.paramSets = undefined; this.lastKey = -Infinity;
    this.width = w; this.height = h; this.rotation = rot;
    const enc = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig) this.vDecoder = meta.decoderConfig;
        if (this.vKind === 'avc' && chunk.type === 'key' && !this.vDecoder?.description) {
          // Annex B encoders (some Safari versions): remember SPS/PPS, they may only come with the first frame
          const u = new Uint8Array(chunk.byteLength); chunk.copyTo(u);
          if (isAnnexB(u)) {
            const nals = splitAnnexB(u), sps = nals.find(n => nalType(n) === 7), pps = nals.find(n => nalType(n) === 8);
            if (sps && pps) this.paramSets = { sps: sps.slice(), pps: pps.slice() };
          }
        }
        this.v.push({ chunk, ts: chunk.timestamp, key: chunk.type === 'key' });
        this.trim();
      },
      error: e => this.failed?.(e),
    });
    enc.configure(cfg);
    this.venc = enc;
  }

  /** keep the newest key frame that is at least len+slack seconds old, and everything after it */
  private trim() {
    if (!this.v.length) return;
    const cutoff = this.v[this.v.length - 1].ts - (this.len() + SLACK_S) * 1e6;
    let keep = 0;
    for (let i = 0; i < this.v.length; i++) { if (this.v[i].ts > cutoff) break; if (this.v[i].key) keep = i; }
    if (keep > 0) this.v.splice(0, keep);
    const vStart = this.v[0].ts - 500_000;
    let ai = 0; while (ai < this.a.length && this.a[ai].rt < vStart) ai++;
    if (ai) this.a.splice(0, ai);
  }

  /* ---------- audio (AAC via AudioWorklet → AudioEncoder) ---------- */
  private async startAudio() {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return;
    const ctx = new AudioContext();
    this.sampleRate = ctx.sampleRate;
    // AAC plays everywhere; Opus only where AAC can't be encoded (not on iPhone, which has AAC)
    let cfg: AudioEncoderConfig | null = null;
    for (const [codec, kind] of [['mp4a.40.2', 'aac'], ['opus', 'opus']] as const) {
      const c: AudioEncoderConfig = { codec, sampleRate: this.sampleRate, numberOfChannels: 1, bitrate: 96000 };
      if (await AudioEncoder.isConfigSupported(c).then(r => !!r.supported, () => false)) { cfg = c; this.aKind = kind; break; }
    }
    if (!cfg) { await ctx.close(); return; }
    const enc = new AudioEncoder({
      output: (chunk, meta) => { if (meta?.decoderConfig) this.aDecoder = meta.decoderConfig; this.a.push({ chunk, ts: chunk.timestamp, rt: this.now() }); },
      error: () => { this.audio = false; },
    });
    enc.configure(cfg);
    this.aenc = enc;
    const src = `class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}
      process(i){const c=i[0]&&i[0][0];if(c){if(this.n+c.length>this.b.length){this.port.postMessage(this.b.slice(0,this.n));this.n=0}
      this.b.set(c,this.n);this.n+=c.length}return true}}registerProcessor('betalog-tap',P)`;
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, 'betalog-tap');
    const input = ctx.createMediaStreamSource(this.stream);
    input.connect(node);
    const mute = ctx.createGain(); mute.gain.value = 0; node.connect(mute); mute.connect(ctx.destination); // keep the graph pulling
    let samples = 0, startUs = -1;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.aenc || this.aenc.state !== 'configured') return;
      if (startUs < 0) startUs = this.now() - Math.round((e.data.length / this.sampleRate) * 1e6);
      const ts = startUs + Math.round((samples / this.sampleRate) * 1e6);
      samples += e.data.length;
      try {
        const d = new AudioData({ format: 'f32-planar', sampleRate: this.sampleRate, numberOfFrames: e.data.length, numberOfChannels: 1, timestamp: ts, data: e.data });
        this.aenc.encode(d); d.close();
      } catch { /* drop */ }
    };
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    this.audio = true;
    this.stops.push(() => { node.port.onmessage = null; input.disconnect(); node.disconnect(); ctx.close().catch(() => {}); });
  }

  /* ---------- save ---------- */
  /**
   * The last `len` seconds as an MP4. Throws with a readable reason when muxing fails;
   * if it only fails because of the audio, retries without sound (dropped = true).
   */
  save(len: number): { blob: Blob; len: number; dropped: boolean } | null {
    if (!this.v.length) return null;
    const last = this.v[this.v.length - 1].ts, cutoff = last - len * 1e6;
    let start = -1;
    for (let i = 0; i < this.v.length; i++) { if (this.v[i].key && this.v[i].ts <= cutoff) start = i; }
    if (start < 0) start = this.v.findIndex(c => c.key);
    if (start < 0) return null;
    const vids = this.v.slice(start);
    const t0 = vids[0].ts;
    const copy = (c: EncodedVideoChunk | EncodedAudioChunk) => { const u = new Uint8Array(c.byteLength); c.copyTo(u); return u; };
    const video: MuxInput['video'] = {
      kind: this.vKind, width: this.width, height: this.height, rotation: this.rotation,
      decoderConfig: this.vDecoder || { codec: this.vCodec }, paramSets: this.paramSets,
      samples: vids.map(c => ({ data: copy(c.chunk), ts: c.ts, key: c.key })),
    };
    const sel = this.audio ? this.a.filter(c => c.rt >= t0 && c.rt <= last + 500_000) : [];
    const audio: MuxInput['audio'] = sel.length ? {
      kind: this.aKind, sampleRate: this.sampleRate, channels: 1, decoderConfig: this.aDecoder,
      // the first sample anchors the audio; trust the encoder's time only if it is close to when it arrived
      samples: sel.map((c, i) => ({ data: copy(c.chunk), key: true, dur: c.chunk.duration ?? undefined,
        ts: i === 0 ? (Math.abs(c.ts - c.rt) < 2e6 ? c.ts : c.rt - 100_000) : c.ts })),
    } : undefined;
    let bytes: Uint8Array, dropped = false;
    try { bytes = muxClip({ video, audio }); }
    catch (e) {
      if (!audio) throw e;
      console.warn('mux with audio failed, saving without sound', e);
      bytes = muxClip({ video }); dropped = true;
    }
    return { blob: new Blob([bytes], { type: 'video/mp4' }), len: (last - t0) / 1e6, dropped };
  }
}
