import { useSyncExternalStore } from 'react';
import { pad } from '../data/util';

export interface Clip {
  id: string; date: number; len: number; type: string; size: number; blob: Blob; url: string; memOnly?: boolean;
  /** still picture for the list (JPEG); 'none' when one could not be made */
  thumb?: Blob | 'none'; thumbUrl?: string;
}

let dbp: Promise<IDBDatabase | null> | null = null;
function open() {
  if (!dbp) dbp = new Promise<IDBDatabase | null>(res => {
    try {
      const r = indexedDB.open('betalog-replay', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('clips', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await open(); if (!db) throw new Error('no db');
  return new Promise((res, rej) => {
    const t = db.transaction('clips', mode), q = fn(t.objectStore('clips'));
    t.oncomplete = () => res(q ? (q.result as T) : undefined); t.onerror = t.onabort = () => rej(t.error);
  });
}

let items: Clip[] = [];
const L = new Set<() => void>();
const emit = () => { items = [...items]; L.forEach(l => l()); };
const strip = ({ url: _u, memOnly: _m, thumbUrl: _t, ...rest }: Clip) => rest;
const withThumbUrl = (c: Clip): Clip => ({ ...c, thumbUrl: c.thumb instanceof Blob ? URL.createObjectURL(c.thumb) : undefined });

/* ---------- thumbnails ----------
 * iPhone Safari draws nothing for a <video> until it plays, and gives up when a list holds many of them,
 * so the list shows a picture made once per clip instead. */
/** resolves true on the event, false on timeout or a media error */
const wait = (el: HTMLVideoElement, ev: string, ms: number) => new Promise<boolean>(res => {
  const done = (v: boolean) => { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); res(v); };
  const ok = () => done(true), bad = () => done(false);
  const t = setTimeout(() => done(false), ms);
  el.addEventListener(ev, ok); el.addEventListener('error', bad);
});
async function grab(url: string): Promise<Blob | null> {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', '');
  v.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;opacity:0';
  document.body.appendChild(v);
  try {
    v.src = url;
    if (!(await wait(v, 'loadeddata', 8000))) return null;
    const at = Math.min(1, (v.duration || 2) / 3);
    v.currentTime = at;
    await wait(v, 'seeked', 4000);
    // iPhone may still have no decoded picture: playing for a moment makes it draw one
    if (!v.videoWidth || v.readyState < 2) { try { await v.play(); await wait(v, 'timeupdate', 3000); v.pause(); } catch { /* ignore */ } }
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, 360 / Math.min(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const g = cv.getContext('2d'); if (!g) return null;
    g.drawImage(v, 0, 0, cv.width, cv.height);
    // a fully black picture usually means nothing was decoded yet
    const px = g.getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0; for (let i = 0; i < px.length; i += 400) lit += px[i] + px[i + 1] + px[i + 2];
    if (lit === 0) return null;
    return await new Promise<Blob | null>(res => cv.toBlob(b => res(b), 'image/jpeg', 0.8));
  } catch { return null; } finally { v.removeAttribute('src'); v.load(); v.remove(); }
}
/** a copy in memory: Safari sometimes can't play a video straight from IndexedDB */
async function memCopy(c: Clip, type = c.type) { return URL.createObjectURL(new Blob([await c.blob.arrayBuffer()], { type })); }
/** a .mov is laid out like an .mp4; browsers other than Safari only accept it under the mp4 name */
const altType = (c: Clip) => (c.type.includes('quicktime') ? 'video/mp4' : null);
const memUrls = new Map<string, string>();

let thumbing = false;
async function makeThumbs() {
  if (thumbing) return; thumbing = true;
  try {
    for (;;) {
      const c = items.find(x => !x.thumb); if (!c) break;
      let b = await grab(c.url);
      for (const type of [c.type, altType(c)]) {
        if (b || !type) continue;
        try { const u = await memCopy(c, type); b = await grab(u); URL.revokeObjectURL(u); } catch { /* ignore */ }
      }
      const cur = items.find(x => x.id === c.id); if (!cur) continue;
      const next = withThumbUrl({ ...cur, thumb: b || 'none' });
      items = items.map(x => (x.id === c.id ? next : x)); emit();
      if (!cur.memOnly) { try { await tx('readwrite', s => s.put(strip(next))); } catch { /* ignore */ } }
    }
  } finally { thumbing = false; }
}

export const Clips = {
  async load() {
    try {
      const all = (await tx<Omit<Clip, 'url'>[]>('readonly', s => s.getAll())) || [];
      items = all.map(c => withThumbUrl({ ...c, url: URL.createObjectURL(c.blob) } as Clip)).sort((a, b) => b.date - a.date);
    } catch { items = []; }
    emit();
    makeThumbs();
  },
  /** returns false when the device would not store it (kept in memory for this session) */
  async add(meta: Omit<Clip, 'url' | 'blob'>, blob: Blob): Promise<boolean> {
    const c: Clip = { ...meta, blob, url: URL.createObjectURL(blob) };
    items.unshift(c); emit();
    let ok = true;
    try { await tx('readwrite', s => s.put(strip(c))); } catch { c.memOnly = true; emit(); ok = false; }
    makeThumbs();
    return ok;
  },
  async del(id: string) {
    const c = items.find(x => x.id === id);
    if (c) { URL.revokeObjectURL(c.url); if (c.thumbUrl) URL.revokeObjectURL(c.thumbUrl); }
    const m = memUrls.get(id); if (m) { URL.revokeObjectURL(m); memUrls.delete(id); }
    items = items.filter(x => x.id !== id); emit();
    try { await tx('readwrite', s => s.delete(id)); } catch { /* ignore */ }
  },
  async clear() { for (const c of [...items]) await Clips.del(c.id); },
  get: (id: string) => items.find(x => x.id === id),
  /** a URL that plays when the stored one doesn't (made once, kept until the clip is deleted) */
  async fallbackUrl(id: string, attempt: number): Promise<string | null> {
    const c = items.find(x => x.id === id); if (!c) return null;
    const type = attempt === 0 ? c.type : altType(c);
    if (!type) return null;
    const old = memUrls.get(id); if (old) URL.revokeObjectURL(old);
    try { const u = await memCopy(c, type); memUrls.set(id, u); return u; } catch { return null; }
  },
};
export const useClips = () => useSyncExternalStore(l => { L.add(l); return () => { L.delete(l); }; }, () => items);
export const clipName = (c: { date: number; type: string }) => {
  const d = new Date(c.date);
  return `climb-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${c.type.includes('quicktime') ? 'mov' : c.type.includes('mp4') ? 'mp4' : 'webm'}`;
};
