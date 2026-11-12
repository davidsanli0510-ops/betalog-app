export type Result = 'flash' | 'send' | 'project';
export interface Mark { x: number; y: number }
export interface VideoRef { id: string; date: number }

/** A problem the climber recorded. Photos and videos live on the device only (ids point into IndexedDB). */
export interface Problem {
  id: string;
  gym: string;
  v: number;
  sector: string;
  memo: string;
  created: number;
  updatedAt: number;
  photo: string | null;
  videos: VideoRef[];
  marks: Mark[];
  deleted?: boolean;
  sample?: boolean;
}

export interface Attempt {
  id: string;
  pid: string;
  attempts: number;
  result: Result;
  date: number;
  updatedAt: number;
  deleted?: boolean;
  sample?: boolean;
}
