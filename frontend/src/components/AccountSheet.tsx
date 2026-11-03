import { useEffect, useState } from 'react';
import { clearAllLocal, toast, useAppState } from '../data/store';
import { ApiError, DEFAULT_SERVER, checkServer, login, logout, normalizeServer, signup, syncNow } from '../data/sync';
import { clock, fmtD, ls } from '../data/util';
import { isApp } from '../native';
import { SheetHead } from './common';
import type { Nav } from '../App';

const STATUS: Record<string, string> = { off: '로그인 안 함', idle: '동기화됨', syncing: '동기화 중…', offline: '서버에 연결할 수 없음', error: '오류', relogin: '다시 로그인 필요' };

export function AccountSheet({ nav }: { nav: Nav }) {
  const s = useAppState();
  const acc = s.account;
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [server, setServer] = useState(acc?.server || ls.get('lastServer', '') || DEFAULT_SERVER);
  const [username, setUsername] = useState(acc?.username || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [check, setCheck] = useState<'' | 'ok' | 'fail' | 'checking'>('');
  const [confirmOut, setConfirmOut] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => { if (!busy && check !== 'checking') { setSlow(false); return; } const t = setTimeout(() => setSlow(true), 4000); return () => clearTimeout(t); }, [busy, check]);
  const pending = s.problems.filter(p => p.dirty && !p.sample).length + s.logs.filter(l => l.dirty && !l.sample).length;
  const mixed = !isApp && location.protocol === 'https:' && /^http:/i.test(normalizeServer(server));

  async function submit() {
    setErr('');
    if (!server.trim()) { setErr('서버 주소를 입력해 주세요.'); return; }
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) { setErr('아이디는 영문·숫자·._- 로 3~30자예요.'); return; }
    if (password.length < 6) { setErr('비밀번호는 6자 이상이에요.'); return; }
    setBusy(true);
    try {
      ls.set('lastServer', normalizeServer(server));
      if (mode === 'signup') await signup(server, username, password, displayName.trim() || username);
      else await login(server, username, password);
      setPassword(''); toast(mode === 'signup' ? '가입했어요. 이 폰의 기록을 올리는 중이에요' : '로그인했어요');
    } catch (e) { setErr((e as ApiError).message || '실패했어요'); }
    setBusy(false);
  }

  return (
    <div className="wrap">
      <SheetHead back="close" onBack={nav.close} title="계정 · 동기화" />
      {acc && s.sync.status !== 'relogin' ? (
        <>
          <section className="block" style={{ marginTop: 6 }}>
            <dl className="kv">
              <dt>계정</dt><dd><b>{acc.displayName}</b> ({acc.username})</dd>
              <dt>서버</dt><dd className="mono" style={{ fontSize: 13 }}>{acc.server}</dd>
              <dt>상태</dt><dd>{STATUS[s.sync.status]}{pending > 0 && s.sync.status !== 'syncing' ? ` · 올릴 변경 ${pending}개` : ''}</dd>
              <dt>마지막 동기화</dt><dd>{s.sync.lastSync ? `${fmtD(s.sync.lastSync)} ${clock(s.sync.lastSync)}` : '아직 없음'}</dd>
            </dl>
            {s.sync.message && s.sync.status !== 'idle' && <div className="errbox" style={{ marginTop: 10 }}>{s.sync.message}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" style={{ flex: 1 }} disabled={s.sync.status === 'syncing'} onClick={async () => { await syncNow(); }}>지금 동기화</button>
              <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmOut(true)}>로그아웃</button>
            </div>
          </section>
          {confirmOut && (
            <section className="block warn"><h3>로그아웃할까요?</h3>
              <p className="sub" style={{ margin: '0 0 10px' }}>{pending > 0 ? `아직 서버에 못 올린 변경이 ${pending}개 있어요. ` : ''}이 폰의 기록을 남길지 고르세요. 서버의 기록은 그대로예요.</p>
              <div className="row">
                <button className="btn" style={{ flex: '1 1 auto' }} onClick={() => { logout(); setConfirmOut(false); toast('로그아웃했어요'); }}>기록 남기고 로그아웃</button>
                <button className="btn danger" style={{ flex: '1 1 auto' }} onClick={() => { logout(); clearAllLocal(); setConfirmOut(false); toast('로그아웃하고 이 폰의 기록을 지웠어요'); }}>폰 기록도 지우기</button>
                <button className="btn" style={{ flex: '1 1 auto' }} onClick={() => setConfirmOut(false)}>취소</button>
              </div>
            </section>
          )}
          <p className="sub" style={{ marginTop: 14, fontSize: 12 }}>기록, 시도, 베타 표시가 동기화돼요. 사진과 영상은 용량 때문에 이 폰에만 남아요.</p>
        </>
      ) : (
        <>
          <p className="sub" style={{ marginTop: 6 }}>{acc ? '로그인이 만료됐어요. 다시 로그인해 주세요.' : '로그인하면 기록이 서버에 저장돼 폰을 바꿔도 이어져요. 로그인하지 않아도 이 폰에서는 모두 쓸 수 있어요.'}</p>
          <div className="form" style={{ marginTop: 14 }}>
            <div className="field">
              <label className="lbl" htmlFor="srv" style={{ marginBottom: 0 }}>서버 주소</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id="srv" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="예: betalog-api.onrender.com" value={server} onChange={e => { setServer(e.target.value); setCheck(''); }} />
                <button className="btn" style={{ flex: 'none' }} disabled={!server.trim() || check === 'checking'} onClick={async () => { setCheck('checking'); setCheck((await checkServer(server)) ? 'ok' : 'fail'); }}>{check === 'checking' ? '확인 중' : '연결 확인'}</button>
              </div>
              <span className="sub" style={{ fontSize: 12 }}>
                {check === 'checking' && slow ? '서버를 깨우는 중이에요. 무료 서버라 최대 1분쯤 걸려요.' : check === 'ok' ? '✓ 서버에 연결됐어요.' : check === 'fail' ? '서버에 닿지 않아요. 주소와 인터넷 연결을 확인하세요.' : DEFAULT_SERVER ? '기본 서버 주소가 들어 있어요. 그대로 쓰면 돼요.' : '베타로그 서버 주소예요. 예: betalog-api.onrender.com'}
              </span>
              {mixed && <div className="errbox">웹 버전(https)에서는 http 서버에 연결할 수 없어요. 안드로이드 앱을 쓰거나 서버를 https로 올린 뒤 연결하세요.</div>}
            </div>
            <div className="seg2" role="group" aria-label="로그인 또는 가입">
              <button aria-pressed={mode === 'login'} onClick={() => setMode('login')}>로그인</button>
              <button aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>회원가입</button>
            </div>
            <div className="field"><label className="lbl" htmlFor="uid" style={{ marginBottom: 0 }}>아이디</label>
              <input id="uid" autoCapitalize="off" autoCorrect="off" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></div>
            {mode === 'signup' && <div className="field"><label className="lbl" htmlFor="dname" style={{ marginBottom: 0 }}>이름 <span className="opt">친구들에게 보일 이름</span></label>
              <input id="dname" value={displayName} onChange={e => setDisplayName(e.target.value)} /></div>}
            <div className="field"><label className="lbl" htmlFor="pw" style={{ marginBottom: 0 }}>비밀번호 <span className="opt">6자 이상</span></label>
              <input id="pw" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} /></div>
            {err && <div className="errbox">{err}</div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={submit}>{busy ? (slow ? '서버 깨우는 중… (최대 1분)' : '처리 중…') : mode === 'signup' ? '가입하고 동기화 시작' : '로그인'}</button>
          </div>
        </>
      )}
    </div>
  );
}
