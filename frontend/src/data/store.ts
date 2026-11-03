import { useSyncExternalStore } from 'react';
import type { Account, Attempt, Problem, Result, SyncState } from './types';
import { DAY, ls, rng, startOfToday, uid } from './util';
import { GYMS, TOP, gymOf } from './grades';

export interface State {
  problems: Problem[];
  logs: Attempt[];
  account: Account | null;
  sync: SyncState;
  lastGym: string;
  gymF: string;
}

/* ---------- example records (marked sample, never synced, removable) ---------- */
function sampleData(): { problems: Problem[]; logs: Attempt[] } {
  const r = rng(42), problems: Problem[] = [], logs: Attempt[] = [], gyms = ['yj', 'yj', 'gn', 'nh', 'is'];
  const memos = ['', '', '발 바꾸는 타이밍이 핵심', '마지막 슬로퍼에서 계속 미끄러짐', '', '힐훅 걸면 편함', ''];
  const today = startOfToday(), evening = 19 * 36e5;
  for (let i = 0; i < 14; i++) {
    const w = 9 - Math.floor((i * 10) / 14), base = Math.min(6, 2 + Math.floor((9 - w) / 2.5));
    const v = Math.max(0, Math.min(TOP, base + Math.floor(r() * 3) - 1)), gym = gymOf(gyms[Math.floor(r() * gyms.length)]);
    const d0 = today - (w * 7 + Math.floor(r() * 5)) * DAY + evening, id = 'sample-p' + i;
    problems.push({ id, gym: gym.id, v, sector: gym.sectors[Math.floor(r() * gym.sectors.length)], memo: memos[Math.floor(r() * memos.length)],
      created: d0, updatedAt: d0, photo: null, videos: [], marks: [], sample: true });
    const k = r(), mk = (s: string, attempts: number, result: Result, date: number): Attempt =>
      ({ id: 'sample-l' + i + s, pid: id, attempts, result, date, updatedAt: date, sample: true });
    if (k < 0.25) logs.push(mk('a', 1, 'flash', d0));
    else if (k < 0.8) {
      if (r() < 0.5) { logs.push(mk('a', 2 + Math.floor(r() * 5), 'project', d0)); logs.push(mk('b', 1 + Math.floor(r() * 3), 'send', Math.min(today + evening, d0 + (3 + Math.floor(r() * 4)) * DAY))); }
      else logs.push(mk('a', 2 + Math.floor(r() * 5), 'send', d0));
    } else logs.push(mk('a', 3 + Math.floor(r() * 6), 'project', d0));
  }
  return { problems, logs };
}

function load(): State {
  const data = ls.get<{ problems: Problem[]; logs: Attempt[] } | null>('data', null) || sampleData();
  return {
    problems: data.problems, logs: data.logs,
    account: ls.get<Account | null>('account', null),
    sync: ls.get<SyncState>('sync', { cursor: 0, lastSync: null, status: 'off' }),
    lastGym: ls.get('lastGym', GYMS[0].id),
    gymF: ls.get('gymF', 'all'),
  };
}

let state: State = load();
const listeners = new Set<() => void>();
let changeHook: (() => void) | null = null;
let persistOk = true;

export const getState = () => state;
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useAppState = () => useSyncExternalStore(subscribe, getState);
export const lastPersistOk = () => persistOk;
/** sync module registers itself here so data changes trigger a background sync */
export const setChangeHook = (fn: () => void) => { changeHook = fn; };

export function setState(patch: Partial<State>, opts: { dataChanged?: boolean } = {}) {
  state = { ...state, ...patch };
  if ('problems' in patch || 'logs' in patch) persistOk = ls.set('data', { problems: state.problems, logs: state.logs });
  if ('account' in patch) state.account ? ls.set('account', state.account) : ls.del('account');
  if ('sync' in patch) ls.set('sync', state.sync);
  if ('lastGym' in patch) ls.set('lastGym', state.lastGym);
  if ('gymF' in patch) ls.set('gymF', state.gymF);
  listeners.forEach(l => l());
  if (opts.dataChanged && changeHook) changeHook();
}

/* ---------- selectors ---------- */
export const liveProblems = (s: State) => s.problems.filter(p => !p.deleted);
export const liveLogs = (s: State) => s.logs.filter(l => !l.deleted);
export const problemById = (s: State, id: string) => s.problems.find(p => p.id === id && !p.deleted);
export const logsOf = (s: State, pid: string) => s.logs.filter(l => l.pid === pid && !l.deleted).sort((a, b) => b.date - a.date);
export type Status = 'flash' | 'send' | 'project' | 'none';
export function statusOf(s: State, pid: string): Status {
  const L = logsOf(s, pid);
  return L.some(l => l.result === 'flash') ? 'flash' : L.some(l => l.result === 'send') ? 'send' : L.length ? 'project' : 'none';
}

/* ---------- actions (every change is stamped so sync can pick it up) ---------- */
const stamp = <T extends { updatedAt: number; dirty?: boolean }>(o: T): T => ({ ...o, updatedAt: Date.now(), dirty: true });

export function addProblem(p: Omit<Problem, 'id' | 'created' | 'updatedAt'>): Problem {
  const np = stamp({ ...p, id: uid(), created: Date.now(), updatedAt: 0 });
  setState({ problems: [np, ...state.problems] }, { dataChanged: true });
  return np;
}
export function updateProblem(id: string, patch: Partial<Problem>) {
  setState({ problems: state.problems.map(p => (p.id === id ? stamp({ ...p, ...patch }) : p)) }, { dataChanged: true });
}
/** local-only change (media ids, marks are synced but photos/videos are not) */
export function updateProblemQuiet(id: string, patch: Partial<Problem>) {
  setState({ problems: state.problems.map(p => (p.id === id ? { ...p, ...patch } : p)) });
}
export function deleteProblem(id: string) {
  const keepTomb = !!state.account; // only keep tombstones when there is a server to tell
  const p = state.problems.find(x => x.id === id);
  const problems = keepTomb && p && !p.sample ? state.problems.map(x => (x.id === id ? stamp({ ...x, deleted: true }) : x)) : state.problems.filter(x => x.id !== id);
  const logs = keepTomb && p && !p.sample ? state.logs.map(l => (l.pid === id && !l.deleted ? stamp({ ...l, deleted: true }) : l)) : state.logs.filter(l => l.pid !== id);
  setState({ problems, logs }, { dataChanged: true });
}
export function addAttempt(pid: string, attempts: number, result: Result) {
  const a = stamp<Attempt>({ id: uid(), pid, attempts, result, date: Date.now(), updatedAt: 0 });
  setState({ logs: [a, ...state.logs] }, { dataChanged: true });
}
export function deleteAttempt(id: string) {
  const l = state.logs.find(x => x.id === id);
  const logs = state.account && l && !l.sample ? state.logs.map(x => (x.id === id ? stamp({ ...x, deleted: true }) : x)) : state.logs.filter(x => x.id !== id);
  setState({ logs }, { dataChanged: true });
}
export function clearSamples() {
  setState({ problems: state.problems.filter(p => !p.sample), logs: state.logs.filter(l => !l.sample) });
}
export function clearAllLocal() {
  setState({ problems: [], logs: [] });
}

/* ---------- toast ---------- */
let toastMsg: { text: string; at: number } | null = null;
const toastL = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string) {
  toastMsg = { text, at: Date.now() }; toastL.forEach(l => l());
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastMsg = null; toastL.forEach(l => l()); }, 2400);
}
export const useToast = () => useSyncExternalStore(l => { toastL.add(l); return () => { toastL.delete(l); }; }, () => toastMsg);
