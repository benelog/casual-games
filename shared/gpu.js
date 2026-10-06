// WebGL 렌더러를 만들고 모바일 GPU 문제를 다룬다.
//
// Pixel 10(PowerVR D-Series) 의 Chrome 에서 그림자 맵을 그리다 GPU 컨텍스트를 잃는 일이 잦았다.
// 한 번 잃으면 Chrome 이 그 사이트의 WebGL 을 막아 다른 게임까지 로딩에서 멈춘다.
// 그래서 PowerVR 에서는 그림자를 끄고 해상도를 낮춘 안전 모드로 그린다.
// 주소에 ?safe=1 / ?safe=0 을 붙이면 안전 모드를 강제로 켜고 끌 수 있다.
//
// 또 컴퓨터가 뜨거워지지 않도록 그리는 일을 아낀다 (startLoop).
// 초당 60 번을 넘겨 그리지 않고, 잔잔한 배경 움직임만 있을 때는 30 번으로 줄이며,
// 그림자 맵은 그림자를 드리우는 물체가 움직일 때만 다시 그리고, 창이 포커스를 잃으면 멈춘다.

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

const MAX_PIXEL_RATIO = 1.5;
const FRAME_MS = 1000 / 60 - 1; // 60Hz 화면의 프레임 간격이 조금 흔들려도 거르지 않도록 여유를 둔다
const CALM_MS = 1000 / 30 - 1;
const LINGER_MS = 200; // 움직임이 끝난 뒤에도 이만큼은 매 프레임 그려 마무리 동작을 놓치지 않는다
const SHADOW_REFRESH_MS = 250; // 움직임을 알아채지 못했더라도 그림자가 이보다 오래 어긋나 있지 않게 한다

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
  box.dataset.problem = ''; // 받는 중 표시 줄을 숨긴다
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
 * 그리기는 startLoop 로 시작한다.
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.shadowMap.enabled = shadows && !safe;
  renderer.shadowMap.autoUpdate = false; // startLoop 의 due() 가 필요할 때만 다시 그리게 한다
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); // 복구될 수 있으면 three.js 가 다시 그린다
    showProblem(t('lost'), true);
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    const box = document.getElementById('loading');
    box.hidden = true;
    delete box.dataset.problem;
  });
  return renderer;
}

/**
 * 씬의 frame(now) 을 화면 주사율에 맞춰(초당 60 번까지) 부르기 시작한다.
 * 창이 포커스를 잃거나 setPaused(true) 인 동안에는 멈추고, 그 사이 캔버스 크기가 바뀌면 한 장만 다시 그린다.
 *
 * 씬은 frame 안에서 그리기 전에 due() 를 물어 이번 프레임을 그릴지 정한다.
 * 씬의 메서드가 frame 밖에서 불리면(조작, 게임 진행) 무언가 바뀐 것으로 보고 잠시 동안 매 프레임 그린다.
 */
export function startLoop(renderer, scene) {
  let tickAt = 0;
  let drawnAt = -Infinity;
  let shadowAt = -Infinity;
  let livelyAt = -Infinity;
  let castAt = -Infinity;
  let touchAt = performance.now();
  let forced = true;
  let inFrame = false;
  let paused = false;
  let blurred = false;

  const proto = Object.getPrototypeOf(scene);
  for (const name of Object.getOwnPropertyNames(proto)) {
    const method = Object.getOwnPropertyDescriptor(proto, name).value;
    if (name === 'constructor' || typeof method !== 'function') continue;
    if (name === 'frame') {
      scene.frame = (now) => {
        inFrame = true;
        try {
          method.call(scene, now);
        } finally {
          inFrame = false;
        }
      };
    } else {
      scene[name] = (...args) => {
        if (!inFrame) touchAt = performance.now();
        return method.apply(scene, args);
      };
    }
  }

  const tick = (now) => {
    const elapsed = now - tickAt;
    if (elapsed < FRAME_MS) return;
    tickAt = now - (elapsed % FRAME_MS);
    scene.frame(now);
  };
  const run = () => renderer.setAnimationLoop(paused || blurred ? null : tick);
  addEventListener('blur', () => {
    blurred = true;
    run();
  });
  addEventListener('focus', () => {
    blurred = false;
    run();
  });
  new ResizeObserver(() => {
    forced = true;
    if (paused || blurred) requestAnimationFrame((now) => scene.frame(now));
  }).observe(renderer.domElement);
  run();

  return {
    /**
     * 이번 프레임을 그려야 하면 true.
     * lively: 눈에 띄게 움직이는 것이 있다. 없으면 초당 30 번만 그린다.
     * casters: 그림자를 드리우는 물체가 움직였다. 없으면 그림자 맵은 가끔만 다시 그린다.
     */
    due(now, lively, casters = lively) {
      if (lively) livelyAt = now;
      if (casters) castAt = now;
      const recent = (at) => now - at < LINGER_MS;
      const touched = forced || recent(touchAt);
      if (!touched && !recent(livelyAt) && now - drawnAt < CALM_MS) return false;
      if (touched || recent(castAt) || now - shadowAt >= SHADOW_REFRESH_MS) {
        renderer.shadowMap.needsUpdate = true;
        shadowAt = now;
      }
      drawnAt = now;
      forced = false;
      return true;
    },
    /** 게임을 일시정지한 동안 그리기를 멈춘다 */
    setPaused(value) {
      paused = value;
      run();
    },
  };
}
