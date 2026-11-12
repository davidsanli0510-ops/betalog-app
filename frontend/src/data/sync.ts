import type { Account, Attempt, Problem, Result, SyncState } from './types';
import { getState, setChangeHook, setState } from './store';

/* ---------- wire format (matches the FastAPI server in backend/) ---------- */
interface ProblemDto { id: string; gym: string; grade: number; sector: string; memo: string; createdAt: number; updatedAt: number; deleted: boolean; marks: string; hasPhoto: boolean; videoCount: number }
interface AttemptDto { id: string; problemId: string; attempts: number; result: 'FLASH' | 'SEND' | 'PROJECT'; date: number; updatedAt: number; deleted: boolean }
interface SyncResponse { cursor: number; problems: ProblemDto[]; attempts: AttemptDto[] }
interface AuthResponse { token: string; username: string; displayName: string }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** server address baked in at build time (GitHub repository variable DEFAULT_SERVER), so friends don't have to type it */
export const DEFAULT_SERVER: string = (import.meta.env.VITE_DEFAULT_SERVER as string | undefined) || '';

export function normalizeServer(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) {
    // a PC on the local network (IP or localhost) speaks plain http; anything with a domain name gets https
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\d+\.\d+\.\d+\.\d+)/.test(s);
    s = (local ? 'http://' : 'https://') + s;
  }
  return s;
}

const WAKING = '서버가 깨어나는 중이에요. 잠시 후 자동으로 다시 시도해요.';
/** free servers sleep when idle and take up to a minute to wake, so requests get a long timeout */
const TIMEOUT = 75000;

async function call<T>(server: string, path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
  let res: Response;
  try {
    res = await fetch(server + path, {
      method: init.method || 'GET', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.token ? { Authorization: 'Bearer ' + init.token } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없어요. 인터넷 연결과 서버 주소를 확인하세요.');
  } finally { clearTimeout(timer); }
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new ApiError(0, WAKING);
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = j.message || ''; } catch { /* ignore */ }
    throw new ApiError(res.status, msg || (res.status === 401 ? '로그인이 만료됐어요. 다시 로그인해 주세요.' : `서버 오류가 났어요 (${res.status})`));
  }
  try { return (await res.json()) as T; } catch { throw new ApiError(0, WAKING); }
}

export async function checkServer(server: string): Promise<boolean> {
  try { await call<{ ok: boolean }>(normalizeServer(server), '/api/health'); return true; } catch { return false; }
}

async function auth(kind: 'login' | 'signup', serverRaw: string, username: string, password: string, displayName?: string, inviteCode?: string) {
  const server = normalizeServer(serverRaw);
  const r = await call<AuthResponse>(server, '/api/auth/' + kind, { method: 'POST', body: { username, password, displayName, inviteCode } });
  const account: Account = { server, token: r.token, username: r.username, displayName: r.displayName };
  // a new account starts from cursor 0 so everything already on this phone gets uploaded
  const problems = getState().problems.map(p => (p.sample ? p : { ...p, dirty: true }));
  const logs = getState().logs.map(l => (l.sample ? l : { ...l, dirty: true }));
  setState({ account, problems, logs, sync: { cursor: 0, lastSync: null, status: 'idle' } });
  await syncNow();
}
export const login = (s: string, u: string, p: string) => auth('login', s, u, p);
export const signup = (s: string, u: string, p: string, d: string, code?: string) => auth('signup', s, u, p, d, code);

export function logout() {
  setState({ account: null, sync: { cursor: 0, lastSync: null, status: 'off' } });
}

/* ---------- mapping ---------- */
const RES_OUT: Record<Result, AttemptDto['result']> = { flash: 'FLASH', send: 'SEND', project: 'PROJECT' };
const RES_IN: Record<AttemptDto['result'], Result> = { FLASH: 'flash', SEND: 'send', PROJECT: 'project' };
const toProblemDto = (p: Problem): ProblemDto => ({
  id: p.id, gym: p.gym, grade: p.v, sector: p.sector || '', memo: p.memo || '', createdAt: p.created, updatedAt: p.updatedAt,
  deleted: !!p.deleted, marks: JSON.stringify(p.marks || []), hasPhoto: !!p.photo, videoCount: p.videos.length,
});
const toAttemptDto = (a: Attempt): AttemptDto => ({
  id: a.id, problemId: a.pid, attempts: a.attempts, result: RES_OUT[a.result], date: a.date, updatedAt: a.updatedAt, deleted: !!a.deleted,
});
function parseMarks(s: string) { try { const m = JSON.parse(s); return Array.isArray(m) ? m : []; } catch { return []; } }

