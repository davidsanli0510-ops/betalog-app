import { useSyncExternalStore } from 'react';
import { toast } from '../data/store';

/* hangboard timer — runs outside React so it keeps going while you switch tabs */
type Phase = '준비' | '매달리기' | '휴식' | '세트 휴식' | '완료';
interface T { hang: number; rest: number; reps: number; sets: number; setRest: number; running: boolean; phase: Phase; left: number; total: number; rep: number; set: number }
let t: T = { hang: 7, rest: 3, reps: 6, sets: 3, setRest: 120, running: false, phase: '준비', left: 5, total: 5, rep: 0, set: 1 };
let iv: ReturnType<typeof setInterval> | undefined;
const L = new Set<() => void>();
const set = (p: Partial<T>) => { t = { ...t, ...p }; L.forEach(l => l()); };
let ac: AudioContext | undefined;
function beep(f = 880, d = 0.12) {
  try {
    ac = ac || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.2, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + d); o.start(); o.stop(ac.currentTime + d);
  } catch { /* no audio */ }
}
const reset = () => { clearInterval(iv); set({ running: false, phase: '준비', left: 5, total: 5, rep: 0, set: 1 }); };
function next() {
  if (t.phase === '준비' || t.phase === '휴식' || t.phase === '세트 휴식') { beep(1046, 0.25); set({ phase: '매달리기', left: t.hang, total: t.hang }); return; }
  if (t.phase === '매달리기') {
    const rep = t.rep + 1;
    if (rep < t.reps) { if (t.rest > 0) { beep(523); set({ rep, phase: '휴식', left: t.rest, total: t.rest }); } else { beep(1046, 0.25); set({ rep, left: t.hang, total: t.hang }); } return; }
    if (t.set < t.sets) { beep(440, 0.4); const r = t.setRest || t.rest || 1; set({ rep: 0, set: t.set + 1, phase: '세트 휴식', left: r, total: r }); return; }
    clearInterval(iv); beep(880, 0.15); setTimeout(() => beep(1175, 0.3), 180); set({ rep, phase: '완료', left: 0, total: 1, running: false });
  }
}
function tick() { const left = t.left - 1; if (left <= 3 && left > 0) beep(660, 0.06); set({ left }); if (left <= 0) next(); }
const useTimer = () => useSyncExternalStore(l => { L.add(l); return () => { L.delete(l); }; }, () => t);

export function TimerView() {
  const s = useTimer();
  const C = 2 * Math.PI * 90, frac = s.total ? s.left / s.total : 0;
  const color = s.phase === '매달리기' ? 'var(--accent)' : s.phase === '완료' ? 'var(--good)' : 'var(--muted)';
  const fields: [keyof T, string][] = [['hang', '매달리기(초)'], ['rest', '휴식(초)'], ['reps', '반복'], ['sets', '세트'], ['setRest', '세트 휴식(초)']];
  return (
    <>
      <h2>행보드 타이머</h2>
      <p className="sub">리피터: 매달리기와 휴식을 반복하고, 세트 사이에 길게 쉬어요.</p>
      <div className="chips" role="group" aria-label="프리셋">
        {([['리피터 7/3', [7, 3, 6, 3, 120]], ['맥스 행 10초', [10, 170, 1, 5, 0]], ['타바타 지구력', [20, 10, 8, 1, 0]]] as const).map(([name, [hang, rest, reps, sets, setRest]]) => (
          <button key={name} className="chip" onClick={() => { reset(); set({ hang, rest, reps, sets, setRest }); toast(name + ' 설정'); }}>{name}</button>
        ))}
      </div>
      <div className="timer">
        <div className="ring">
          <svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="90" fill="none" stroke="var(--sunk)" strokeWidth="12" />
            <circle cx="100" cy="100" r="90" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: 'stroke-dashoffset .25s linear' }} /></svg>
          <div className="center"><div>
            <div className="phase" id="tph" style={{ color }}>{s.phase}</div>
            <div className="sec">{s.left}</div>
            <div className="meta mono">세트 {s.set}/{s.sets} · 반복 {Math.min(s.rep + (s.phase === '매달리기' ? 1 : 0), s.reps)}/{s.reps}</div>
          </div></div>
        </div>
        <div className="row" style={{ width: '100%' }}>
          <button className="btn primary" id="tgo" style={{ flex: 2 }} onClick={() => {
            if (t.phase === '완료') reset();
            if (t.running) { clearInterval(iv); set({ running: false }); } else { beep(660, 0.05); clearInterval(iv); iv = setInterval(tick, 1000); set({ running: true }); }
          }}>{s.running ? '일시정지' : s.phase === '완료' ? '다시 시작' : '시작'}</button>
          <button className="btn" style={{ flex: 1 }} onClick={reset}>초기화</button>
        </div>
        <div className="cfg">{fields.map(([k, l]) => (
          <label key={k} htmlFor={'c-' + k}>{l}
            <input id={'c-' + k} type="number" inputMode="numeric" min={k === 'rest' || k === 'setRest' ? 0 : 1} value={s[k] as number} disabled={s.running}
              onChange={e => { const min = k === 'rest' || k === 'setRest' ? 0 : 1; reset(); set({ [k]: Math.max(min, parseInt(e.target.value) || 0) } as Partial<T>); }} />
          </label>
        ))}</div>
      </div>
    </>
  );
}
