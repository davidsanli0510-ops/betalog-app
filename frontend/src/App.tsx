import { useCallback, useState } from 'react';
import { ls } from './data/util';
import { Toast } from './components/common';
import { TimerView } from './components/TimerView';
import { RecMini, ReplayView } from './components/ReplayView';
import { useInstallHint } from './install';

/** home-screen install guide: iPhone (keeps clips from being wiped) and Android (app-like, opens offline) */
function InstallHint() {
  const { show, hide, kind, install } = useInstallHint();
  if (!show) return null;
  if (kind === 'ios') return (
    <div className="install" id="installHint" role="note">
      <b>홈 화면에 추가해서 쓰세요</b>
      <p>사파리에서 7일 넘게 안 열면 아이폰이 저장한 클립을 지울 수 있어요. 홈 화면에 추가한 앱은 지워지지 않고, 앱처럼 전체 화면으로 열려요.</p>
      <ol><li>아래쪽 <b>공유 버튼</b>(네모에 위 화살표, 안 보이면 <b>···</b> 안에 있어요)을 누르고</li><li><b>홈 화면에 추가</b>를 누르세요.</li></ol>
      <p className="sub">홈 화면 앱은 사파리와 저장 공간이 따로라서, 지금 사파리에 저장한 클립은 옮겨지지 않아요. 필요한 클립은 먼저 사진 앱에 저장해 두세요.</p>
      <button className="btn sm" onClick={hide}>2주 동안 숨기기</button>
    </div>
  );
  return (
    <div className="install" id="installHint" role="note">
      <b>홈 화면에 설치해서 쓰세요</b>
      <p>앱처럼 아이콘으로 바로 열리고, 주소창 없이 전체 화면으로 보여요. 신호가 약한 암장에서도 열려요.</p>
      {install
        ? <button className="btn sm primary" id="installBtn" onClick={install}>홈 화면에 설치</button>
        : kind === 'samsung'
          ? <ol><li>아래쪽 <b>메뉴(≡)</b>를 누르고</li><li><b>현재 페이지 추가 → 홈 화면</b>을 누르세요.</li></ol>
          : <ol><li>오른쪽 위 <b>⋮ 메뉴</b>를 누르고</li><li><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누르세요.</li></ol>}
      <button className="btn sm" style={{ marginLeft: install ? 6 : 0 }} onClick={hide}>2주 동안 숨기기</button>
    </div>
  );
}

type Tab = 'replay' | 'timer';
const TAB_IDS: Tab[] = ['replay', 'timer'];

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'replay', label: '리플레이', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /><circle cx="9.5" cy="12" r="2" fill="currentColor" /></svg> },
  { id: 'timer', label: '타이머', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg> },
];

export default function App() {
  const [tab, setTabRaw] = useState<Tab>(() => { const t = ls.get<string>('tab', 'replay'); return TAB_IDS.includes(t as Tab) ? (t as Tab) : 'replay'; });
  const setTab = useCallback((t: Tab) => { setTabRaw(t); ls.set('tab', t); window.scrollTo(0, 0); }, []);

  return (
    <>
      <div className="wrap" id="app">
        <header className="top">
          <div className="logo">베타<b>로그</b></div>
        </header>
        <InstallHint />
        <main id="view">
          {tab === 'replay' && <ReplayView />}
          {tab === 'timer' && <TimerView />}
        </main>
      </div>

      <nav className="tabs" aria-label="메뉴"><div className="in">
        {TABS.map(t => <button key={t.id} data-tab={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.icon}{t.label}</button>)}
      </div></nav>

      <RecMini show={tab !== 'replay'} onOpen={() => setTab('replay')} />
      <Toast />
    </>
  );
}
