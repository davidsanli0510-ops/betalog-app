import { useEffect, useState } from 'react';
import { isAndroid, isIOS, isSamsungBrowser } from './platform';
import { ls } from './data/util';

/**
 * iPhone Safari may wipe a site's storage (photos, videos, clips) after 7 days without a visit.
 * A web app added to the home screen is exempt, and asking for persistent storage helps elsewhere.
 */
export { isIOS };
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

let persisted: boolean | null = null;
/** asks the browser to keep our data; harmless where it is not supported */
export async function requestPersist(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch { persisted = null; }
  return persisted;
}

/* Chrome on Android offers its own install dialog; keep the event so a button can open it later */
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let promptEv: InstallPrompt | null = null;
const subs = new Set<() => void>();
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptEv = e as InstallPrompt; subs.forEach(f => f()); });
window.addEventListener('appinstalled', () => { promptEv = null; ls.set('installHintUntil', Date.now() + 3650 * 864e5); subs.forEach(f => f()); });

/** registers the offline helper (production build only), so the app opens even with a weak signal at the gym */
export function registerOffline() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* not fatal */ }); });
}

const HIDE_DAYS = 14;
export type HintKind = 'ios' | 'android' | 'samsung';
export function useInstallHint() {
  const [show, setShow] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(n => n + 1); subs.add(f);
    if ((isIOS || isAndroid) && !isStandalone() && Date.now() >= ls.get<number>('installHintUntil', 0)) setShow(true);
    return () => { subs.delete(f); };
  }, []);
  const hide = () => { ls.set('installHintUntil', Date.now() + HIDE_DAYS * 864e5); setShow(false); };
  const kind: HintKind = isIOS ? 'ios' : isSamsungBrowser ? 'samsung' : 'android';
  /** opens Chrome's install dialog when it is available */
  const install = promptEv ? async () => {
    const ev = promptEv!; promptEv = null;
    await ev.prompt();
    if ((await ev.userChoice).outcome === 'accepted') { ls.set('installHintUntil', Date.now() + 3650 * 864e5); setShow(false); }
    tick(n => n + 1);
  } : null;
  const installed = Date.now() < ls.get<number>('installHintUntil', 0) - 3000 * 864e5;
  return { show: show && !installed, hide, kind, install };
}
