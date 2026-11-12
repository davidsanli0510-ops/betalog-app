export const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (t: number) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export const hms = (s: number) => { s = Math.max(0, Math.floor(s)); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
export const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem('betalog4.' + k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown): boolean { try { localStorage.setItem('betalog4.' + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k: string) { try { localStorage.removeItem('betalog4.' + k); } catch { /* ignore */ } },
};
