// Google Analytics 4 방문 통계. 게임마다 주소(/poker/, /yut/ …)가 달라 GA 의 '페이지 경로' 로 게임별 방문자를 본다.
// page_view 에는 game 매개변수(루트는 'home', 게임은 디렉토리 이름)도 붙인다. GA 관리 화면에서
// 이벤트 범위 맞춤 측정기준 'game' 을 등록하면 보고서에서 게임 이름으로 바로 묶어 볼 수 있다.
// 모든 페이지가 불러오는 shared/pwa.js 가 이 파일을 붙이므로 새 게임은 따로 할 일이 없다.
// 측정 ID 가 비어 있거나 로컬 개발 서버·파일로 열면 아무것도 보내지 않는다.
(() => {
  const MEASUREMENT_ID = '';
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
  if (!MEASUREMENT_ID || !location.protocol.startsWith('http') || LOCAL_HOSTS.includes(location.hostname)) return;

  const root = new URL('../', document.currentScript.src);
  const path = location.pathname.startsWith(root.pathname) ? location.pathname.slice(root.pathname.length) : '';
  const game = path.includes('/') ? path.split('/')[0] : 'home';

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, { game });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.append(script);
})();
