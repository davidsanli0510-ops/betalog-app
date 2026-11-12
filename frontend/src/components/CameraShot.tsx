import { useRef, useState } from 'react';
import { toast } from '../data/store';
import { isIOS } from '../install';
import { Clips } from '../replay/clips';
import { replay, LENGTHS } from '../replay/engine';
import { cutLast, readMovie, type Movie } from '../replay/trim';
import { fmtLen } from './ReplayView';

/**
 * Records with the phone's own camera app (full camera quality: stabilisation, HDR, lenses), then keeps
 * the last 1 min / 1 min 30 / 2 min of it as a clip — cut without re-encoding (see replay/trim.ts).
 */
const camName = isIOS ? '아이폰 카메라' : '폰 카메라';

export function CameraShot() {
  const input = useRef<HTMLInputElement>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [raw, setRaw] = useState<File | null>(null);
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [err, setErr] = useState('');

  function open() {
    if (replay.stream) { replay.stop(); toast('기본 카메라를 쓰려고 리플레이를 껐어요'); }
    setErr(''); setMovie(null); setRaw(null);
    input.current?.click();
  }
  async function picked(f: File | undefined) {
    if (input.current) input.current.value = '';
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
  const opts = LENGTHS.filter(n => n < dur - 0.5);
  return (
    <section className="block camshot">
      <div className="camhead"><b>{camName}로 찍기</b><small>카메라 앱의 화질 그대로 찍고, 끝에서부터 원하는 길이만 남겨요. 리플레이처럼 계속 켜두는 방식은 아니에요.</small></div>
      <input ref={input} id="camInput" type="file" accept="video/*" capture="environment" hidden onChange={e => picked(e.target.files?.[0])} />
      {!raw && <button className="btn" id="camOpen" style={{ width: '100%' }} onClick={open}>{camName} 열기</button>}
      {busy === 'reading' && <p className="sub">영상을 읽는 중…</p>}
      {movie && busy !== 'reading' && (
        <div className="camcut">
          <p className="sub" style={{ margin: '0 0 8px' }}>찍은 영상 <b className="mono">{fmtLen(Math.round(dur))}</b> · {(raw!.size / 1048576).toFixed(0)}MB. 남길 부분을 고르세요.</p>
          <div className="savegrid">
            {opts.map(n => <button key={n} className="bigsave" id={'camCut' + n} disabled={!!busy} onClick={() => keep(n)}><b>{fmtLen(n)}</b><small>마지막</small></button>)}
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
}
