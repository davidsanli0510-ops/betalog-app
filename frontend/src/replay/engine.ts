import { useSyncExternalStore } from 'react';
import { Clips } from './clips';
import { isApp, keepScreenOn, screenKeptOn } from '../native';
import { toast } from '../data/store';
import { ls } from '../data/util';
import { ExactRing, canEncode, exactSupported } from './ring';

/**
 * Replay buffer: the camera keeps recording, and "save" keeps exactly the last `len` seconds before the press.
 *
 * - exact mode (WebCodecs, see ring.ts): frames are encoded with a key frame every second and only the last
 *   `len` seconds stay in memory; a save cuts at the key frame `len` seconds back and writes an MP4.
 * - compat mode (browsers without WebCodecs): two MediaRecorders run staggered, one always holds between
 *   len and 2·len seconds, and save stops that one. It cannot cut exactly, so the UI says so.
 */
/** clip lengths the user picks when saving; the buffer always holds the longest one */
export const LENGTHS = [60, 90, 120] as const;
export const MAX_LEN = 120;
/** compat mode can't cut: it keeps one recorder between COMPAT_LEN and 2·COMPAT_LEN seconds old */
const COMPAT_LEN = 60;
export interface ReplayCfg { len: number; res: Res; audio: boolean; facing: 'environment' | 'user'; zoom?: number }
export type Res = 480 | 720 | 1080 | 2160;
export type ReplayStatus = 'off' | 'starting' | 'live' | 'paused';
export type ReplayMode = 'exact' | 'compat';
export interface ReplaySnap { status: ReplayStatus; error: string | null; saveError: string | null; mode: ReplayMode; single: boolean; silent: boolean; awake: boolean; startedAt: number; saving: boolean; buffered: number; streamId: number; cfg: ReplayCfg; zoom: number; zoomOptions: number[]; zoomBusy: boolean; can4k: boolean; actual: string }

const MIME = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  .find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) || '';
/** bitrates per height. Phone camera apps use ~16 Mbps at 1080p; these stay sharp while 2 minutes still fit in memory
 *  (1080p ≈ 150 MB, 4K ≈ 300 MB). */
const BPS = { 480: 2_000_000, 720: 5_000_000, 1080: 10_000_000, 2160: 20_000_000 } as const;
/** zoom steps offered like a phone camera app; only those the device can do are shown */
const ZOOM_STEPS = [1, 2, 3, 5];
const ULTRA_RE = /ultra ?wide|초광각|울트라|0\.5x/i;
type ZoomCaps = { min: number; max: number } | null;

/** where to turn the camera back on, for the browser actually in use */
function deniedHelp(): string {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isApp) return '카메라 권한이 꺼져 있어요. 폰 설정 → 애플리케이션 → 베타로그 → 권한에서 카메라와 마이크를 허용해 주세요.';
  if (ios) {
    const other = /CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS/.test(ua) ? 'Edge' : '';
    if (other) return `카메라가 막혀 있어요. 아이폰 설정 앱 → ${other} → 카메라와 마이크를 켠 뒤, 이 페이지를 새로고침하고 다시 눌러 주세요. 아이폰에서는 사파리로 여는 걸 추천해요.`;
    return '카메라가 막혀 있어요. 주소창 왼쪽 가가(aA) → 웹 사이트 설정 → 카메라와 마이크를 "허용"으로 바꾼 뒤 다시 눌러 주세요. 홈 화면에 추가한 앱이면 아이폰 설정 앱 → 앱 → Safari → 카메라도 확인해 주세요.';
  }
  if (/Android/.test(ua)) return '카메라가 막혀 있어요. 주소창 왼쪽 아이콘 → 권한에서 카메라와 마이크를 허용한 뒤 다시 눌러 주세요.';
  return '카메라가 막혀 있어요. 브라우저 주소창의 사이트 설정에서 카메라와 마이크를 허용한 뒤 다시 눌러 주세요.';
}

