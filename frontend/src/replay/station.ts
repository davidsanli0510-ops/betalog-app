import { useSyncExternalStore } from 'react';
import { ls } from '../data/util';
import { isAndroid, isIOS } from '../platform';
import { isNativeIOS } from './nativeReplay';

/**
 * Spare-phone settings: a phone left on a tripod all day as the replay camera.
 * - autoSave: a save button press also puts the clip in the gallery (Android: Download album),
 *   so Google Photos backup can send it on to other phones.
 * - autoResume: if the camera stops (a call, another app took it), start recording again by itself.
 * - keepRecent: once clips are in the gallery, keep only the newest ones in the app to save space.
 */
export interface Station { autoSave: boolean; autoResume: boolean; keepRecent: boolean }
/** iPhone Safari can only save through the share sheet, which needs a fresh tap; the iPhone app can */
export const canAutoSave = !isIOS || isNativeIOS; // the iPhone app adds to Photos directly
export const KEEP_RECENT = 10;

let st: Station = { autoSave: false, autoResume: false, keepRecent: false, ...ls.get<Partial<Station>>('station', {}) };
// Galaxy and the iPhone app: clips go straight to the gallery unless that was turned off (set once, then the
// person's own choice is kept)
if (canAutoSave && (isAndroid || isNativeIOS) && !ls.get('autoSaveDefault1', false)) {
  ls.set('autoSaveDefault1', true); st = { ...st, autoSave: true }; ls.set('station', st);
}
if (!canAutoSave) st = { ...st, autoSave: false, keepRecent: false };
const subs = new Set<() => void>();
export const station = {
  get: () => st,
  set(p: Partial<Station>) { st = { ...st, ...p }; ls.set('station', st); subs.forEach(f => f()); },
};
export const useStation = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
