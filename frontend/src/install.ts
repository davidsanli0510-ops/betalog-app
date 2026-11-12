import { useEffect, useState } from 'react';
import { isApp } from './native';
import { ls } from './data/util';

/**
 * iPhone Safari may wipe a site's storage (photos, videos, clips) after 7 days without a visit.
 * A web app added to the home screen is exempt, and asking for persistent storage helps elsewhere.
 */
const ua = navigator.userAgent;
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  isApp || matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

let persisted: boolean | null = null;
/** asks the browser to keep our data; harmless where it is not supported */
export async function requestPersist(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch { persisted = null; }
  return persisted;
}

const HIDE_DAYS = 14;
export function useInstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isIOS || isStandalone()) return;
    const until = ls.get<number>('installHintUntil', 0);
    if (Date.now() >= until) setShow(true);
  }, []);
  const hide = () => { ls.set('installHintUntil', Date.now() + HIDE_DAYS * 864e5); setShow(false); };
  return { show, hide };
}