/* ---------- sync: push dirty rows, pull what changed since our cursor, newest edit wins ---------- */
let running: Promise<void> | null = null;
export function syncNow(): Promise<void> {
  if (!running) running = doSync().finally(() => { running = null; });
  return running;
}
const setSync = (patch: Partial<SyncState>) => setState({ sync: { ...getState().sync, ...patch } });

async function doSync() {
  const s0 = getState(); const acc = s0.account;
  if (!acc) return;
  const outP = s0.problems.filter(p => p.dirty && !p.sample);
  const outA = s0.logs.filter(l => l.dirty && !l.sample);
  const sentP = new Map(outP.map(p => [p.id, p.updatedAt])), sentA = new Map(outA.map(a => [a.id, a.updatedAt]));
  setSync({ status: 'syncing', message: undefined });
  const wakeHint = setTimeout(() => { if (getState().sync.status === 'syncing') setSync({ message: '서버를 깨우는 중이에요 (최대 1분)' }); }, 4000);
  let r: SyncResponse;
  try {
    r = await call<SyncResponse>(acc.server, '/api/sync', { method: 'POST', token: acc.token, body: { since: s0.sync.cursor, problems: outP.map(toProblemDto), attempts: outA.map(toAttemptDto) } });
  } catch (e) {
    const err = e as ApiError;
    setSync(err.status === 401 ? { status: 'relogin', message: err.message } : err.status === 0 ? { status: 'offline', message: err.message } : { status: 'error', message: err.message });
    if (err.status === 0 && err.message === WAKING) scheduleSync(15000);
    return;
  } finally { clearTimeout(wakeHint); }
  // merge on top of the *current* state (the user may have edited while we were waiting)
  const s = getState();
  const problems = new Map(s.problems.map(p => [p.id, p]));
  for (const d of r.problems) {
    const cur = problems.get(d.id);
    if (cur && cur.dirty && cur.updatedAt > d.updatedAt) continue; // our unsent edit is newer
    problems.set(d.id, {
      id: d.id, gym: d.gym, v: d.grade, sector: d.sector || '', memo: d.memo || '', created: d.createdAt, updatedAt: d.updatedAt,
      marks: parseMarks(d.marks), deleted: d.deleted || undefined,
      photo: cur ? cur.photo : null, videos: cur ? cur.videos : [], dirty: false,
    });
  }
  const logs = new Map(s.logs.map(l => [l.id, l]));
  for (const d of r.attempts) {
    const cur = logs.get(d.id);
    if (cur && cur.dirty && cur.updatedAt > d.updatedAt) continue;
    logs.set(d.id, { id: d.id, pid: d.problemId, attempts: d.attempts, result: RES_IN[d.result], date: d.date, updatedAt: d.updatedAt, deleted: d.deleted || undefined, dirty: false });
  }
  // rows we sent and did not touch since are now clean; clean tombstones can go
  const clean = <T extends { id: string; updatedAt: number; dirty?: boolean }>(x: T, sent: Map<string, number>): T =>
    (x.dirty && sent.get(x.id) === x.updatedAt ? { ...x, dirty: false } : x);
  setState({
    problems: [...problems.values()].map(p => clean(p, sentP)).filter(p => !(p.deleted && !p.dirty)).sort((a, b) => b.created - a.created),
    logs: [...logs.values()].map(l => clean(l, sentA)).filter(l => !(l.deleted && !l.dirty)),
    sync: { cursor: r.cursor, lastSync: Date.now(), status: 'idle' },
  });
}

/* ---------- background sync ---------- */
let debounce: ReturnType<typeof setTimeout> | undefined;
export function scheduleSync(ms = 2500) {
  if (!getState().account) return;
  clearTimeout(debounce); debounce = setTimeout(() => { syncNow(); }, ms);
}
export function startAutoSync() {
  setChangeHook(() => scheduleSync());
  if (getState().account) scheduleSync(800);
  setInterval(() => { if (getState().account && getState().sync.status !== 'relogin') syncNow(); }, 60000);
  window.addEventListener('online', () => scheduleSync(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(500); });
}
