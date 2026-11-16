/** which phone/browser this is, for wording and for where saved videos go */
const ua = navigator.userAgent;
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);
export const isSamsungBrowser = /SamsungBrowser/i.test(ua);
/** what people call the phone's photo app */
export const galleryName = isIOS ? '사진첩' : '갤러리';
