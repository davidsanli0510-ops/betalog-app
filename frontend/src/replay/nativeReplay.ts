import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * The iPhone app's native recorder (ios/App/CapApp-SPM/Sources/CapApp-SPM/BetaReplayPlugin.swift).
 * Only present inside the app; the website keeps using the browser camera (ring.ts).
 */
export const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export interface NativeInfo {
  resolution: number; audio: boolean; zoomOptions: number[]; zoom: number;
  lens: string; codec: string; buffered: number; recording: boolean;
}
export interface NativeClip { path: string; seconds: number; size: number; photos: boolean; photosError?: string }
interface BetaReplayPlugin {
  start(o: { resolution: number; audio: boolean }): Promise<NativeInfo>;
  stop(): Promise<void>;
  status(): Promise<NativeInfo>;
  save(o: { seconds: number; toPhotos: boolean }): Promise<NativeClip>;
  setZoom(o: { zoom: number }): Promise<{ zoom: number }>;
  setPreview(o: { x: number; y: number; width: number; height: number; visible: boolean; radius?: number; clipTop?: number; clipBottom?: number }): Promise<void>;
  saveToPhotos(o: { path: string }): Promise<{ photos: boolean }>;
  deleteClip(o: { path: string }): Promise<void>;
  addListener(ev: 'replayEvent', fn: (e: { type: 'interrupted' | 'resumed' | 'error'; message?: string }) => void): Promise<PluginListenerHandle>;
}
export const BetaReplay = registerPlugin<BetaReplayPlugin>('BetaReplay');
/** a file in the app's folders as a URL the page can load (video src, fetch) */
export const fileUrl = (path: string) => Capacitor.convertFileSrc('file://' + path);

/** keeps the native camera picture on top of `el`, following scrolling and resizing */
export function followPreview(el: HTMLElement, visible: () => boolean): () => void {
  let raf = 0, alive = true;
  const send = () => {
    raf = 0; if (!alive) return;
    const r = el.getBoundingClientRect();
    // the picture sits on top of the page, so keep it between the sticky header and the tab bar
    const clipTop = document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0;
    const clipBottom = document.querySelector('nav.tabs')?.getBoundingClientRect().top ?? innerHeight;
    BetaReplay.setPreview({ x: r.left, y: r.top, width: r.width, height: r.height, clipTop, clipBottom,
      visible: visible() && r.bottom > clipTop && r.top < clipBottom, radius: 14 }).catch(() => {});
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(send); };
  addEventListener('scroll', kick, { passive: true }); addEventListener('resize', kick);
  const ro = new ResizeObserver(kick); ro.observe(el);
  const iv = setInterval(kick, 500); // layout changes above the stage (banners, errors) move it too
  kick();
  return () => {
    alive = false; cancelAnimationFrame(raf); clearInterval(iv); ro.disconnect();
    removeEventListener('scroll', kick); removeEventListener('resize', kick);
    BetaReplay.setPreview({ x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => {});
  };
}
