export const DAY = 864e5;
export const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return +d; };
export const pad = (n: number) => String(n).padStart(2, '0');
export const fmtD = (t: number) => { const d = new Date(t); return (d.getMonth() + 1) + '.' + pad(d.getDate()); };
export const clock = (t: number) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export const hms = (s: number) => { s = Math.max(0, Math.floor(s)); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem('betalog4.' + k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown): boolean { try { localStorage.setItem('betalog4.' + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k: string) { try { localStorage.removeItem('betalog4.' + k); } catch { /* ignore */ } },
};
