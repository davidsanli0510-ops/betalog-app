import { useEffect, useState } from 'react';

/** Photos and videos stay on the device, in IndexedDB. Records only keep their ids. */
let dbp: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  if (!dbp) dbp = new Promise(res => {
    try {
      const r = indexedDB.open('betalog-media', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('m');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await open(); if (!db) throw new Error('no db');
  return new Promise((res, rej) => {
    const t = db.transaction('m', mode), q = fn(t.objectStore('m'));
    t.oncomplete = () => res(q ? (q.result as T) : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const urls = new Map<string, string>();

export const Media = {
  /** stores the blob; returns false when the device refused (quota) — the url still works for this session */
  async put(id: string, blob: Blob): Promise<boolean> {
    urls.set(id, URL.createObjectURL(blob));
    try { await tx('readwrite', s => s.put(blob, id)); return true; } catch { return false; }
  },
  cached: (id: string) => urls.get(id) || null,
  async url(id: string): Promise<string | null> {
    if (urls.has(id)) return urls.get(id)!;
    try { const b = await tx<Blob>('readonly', s => s.get(id)); if (!b) return null; const u = URL.createObjectURL(b); urls.set(id, u); return u; } catch { return null; }
  },
  async blob(id: string): Promise<Blob | null> {
    try { return (await tx<Blob>('readonly', s => s.get(id))) || null; } catch { return null; }
  },
  async del(id: string | null | undefined) {
    if (!id) return; const u = urls.get(id); if (u) URL.revokeObjectURL(u); urls.delete(id);
    try { await tx('readwrite', s => s.delete(id)); } catch { /* ignore */ }
  },
};

/** resolves a media id to an object url; null while loading, '' when the file is not on this device */
export function useMediaUrl(id: string | null | undefined): string | null {
  const [u, setU] = useState<string | null>(id ? Media.cached(id) : '');
  useEffect(() => {
    let alive = true;
    if (!id) { setU(''); return; }
    const c = Media.cached(id); if (c) { setU(c); return; }
    setU(null);
    Media.url(id).then(x => { if (alive) setU(x || ''); });
    return () => { alive = false; };
  }, [id]);
  return u;
}

export function shrinkImage(file: Blob, max = 1600): Promise<Blob> {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      c.toBlob(b => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode')); };
    img.src = u;
  });
}