class Seg {
  rec: MediaRecorder | null = null; chunks: Blob[] = []; t0 = 0;
  constructor(private eng: ReplayEngine) {}
  start() {
    const chunks: Blob[] = []; this.chunks = chunks; this.t0 = performance.now();
    const opts: MediaRecorderOptions = { videoBitsPerSecond: BPS[this.eng.cfg.res], audioBitsPerSecond: 96000 };
    if (MIME) opts.mimeType = MIME;
    this.rec = new MediaRecorder(this.eng.stream!, opts);
    this.rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    this.rec.start(1000);
  }
  age() { return this.rec ? (performance.now() - this.t0) / 1000 : 0; }
  discard() { const r = this.rec; this.rec = null; try { if (r && r.state !== 'inactive') r.stop(); } catch { /* ignore */ } }
  finish(): Promise<{ blob: Blob; len: number }> {
    const r = this.rec!, chunks = this.chunks, len = this.age(); this.rec = null;
    return new Promise((res, rej) => {
      r.onstop = () => res({ blob: new Blob(chunks, { type: (r.mimeType || MIME || 'video/webm').split(';')[0] }), len });
      r.onerror = () => rej(new Error('recorder')); try { r.stop(); } catch (e) { rej(e); }
    });
  }
}

class ReplayEngine {
  cfg: ReplayCfg = (() => {
    const c = ls.get<ReplayCfg>('replayCfg', { len: 60, res: 1080, audio: true, facing: 'environment' });
    // one-time move to the sharper default (older versions started at 720p); 480p is no longer offered
    let res: Res = c.res === 480 ? 720 : c.res;
    if (!ls.get('resUp1', false)) { ls.set('resUp1', true); if (res === 720) res = 1080; }
    return { ...c, res, len: (LENGTHS as readonly number[]).includes(c.len) ? c.len : 60 };
  })();
  stream: MediaStream | null = null;
  private segs: Seg[] = [];
  private ring: ExactRing | null = null;
  private exactOk: boolean | null = null;
  private tick: ReturnType<typeof setInterval> | undefined;
  private hiddenAt = 0;
  private snap: ReplaySnap;
  private L = new Set<() => void>();
  private st = { status: 'off' as ReplayStatus, error: null as string | null, saveError: null as string | null, mode: 'exact' as ReplayMode, single: false, startedAt: 0, saving: false, streamId: 0, zoom: 1, zoomOptions: [1] as number[], zoomBusy: false, can4k: false, actual: '' };
  /** zoom range of the main camera track, and the ultra-wide lens (for 0.5×) if the browser shows it */
  private zoomCaps: ZoomCaps = null;
  private ultraId: string | null = null;
  private useUltra = false;

  constructor() {
    this.snap = this.make();
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }
  private make(): ReplaySnap {
    const o = this.byAge()[0];
    const buffered = this.ring ? this.ring.buffered() : o ? o.age() : 0;
    const silent = !!this.ring && this.cfg.audio && !this.ring.audio;
    return { ...this.st, silent, awake: screenKeptOn(), buffered, cfg: { ...this.cfg } };
  }
  private emit() { this.snap = this.make(); this.L.forEach(l => l()); }
  subscribe = (l: () => void) => { this.L.add(l); return () => { this.L.delete(l); }; };
  getSnap = () => this.snap;
  private byAge() { return this.segs.filter(s => s.rec).sort((a, b) => b.age() - a.age()); }

  setCfg(patch: Partial<ReplayCfg>) {
    const restart = this.stream && (('res' in patch && patch.res !== this.cfg.res) || ('audio' in patch && patch.audio !== this.cfg.audio) || ('facing' in patch && patch.facing !== this.cfg.facing));
    if ('facing' in patch && patch.facing !== this.cfg.facing) { patch = { ...patch, zoom: 1 }; this.useUltra = false; this.ultraId = null; }
    this.cfg = { ...this.cfg, ...patch }; ls.set('replayCfg', this.cfg); this.emit();
    if (restart) return this.restart();
    return Promise.resolve(true);
  }

