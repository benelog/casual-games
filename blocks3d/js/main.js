// 3D 블록: 규칙(game.js), 3D 씬(scene.js), 저장(save.js)을 잇고 HUD·입력을 처리한다.

import { Tetris3D, PIT_SIZES } from './game.js';
import { SET_IDS, spawnCells } from './pieces.js';
import { moveVector, rotation } from './controls.js';
import { SaveStore, browserStorage } from './save.js';
import { TetrisScene, layerColor } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, formatNumber, mountLangToggle } from '../../shared/i18n.js';

const $ = (id) => document.getElementById(id);

// 누르고 있으면 반복되는 동작: 처음 기다리는 시간과 반복 간격(초)
const REPEAT = {
  left: [0.17, 0.06],
  right: [0.17, 0.06],
  up: [0.17, 0.06],
  down: [0.17, 0.06],
  soft: [0.12, 0.04],
};

const KEYS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyZ: 'soft',
  Space: 'drop',
  KeyQ: 'pitch+',
  KeyA: 'pitch-',
  KeyW: 'roll+',
  KeyS: 'roll-',
  KeyE: 'yaw+',
  KeyD: 'yaw-',
  Comma: 'view-left',
  Period: 'view-right',
};

document.title = t('title');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new TetrisScene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
scene.setPreview($('next-view'));

let settings = store.loadSettings();
let game = null;
let backdrop = null; // 메뉴 뒤에 보여 줄 빈 우물
let state = 'menu'; // menu | playing | paused | over
const held = new Map(); // 누르고 있는 반복 동작 → 다음 반복까지 남은 시간
let toastTimer = 0;

// ---------- 메뉴 ----------

function segmented(container, options, current, onPick) {
  container.replaceChildren();
  for (const { value, label, detail } of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.setAttribute('aria-pressed', String(value === current));
    button.innerHTML = `<span>${label}</span>${detail ? `<small>${detail}</small>` : ''}`;
    button.addEventListener('click', () => onPick(value));
    container.append(button);
  }
}

function describeBest(best) {
  return best ? t('best', { score: formatNumber(best.score), layers: best.layers, level: best.level }) : '';
}

