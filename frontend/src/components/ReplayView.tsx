import { useEffect, useRef, useState } from 'react';
import { LENGTHS, MAX_LEN, replay, useReplay, type ReplayCfg, type ReplaySnap } from '../replay/engine';
import { Clips, clipName, useClips } from '../replay/clips';
import { toast } from '../data/store';
import { clock, hms } from '../data/util';
import { isApp, saveLabel, saveVideo } from '../native';
import type { Nav } from '../App';

let flashHook: (() => void) | null = null;
/** 60 → "1분", 90 → "1분 30초", 45 → "45초" */
export const fmtLen = (sec: number) => { const m = Math.floor(sec / 60), x = Math.round(sec % 60); return m ? `${m}분${x ? ` ${x}초` : ''}` : `${x}초`; };
export async function saveReplay(len?: number) {
  const r = await replay.save(len);
  if (!r.ok) { toast(r.message); return; }
  flashHook?.(); if (navigator.vibrate) navigator.vibrate(60);
  toast(!r.stored ? '저장 공간이 부족해 이 클립은 지금만 볼 수 있어요' : r.silent ? `직전 ${fmtLen(r.len)}를 소리 없이 저장했어요` : `직전 ${fmtLen(r.len)}를 저장했어요`);
}
const saveSub = (r: ReplaySnap) => r.saving ? '저장 중…' : r.buffered < 1.5 ? '녹화 준비 중' : `직전 ${fmtLen(Math.floor(r.buffered))} 저장`;
/** label under each length button: how much a press would really save right now */
const lenSub = (r: ReplaySnap, n: number) => r.saving ? '저장 중…' : r.buffered < 1.5 ? '준비 중' : r.buffered >= n - 1 ? '저장' : `지금은 ${fmtLen(Math.floor(r.buffered))}`;
const shortLen = (n: number) => (n === 90 ? '1분30' : fmtLen(n));

/* keyboard / bluetooth remote: space or enter saves while recording */
document.addEventListener('keydown', e => {
  if (!replay.stream || e.repeat) return;
  const tag = ((e.target as HTMLElement)?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.code === 'Space' || e.key === 'Enter' || e.key === 'MediaPlayPause') { e.preventDefault(); saveReplay(); } // last picked length
});

export function RecMini({ show, onOpen }: { show: boolean; onOpen: () => void }) {
  const r = useReplay();
  const visible = show && r.status === 'live';
  // lift the floating "add problem" button and toasts above the bar while it shows
  useEffect(() => { document.body.classList.toggle('rec-on', visible); return () => document.body.classList.remove('rec-on'); }, [visible]);
  if (!visible) return null;
  return (
    <div className="recmini" role="status">
      <i /><span onClick={onOpen} style={{ cursor: 'pointer' }}>REC {hms((Date.now() - r.startedAt) / 1000)}</span>
      {r.mode === 'exact'
        ? LENGTHS.map(n => <button key={n} disabled={r.buffered < 1.5 || r.saving} onClick={() => saveReplay(n)} aria-label={`직전 ${fmtLen(n)} 저장`}>{shortLen(n)}</button>)
        : <button disabled={r.buffered < 1.5 || r.saving} onClick={() => saveReplay()}>{r.saving ? '저장 중' : '방금 거 저장'}</button>}
    </div>
  );
}

function ClipCard({ id, nav }: { id: string; nav: Nav }) {
  const c = Clips.get(id)!;
  const [confirm, setConfirm] = useState(false);
  if (confirm) return (
    <div className="clip confirm"><video src={c.url + '#t=0.1'} playsInline preload="metadata" muted />
      <div className="meta"><b>이 클립을 지울까요?</b></div>
      <div className="acts"><button className="btn sm danger" onClick={() => { Clips.del(id); toast('클립을 지웠어요'); }}>삭제</button><button className="btn sm" onClick={() => setConfirm(false)}>취소</button></div></div>
  );
  return (
    <div className="clip">
      <video src={c.url + '#t=0.1'} controls playsInline preload="metadata" />
      <div className="meta"><b>{clock(c.date)}</b><span>{fmtLen(c.len)} · {(c.size / 1048576).toFixed(1)}MB</span>{c.attached ? <span className="attached">문제에 붙임</span> : null}</div>
      <div className="acts">
        <button className="btn sm primary" onClick={() => nav.openAttach(id)}>문제에 붙이기</button>
        <button className="btn sm" onClick={async () => {
          const r = await saveVideo(c.blob, clipName(c));
          toast(r === 'saved' ? '갤러리의 BetaLog 폴더에 저장했어요' : r === 'downloaded' ? '파일로 받았어요' : r === 'failed' ? '저장하지 못했어요. 저장 권한을 확인해 주세요' : r === 'shared' ? '공유 메뉴를 열었어요' : '취소했어요');
        }}>{saveLabel}</button>
        <button className="btn sm" onClick={() => setConfirm(true)} aria-label="클립 삭제">삭제</button>
      </div>
    </div>
  );
}

