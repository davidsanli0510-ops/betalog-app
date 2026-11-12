import { useSyncExternalStore } from 'react';
import type { Attempt, Problem, Result } from './types';
import { DAY, ls, rng, startOfToday, uid } from './util';
import { GYMS, TOP, gymOf } from './grades';

export interface State {
  problems: Problem[];
  logs: Attempt[];
  lastGym: string;
  gymF: string;
}

/* ---------- example records (marked sample, removable) ---------- */
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
  // records live only on this phone; drop leftovers from the old login/sync version
  ls.del('account'); ls.del('sync');
  return {
    problems: data.problems.filter(p => !p.deleted), logs: data.logs.filter(l => !l.deleted),
    lastGym: ls.get('lastGym', GYMS[0].id),
    gymF: ls.get('gymF', 'all'),
  };
}

let state: State = load();
const listeners = new Set<() => void>();
let persistOk = true;

export const getState = () => state;
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useAppState = () => useSyncExternalStore(subscribe, getState);
export const lastPersistOk = () => persistOk;

export function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  if ('problems' in patch || 'logs' in patch) persistOk = ls.set('data', { problems: state.problems, logs: state.logs });
  if ('lastGym' in patch) ls.set('lastGym', state.lastGym);
  if ('gymF' in patch) ls.set('gymF', state.gymF);
  listeners.forEach(l => l());
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

/* ---------- actions ---------- */
const stamp = <T extends { updatedAt: number }>(o: T): T => ({ ...o, updatedAt: Date.now() });

export function addProblem(p: Omit<Problem, 'id' | 'created' | 'updatedAt'>): Problem {
  const np = stamp({ ...p, id: uid(), created: Date.now(), updatedAt: 0 });
  setState({ problems: [np, ...state.problems] });
  return np;
}
export function updateProblem(id: string, patch: Partial<Problem>) {
  setState({ problems: state.problems.map(p => (p.id === id ? stamp({ ...p, ...patch }) : p)) });
}
/** change that doesn't count as an edit (e.g. attaching media) */
export function updateProblemQuiet(id: string, patch: Partial<Problem>) {
  setState({ problems: state.problems.map(p => (p.id === id ? { ...p, ...patch } : p)) });
}
export function deleteProblem(id: string) {
  setState({ problems: state.problems.filter(x => x.id !== id), logs: state.logs.filter(l => l.pid !== id) });
}
export function addAttempt(pid: string, attempts: number, result: Result) {
  const a = stamp<Attempt>({ id: uid(), pid, attempts, result, date: Date.now(), updatedAt: 0 });
  setState({ logs: [a, ...state.logs] });
}
export function deleteAttempt(id: string) {
  setState({ logs: state.logs.filter(x => x.id !== id) });
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