function renderMenu() {
  segmented(
    $('set-options'),
    SET_IDS.map((id) => ({ value: id, label: t(`set.${id}`), detail: t(`set.${id}.detail`) })),
    settings.set,
    (set) => {
      settings = { ...settings, set };
      renderMenu();
    },
  );
  segmented(
    $('size-options'),
    PIT_SIZES.map((size) => ({ value: size, label: `${size}×${size}` })),
    settings.size,
    (size) => {
      settings = { ...settings, size };
      renderMenu();
    },
  );
  $('menu-best').textContent = describeBest(store.loadBest(settings));
  if (!backdrop || backdrop.width !== settings.size) {
    backdrop = new Tetris3D({ width: settings.size, set: settings.set });
    backdrop.piece = null;
    scene.setup(backdrop);
  }
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function setState(next) {
  state = next;
  show('menu', state === 'menu');
  show('pause', state === 'paused');
  show('result', state === 'over');
  const inGame = !!game && state !== 'menu';
  show('stats', inGame);
  show('controls', inGame);
  show('side', inGame);
  show('pad', state === 'playing');
  $('btn-pause').textContent = state === 'paused' ? t('resume') : t('pause');
  held.clear();
  // 포커스가 버튼에 남아 있으면 Space 가 그 버튼을 누르게 된다
  if (state === 'playing') document.activeElement?.blur?.();
  updateInsets();
  scene.loop.setPaused(state === 'paused');
}

function openMenu() {
  game = null;
  backdrop = null;
  renderMenu();
  setState('menu');
  $('btn-start').focus();
}

function start() {
  sound.unlock();
  store.saveSettings(settings);
  game = new Tetris3D({ width: settings.size, set: settings.set });
  scene.setup(game);
  scene.resetView();
  game.drain();
  buildGauge();
  updateHud();
  setState('playing');
}

function pause() {
  if (state === 'playing') setState('paused');
}

function resume() {
  if (state === 'paused') setState('playing');
}

function gameOver() {
  const mode = { set: game.set, size: game.width };
  const previous = store.loadBest(mode);
  const record = { score: game.score, layers: game.layers, level: game.level };
  const isBest = game.score > 0 && store.recordBest(mode, record);
  $('result-title').textContent = isBest ? t('newBest') : t('gameOver');
  $('result-detail').textContent = t('result', {
    score: formatNumber(game.score),
    layers: game.layers,
    level: game.level,
    pieces: game.pieces,
  });
  $('result-best').textContent = isBest
    ? previous
      ? t('previousBest', { score: formatNumber(previous.score) })
      : ''
    : describeBest(previous);
  $('result').dataset.tone = isBest ? 'win' : '';
  setState('over');
  $('btn-again').focus();
}

// ---------- HUD ----------

function buildGauge() {
  const gauge = $('gauge');
  gauge.replaceChildren();
  for (let z = game.height - 1; z >= 0; z--) {
    const item = document.createElement('li');
    item.style.setProperty('--color', layerColor(z));
    item.innerHTML = '<i></i>';
    gauge.append(item);
  }
}

function updateGauge() {
  const items = $('gauge').children;
  for (let z = 0; z < game.height; z++) {
    const count = game.layerCount(z);
    const item = items[game.height - 1 - z];
    item.style.setProperty('--fill', `${(count / game.area) * 100}%`);
    item.classList.toggle('empty', count === 0);
  }
  $('gauge').classList.toggle('danger', game.stackHeight() >= game.height - 3);
}

function updateHud() {
  $('score').textContent = formatNumber(game.score);
  $('layers').textContent = game.layers;
  $('level').textContent = game.level;
  const next = game.next;
  scene.showNext(spawnCells(next, game.width, game.depth), next);
  $('next-name').textContent = t(`piece.${next}`);
  $('side-best').textContent = describeBest(store.loadBest({ set: game.set, size: game.width }));
  updateGauge();
}

function toast(text, tone = '') {
  const el = $('toast');
  el.textContent = text;
  el.dataset.tone = tone;
  el.classList.remove('show');
  void el.offsetWidth; // 애니메이션을 처음부터 다시
  el.classList.add('show');
  toastTimer = 1.4;
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 우물이 그 사이에 오도록 한다 */
function updateInsets() {
  const h = window.innerHeight;
  const top = $('top').getBoundingClientRect().bottom;
  const pad = $('pad').hidden ? 0 : h - $('pad').getBoundingClientRect().top;
  const side = $('side');
  const insets = { top, bottom: pad, left: 0, right: 0 };
  if (!side.hidden) {
    const rect = side.getBoundingClientRect();
    if (narrow.matches) insets.top = Math.max(top, rect.bottom);
    else insets.left = rect.right;
  }
  scene.setInsets(insets);
}

const narrow = window.matchMedia('(max-width: 720px)');
narrow.addEventListener('change', updateInsets);
window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('pad'));
new ResizeObserver(updateInsets).observe($('side'));

// ---------- 사건 ----------

function flush() {
  let hudDirty = false;
  for (const event of game.drain()) {
    scene.handle(event);
    switch (event.type) {
      case 'move':
        sound.play('move');
        break;
      case 'rotate':
        sound.play('rotate');
        break;
      case 'drop':
        sound.play('drop');
        break;
      case 'lock':
        sound.play('lock');
        hudDirty = true;
        break;
      case 'clear': {
        const n = event.layers.length;
        sound.play(event.perfect ? 'perfect' : 'clear', 1 + (n - 1) * 0.08);
        const score = formatNumber(event.score);
        let text = n === 1 ? t('clearOne', { score }) : t('clearMany', { n, score });
        if (event.perfect) text = t('perfect', { score });
        toast(text, n > 1 || event.perfect ? 'big' : '');
        hudDirty = true;
        break;
      }
      case 'level':
        sound.play('level');
        setTimeout(() => toast(t('levelUp', { n: event.level }), 'level'), 600);
        break;
      case 'spawn':
        hudDirty = true;
        break;
      case 'over':
        sound.play('over');
        hudDirty = true;
        break;
    }
  }
  if (hudDirty || game.score !== Number($('score').dataset.value)) {
    $('score').dataset.value = game.score;
    updateHud();
  }
  if (game.over && state === 'playing') gameOver();
}

// ---------- 입력 ----------

function perform(action) {
  if (state !== 'playing' || !game || game.over) return;
  const q = scene.quadrant();
  if (action in REPEAT && action !== 'soft') {
    game.move(...moveVector(action, q));
  } else if (action === 'soft') {
    game.softDrop();
  } else if (action === 'drop') {
    game.hardDrop();
  } else if (action === 'view-left') {
    scene.turnView(-1);
  } else if (action === 'view-right') {
    scene.turnView(1);
  } else {
    const [, turn, sign] = action.match(/^(pitch|roll|yaw)([+-])$/);
    const { axis, dir } = rotation(turn, sign === '+' ? 1 : -1, q);
    game.rotate(axis, dir);
  }
}

function press(action) {
  sound.unlock();
  if (held.has(action)) return;
  perform(action);
  if (REPEAT[action]) held.set(action, REPEAT[action][0]);
}

function release(action) {
  held.delete(action);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (state === 'menu') {
      e.preventDefault();
      start();
    } else if (state === 'over') {
      e.preventDefault();
      start();
    }
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
    return;
  }
  if (e.code === 'KeyM') {
    toggleSound();
    return;
  }
  const action = KEYS[e.code];
  if (!action || state !== 'playing') return;
  e.preventDefault();
  if (e.repeat) return; // 반복은 직접 처리한다
  press(action);
});

window.addEventListener('keyup', (e) => {
  const action = KEYS[e.code];
  if (action) release(action);
});

for (const button of $('pad').querySelectorAll('[data-action]')) {
  const action = button.dataset.action;
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    press(action);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, () => release(action));
  }
  button.addEventListener('contextmenu', (e) => e.preventDefault());
}

function toggleSound() {
  sound.enabled = !sound.enabled;
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', start);
$('btn-menu').addEventListener('click', openMenu);
$('btn-resume').addEventListener('click', resume);
$('btn-quit').addEventListener('click', openMenu);
$('btn-pause').addEventListener('click', () => (state === 'paused' ? resume() : pause()));
$('btn-sound').addEventListener('click', toggleSound);

// 다른 창으로 가면 멈춘다
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) $('toast').classList.remove('show');
  if (!game) {
    // 메뉴 뒤에서 빈 우물이 천천히 돈다
    scene.viewTarget.azimuth += dt * 0.15;
    return;
  }
  if (state === 'playing') {
    for (const [action, wait] of held) {
      let left = wait - dt;
      while (left <= 0 && held.has(action)) {
        perform(action);
        left += REPEAT[action][1];
      }
      if (held.has(action)) held.set(action, left);
    }
    game.update(dt);
    flush();
  }
  scene.sync(game);
  return state === 'playing';
};

$('loading').hidden = true;
openMenu();
