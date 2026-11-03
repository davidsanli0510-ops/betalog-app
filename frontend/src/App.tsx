import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { GYMS } from './data/grades';
import { setState, useAppState } from './data/store';
import { ls } from './data/util';
import { isApp } from './native';
import { I, Toast } from './components/common';
import { ProblemsView } from './components/ProblemsView';
import { ProblemForm } from './components/ProblemForm';
import { ProblemDetail } from './components/ProblemDetail';
import { CompareView } from './components/CompareView';
import { RecordsView } from './components/RecordsView';
import { TimerView } from './components/TimerView';
import { RecMini, ReplayView } from './components/ReplayView';
import { AttachSheet } from './components/AttachSheet';
import { AccountSheet } from './components/AccountSheet';

type Tab = 'problems' | 'replay' | 'compare' | 'records' | 'timer';
type Sheet = { kind: 'detail'; id: string } | { kind: 'form'; id?: string; videos?: Blob[] } | { kind: 'attach'; clipId: string } | { kind: 'account' } | null;
export interface Nav {
  openDetail(id: string): void;
  openForm(id?: string, videos?: Blob[]): void;
  openAttach(clipId: string): void;
  openAccount(): void;
  close(): void;
  goTab(t: Tab): void;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'problems', label: '내 문제', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="3" /><circle cx="17" cy="9" r="2.5" /><circle cx="9" cy="17" r="2.5" /><circle cx="17" cy="18" r="2" /></svg> },
  { id: 'replay', label: '리플레이', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /><circle cx="9.5" cy="12" r="2" fill="currentColor" /></svg> },
  { id: 'compare', label: '영상 비교', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></svg> },
  { id: 'records', label: '기록', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V5M4 19h16" /><path d="M7 15l4-4 3 3 5-6" /></svg> },
  { id: 'timer', label: '타이머', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg> },
];

function SyncButton({ onClick }: { onClick: () => void }) {
  const s = useAppState();
  const pending = s.account ? s.problems.filter(p => p.dirty && !p.sample).length + s.logs.filter(l => l.dirty && !l.sample).length : 0;
  const st = s.sync.status;
  const [cls, label] = !s.account ? ['', '로그인']
    : st === 'syncing' ? ['wait', s.sync.message ? '깨우는 중' : '동기화 중']
    : st === 'relogin' ? ['err', '다시 로그인']
    : st === 'error' ? ['err', '동기화 오류']
    : pending ? ['wait', `대기 ${pending}`]
    : st === 'offline' ? ['', '오프라인'] : ['ok', '동기화됨'];
  return <button className={'syncbtn ' + cls} onClick={onClick} aria-label={'계정 · 동기화: ' + label}><i />{label}</button>;
}

export default function App() {
  const s = useAppState();
  const [tab, setTabRaw] = useState<Tab>(() => ls.get<Tab>('tab', 'problems'));
  const [sheet, setSheet] = useState<Sheet>(null);
  const sheetEl = useRef<HTMLDivElement>(null);
  const setTab = useCallback((t: Tab) => { setTabRaw(t); ls.set('tab', t); window.scrollTo(0, 0); }, []);

  const nav = useMemo<Nav>(() => ({
    openDetail: id => setSheet({ kind: 'detail', id }),
    openForm: (id, videos) => setSheet({ kind: 'form', id, videos }),
    openAttach: clipId => setSheet({ kind: 'attach', clipId }),
    openAccount: () => setSheet({ kind: 'account' }),
    close: () => setSheet(null),
    goTab: t => { setSheet(null); setTab(t); },
  }), [setTab]);

  useEffect(() => { sheetEl.current?.scrollTo(0, 0); }, [sheet?.kind, sheet && 'id' in sheet ? sheet.id : null]);
  useEffect(() => { document.body.style.overflow = sheet ? 'hidden' : ''; }, [sheet]);

  /* Android back button: close the sheet first, then go back to the first tab, then leave the app */
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    if (sheet) { if (sheet.kind === 'form' && sheet.id) setSheet({ kind: 'detail', id: sheet.id }); else setSheet(null); return true; }
    if (tab !== 'problems') { setTab('problems'); return true; }
    return false;
  };
  useEffect(() => {
    if (!isApp) return;
    const h = CapApp.addListener('backButton', () => { if (!backRef.current()) CapApp.exitApp(); });
    return () => { h.then(x => x.remove()); };
  }, []);

  return (
    <>
      <div className="wrap" id="app">
        <header className="top">
          <div className="logo">베타<b>로그</b></div>
          <div className="hdr-r">
            {tab === 'problems' && (
              <div className="gymsel"><I.pin />
                <select id="gym" aria-label="지점으로 거르기" value={s.gymF} onChange={e => setState({ gymF: e.target.value })}>
                  <option value="all">전체 지점</option>
                  {GYMS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select></div>
            )}
            <SyncButton onClick={nav.openAccount} />
          </div>
        </header>
        <main id="view">
          {tab === 'problems' && <ProblemsView nav={nav} />}
          {tab === 'replay' && <ReplayView nav={nav} />}
          {tab === 'compare' && <CompareView />}
          {tab === 'records' && <RecordsView nav={nav} />}
          {tab === 'timer' && <TimerView />}
        </main>
      </div>

      <nav className="tabs" aria-label="메뉴"><div className="in">
        {TABS.map(t => <button key={t.id} data-tab={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => { setSheet(null); setTab(t.id); }}>{t.icon}{t.label}</button>)}
      </div></nav>

      <RecMini show={tab !== 'replay' && !sheet} onOpen={() => setTab('replay')} />

      <div id="sheet" className="sheet" hidden={!sheet} ref={sheetEl}>
        {sheet?.kind === 'detail' && <ProblemDetail key={sheet.id} id={sheet.id} nav={nav} />}
        {sheet?.kind === 'form' && <ProblemForm key={(sheet.id || 'new') + (sheet.videos?.length || 0)} id={sheet.id} presetVideos={sheet.videos} nav={nav} />}
        {sheet?.kind === 'attach' && <AttachSheet clipId={sheet.clipId} nav={nav} />}
        {sheet?.kind === 'account' && <AccountSheet nav={nav} />}
      </div>
      <Toast />
    </>
  );
}
