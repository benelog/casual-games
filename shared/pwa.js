// 서비스 워커를 등록해 홈 화면에 설치하고 한 번 받은 게임은 오프라인에서도 열리게 한다.
// 루트 index.html 과 각 게임 index.html 이 <script src=".../shared/pwa.js" defer> 로 불러온다.
(() => {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const root = new URL('../', document.currentScript.src);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname }).catch(() => {});
  });
})();