export function ReplayView({ nav }: { nav: Nav }) {
  const r = useReplay();
  const clips = useClips();
  const vid = useRef<HTMLVideoElement>(null);
  const [dim, setDim] = useState(false);
  const [fx, setFx] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  useEffect(() => {
    flashHook = () => { setFx(true); requestAnimationFrame(() => requestAnimationFrame(() => setFx(false))); };
    return () => { flashHook = null; };
  }, []);
  useEffect(() => {
    const v = vid.current; if (!v) return;
    v.srcObject = replay.stream; if (replay.stream) v.play().catch(() => {});
  }, [r.streamId, r.status]);
  useEffect(() => { if (replay.resumedNote) { replay.resumedNote = false; toast('화면을 벗어난 동안은 녹화되지 않아 버퍼를 새로 시작했어요'); } });
  useEffect(() => { if (!clearArmed) return; const t = setTimeout(() => setClearArmed(false), 4000); return () => clearTimeout(t); }, [clearArmed]);
  const setCfg = async (p: Partial<ReplayCfg>, msg: string) => { const ok = await replay.setCfg(p); if (ok) toast(msg); };
  const on = r.status === 'live' || r.status === 'paused';

  return (
    <>
      <h2>리플레이</h2>
      <p className="sub">카메라를 켜두면 최근 2분만 기억해요. 완등하고 내려와서 저장할 길이(1분·1분 30초·2분)를 골라 누르세요. 다른 탭으로 가도 녹화는 계속돼요.</p>

      {!on ? (
        <div style={{ marginTop: 12 }}>
          <ol className="rp-steps">
            <li><span className="k">1</span><div><b>폰을 거치대에 두고 카메라를 켜요</b><span>충전기를 꽂아 두면 오래 켜둘 수 있어요.</span></div></li>
            <li><span className="k">2</span><div><b>평소처럼 등반해요</b><span>저장 전까지는 아무것도 쌓이지 않아 용량 걱정이 없어요.</span></div></li>
            <li><span className="k">3</span><div><b>1분 · 1분 30초 · 2분 중 골라 눌러요</b><span>누른 순간부터 거꾸로 그만큼이 클립이 되고, 바로 문제에 붙이거나 {isApp ? '갤러리' : '사진첩'}에 저장할 수 있어요.</span></div></li>
          </ol>
          {r.error && <div className="errbox" style={{ marginBottom: 12 }}>{r.error}</div>}
          <button className="btn primary" style={{ width: '100%', fontSize: 17, padding: 16 }} disabled={r.status === 'starting'} onClick={() => replay.start()}>
            {r.status === 'starting' ? '카메라 여는 중…' : '카메라 켜기'}</button>
          <p className="sub" style={{ marginTop: 10, fontSize: 12 }}>{isApp ? '앱이 화면에 떠 있는 동안 녹화돼요. 다른 앱으로 나가면 멈춰요.' : '아이폰은 이 화면이 떠 있어야 녹화돼요. 다른 앱으로 나가거나 화면을 끄면 멈춰요.'}</p>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="pills">
            <span className={'pill ' + (r.mode === 'exact' ? 'on' : 'soon')}>{r.mode === 'exact' ? '녹화 중' : '호환 모드'}</span>
            {r.silent && <span className="pill soon">소리 없음 (이 기기 미지원)</span>}
            <span className={'pill ' + (r.awake ? 'on' : 'soon')}>{r.awake ? '화면 꺼짐 방지' : '화면 자동 꺼짐 주의'}</span>
          </div>
          <div className="stage">
            <video ref={vid} muted playsInline autoPlay />
            <div className="hud"><span className="recdot"><i />REC {hms((Date.now() - r.startedAt) / 1000)}</span></div>
            <div className="buf"><span>버퍼 {fmtLen(Math.floor(Math.min(r.buffered, MAX_LEN)))}</span><span className="bar"><i style={{ width: Math.min(100, (r.buffered / MAX_LEN) * 100) + '%' }} /></span><span>{fmtLen(MAX_LEN)}</span></div>
            <div className={'flashfx' + (fx ? ' go' : '')} />
          </div>
          {r.mode === 'compat' && <p className="sub" style={{ margin: '8px 0 0', fontSize: 12 }}>이 브라우저는 영상을 정확히 자르지 못해서 길이를 고를 수 없고, 직전 1~2분이 저장돼요. 안드로이드는 크롬, 아이폰은 최신 iOS의 사파리에서 길이를 골라 정확히 저장할 수 있어요.</p>}
          {r.status === 'paused' && (
            <div className="errbox" style={{ marginTop: 12 }}><b>카메라가 멈췄어요.</b> 화면을 벗어나 있으면 녹화가 멈춰요.
              <div style={{ marginTop: 8 }}><button className="btn sm primary" onClick={() => replay.restart()}>다시 시작</button></div></div>
          )}
          {r.mode === 'exact' ? (
            <>
              <div className="savehead">방금 거 저장<small>누른 순간부터 거꾸로 저장할 길이를 고르세요</small></div>
              <div className="savegrid">{LENGTHS.map(n => (
                <button key={n} className="bigsave" id={'rpSave' + n} disabled={r.status !== 'live' || r.buffered < 1.5 || r.saving} onClick={() => saveReplay(n)} aria-label={`직전 ${fmtLen(n)} 저장`}>
                  <b>{fmtLen(n)}</b><small>{r.status === 'paused' ? '카메라 멈춤' : lenSub(r, n)}</small></button>
              ))}</div>
            </>
          ) : (
            <button className="bigsave" id="rpSave" disabled={r.status !== 'live' || r.buffered < 1.5 || r.saving} onClick={() => saveReplay()}>
              <b>방금 거 저장</b><small>{r.status === 'paused' ? '카메라 멈춤' : saveSub(r)}</small></button>
          )}

          {r.saveError && <div className="errbox" style={{ marginTop: 10 }}><b>저장 실패 원인</b> (캡처해서 보내주세요)<div className="mono" style={{ fontSize: 11, marginTop: 4, overflowWrap: 'anywhere' }}>{r.saveError}</div></div>}
          <div className="block rp-ctrl">
            <div className="crow"><span>화질<small>낮을수록 배터리·발열이 덜해요</small></span>
              <div className="seg">{([480, 720, 1080] as const).map(n => <button key={n} aria-pressed={r.cfg.res === n} onClick={() => r.cfg.res !== n && setCfg({ res: n }, `${n}p로 바꾸고 버퍼를 새로 시작했어요`)}>{n}p</button>)}</div></div>
            <div className="crow"><span>소리 녹음</span>
              <div className="seg">{[true, false].map(a => <button key={String(a)} aria-pressed={r.cfg.audio === a} onClick={() => r.cfg.audio !== a && setCfg({ audio: a }, a ? '소리도 녹음해요' : '소리 없이 녹화해요')}>{a ? '켜기' : '끄기'}</button>)}</div></div>
            <div className="row">
              <button className="btn" style={{ flex: '1 1 auto' }} onClick={() => setCfg({ facing: r.cfg.facing === 'environment' ? 'user' : 'environment' }, r.cfg.facing === 'environment' ? '앞 카메라로 바꿨어요' : '뒤 카메라로 바꿨어요')}>카메라 전환</button>
              <button className="btn" style={{ flex: '1 1 auto' }} onClick={() => setDim(true)}>화면 어둡게</button>
              <button className="btn" style={{ flex: '1 1 auto' }} onClick={() => { replay.stop(); toast('카메라를 껐어요'); }}>끄기</button>
            </div>
          </div>
          <p className="sub" style={{ marginTop: 10, fontSize: 12 }}>블루투스 키보드·리모컨의 스페이스나 엔터 키로도 저장돼요. 마지막으로 고른 길이({fmtLen(r.cfg.len)})로 저장해요.</p>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '26px 0 10px' }}><h3 style={{ margin: 0, fontSize: 16 }}>저장한 클립</h3>{clips.length > 0 && <span className="mono sub">{clips.length}개</span>}</div>
      <div className="clips">
        {clips.length ? clips.map(c => <ClipCard key={c.id} id={c.id} nav={nav} />)
          : <div className="empty span" style={{ marginTop: 0 }}><span>아직 저장한 클립이 없어요.<br />녹화 중에 '방금 거 저장'을 누르면 여기 쌓여요.</span></div>}
      </div>
      {clips.length > 0 && (
        <div className="samplenote"><span>클립은 이 기기에만 보관돼요. 남길 클립은 문제에 붙이거나 {isApp ? '갤러리' : '사진첩'}에 저장하세요.</span>
          <button className={'btn sm' + (clearArmed ? ' danger' : '')} onClick={() => { if (!clearArmed) { setClearArmed(true); return; } setClearArmed(false); Clips.clear(); toast('클립을 모두 지웠어요'); }}>
            {clearArmed ? '한 번 더 누르면 모두 지워요' : '클립 모두 지우기'}</button></div>
      )}

      {dim && (
        <div className="dim">
          <span className="recdot"><i />녹화 중 {hms((Date.now() - r.startedAt) / 1000)}</span>
          {r.mode === 'exact'
            ? <div className="dgrid">{LENGTHS.map(n => <button key={n} className="dsave" disabled={r.saving || r.buffered < 1.5} onClick={() => saveReplay(n)}>{fmtLen(n)} 저장<small>{lenSub(r, n)}</small></button>)}</div>
            : <button className="dsave" disabled={r.saving} onClick={() => saveReplay()}>방금 거 저장<small>{saveSub(r)}</small></button>}
          <button className="wake" onClick={() => setDim(false)}>화면 밝히기</button>
        </div>
      )}
    </>
  );
}