  private getStream(audio: boolean) {
    const h = this.cfg.res;
    const video: MediaTrackConstraints & { zoom?: boolean } = { height: { ideal: h }, width: { ideal: Math.round((h * 16) / 9) }, frameRate: { ideal: 30, max: 30 } };
    if (this.useUltra && this.ultraId) video.deviceId = { exact: this.ultraId };
    else video.facingMode = { ideal: this.cfg.facing };
    // Chrome only hands out zoom control when it is asked for up front
    if ((navigator.mediaDevices.getSupportedConstraints?.() as Record<string, boolean> | undefined)?.zoom) video.zoom = true;
    return navigator.mediaDevices.getUserMedia({ video, audio });
  }
  async start(): Promise<boolean> {
    if (this.stream) return true;
    this.st.error = null;
    if (!window.isSecureContext) { this.st.error = '보안 연결(https) 주소나 앱에서만 카메라를 쓸 수 있어요.'; this.emit(); return false; }
    if (!navigator.mediaDevices?.getUserMedia || (typeof MediaRecorder === 'undefined' && !exactSupported())) { this.st.error = '이 브라우저는 카메라 녹화를 지원하지 않아요. 안드로이드는 크롬, 아이폰은 사파리 최신 버전을 쓰세요.'; this.emit(); return false; }
    this.st.status = 'starting'; this.emit();
    try {
      try { this.stream = await this.getStream(this.cfg.audio); }
      catch (e) {
        // the ultra-wide lens may have gone away: fall back to the normal camera once
        if (this.useUltra) { this.useUltra = false; this.cfg = { ...this.cfg, zoom: 1 }; return this.start(); }
        // the camera may be allowed while only the microphone was refused: record without sound
        if (!this.cfg.audio) throw e;
        this.stream = await this.getStream(false);
        toast('마이크 없이 녹화해요');
      }
    } catch (e) {
      const n = (e as Error).name;
      this.st.error = n === 'NotAllowedError' || n === 'SecurityError' ? deniedHelp()
        : n === 'NotFoundError' || n === 'OverconstrainedError' ? '쓸 수 있는 카메라를 찾지 못했어요.'
        : n === 'NotReadableError' ? '다른 앱이 카메라를 쓰고 있어요. 그 앱을 닫고 다시 시도해 주세요.'
        : `카메라를 열지 못했어요. (${n || '알 수 없는 오류'})`;
      this.st.status = 'off'; this.emit(); return false;
    }
    this.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.onStopped());
    this.st.streamId++; this.st.startedAt = this.st.startedAt || Date.now();
    await this.detectZoom();
    if (this.exactOk === null) this.exactOk = await canEncode(Math.min(this.cfg.res, 1080), BPS[1080]).catch(() => false);
    await this.detectRes();
    if (this.cfg.res === 2160 && !this.st.can4k) {
      // 4K was picked on another device/camera that had it: go back to 1080p
      this.cfg = { ...this.cfg, res: 1080 }; ls.set('replayCfg', this.cfg);
      this.stream.getTracks().forEach(t => t.stop()); this.stream = null;
      return this.start();
    }
    this.st.mode = this.exactOk || typeof MediaRecorder === 'undefined' ? 'exact' : 'compat';
    this.begin();
    await keepScreenOn(true);
    this.emit();
    return true;
  }
  /** what the camera really delivers, and whether 4K is possible (camera gives it and it can be encoded live) */
  private async detectRes() {
    const t = this.videoTrack, s = t?.getSettings?.();
    this.st.actual = s?.width && s?.height ? `${s.width}×${s.height}` : '';
    const c = t?.getCapabilities?.() as { width?: { max?: number }; height?: { max?: number } } | undefined;
    const big = Math.max(c?.width?.max || 0, c?.height?.max || 0) >= 3840 && Math.min(c?.width?.max || 0, c?.height?.max || 0) >= 2160;
    this.st.can4k = this.cfg.res === 2160 ? big || this.st.can4k : big && this.st.mode !== 'compat' && !!this.exactOk && await canEncode(2160, BPS[2160]).catch(() => false);
  }
  private get videoTrack() { return this.stream?.getVideoTracks()[0]; }
  /** works out which zoom steps this device offers and applies the saved one */
  private async detectZoom() {
    const t = this.videoTrack;
    if (!this.useUltra) {
      const z = (t?.getCapabilities?.() as { zoom?: { min?: number; max?: number } } | undefined)?.zoom;
      this.zoomCaps = z && typeof z.max === 'number' && z.max > (z.min ?? 1) ? { min: z.min ?? 1, max: z.max } : null;
    }
    if (this.cfg.facing === 'environment' && !this.ultraId) {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        this.ultraId = devs.find(d => d.kind === 'videoinput' && d.deviceId && ULTRA_RE.test(d.label))?.deviceId || null;
      } catch { this.ultraId = null; }
    }
    const caps = this.zoomCaps;
    const opts = ZOOM_STEPS.filter(z => z === 1 || (caps && z >= caps.min && z <= caps.max));
    // the main camera itself may already go wider than 1× (some phones report min 0.5)
    if (this.ultraId || (caps && caps.min <= 0.5)) opts.unshift(0.5);
    this.st.zoomOptions = opts;
    if (this.useUltra) { this.st.zoom = 0.5; return; }
    const want = this.cfg.zoom && opts.includes(this.cfg.zoom) && this.cfg.zoom !== 0.5 ? this.cfg.zoom : 1;
    this.st.zoom = 1;
    if (want !== 1 || (caps && caps.min <= 1 && caps.max >= 1)) await this.applyZoom(want);
  }
  private async applyZoom(z: number): Promise<boolean> {
    const t = this.videoTrack;
    if (!t || !this.zoomCaps) { this.st.zoom = 1; return z === 1; }
    try {
      await t.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] });
      this.st.zoom = z; return true;
    } catch (e) { console.warn('zoom', e); return false; }
  }
  /** changes the zoom. Within one lens the recording keeps going; 0.5× on a separate ultra-wide lens restarts the camera */
  async setZoom(z: number): Promise<boolean> {
    if (!this.stream || this.st.zoomBusy || z === this.st.zoom || !this.st.zoomOptions.includes(z)) return false;
    this.cfg = { ...this.cfg, zoom: z }; ls.set('replayCfg', this.cfg);
    const caps = this.zoomCaps;
    const sameLens = !this.useUltra && (z !== 0.5 || (caps !== null && caps.min <= 0.5));
    if (sameLens) {
      const ok = await this.applyZoom(z);
      if (!ok) toast('이 배율로 바꾸지 못했어요');
      this.emit(); return ok;
    }
    // switching between the ultra-wide and the main lens needs a new camera stream
    this.st.zoomBusy = true; this.emit();
    this.useUltra = z === 0.5;
    try {
      const had = this.st.status === 'live';
      const ok = await this.restart();
      if (ok && had) toast('렌즈를 바꿔서 버퍼를 새로 시작했어요');
      return ok;
    } finally { this.st.zoomBusy = false; this.emit(); }
  }
  private stopRecorders() {
    this.ring?.stop(); this.ring = null;
    this.segs.forEach(s => s.discard()); this.segs = [];
  }
  private begin() {
    this.stopRecorders();
    if (this.st.mode === 'exact') {
      this.ring = new ExactRing(this.stream!, () => MAX_LEN, BPS[this.cfg.res], e => this.onExactFail(e));
      this.ring.start(this.cfg.audio).then(() => this.emit());
      this.st.status = 'live';
      clearInterval(this.tick); this.tick = setInterval(() => this.onTick(), 250);
      return;
    }
    this.segs = [new Seg(this), new Seg(this)]; this.st.single = false;
    try { this.segs[0].start(); } catch (e) { this.st.error = `녹화를 시작하지 못했어요. (${(e as Error).name || e})`; this.stop(); return; }
    try { this.segs[1].start(); } catch { this.segs.pop(); this.st.single = true; }
    this.st.status = 'live';
    clearInterval(this.tick); this.tick = setInterval(() => this.onTick(), 250);
  }
  /** the exact encoder failed on this device: keep recording with the compatible method */
  private onExactFail(e: unknown) {
    if (!this.ring) return;
    console.warn('exact replay buffer failed, falling back', e);
    this.exactOk = false; this.st.mode = 'compat';
    if (typeof MediaRecorder === 'undefined') { this.st.error = '이 기기에서는 녹화를 할 수 없어요.'; this.stop(); return; }
    toast('이 기기에서는 정확히 자르기가 안 돼서 호환 모드로 녹화해요');
    this.begin(); this.emit();
  }
  private onTick() {
    if (this.ring) { this.emit(); return; }
    const live = this.byAge(), len = COMPAT_LEN;
    if (this.st.single) { const s = live[0]; if (s && s.age() >= len * 3) { s.discard(); s.start(); } }
    else if (live.length === 2 && live[1].age() >= len) { live[0].discard(); live[0].start(); }
    this.emit();
  }
  stop() {
    clearInterval(this.tick); this.stopRecorders();
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.st = { ...this.st, status: 'off', startedAt: 0, saving: false };
    keepScreenOn(false); this.emit();
  }
  private onStopped() {
    clearInterval(this.tick); this.stopRecorders();
    this.st.status = 'paused'; this.emit();
  }
  async restart(): Promise<boolean> { const keep = this.st.startedAt; this.stop(); this.st.startedAt = keep; return this.start(); }
  private onVisibility() {
    if (document.visibilityState === 'hidden') { this.hiddenAt = Date.now(); return; }
    if (!this.stream) return;
    const vt = this.stream.getVideoTracks()[0];
    if (!vt || vt.readyState === 'ended') { this.onStopped(); return; }
    if (this.hiddenAt && Date.now() - this.hiddenAt > 1500 && this.st.status === 'live') { this.begin(); this.resumedNote = true; }
    this.hiddenAt = 0; keepScreenOn(true); this.emit();
  }
  resumedNote = false;

  /** saves the recent footage as a clip; returns its length in seconds or an error message */
  /** saves the last `len` seconds (default: the length picked last time) */
  async save(len?: number): Promise<{ ok: true; len: number; stored: boolean; silent?: boolean } | { ok: false; message: string }> {
    if (this.st.saving || !this.stream) return { ok: false, message: '녹화 중이 아니에요' };
    if (len && len !== this.cfg.len) { this.cfg = { ...this.cfg, len }; ls.set('replayCfg', this.cfg); }
    if (this.ring) {
      let out: { blob: Blob; len: number; dropped: boolean } | null = null;
      try { out = this.ring.save(this.cfg.len); }
      catch (e) {
        console.warn(e);
        const why = (e instanceof Error ? e.message : String(e)).slice(0, 160);
        this.st.saveError = `${why} · ${navigator.userAgent.match(/(iPhone OS [\d_]+|Android [\d.]+|Chrome\/\d+|Version\/[\d.]+)/g)?.join(' ') || ''}`;
        this.emit();
        return { ok: false, message: '저장하지 못했어요. 아래 원인을 캡처해서 알려주세요' };
      }
      if (!out || out.len < 1.5) return { ok: false, message: '아직 녹화된 분량이 없어요' };
      this.st.saving = true; this.st.saveError = null; this.emit();
      try {
        const len = Math.round(out.len);
        const stored = await Clips.add({ id: 'c' + Date.now(), date: Date.now(), len, type: 'video/mp4', size: out.blob.size }, out.blob);
        return { ok: true, len, stored, silent: out.dropped };
      } finally { this.st.saving = false; this.emit(); }
    }
    const o = this.byAge()[0];
    if (!o || o.age() < 1.5) return { ok: false, message: '아직 녹화된 분량이 없어요' };
    this.st.saving = true; this.emit();
    try {
      const { blob, len } = await o.finish();
      try { if (this.stream) o.start(); } catch { /* ignore */ }
      const stored = await Clips.add({ id: 'c' + Date.now(), date: Date.now(), len: Math.round(len), type: blob.type, size: blob.size }, blob);
      return { ok: true, len: Math.round(len), stored };
    } catch {
      if (!o.rec && this.stream) try { o.start(); } catch { /* ignore */ }
      return { ok: false, message: '저장하지 못했어요. 다시 눌러 주세요' };
    } finally { this.st.saving = false; this.emit(); }
  }
}

export const replay = new ReplayEngine();
export const useReplay = () => useSyncExternalStore(replay.subscribe, replay.getSnap);
