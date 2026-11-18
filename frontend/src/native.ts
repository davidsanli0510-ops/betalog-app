import { isAndroid, isIOS } from './platform';
import type { Clip } from './replay/clips';
import { BetaReplay } from './replay/nativeReplay';

/* ---------- keep the screen on while recording ---------- */
let wake: WakeLockSentinel | null = null;
let wantAwake = false;
export async function keepScreenOn(on: boolean): Promise<boolean> {
  wantAwake = on;
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
// the browser drops the lock when the page is hidden; take it again on return
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantAwake && !wake) keepScreenOn(true); });
export const screenKeptOn = () => !!wake;

/* ---------- save a video to the phone's gallery ----------
 * iPhone: the share sheet has "Save Video" (to Photos).
 * Android: a download lands in Download, which Samsung Gallery and Google Photos show as an album;
 * the Android share sheet has no "save to gallery", so it is only the fallback there. */
export type SaveResult = 'photos' | 'shared' | 'downloaded' | 'cancelled' | 'failed';
function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
export async function saveVideo(blob: Blob, name: string): Promise<SaveResult> {
  const mime = blob.type || 'video/mp4';
  if (isAndroid) { try { download(blob, name); return 'downloaded'; } catch { /* try sharing */ } }
  const file = new File([blob], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '클라이밍 클립' }); return 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  try { download(blob, name); return 'downloaded'; } catch { return 'failed'; }
}
/** puts a saved clip in the phone's gallery: the iPhone app adds it to Photos directly, the website as above */
export async function saveClip(c: Clip, name: string): Promise<SaveResult> {
  if (c.path) {
    try { await BetaReplay.saveToPhotos({ path: c.path }); return 'photos'; }
    catch (e) { lastError = (e as Error).message || ''; return 'failed'; }
  }
  return c.blob ? saveVideo(c.blob, name) : 'failed';
}
let lastError = '';
export const saveLabel = isIOS ? '사진첩에 저장' : '갤러리에 저장';
export const savedMessage = (r: SaveResult) =>
  r === 'photos' ? '사진첩에 저장했어요'
  : r === 'downloaded' ? (isAndroid ? '저장했어요. 갤러리의 Download 앨범에서 볼 수 있어요' : '파일로 받았어요')
  : r === 'shared' ? (isIOS ? "공유 메뉴에서 '비디오 저장'을 누르면 사진첩에 들어가요" : '공유 메뉴를 열었어요')
  : r === 'failed' ? (lastError || '저장하지 못했어요') : '취소했어요';
