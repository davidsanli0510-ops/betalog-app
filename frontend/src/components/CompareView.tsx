import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { I } from './common';
import { toast } from '../data/store';

/* compare slots live outside React so the problem screen can drop a video in */
let slots: { a: string | null; b: string | null } = { a: null, b: null };
const L = new Set<() => void>();
const emit = () => L.forEach(l => l());
export const compare = {
  put(url: string): 'a' | 'b' { const k = !slots.a ? 'a' : 'b'; slots = { ...slots, [k]: url }; emit(); return k; },
  set(k: 'a' | 'b', url: string | null) { slots = { ...slots, [k]: url }; emit(); },
  /** a video was deleted: drop it from any slot that points at it */
  forget(url: string | null) { if (!url) return; if (slots.a === url || slots.b === url) { slots = { a: slots.a === url ? null : slots.a, b: slots.b === url ? null : slots.b }; emit(); } },
};
const useSlots = () => useSyncExternalStore(l => { L.add(l); return () => { L.delete(l); }; }, () => slots);

export function CompareView() {
  const s = useSlots();
  const va = useRef<HTMLVideoElement>(null), vb = useRef<HTMLVideoElement>(null);
  const [rate, setRate] = useState(1), [off, setOff] = useState(0), [playing, setPlaying] = useState(false), [pos, setPos] = useState(0);
  const ready = !!(s.a && s.b);
  useEffect(() => { [va.current, vb.current].forEach(v => { if (v) v.playbackRate = rate; }); }, [rate, s.a, s.b]);
  useEffect(() => { setPlaying(false); setPos(0); }, [s.a, s.b]);

  const slot = (k: 'a' | 'b', lab: string, hint: string, ref: React.RefObject<HTMLVideoElement | null>) => (
    <div className="slot">
      <span className="lab">{lab}</span>
      {s[k] ? <>
        <video ref={ref} src={s[k]!} playsInline muted preload="auto"
          onTimeUpdate={k === 'a' ? e => { const v = e.currentTarget; if (v.duration) setPos((v.currentTime / v.duration) * 1000); } : undefined}
          onEnded={k === 'a' ? () => { vb.current?.pause(); setPlaying(false); } : undefined} />
        <label htmlFor={'f' + k} className="btn sm" style={{ position: 'absolute', right: 8, bottom: 8 }}>바꾸기</label>
      </> : <label className="ghostvid" htmlFor={'f' + k}><span><I.plus s={26} w={2} /><br />{hint}</span></label>}
      <input type="file" id={'f' + k} accept="video/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) compare.set(k, URL.createObjectURL(f)); }} />
    </div>
  );
  const syncB = () => { if (va.current && vb.current) vb.current.currentTime = Math.max(0, va.current.currentTime + off); };

  return (
    <>
      <h2>나란히 비교</h2>
      <p className="sub">내 시도와 완등자 영상을 같은 속도로 돌려보며 어디서 다른지 찾으세요. 문제 화면에서 '비교'를 눌러 넣을 수도 있어요.</p>
      <div className="cmp">{slot('a', '내 시도', '내 시도 영상 선택', va)}{slot('b', '완등자', '완등 영상 선택', vb)}</div>
      <input className="scrub" id="scrub" type="range" min={0} max={1000} value={pos} disabled={!ready} aria-label="재생 위치"
        onChange={e => { const v = va.current; setPos(+e.target.value); if (v?.duration) { v.currentTime = (+e.target.value / 1000) * v.duration; syncB(); } }} />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div className="row">
          <button className="btn dark" id="cplay" disabled={!ready} onClick={() => {
            const a = va.current, b = vb.current; if (!a || !b) return;
            if (a.paused) { syncB(); Promise.all([a.play(), b.play()]).then(() => setPlaying(true)).catch(() => { a.pause(); b.pause(); setPlaying(false); toast('영상을 재생할 수 없어요. 다른 영상으로 바꿔 주세요'); }); } else { a.pause(); b.pause(); setPlaying(false); }
          }}>{playing ? '일시정지' : '동시 재생'}</button>
          <button className="btn" disabled={!ready} onClick={() => { const a = va.current, b = vb.current; if (!a || !b) return; a.pause(); b.pause(); a.currentTime = 0; b.currentTime = Math.max(0, off); setPlaying(false); setPos(0); }}>처음으로</button>
        </div>
        <div className="seg" role="group" aria-label="재생 속도">{[0.25, 0.5, 1].map(r => <button key={r} aria-pressed={rate === r} onClick={() => setRate(r)}>{r}x</button>)}</div>
      </div>
      <div className="block"><h3>출발 지점 맞추기</h3>
        <p className="sub" style={{ margin: '0 0 8px' }}>완등자 영상이 늦게 시작하면 오른쪽으로 밀어 손을 뗀 순간을 맞추세요.</p>
        <div className="row" style={{ alignItems: 'center' }}>
          <input type="range" id="off" min={-5} max={5} step={0.1} value={off} style={{ flex: 1, accentColor: 'var(--accent)' }} aria-label="완등자 영상 시작 오프셋"
            onChange={e => { setOff(+e.target.value); if (va.current && vb.current) vb.current.currentTime = Math.max(0, va.current.currentTime + +e.target.value); }} />
          <span className="mono" style={{ minWidth: 56, textAlign: 'right' }}>{off > 0 ? '+' : ''}{off.toFixed(1)}s</span>
        </div>
      </div>
    </>
  );
}
