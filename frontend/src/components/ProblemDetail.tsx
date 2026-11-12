import { useState, type MouseEvent } from 'react';
import { G, gymOf } from '../data/grades';
import { Media, shrinkImage, useMediaUrl } from '../data/media';
import { addAttempt, deleteAttempt, deleteProblem, getState, logsOf, problemById, toast, updateProblem, updateProblemQuiet, useAppState } from '../data/store';
import type { Mark, Problem, Result, VideoRef } from '../data/types';
import { fmtD, uid } from '../data/util';
import { compare } from './CompareView';
import { I, LogRow, SheetHead, StatusPill, Stepper } from './common';
import type { Nav } from '../App';
import { saveLabel, saveVideo } from '../native';
import { clipName } from '../replay/clips';

function PhotoMarker({ p }: { p: Problem }) {
  const url = useMediaUrl(p.photo);
  const marks = p.marks || [];
  const setMarks = (m: Mark[]) => updateProblem(p.id, { marks: m });
  function tap(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setMarks([...marks, { x: +(((e.clientX - r.left) / r.width) * 100).toFixed(2), y: +(((e.clientY - r.top) / r.height) * 100).toFixed(2) }]);
  }
  async function replace(f: File | undefined) {
    if (!f) return;
    let b: Blob; try { b = await shrinkImage(f); } catch { toast('이 사진은 열 수 없어요. JPG나 PNG로 올려주세요'); return; }
    await Media.del(p.photo); const id = uid(); const ok = await Media.put(id, b);
    updateProblem(p.id, { photo: id, marks: [] });
    toast(ok ? '사진을 올렸어요. 홀드를 순서대로 눌러 보세요' : '저장 공간이 부족해 이 사진은 지금만 보여요');
  }
  const line = marks.map(q => q.x + ',' + q.y).join(' ');
  return (
    <>
      {p.photo ? (
        <>
          <div className="photobox" id="pbox" onClick={tap}>
            {url ? <img src={url} alt="문제 사진" draggable={false} /> : <div style={{ aspectRatio: '3/4' }} />}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              {marks.length > 1 && <>
                <polyline points={line} fill="none" stroke="rgba(0,0,0,.6)" strokeWidth={5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={line} fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="7 5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              </>}
            </svg>
            {marks.map((q, i) => (
              <button key={i} className="pmark" style={{ left: q.x + '%', top: q.y + '%' }} aria-label={`${i + 1}번 표시 지우기`}
                onClick={e => { e.stopPropagation(); setMarks(marks.filter((_, j) => j !== i)); }}>{i + 1}</button>
            ))}
          </div>
          <div className="wallhint"><span>{marks.length ? `홀드 ${marks.length}개 표시 · 번호를 누르면 지워져요` : '사진에서 홀드를 순서대로 누르면 베타가 표시돼요'}</span>
            <button className="btn sm" disabled={!marks.length} onClick={() => setMarks(marks.slice(0, -1))}>되돌리기</button></div>
          <div className="photobar">
            <label className="btn sm" htmlFor="wup"><I.cam />사진 바꾸기</label>
            <button className="btn sm" onClick={async () => { await Media.del(p.photo); updateProblem(p.id, { photo: null, marks: [] }); toast('사진을 지웠어요'); }}>사진 지우기</button>
          </div>
        </>
      ) : (
        <label className="ghostwall" htmlFor="wup"><I.cam s={34} /><b>문제 사진 올리기</b><span>사진이나 캡처를 올리면 그 위에<br />홀드 순서를 찍을 수 있어요</span></label>
      )}
      <input type="file" id="wup" accept="image/*" onChange={e => { replace(e.target.files?.[0]); e.target.value = ''; }} />
    </>
  );
}

function VideoCard({ p, v, pending, setPending }: { p: Problem; v: VideoRef; pending: boolean; setPending: (id: string | null) => void }) {
  const url = useMediaUrl(v.id);
  async function toGallery() {
    const b = await Media.blob(v.id); if (!b) { toast('이 기기에서 영상을 찾을 수 없어요'); return; }
    const r = await saveVideo(b, clipName({ date: v.date, type: b.type || 'video/mp4' }));
    toast(r === 'saved' ? '갤러리에 저장했어요' : r === 'downloaded' ? '파일로 받았어요' : r === 'failed' ? '저장하지 못했어요' : r === 'shared' ? '공유 메뉴를 열었어요' : '취소했어요');
  }
  return (
    <div className="vid">
      {url ? <video src={url + '#t=0.1'} controls playsInline preload="metadata" /> : <div className="ghostvid" style={{ border: 0 }}>{url === '' ? '이 기기에 없는 영상' : ''}</div>}
      <div className="cap">
        {pending ? <>
          <b>지울까요?</b>
          <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <button className="btn sm danger" onClick={async () => { compare.forget(Media.cached(v.id)); await Media.del(v.id); updateProblemQuiet(p.id, { videos: p.videos.filter(x => x.id !== v.id) }); setPending(null); toast('영상을 지웠어요'); }}>삭제</button>
            <button className="btn sm" onClick={() => setPending(null)}>취소</button></span>
        </> : <>
          <span className="mono">{fmtD(v.date)}</span>
          <span className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
            <button className="btn sm" onClick={async () => { const u = await Media.url(v.id); if (!u) { toast('이 기기에서 영상을 찾을 수 없어요'); return; } toast(`영상 비교의 '${compare.put(u) === 'a' ? '내 시도' : '완등자'}' 칸에 넣었어요`); }}>비교</button>
            <button className="xbtn" onClick={toGallery} aria-label={saveLabel}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" /></svg></button>
            <button className="xbtn" onClick={() => setPending(v.id)} aria-label="영상 삭제"><I.trash /></button></span>
        </>}
      </div>
    </div>
  );
}

export function ProblemDetail({ id, nav }: { id: string; nav: Nav }) {
  const s = useAppState();
  const p = problemById(s, id);
  const [att, setAtt] = useState(1);
  const [pendingDel, setPendingDel] = useState<string | null>(null);
  const [pendingVid, setPendingVid] = useState<string | null>(null);
  const [pendingProb, setPendingProb] = useState(false);
  if (!p) return <div className="wrap"><SheetHead onBack={nav.close} title="문제를 찾을 수 없어요" /></div>;
  const g = G(p.v), gym = gymOf(p.gym), L = logsOf(s, p.id), canFlash = !L.length, flashed = L.some(l => l.result === 'flash');

  function log(result: Result) {
    if (result === 'flash' && logsOf(getState(), p!.id).length) { toast('플래시는 첫 시도에만 기록할 수 있어요'); return; }
    addAttempt(p!.id, att, result); setAtt(1);
    toast(result === 'project' ? '프로젝트로 기록했어요' : result === 'flash' ? '플래시! 기록했어요' : '완등을 기록했어요');
  }
  async function addVideos(files: File[]) {
    let fail = false; const add: VideoRef[] = [];
    for (const f of files) { const m = uid(); if (!(await Media.put(m, f))) fail = true; add.push({ id: m, date: Date.now() }); }
    const cur = problemById(getState(), p!.id); if (cur) updateProblemQuiet(cur.id, { videos: [...cur.videos, ...add] });
    toast(fail ? '저장 공간이 부족해 영상은 지금만 볼 수 있어요' : `영상 ${files.length}개를 추가했어요`);
  }
  async function removeProblem() {
    for (const m of [p!.photo, ...p!.videos.map(v => v.id)]) { if (m) compare.forget(Media.cached(m)); await Media.del(m); }
    deleteProblem(p!.id); nav.close(); toast('문제를 지웠어요');
  }
  const primaryFlash = att === 1 && canFlash;

  return (
    <div className="wrap">
      <SheetHead onBack={nav.close} eyebrow={gym.name + (p.sector ? ' · ' + p.sector : '')} title={`${g.c} 문제`}
        right={<button className="btn sm" onClick={() => nav.openForm(p.id)}>수정</button>} />
      <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
        <span className="chip"><span className="tape" style={{ background: g.hex }} />{g.c} · {g.vr}</span>
        <StatusPill pid={p.id} /><span className="sub" style={{ margin: 0 }}>{fmtD(p.created)} 기록</span>
      </div>
      {p.memo && <p className="memo">{p.memo}</p>}
      <PhotoMarker p={p} />

      <section className="block"><h3>시도 기록</h3>
        <div className="row" style={{ alignItems: 'center' }}><span className="sub" style={{ margin: 0 }}>시도 횟수</span><Stepper value={att} onChange={setAtt} /></div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" style={{ flex: 1 }} onClick={() => log(primaryFlash ? 'flash' : 'send')}>{primaryFlash ? '플래시 완등' : '완등 기록'}</button>
          <button className="btn" style={{ flex: 1 }} onClick={() => log('project')}>아직 프로젝트</button>
        </div>
        {!canFlash && <p className="sub" style={{ margin: '8px 0 0' }}>{flashed ? '플래시로 완등한 문제예요. 플래시는 문제당 한 번만 기록돼요.' : '이미 시도한 문제라 플래시는 기록할 수 없어요. 첫 시도에 완등해야 플래시예요.'}</p>}
        {L.length > 0 && <div className="logs" style={{ marginTop: 10 }}>{L.map(l => (
          <LogRow key={l.id} l={l} lead={<span className="mono d">{fmtD(l.date)}</span>} body={<span>{l.attempts}회 시도</span>}
            pending={pendingDel === l.id} onAsk={() => setPendingDel(l.id)} onCancel={() => setPendingDel(null)}
            onConfirm={() => { deleteAttempt(l.id); setPendingDel(null); toast(l.result === 'flash' ? '플래시 기록을 지웠어요' : '기록을 지웠어요'); }} />
        ))}</div>}
      </section>

      <section className="block"><h3>영상 {p.videos.length > 0 && <span className="sub" style={{ fontWeight: 400 }}>· {p.videos.length}개</span>}</h3>
        <div className="vids">
          {p.videos.map(v => <VideoCard key={v.id} p={p} v={v} pending={pendingVid === v.id} setPending={setPendingVid} />)}
          <label className="ghostvid" htmlFor="vup"><span><I.plus s={26} w={2} /><br />영상 추가</span></label>
        </div>
        <input type="file" id="vup" accept="video/*" multiple onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) addVideos(f); }} />
        <p className="sub" style={{ margin: '10px 0 0' }}>기록·사진·영상은 모두 이 폰에만 저장돼요.</p>
      </section>

      {pendingProb ? (
        <section className="block warn"><h3>이 문제를 지울까요?</h3>
          <p className="sub" style={{ margin: '0 0 10px' }}>사진, 영상 {p.videos.length}개, 시도 기록 {L.length}개가 모두 지워지고 되돌릴 수 없어요.</p>
          <div className="row"><button className="btn danger" style={{ flex: 1 }} onClick={removeProblem}>문제 삭제</button><button className="btn" style={{ flex: 1 }} onClick={() => setPendingProb(false)}>취소</button></div>
        </section>
      ) : <button className="textbtn" style={{ marginTop: 8 }} onClick={() => setPendingProb(true)}>문제 삭제</button>}
    </div>
  );
}
