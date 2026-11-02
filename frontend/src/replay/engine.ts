import { useSyncExternalStore } from 'react';
import { Clips } from './clips';
import { keepScreenOn, screenKeptOn } from '../native';
import { ls } from '../data/util';

/**
 * Replay buffer. Two MediaRecorders run staggered on the same camera stream; whenever the younger one
 * reaches `len` seconds the older one restarts. So one recorder always holds between len and 2·len seconds,
 * and "save" just stops that one — no re-encoding. Devices that refuse two recorders fall back to one.
 */
export interface ReplayCfg { len: number; res: 480 | 720 | 1080; audio: boolean; facing: 'environment' | 'user' }
export type ReplayStatus = 'off' | 'starting' | 'live' | 'paused';
export interface ReplaySnap { status: ReplayStatus; error: string | null; single: boolean; awake: boolean; startedAt: number; saving: boolean; buffered: number; streamId: number; cfg: ReplayCfg }

const MIME = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  .find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) || '';
const BPS = { 480: 1_200_000, 720: 2_500_000, 1080: 5_000_000 } as const;

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
  cfg: ReplayCfg = ls.get<ReplayCfg>('replayCfg', { len: 30, res: 720, audio: true, facing: 'environment' });
  stream: MediaStream | null = null;
  private segs: Seg[] = [];
  private tick: ReturnType<typeof setInterval> | undefined;
  private hiddenAt = 0;
  private snap: ReplaySnap;
  private L = new Set<() => void>();
  private st = { status: 'off' as ReplayStatus, error: null as string | null, single: false, startedAt: 0, saving: false, streamId: 0 };

  constructor() {
    this.snap = this.make();
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }
  private make(): ReplaySnap {
    const o = this.byAge()[0];
    return { ...this.st, awake: screenKeptOn(), buffered: o ? o.age() : 0, cfg: { ...this.cfg } };
  }
  private emit() { this.snap = this.make(); this.L.forEach(l => l()); }
  subscribe = (l: () => void) => { this.L.add(l); return () => { this.L.delete(l); }; };
  getSnap = () => this.snap;
  private byAge() { return this.segs.filter(s => s.rec).sort((a, b) => b.age() - a.age()); }

  setCfg(patch: Partial<ReplayCfg>) {
    const restart = this.stream && (('res' in patch && patch.res !== this.cfg.res) || ('audio' in patch && patch.audio !== this.cfg.audio) || ('facing' in patch && patch.facing !== this.cfg.facing));
    this.cfg = { ...this.cfg, ...patch }; ls.set('replayCfg', this.cfg); this.emit();
    if (restart) return this.restart();
    return Promise.resolve(true);
  }

  private getStream(audio: boolean) {
    const h = this.cfg.res;
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: this.cfg.facing }, height: { ideal: h }, width: { ideal: Math.round((h * 16) / 9) }, frameRate: { ideal: 30, max: 30 } }, audio });
  }
  async start(): Promise<boolean> {
    if (this.stream) return true;
    this.st.error = null;
    if (!window.isSecureContext) { this.st.error = '보안 연결(https) 주소나 앱에서만 카메라를 쓸 수 있어요.'; this.emit(); return false; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { this.st.error = '이 브라우저는 카메라 녹화를 지원하지 않아요. 안드로이드는 크롬, 아이폰은 사파리 최신 버전을 쓰세요.'; this.emit(); return false; }
    this.st.status = 'starting'; this.emit();
    try {
      try { this.stream = await this.getStream(this.cfg.audio); }
      catch (e) { if (this.cfg.audio && (e as Error).name !== 'NotAllowedError') this.stream = await this.getStream(false); else throw e; }
    } catch (e) {
      const n = (e as Error).name;
      this.st.error = n === 'NotAllowedError' ? '카메라 권한이 거부됐어요. 설정에서 카메라(와 마이크)를 허용한 뒤 다시 눌러 주세요.'
        : n === 'NotFoundError' || n === 'OverconstrainedError' ? '쓸 수 있는 카메라를 찾지 못했어요.'
        : n === 'NotReadableError' ? '다른 앱이 카메라를 쓰고 있어요. 그 앱을 닫고 다시 시도해 주세요.'
        : `카메라를 열지 못했어요. (${n || '알 수 없는 오류'})`;
      this.st.status = 'off'; this.emit(); return false;
    }
    this.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.onStopped());
    this.st.streamId++; this.st.startedAt = this.st.startedAt || Date.now();
    this.begin();
    await keepScreenOn(true);
    this.emit();
    return true;
  }
  private begin() {
    this.segs.forEach(s => s.discard()); this.segs = [new Seg(this), new Seg(this)]; this.st.single = false;
    try { this.segs[0].start(); } catch (e) { this.st.error = `녹화를 시작하지 못했어요. (${(e as Error).name || e})`; this.stop(); return; }
    try { this.segs[1].start(); } catch { this.segs.pop(); this.st.single = true; }
    this.st.status = 'live';
    clearInterval(this.tick); this.tick = setInterval(() => this.onTick(), 250);
  }
  private onTick() {
    const live = this.byAge(), len = this.cfg.len;
    if (this.st.single) { const s = live[0]; if (s && s.age() >= len * 3) { s.discard(); s.start(); } }
    else if (live.length === 2 && live[1].age() >= len) { live[0].discard(); live[0].start(); }
    this.emit();
  }
  stop() {
    clearInterval(this.tick); this.segs.forEach(s => s.discard()); this.segs = [];
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.st = { ...this.st, status: 'off', startedAt: 0, saving: false };
    keepScreenOn(false); this.emit();
  }
  private onStopped() {
    clearInterval(this.tick); this.segs.forEach(s => s.discard()); this.segs = [];
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
  async save(): Promise<{ ok: true; len: number; stored: boolean } | { ok: false; message: string }> {
    if (this.st.saving || !this.stream) return { ok: false, message: '녹화 중이 아니에요' };
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
