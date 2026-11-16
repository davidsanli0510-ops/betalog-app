import { memo, useRef, useState } from 'react';
import { toast } from '../data/store';
import { isIOS } from '../platform';
import { Clips } from '../replay/clips';
import { replay, LENGTHS } from '../replay/engine';
import { cutLast, readMovie, type Movie } from '../replay/trim';
import { fmtLen } from './ReplayView';

/**
 * Takes a video from the phone's own camera app and keeps the last 1 min / 1 min 30 / 2 min of it as a clip,
 * cut without re-encoding (see replay/trim.ts).
 *
 * iPhone Safari lowers the quality of videos it hands to web pages: recording through the page gives about
 * 480×360, and picking from the photo library is scaled down to 720p. Only a file picked through "Files"
 * arrives untouched, so that is the main path there, with the quick in-page recording as a low-quality option.
 * Android browsers hand over the camera app's original file, so there recording is the main button.
 */
const camName = isIOS ? '아이폰' : '폰';
const LOW = 720; // shorter side below this: the phone lowered the quality

export const CameraShot = memo(function CameraShot() {
  const input = useRef<HTMLInputElement>(null), pick = useRef<HTMLInputElement>(null);
  const [guide, setGuide] = useState(false);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [raw, setRaw] = useState<File | null>(null);
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [err, setErr] = useState('');

  function open(el: HTMLInputElement | null, camera: boolean) {
    if (camera && replay.stream) { replay.stop(); toast('기본 카메라를 쓰려고 리플레이를 껐어요'); }
    setErr(''); setMovie(null); setRaw(null);
    el?.click();
  }
  async function picked(f: File | undefined) {
    if (input.current) input.current.value = '';
    if (pick.current) pick.current.value = '';
    if (!f) return;
    setRaw(f); setBusy('reading'); setErr('');
    try { setMovie(await readMovie(f)); }
    catch (e) { console.warn(e); setErr(`이 영상은 자르지 못해요. (${(e as Error).message || e})`); }
    setBusy('');
  }
  async function keep(sec: number | null) {
    if (!raw) return;
    setBusy('saving');
    try {
      const { blob, len } = movie ? cutLast(movie, sec) : { blob: raw as Blob, len: 0 };
      const type = blob.type || raw.type || 'video/mp4';
      const stored = await Clips.add({ id: 'c' + Date.now(), date: Date.now(), len: Math.round(len), type, size: blob.size }, blob);
      toast(stored ? `${len ? fmtLen(Math.round(len)) + ' ' : ''}클립으로 저장했어요` : '저장 공간이 부족해서 이 화면을 닫으면 사라져요. 사진첩에 저장해 두세요');
      setMovie(null); setRaw(null); setErr('');
    } catch (e) {
      console.warn(e); setErr(`저장하지 못했어요. (${(e as Error).message || e})`);
    }
    setBusy('');
  }

  const dur = movie?.duration || 0;
  const w = Math.round(movie?.video.width || 0), h = Math.round(movie?.video.height || 0);
  const low = !!movie && w > 0 && Math.min(w, h) < LOW;
  return (
    <section className="block camshot">
      <div className="camhead"><b>{camName} 카메라 영상 자르기</b><small>기본 카메라 앱으로 찍은 영상에서 끝부분 1분 · 1분 30초 · 2분만 남겨요. 다시 압축하지 않아 화질이 그대로예요.</small></div>
      <input ref={pick} id="camPick" type="file" accept="video/*,.mov,.mp4" hidden onChange={e => picked(e.target.files?.[0])} />
      <input ref={input} id="camInput" type="file" accept="video/*" capture="environment" hidden onChange={e => picked(e.target.files?.[0])} />
      {!raw && <>
        {!isIOS && <button className="btn primary" id="camOpen" style={{ width: '100%', marginBottom: 8 }} onClick={() => open(input.current, true)}>카메라로 찍기</button>}
        <button className={'btn' + (isIOS ? ' primary' : '')} id="camPickBtn" style={{ width: '100%' }} onClick={() => open(pick.current, false)}>{isIOS ? '원본 화질로 가져오기' : '갤러리에서 가져오기'}</button>
        {isIOS && <button className="linkbtn" id="camGuide" aria-expanded={guide} onClick={() => setGuide(!guide)}>{guide ? '방법 접기' : '원본 화질로 가져오는 방법'}</button>}
        {isIOS && guide && <ol className="camguide">
          <li>아이폰 <b>카메라 앱</b>으로 평소처럼 찍어요.</li>
          <li><b>사진 앱</b>에서 그 영상 → <b>공유</b> → <b>파일에 저장</b>을 눌러요.</li>
          <li>여기서 <b>원본 화질로 가져오기</b> → <b>파일 선택</b>을 누르고 그 영상을 골라요.</li>
          <li className="warn"><b>사진 보관함</b>에서 고르면 아이폰이 720p로 줄여서 넘겨줘요.</li>
        </ol>}
        {isIOS && <button className="btn" id="camOpen" style={{ width: '100%', marginTop: 8 }} onClick={() => open(input.current, true)}>바로 찍기 <small style={{ opacity: .7, fontWeight: 500 }}>· 화질 낮음</small></button>}
      </>}
      {busy === 'reading' && <p className="sub">영상을 읽는 중…</p>}
      {movie && busy !== 'reading' && (
        <div className="camcut">
          <p className="sub" style={{ margin: '0 0 8px' }} id="camInfo">영상 <b className="mono">{fmtLen(Math.round(dur))}</b>{w ? <> · <span className="mono">{w}×{h}</span></> : null} · {(raw!.size / 1048576).toFixed(0)}MB. 남길 부분을 고르세요.</p>
          {low && <div className="errbox" id="camLow" style={{ margin: '0 0 8px' }}>{isIOS
            ? <>아이폰이 화질을 낮춰서 넘겨준 영상이에요({w}×{h}). 화질이 중요하면 취소하고 <b>원본 화질로 가져오기 → 파일 선택</b>으로 다시 골라 주세요.</>
            : <>화질이 낮은 영상이에요({w}×{h}). 카메라 앱의 동영상 해상도 설정을 확인해 보세요.</>}</div>}
          <div className="savegrid">
            {LENGTHS.map(n => <button key={n} className="bigsave" id={'camCut' + n} disabled={!!busy} onClick={() => keep(n)}>
              <b>{fmtLen(n)}</b><small>{n < dur - 0.5 ? '마지막 ' + fmtLen(n) : `영상이 ${fmtLen(Math.round(dur))}라 전부`}</small></button>)}
            <button className="bigsave alt" id="camAll" disabled={!!busy} onClick={() => keep(null)}><b>전체</b><small>{fmtLen(Math.round(dur))}</small></button>
          </div>
          {busy === 'saving' && <p className="sub">저장하는 중…</p>}
          <button className="btn sm" style={{ marginTop: 8 }} disabled={!!busy} onClick={() => { setMovie(null); setRaw(null); }}>취소</button>
        </div>
      )}
      {err && (
        <div className="errbox" style={{ marginTop: 8 }}>{err}
          {raw && !movie && <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm primary" disabled={!!busy} onClick={() => keep(null)}>자르지 않고 전체 저장</button>
            <button className="btn sm" onClick={() => { setRaw(null); setErr(''); }}>취소</button></div>}
        </div>
      )}
    </section>
  );
});
