import { useSyncExternalStore } from 'react';
import { pad } from '../data/util';

export interface Clip { id: string; date: number; len: number; type: string; size: number; blob: Blob; url: string; memOnly?: boolean }

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
const strip = ({ url: _u, memOnly: _m, ...rest }: Clip) => rest;

export const Clips = {
  async load() {
    try {
      const all = (await tx<Omit<Clip, 'url'>[]>('readonly', s => s.getAll())) || [];
      items = all.map(c => ({ ...c, url: URL.createObjectURL(c.blob) })).sort((a, b) => b.date - a.date);
    } catch { items = []; }
    emit();
  },
  /** returns false when the device would not store it (kept in memory for this session) */
  async add(meta: Omit<Clip, 'url' | 'blob'>, blob: Blob): Promise<boolean> {
    const c: Clip = { ...meta, blob, url: URL.createObjectURL(blob) };
    items.unshift(c); emit();
    try { await tx('readwrite', s => s.put(strip(c))); return true; } catch { c.memOnly = true; emit(); return false; }
  },
  async del(id: string) {
    const c = items.find(x => x.id === id); if (c) URL.revokeObjectURL(c.url);
    items = items.filter(x => x.id !== id); emit();
    try { await tx('readwrite', s => s.delete(id)); } catch { /* ignore */ }
  },
  async clear() { for (const c of [...items]) await Clips.del(c.id); },
  get: (id: string) => items.find(x => x.id === id),
};
export const useClips = () => useSyncExternalStore(l => { L.add(l); return () => { L.delete(l); }; }, () => items);
export const clipName = (c: { date: number; type: string }) => {
  const d = new Date(c.date);
  return `climb-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${c.type.includes('mp4') ? 'mp4' : 'webm'}`;
};
