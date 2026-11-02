import { useState } from 'react';
import { G, GRADES, TOP } from '../data/grades';
import { deleteAttempt, liveLogs, liveProblems, problemById, statusOf, toast, useAppState } from '../data/store';
import { DAY, fmtD, startOfToday } from '../data/util';
import { LogRow, Tape, where } from './common';
import { SampleNote } from './ProblemsView';
import type { Nav } from '../App';

export function RecordsView({ nav }: { nav: Nav }) {
  const s = useAppState();
  const [pendingDel, setPendingDel] = useState<string | null>(null);
  const today = startOfToday(), now = new Date();
  const LL = liveLogs(s).map(l => ({ ...l, p: problemById(s, l.pid)! })).filter(l => l.p);
  const sends = LL.filter(l => l.result !== 'project');
  const month = sends.filter(l => { const d = new Date(l.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const best = sends.reduce((m, l) => Math.max(m, l.p.v), -1);
  const sentProbs = liveProblems(s).filter(p => ['flash', 'send'].includes(statusOf(s, p.id)));
  const flashRate = sentProbs.length ? Math.round((sentProbs.filter(p => statusOf(s, p.id) === 'flash').length / sentProbs.length) * 100) : 0;

  const weeks: { label: string; v: number | null }[] = [];
  for (let w = 9; w >= 0; w--) {
    const end = today + DAY - w * 7 * DAY, start = end - 7 * DAY, ws = sends.filter(l => l.date >= start && l.date < end);
    weeks.push({ label: fmtD(start), v: ws.length ? Math.max(...ws.map(l => l.p.v)) : null });
  }
  const W = 340, H = 190, pl = 40, pr = 22, pt = 12, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
  const X = (i: number) => pl + (i / (weeks.length - 1)) * iw, Y = (v: number) => pt + ih - (v / TOP) * ih;
  const pts = weeks.map((w, i) => (w.v === null ? null : [X(i), Y(w.v)] as [number, number])).filter((x): x is [number, number] => !!x);
  const line = pts.map(p => p.join(',')).join(' ');
  const area = pts.length ? `M${pts[0][0]},${pt + ih} L${line.replace(/ /g, ' L')} L${pts[pts.length - 1][0]},${pt + ih}Z` : '';
  const last = pts[pts.length - 1];
  const dist = GRADES.map(g => ({ g, n: sentProbs.filter(p => p.v === g.v).length })), mx = Math.max(1, ...dist.map(d => d.n));

  return (
    <>
      <h2>나의 성장</h2>
      <p className="sub">완등한 문제를 기준으로 계산해요.</p>
      <div className="stats">
        <div className="stat"><div className="eyebrow">이번 달 완등</div><div className="v">{month.length}<small> 개</small></div></div>
        <div className="stat"><div className="eyebrow">최고 난이도</div><div className="v" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{best < 0 ? '–' : <><Tape v={best} size={16} />{G(best).c}</>}</div></div>
        <div className="stat"><div className="eyebrow">플래시 비율</div><div className="v">{flashRate}<small>%</small></div></div>
      </div>
      <section className="block chart"><h3>주별 최고 완등 색상</h3>
        {pts.length ? (
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="주별 최고 완등 색상">
            {GRADES.map(g => (
              <g key={g.v}>
                <line x1={pl} x2={W - pr} y1={Y(g.v)} y2={Y(g.v)} stroke="var(--line)" strokeWidth={0.6} />
                <rect x={pl - 9} y={Y(g.v) - 3.5} width={7} height={7} rx={1.5} fill={g.hex} stroke="rgba(0,0,0,.25)" strokeWidth={0.6} />
                <text x={pl - 13} y={Y(g.v) + 3.5} textAnchor="end" fontSize={9.5} fill="var(--muted)">{g.c}</text>
              </g>
            ))}
            {weeks.map((w, i) => (i % 3 === 0 || i === weeks.length - 1) && <text key={i} x={X(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)" fontFamily="IBM Plex Mono,monospace">{w.label}</text>)}
            <path d={area} fill="var(--accent)" opacity={0.12} />
            <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" />
            {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />)}
            <circle cx={last[0]} cy={last[1]} r={6} fill="var(--accent)" />
          </svg>
        ) : <p className="sub" style={{ margin: 0 }}>완등을 기록하면 그래프가 그려져요.</p>}
      </section>
      <section className="block"><h3>색상별 완등 문제 수</h3>
        <div className="dist">{dist.map(d => (
          <div className="dr" key={d.g.v}><span>{d.g.c}</span>
            <div className="bar"><i style={{ width: (d.n / mx) * 100 + '%', background: d.g.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.2)' }} /></div>
            <span className="mono" style={{ textAlign: 'right' }}>{d.n}</span></div>
        ))}</div>
      </section>
      <section className="block"><h3>최근 기록</h3>
        <div className="logs">{LL.length ? LL.sort((a, b) => b.date - a.date).slice(0, 15).map(l => (
          <LogRow key={l.id} l={l} lead={<Tape v={l.p.v} size={14} />}
            body={<div className="lnk" style={{ minWidth: 0 }} onClick={() => nav.openDetail(l.pid)}><div>{G(l.p.v).c} · {where(l.p)}</div><div className="d">{fmtD(l.date)} · {l.attempts}회 시도</div></div>}
            pending={pendingDel === l.id} onAsk={() => setPendingDel(l.id)} onCancel={() => setPendingDel(null)}
            onConfirm={() => { deleteAttempt(l.id); setPendingDel(null); toast(l.result === 'flash' ? '플래시 기록을 지웠어요' : '기록을 지웠어요'); }} />
        )) : <p className="sub" style={{ margin: 0 }}>아직 기록이 없어요. 문제를 추가하고 완등이나 프로젝트를 기록해 보세요.</p>}</div>
        <SampleNote />
      </section>
    </>
  );
}
