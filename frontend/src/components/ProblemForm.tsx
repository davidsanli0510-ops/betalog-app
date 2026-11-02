import { useEffect, useMemo, useState } from 'react';
import { GRADES, GYMS, gymOf } from '../data/grades';
import { Media, shrinkImage, useMediaUrl } from '../data/media';
import { addAttempt, addProblem, getState, lastPersistOk, problemById, setState, toast, updateProblem } from '../data/store';
import type { Result } from '../data/types';
import { uid } from '../data/util';
import { I, SheetHead, Stepper } from './common';
import type { Nav } from '../App';

export function ProblemForm({ id, presetVideos, nav }: { id?: string; presetVideos?: Blob[]; nav: Nav }) {
  const s0 = getState();
  const editing = id ? problemById(s0, id) : undefined;
  const [v, setV] = useState<number | null>(editing ? editing.v : null);
  const [gym, setGym] = useState(editing ? editing.gym : s0.gymF !== 'all' ? s0.gymF : s0.lastGym);
  const [sector, setSector] = useState(editing?.sector || '');
  const [memo, setMemo] = useState(editing?.memo || '');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [videos, setVideos] = useState<Blob[]>(presetVideos || []);
  const [result, setResult] = useState<Result | 'none'>('none');
  const [att, setAtt] = useState(1);
  const [saving, setSaving] = useState(false);
  const existingUrl = useMediaUrl(!photoChanged ? editing?.photo : null);
  const newUrl = useMemo(() => (photoBlob ? URL.createObjectURL(photoBlob) : null), [photoBlob]);
  useEffect(() => () => { if (newUrl) URL.revokeObjectURL(newUrl); }, [newUrl]);
  const photoUrl = newUrl || existingUrl || null;
  const g = gymOf(gym);

  async function pickPhoto(f: File | undefined) {
    if (!f) return;
    try { setPhotoBlob(await shrinkImage(f)); setPhotoChanged(true); } catch { toast('이 사진은 열 수 없어요. JPG나 PNG로 올려주세요'); }
  }
  async function save() {
    if (v === null || saving) return; setSaving(true);
    let fail = false;
    if (!editing) {
      let photo: string | null = null;
      if (photoBlob) { photo = uid(); if (!(await Media.put(photo, photoBlob))) fail = true; }
      const vids = [];
      for (const b of videos) { const m = uid(); if (!(await Media.put(m, b))) fail = true; vids.push({ id: m, date: Date.now() }); }
      const p = addProblem({ gym, v, sector, memo: memo.trim(), photo, videos: vids, marks: [] });
      if (result !== 'none') addAttempt(p.id, result === 'flash' ? 1 : att, result);
      setState({ lastGym: gym });
      if (!lastPersistOk()) fail = true;
      toast(fail ? '저장 공간이 부족해 일부 내용은 지금만 보여요' : '문제를 저장했어요');
      nav.openDetail(p.id); return;
    }
    const patch: Parameters<typeof updateProblem>[1] = { v, gym, sector, memo: memo.trim() };
    if (photoChanged) {
      await Media.del(editing.photo); patch.photo = null; patch.marks = [];
      if (photoBlob) { patch.photo = uid(); if (!(await Media.put(patch.photo, photoBlob))) fail = true; }
    }
    updateProblem(editing.id, patch);
    toast(fail ? '저장 공간이 부족해 일부 내용은 지금만 보여요' : '수정했어요');
    nav.openDetail(editing.id);
  }

  return (
    <div className="wrap">
      <SheetHead back="close" onBack={() => (editing ? nav.openDetail(editing.id) : nav.close())} title={editing ? '문제 수정' : '문제 추가'} />
      <div className="form">
        <div>
          <div className="lbl">문제 사진 <span className="opt">선택</span></div>
          {photoUrl ? (
            <>
              <div className="preview"><img src={photoUrl} alt="문제 사진" /></div>
              <div className="photobar">
                <label className="btn sm" htmlFor="fphoto"><I.cam />사진 바꾸기</label>
                <button className="btn sm" onClick={() => { setPhotoBlob(null); setPhotoChanged(true); }}>사진 빼기</button>
              </div>
            </>
          ) : (
            <label className="ghostwall" htmlFor="fphoto" style={{ minHeight: 180 }}><I.cam s={30} /><b>사진 고르기</b><span>문제가 보이게 찍은 사진이나 캡처</span></label>
          )}
          <input type="file" id="fphoto" accept="image/*" onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        </div>

        <div>
          <div className="lbl">색상 난이도 <span className="req">필수</span></div>
          <div className="colorgrid">{GRADES.map(x => (
            <button key={x.v} className="cbtn" aria-pressed={v === x.v} onClick={() => setV(x.v)}><span className="tape" style={{ background: x.hex }} />{x.c}<small>{x.vr}</small></button>
          ))}</div>
        </div>

        <div>
          <label className="lbl" htmlFor="fgym">지점</label>
          <select id="fgym" className="sel" value={gym} onChange={e => { setGym(e.target.value); setSector(''); }}>
            {GYMS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>

        <div>
          <div className="lbl">벽 <span className="opt">선택</span></div>
          <div className="segw">{g.sectors.map(x => <button key={x} className="chip" aria-pressed={sector === x} onClick={() => setSector(sector === x ? '' : x)}>{x}</button>)}</div>
        </div>

        {!editing && (
          <>
            <div>
              <div className="lbl">영상 <span className="opt">선택 · 여러 개 가능</span></div>
              <div className="segw">
                {videos.map((f, i) => (
                  <span className="chip" key={i}>영상 {i + 1} · {(f.size / 1048576).toFixed(1)}MB
                    <button className="xmini" onClick={() => setVideos(videos.filter((_, j) => j !== i))} aria-label={`영상 ${i + 1} 빼기`}>×</button></span>
                ))}
                <label className="chip" htmlFor="fvid" style={{ cursor: 'pointer' }}>+ 영상 추가</label>
              </div>
              <input type="file" id="fvid" accept="video/*" multiple onChange={e => { setVideos([...videos, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
            </div>
            <div>
              <div className="lbl">오늘 결과 <span className="opt">선택</span></div>
              <div className="segw">{([['none', '나중에'], ['flash', '플래시'], ['send', '완등'], ['project', '프로젝트']] as const).map(([k, l]) => (
                <button key={k} className="chip" aria-pressed={result === k} onClick={() => setResult(k)}>{l}</button>
              ))}</div>
              {(result === 'send' || result === 'project') && (
                <div className="row" style={{ alignItems: 'center', marginTop: 10 }}><span className="sub" style={{ margin: 0 }}>시도 횟수</span><Stepper value={att} onChange={setAtt} /></div>
              )}
              {result === 'flash' && <p className="sub" style={{ margin: '8px 0 0' }}>첫 시도에 완등한 경우예요. 시도 1회로 기록돼요.</p>}
            </div>
          </>
        )}

        <div>
          <label className="lbl" htmlFor="fmemo">메모 <span className="opt">선택</span></label>
          <textarea id="fmemo" className="sel" placeholder="예: 세 번째 홀드에서 왼발 하이스텝" value={memo} onChange={e => setMemo(e.target.value)} />
        </div>
      </div>
      <div className="savebar">
        <button className="btn primary" style={{ flex: 1 }} disabled={v === null || saving} onClick={save}>
          {v === null ? '색상을 골라 주세요' : saving ? '저장 중…' : editing ? '수정 저장' : '문제 저장'}
        </button>
      </div>
    </div>
  );
}
