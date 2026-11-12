import { useSyncExternalStore } from 'react';

/* ---------- toast: one short message at a time ---------- */
let toastMsg: { text: string; at: number } | null = null;
const toastL = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string) {
  toastMsg = { text, at: Date.now() }; toastL.forEach(l => l());
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastMsg = null; toastL.forEach(l => l()); }, 2400);
}
export const useToast = () => useSyncExternalStore(l => { toastL.add(l); return () => { toastL.delete(l); }; }, () => toastMsg);
