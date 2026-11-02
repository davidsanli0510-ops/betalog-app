import { G } from '../data/grades';
import { Media } from '../data/media';
import { getState, liveProblems, problemById, toast, updateProblemQuiet, useAppState } from '../data/store';
import { clock, fmtD, uid } from '../data/util';
import { Clips } from '../replay/clips';
import { SheetHead, StatusPill, Thumb, where } from './common';
import type { Nav } from '../App';

export function AttachSheet({ clipId, nav }: { clipId: string; nav: Nav }) {
  const s = useAppState();
  const c = Clips.get(clipId);
  if (!c) return <div className="wrap"><SheetHead back="close" onBack={nav.close} title="클립을 찾을 수 없어요" /></div>;
  const list = liveProblems(s).slice().sort((a, b) => b.created - a.created);

  async function pick(pid: string) {
    const m = uid(); const ok = await Media.put(m, c!.blob);
    const p = problemById(getState(), pid); if (!p) return;
    updateProblemQuiet(pid, { videos: [...p.videos, { id: m, date: c!.date }] });
    Clips.markAttached(c!.id);
    toast(ok ? '문제에 클립을 붙였어요' : '저장 공간이 부족해 지금만 보여요');
    nav.openDetail(pid);
  }
  return (
    <div className="wrap">
      <SheetHead back="close" onBack={nav.close} title="클립을 붙일 문제" />
      <p className="sub">{c.len}초 클립 · {clock(c.date)}</p>
      <button className="btn primary" style={{ width: '100%', marginBottom: 14 }} onClick={() => { Clips.markAttached(c.id); nav.openForm(undefined, [c.blob]); }}>+ 새 문제로 만들기</button>
      <div className="plist">
        {list.length ? list.map(p => (
          <button className="prob" key={p.id} onClick={() => pick(p.id)}>
            <Thumb p={p} />
            <div style={{ minWidth: 0 }}><div className="t">{G(p.v).c} · {where(p)}</div><div className="m"><span>{fmtD(p.created)}</span>{p.videos.length > 0 && <span>영상 {p.videos.length}</span>}</div></div>
            <div><StatusPill pid={p.id} /></div>
          </button>
        )) : <p className="sub">아직 문제가 없어요. 새 문제로 만들어 보세요.</p>}
      </div>
    </div>
  );
}
