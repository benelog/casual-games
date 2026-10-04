// WebGL 렌더러를 만들고 모바일 GPU 문제를 다룬다.
//
// Pixel 10(PowerVR D-Series) 의 Chrome 에서 그림자 맵을 그리다 GPU 컨텍스트를 잃는 일이 잦았다.
// 한 번 잃으면 Chrome 이 그 사이트의 WebGL 을 막아 다른 게임까지 로딩에서 멈춘다.
// 그래서 PowerVR 에서는 그림자를 끄고 해상도를 낮춘 안전 모드로 그린다.
// 주소에 ?safe=1 / ?safe=0 을 붙이면 안전 모드를 강제로 켜고 끌 수 있다.

import { createT } from './i18n.js';

const t = createT({
  ko: {
    blocked: '이 브라우저에서 3D 그래픽(WebGL)을 쓸 수 없습니다. 브라우저를 완전히 종료한 뒤 다시 열어 보세요.',
    lost: '그래픽 오류로 3D 화면이 멈췄습니다.',
    reload: '다시 불러오기',
  },
  en: {
    blocked: '3D graphics (WebGL) are unavailable in this browser. Fully close the browser and open it again.',
    lost: 'The 3D view stopped because of a graphics error.',
    reload: 'Reload',
  },
});

function rendererName(gl) {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

function safeMode(gl) {
  const forced = new URLSearchParams(location.search).get('safe');
  if (forced !== null) return forced !== '0';
  return /PowerVR/i.test(rendererName(gl));
}

/** 게임마다 있는 #loading 에 안내를 띄운다. reload 가 참이면 다시 불러오기 버튼을 단다 */
function showProblem(message, reload) {
  const box = document.getElementById('loading');
  if (!box) return;
  box.hidden = false;
  box.replaceChildren(message);
  if (reload) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('reload');
    button.style.cssText = 'display:block;margin:12px auto 0;padding:8px 18px;font:inherit;cursor:pointer;pointer-events:auto';
    button.addEventListener('click', () => location.reload());
    box.append(button);
  }
}

/**
 * THREE.WebGLRenderer 를 만들고 픽셀 비율·그림자를 GPU 에 맞춘다.
 * 그림자를 쓰는 게임도 shadowMap.enabled 는 여기서 정하므로 직접 켜지 않는다.
 */
export function createRenderer(THREE, options = {}, { shadows = true } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer(options);
  } catch (error) {
    showProblem(t('blocked'), false);
    throw error;
  }
  const safe = safeMode(renderer.getContext());
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, safe ? 1.5 : 2));
  renderer.shadowMap.enabled = shadows && !safe;
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); // 복구될 수 있으면 three.js 가 다시 그린다
    showProblem(t('lost'), true);
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    document.getElementById('loading').hidden = true;
  });
  return renderer;
}
