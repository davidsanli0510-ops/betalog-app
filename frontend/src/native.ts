import { Capacitor, registerPlugin } from '@capacitor/core';

/** Small Android plugin (android/app/src/main/java/.../BetaLogNativePlugin.java) */
interface BetaLogNative {
  keepScreenOn(o: { on: boolean }): Promise<void>;
  saveStart(o: { name: string; mime: string }): Promise<{ id: string }>;
  saveAppend(o: { id: string; data: string }): Promise<void>;
  saveFinish(o: { id: string }): Promise<{ path: string }>;
}
export const isApp = Capacitor.isNativePlatform();
const Native = registerPlugin<BetaLogNative>('BetaLogNative');

/* ---------- keep the screen on while recording ---------- */
let wake: WakeLockSentinel | null = null;
let wantAwake = false;
export async function keepScreenOn(on: boolean): Promise<boolean> {
  wantAwake = on;
  if (isApp) { try { await Native.keepScreenOn({ on }); return on; } catch { return false; } }
  try {
    if (on) {
      if (!('wakeLock' in navigator)) return false;
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
      return true;
    }
    await wake?.release(); wake = null; return false;
  } catch { return false; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantAwake && !isApp && !wake) keepScreenOn(true); });
export const screenKeptOn = () => (isApp ? wantAwake : !!wake);

/* ---------- save a video to the phone's gallery ---------- */
function b64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result); res(s.slice(s.indexOf(',') + 1)); };
    fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob);
  });
}
export type SaveResult = 'saved' | 'shared' | 'downloaded' | 'cancelled' | 'failed';
export async function saveVideo(blob: Blob, name: string): Promise<SaveResult> {
  const mime = blob.type || 'video/mp4';
  if (isApp) {
    try {
      const { id } = await Native.saveStart({ name, mime });
      const CH = 512 * 1024;
      for (let i = 0; i < blob.size; i += CH) await Native.saveAppend({ id, data: await b64(blob.slice(i, i + CH)) });
      await Native.saveFinish({ id });
      return 'saved';
    } catch { return 'failed'; }
  }
  const file = new File([blob], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '클라이밍 클립' }); return 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return 'downloaded';
}
export const saveLabel = isApp ? '갤러리에 저장' : '사진첩에 저장';
