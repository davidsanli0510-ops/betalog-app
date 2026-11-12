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
export interface ReplayCfg { len: number; res: 480 | 720 | 1080; audio: boolean; facing: 'environment' | 'user' }
export type ReplayStatus = 'off' | 'starting' | 'live' | 'paused';
export type ReplayMode = 'exact' | 'compat';
export interface ReplaySnap { status: ReplayStatus; error: string | null; mode: ReplayMode; single: boolean; silent: boolean; awake: boolean; startedAt: number; saving: boolean; buffered: number; streamId: number; cfg: ReplayCfg }

const MIME = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  .find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) || '';
const BPS = { 480: 1_200_000, 720: 2_500_000, 1080: 5_000_000 } as const;

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
    const c = ls.get<ReplayCfg>('replayCfg', { len: 60, res: 720, audio: true, facing: 'environment' });
    return { ...c, len: (LENGTHS as readonly number[]).includes(c.len) ? c.len : 60 };
  })();
  stream: MediaStream | null = null;
  private segs: Seg[] = [];
  private ring: ExactRing | null = null;
  private exactOk: boolean | null = null;
  private tick: ReturnType<typeof setInterval> | undefined;
  private hiddenAt = 0;
  private snap: ReplaySnap;
  private L = new Set<() => void>();
  private st = { status: 'off' as ReplayStatus, error: null as string | null, mode: 'exact' as ReplayMode, single: false, startedAt: 0, saving: false, streamId: 0 };

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
    if (!navigator.mediaDevices?.getUserMedia || (typeof MediaRecorder === 'undefined' && !exactSupported())) { this.st.error = '이 브라우저는 카메라 녹화를 지원하지 않아요. 안드로이드는 크롬, 아이폰은 사파리 최신 버전을 쓰세요.'; this.emit(); return false; }
    this.st.status = 'starting'; this.emit();
    try {
      try { this.stream = await this.getStream(this.cfg.audio); }
      catch (e) {
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
    if (this.exactOk === null) this.exactOk = await canEncode(this.cfg.res, BPS[this.cfg.res]).catch(() => false);
    this.st.mode = this.exactOk || typeof MediaRecorder === 'undefined' ? 'exact' : 'compat';
    this.begin();
    await keepScreenOn(true);
    this.emit();
    return true;
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
  async save(len?: number): Promise<{ ok: true; len: number; stored: boolean } | { ok: false; message: string }> {
    if (this.st.saving || !this.stream) return { ok: false, message: '녹화 중이 아니에요' };
    if (len && len !== this.cfg.len) { this.cfg = { ...this.cfg, len }; ls.set('replayCfg', this.cfg); }
    if (this.ring) {
      let out: { blob: Blob; len: number } | null = null;
      try { out = this.ring.save(this.cfg.len); } catch (e) { console.warn(e); return { ok: false, message: '저장하지 못했어요. 다시 눌러 주세요' }; }
      if (!out || out.len < 1.5) return { ok: false, message: '아직 녹화된 분량이 없어요' };
      this.st.saving = true; this.emit();
      try {
        const len = Math.round(out.len);
        const stored = await Clips.add({ id: 'c' + Date.now(), date: Date.now(), len, type: 'video/mp4', size: out.blob.size }, out.blob);
        return { ok: true, len, stored };
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
