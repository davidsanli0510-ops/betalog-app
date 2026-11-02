import type { ReactNode } from 'react';
import { G } from '../data/grades';
import { gymOf } from '../data/grades';
import type { Attempt, Problem } from '../data/types';
import { logsOf, statusOf, useAppState, useToast } from '../data/store';
import { useMediaUrl } from '../data/media';

export const where = (p: Problem) => gymOf(p.gym).short + (p.sector ? ' · ' + p.sector : '');

export function Thumb({ p }: { p: Problem }) {
  const g = G(p.v), url = useMediaUrl(p.photo);
  if (p.photo && url) return <img className="thumb" src={url} alt="" />;
  return <span className="thumb" style={{ background: g.hex, color: g.ink }}>{g.c}</span>;
}

export function StatusPill({ pid }: { pid: string }) {
  const s = useAppState(), st = statusOf(s, pid);
  if (st === 'flash') return <span className="pill sent">플래시</span>;
  if (st === 'send') return <span className="pill ok">완등</span>;
  if (st === 'project') return <span className="pill soon">프로젝트 · {logsOf(s, pid).reduce((a, l) => a + l.attempts, 0)}회</span>;
  return <span className="pill none">기록 전</span>;
}
export function ResPill({ l }: { l: Attempt }) {
  return l.result === 'flash' ? <span className="pill sent">플래시</span> : l.result === 'send' ? <span className="pill ok">완등</span> : <span className="pill soon">프로젝트</span>;
}
export const Tape = ({ v, size = 12 }: { v: number; size?: number }) => <span className="tape" style={{ background: G(v).hex, width: size, height: size }} />;

/** a log row with an inline delete confirmation */
export function LogRow({ l, lead, body, pending, onAsk, onCancel, onConfirm }: {
  l: Attempt; lead: ReactNode; body: ReactNode; pending: boolean; onAsk: () => void; onCancel: () => void; onConfirm: () => void;
}) {
  if (pending) return (
    <div className="log confirm">{lead}<span><b>이 기록을 지울까요?</b></span>
      <button className="btn sm danger" onClick={onConfirm}>삭제</button><button className="btn sm" onClick={onCancel}>취소</button></div>
  );
  return <div className="log">{lead}{body}<ResPill l={l} /><button className="xbtn" onClick={onAsk} aria-label="기록 삭제"><I.trash /></button></div>;
}

export function SheetHead({ onBack, back = 'back', title, eyebrow, right }: { onBack: () => void; back?: 'back' | 'close'; title: ReactNode; eyebrow?: ReactNode; right?: ReactNode }) {
  return (
    <div className="sheethead">
      <button className="back" onClick={onBack} aria-label={back === 'back' ? '뒤로' : '닫기'}>{back === 'back' ? <I.chevron /> : <I.x />}</button>
      <div style={{ minWidth: 0, flex: 1 }}>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<div style={{ fontFamily: 'var(--display)', fontSize: 20 }}>{title}</div></div>
      {right}
    </div>
  );
}

export function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(1, value - 1))} aria-label="시도 줄이기">−</button>
      <output className="mono">{value}</output>
      <button onClick={() => onChange(value + 1)} aria-label="시도 늘리기">+</button>
    </div>
  );
}

export function Toast() {
  const t = useToast();
  return t ? <div className="toast" role="status">{t.text}</div> : null;
}

const sv = { fill: 'none', stroke: 'currentColor' } as const;
export const I = {
  trash: () => <svg width="16" height="16" viewBox="0 0 24 24" {...sv} strokeWidth="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>,
  cam: ({ s = 15 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...sv} strokeWidth={s > 20 ? 1.8 : 2}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  plus: ({ s = 18, w = 2.6 }: { s?: number; w?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...sv} strokeWidth={w}><path d="M12 5v14M5 12h14" /></svg>,
  chevron: () => <svg width="18" height="18" viewBox="0 0 24 24" {...sv} strokeWidth="2.2"><path d="M15 18l-6-6 6-6" /></svg>,
  x: () => <svg width="18" height="18" viewBox="0 0 24 24" {...sv} strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  pin: () => <svg width="14" height="14" viewBox="0 0 24 24" {...sv} strokeWidth="2"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>,
};
