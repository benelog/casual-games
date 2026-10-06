// 서비스 워커. 앱 껍데기는 설치할 때 받아 두고, 게임 파일과 에셋은 처음 열 때 캐시에 담는다.
// - 같은 출처(HTML·JS·CSS·에셋): 네트워크 먼저, 안 되면 캐시. 배포하면 바로 새 버전이 보이고
//   HTML 과 JS 의 버전이 섞이지 않는다. 다시 받을 때는 HTTP 캐시(ETag)가 304 로 줄여 준다
// - CDN 라이브러리(three.js 등): 주소에 버전이 박혀 있어 캐시에 있으면 그대로 쓴다
// 껍데기 목록이나 캐시 방식을 바꾸면 VERSION 을 올린다.

const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const CDN = `cdn-${VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'shared/theme.css',
  'shared/i18n.js',
  'shared/pwa.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES.map((path) => new URL(path, self.registration.scope))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL, RUNTIME, CDN]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const response = await fetch(request);
    if (response.status === 200) cache.put(request, response.clone()); // 206(부분 응답)은 담을 수 없다
    return response;
  } catch (error) {
    // 오프라인: poker/index.html?game=holdem 처럼 쿼리가 달라도 같은 페이지를 내준다
    const cached = (await caches.match(request)) ?? (await caches.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CDN);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200) cache.put(request, response.clone()); // 206(부분 응답)은 담을 수 없다
  return response;
}
