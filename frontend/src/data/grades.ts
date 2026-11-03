/* 더클라임 색상 난이도 (쉬움 → 어려움). 체계가 바뀌면 이 배열만 고치면 된다. */
export interface Grade { v: number; c: string; vr: string; hex: string; ink: string }
export const GRADES: Grade[] = [
  { c: '하양', vr: '입문', hex: '#f5f4ef', ink: '#222' },
  { c: '노랑', vr: '입문', hex: '#f2c230', ink: '#222' },
  { c: '주황', vr: '입문', hex: '#ee7d2b', ink: '#fff' },
  { c: '초록', vr: 'V0–1', hex: '#3aa35b', ink: '#fff' },
  { c: '파랑', vr: 'V1–2', hex: '#2f6fd1', ink: '#fff' },
  { c: '빨강', vr: 'V2–3', hex: '#d6403a', ink: '#fff' },
  { c: '보라', vr: 'V4–6', hex: '#8a4fc9', ink: '#fff' },
  { c: '회색', vr: 'V7–9', hex: '#8b8f94', ink: '#fff' },
  { c: '갈색', vr: 'V10+', hex: '#7a4e2d', ink: '#fff' },
].map((g, i) => ({ ...g, v: i }));
export const TOP = GRADES.length - 1;
export const G = (v: number): Grade => GRADES[Math.max(0, Math.min(TOP, v))];

export interface Gym { id: string; short: string; name: string; sectors: string[] }
const BASIC = ['슬랩', '수직벽', '오버행', '케이브'];
export const GYMS: Gym[] = ([
  ['yj', '양재', ['슬랩', '오버행', '케이브', '킬터보드']],
  ['is', '일산', ['컴피벽', '슬랩', '오버행', '케이브']],
  ['gn', '강남', ['슬랩', '수직벽', '오버행']],
  ['ss', '신사', ['네온월', '슬랩', '오버행']],
  ['nh', '논현', ['터널벽', '초보벽', '슬랩', '오버행']],
  ['yn', '연남', BASIC], ['hd', '홍대', BASIC], ['sl', '신림', BASIC],
  ['snu', '서울대', BASIC], ['mg', '마곡', BASIC], ['sd', '사당', BASIC],
] as [string, string, string[]][]).map(([id, short, sectors]) => ({ id, short, name: '더클라임 ' + short, sectors }));
export const gymOf = (id: string): Gym => GYMS.find(g => g.id === id) || { id, short: '기타', name: '기타 지점', sectors: BASIC };
