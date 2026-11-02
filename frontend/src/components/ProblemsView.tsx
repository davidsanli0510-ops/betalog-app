import { useState } from 'react';
import { GRADES, gymOf } from '../data/grades';
import { clearSamples, liveProblems, statusOf, toast, useAppState } from '../data/store';
import { fmtD } from '../data/util';
import { I, StatusPill, Thumb, where } from './common';
import type { Nav } from '../App';

export function SampleNote() {
  const s = useAppState();
  if (!s.problems.some(p => p.sample)) return null;
  return (
    <div className="samplenote"><span>예시 문제가 들어 있어요. 내 기록만 남기려면 지우세요.</span>
      <button className="btn sm" onClick={() => { clearSamples(); toast('예시 기록을 지웠어요'); }}>예시 지우기</button></div>
  );
}

export function ProblemsView({ nav }: { nav: Nav }) {
  const s = useAppState();
  const [filter, setFilter] = useState<number | 'all'>('all');
  const all = liveProblems(s).filter(p => s.gymF === 'all' || p.gym === s.gymF);
  const list = all.filter(p => filter === 'all' || p.v === filter);
  const sent = all.filter(p => ['flash', 'send'].includes(statusOf(s, p.id))).length;
  const proj = all.filter(p => statusOf(s, p.id) === 'project').length;
  const groups = GRADES.map(g => ({ g, items: list.filter(p => p.v === g.v).sort((a, b) => b.created - a.created) })).filter(x => x.items.length);

  return (
    <>
      <h2>내 문제</h2>
      <p className="sub">{s.gymF === 'all' ? '' : gymOf(s.gymF).name + ' · '}{all.length}개 기록 · 완등 {sent} · 프로젝트 {proj}</p>
      {all.length ? (
        <>
          <div className="chips" role="group" aria-label="색상 필터">
            <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>전체</button>
            {GRADES.map(g => {
              const n = all.filter(p => p.v === g.v).length;
              return <button key={g.v} className="chip" aria-pressed={filter === g.v} onClick={() => setFilter(g.v)}><span className="tape" style={{ background: g.hex }} />{g.c}{n ? <span className="cnt">{n}</span> : null}</button>;
            })}
          </div>
          {groups.length ? groups.map(({ g, items }) => (
            <section className="group" key={g.v}>
              <div className="ghead"><span className="tape" style={{ background: g.hex }} />{g.c}<span className="vr">{g.vr}</span><span className="n">{items.length}개</span></div>
              <div className="plist">{items.map(p => (
                <button className="prob" key={p.id} onClick={() => nav.openDetail(p.id)}>
                  <Thumb p={p} />
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{where(p)}</div>
                    <div className="m"><span>{fmtD(p.created)}</span>{p.videos.length > 0 && <span>영상 {p.videos.length}</span>}{p.marks.length > 0 && <span>베타 표시</span>}{p.memo && <span className="memo1">{p.memo}</span>}</div>
                  </div>
                  <div><StatusPill pid={p.id} /></div>
                </button>
              ))}</div>
            </section>
          )) : <div className="empty"><b>이 색상으로 기록한 문제가 없어요</b><span>다른 색상을 고르거나 새 문제를 추가하세요.</span></div>}
        </>
      ) : (
        <div className="empty"><b>{s.gymF === 'all' ? '아직 기록한 문제가 없어요' : '이 지점에서 기록한 문제가 없어요'}</b>
          <span>푼 문제나 도전 중인 문제를 사진·영상과 함께 색상별로 남겨 보세요.</span>
          <button className="btn primary" onClick={() => nav.openForm()}>문제 추가</button></div>
      )}
      <SampleNote />
      <button className="fab" onClick={() => nav.openForm()} aria-label="문제 추가"><I.plus />문제 추가</button>
    </>
  );
}
