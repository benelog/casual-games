// 파이프 연결: 규칙(game.js), 3D 씬(scene.js), 저장(save.js)을 잇고 HUD·입력을 처리한다.

import { PipesGame, SIZES, createRng, dailySeed, dateKey, formatTime } from './game.js';
import { SaveStore, browserStorage, MODES } from './save.js';
import { PipesScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle } from '../../shared/i18n.js';
import { segmented, createToast, focusForKeyboard } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);

const RESULT_DELAY = 2.3; // 완성한 뒤 물결을 보여 주고 결과 창을 띄우기까지(초)
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

document.title = t('title');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new PipesScene($('stage'), new URL('../assets/textures/', import.meta.url));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));

let settings = store.loadSettings();
let game = null;
let backdrop = null; // 메뉴 뒤에 보여 줄 완성된 판
let state = 'menu'; // menu | playing | solved
let resultTimer = 0; // 결과 창을 띄우기까지 남은 시간
const toast = createToast($('toast'));
let keyCursor = -1; // 키보드로 고른 칸

$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

// ---------- 메뉴 ----------

const describe = (key, { time, moves }) => t(key, { time: formatTime(time), moves });

function describeBest(size) {
  const best = store.loadBest(size);
  return best ? describe('best', best) : t('noBest');
}

function describeDaily(size) {
  const day = dateKey();
  const done = store.loadDaily(day, size);
  const streak = store.loadStreak(day);
  const parts = [done ? describe('dailyDone', done) : t('dailyTodo', { date: day })];
  if (streak > 1) parts.push(t('streak', { n: streak }));
  return parts.join(' · ');
}

function renderMenu() {
  segmented(
    $('mode-options'),
    MODES.map((mode) => ({ value: mode, label: t(`mode.${mode}`), detail: t(`mode.${mode}.detail`) })),
    settings.mode,
    (mode) => {
      settings = { ...settings, mode };
      renderMenu();
    },
  );
  const day = dateKey();
  segmented(
    $('size-options'),
    SIZES.map((size) => ({
      value: size,
      label: `${size}×${size}${settings.mode === 'daily' && store.loadDaily(day, size) ? ' ✓' : ''}`,
      detail: t(`size.${size}`),
    })),
    settings.size,
    (size) => {
      settings = { ...settings, size };
      renderMenu();
    },
  );
  $('menu-best').textContent = settings.mode === 'daily' ? describeDaily(settings.size) : describeBest(settings.size);
  if (!backdrop || backdrop.size !== settings.size) {
    // 물이 다 찬 완성된 판을 보여 준다
    backdrop = new PipesGame({ size: settings.size });
    backdrop.masks.set(backdrop.solution);
    backdrop.refresh();
    backdrop.solved = true;
    backdrop.drain();
    scene.setup(backdrop);
  }
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function setState(next) {
  state = next;
  resultTimer = 0;
  const inGame = !!game && state !== 'menu';
  show('menu', state === 'menu');
  show('result', false);
  show('stats', inGame);
  show('bar', inGame);
  show('label', inGame && !!game.daily);
  if (inGame) {
    const daily = !!game.daily;
    show('btn-new', !daily);
    $('btn-reshuffle').textContent = t(daily ? 'restart' : 'reshuffle');
    $('btn-reshuffle').title = t(daily ? 'restartTitle' : 'reshuffleTitle');
    $('label').textContent = daily ? t('dailyLabel', { date: game.daily }) : '';
  }
  // 포커스가 버튼에 남아 있으면 Space 가 그 버튼을 누르게 된다
  if (state === 'playing') $('stage').focus({ preventScroll: true });
  updateInsets();
}

function setKeyCursor(index) {
  keyCursor = index;
  scene.setCursor(index);
}

function openMenu() {
  game = null;
  backdrop = null;
  setKeyCursor(-1);
  renderMenu();
  setState('menu');
  focusForKeyboard($('btn-start'));
}

function start() {
  sound.unlock();
  store.saveSettings(settings);
  const { mode, size } = settings;
  const day = dateKey();
  game =
    mode === 'daily'
      ? new PipesGame({ size, rng: createRng(dailySeed(day, size)), daily: day })
      : new PipesGame({ size });
  game.drain();
  scene.setup(game);
  setKeyCursor(-1);
  sound.play('shuffle');
  updateHud();
  setState('playing');
}

/** 자유 플레이는 같은 퍼즐을 새로 섞고, 오늘의 퍼즐은 누구나 같은 처음 상태로 되돌린다 */
function reshuffle() {
  if (!game || state === 'menu') return;
  sound.unlock();
  if (game.daily) game.reset();
  else game.reshuffle();
  sound.play('shuffle');
  setState('playing');
  flush();
}

function solved() {
  const { size, daily, moves, elapsed: time } = game;
  const previous = store.loadBest(size);
  const improved = store.recordBest(size, { time, moves });
  if (daily) store.recordDaily(daily, size, { time, moves });

  const isBest = !!previous && (improved.time || improved.moves);
  $('result-title').textContent = isBest ? t('newBest') : daily ? t('dailySolved') : t('solved');
  $('result-detail').textContent = describe('result', { time, moves });
  const lines = [];
  if (isBest) lines.push(t(improved.time && improved.moves ? 'bestBoth' : improved.time ? 'bestTime' : 'bestMoves'));
  if (previous) lines.push(describe('best', store.loadBest(size)));
  const streak = daily ? store.loadStreak(daily) : 0;
  if (streak > 1) lines.push(t('streak', { n: streak }));
  $('result-best').textContent = lines.join(' · ');
  $('result').dataset.tone = isBest ? 'win' : '';
  $('btn-next-label').textContent = t(daily ? 'otherSize' : 'next');
  show('btn-result-menu', !daily);

  sound.play('win');
  sound.flow();
  toast.show(t('solved'), 'water');
  setState('solved');
  setKeyCursor(-1);
  resultTimer = RESULT_DELAY;
}

function showResult() {
  show('result', true);
  focusForKeyboard($('btn-next'));
}

function next() {
  if (game?.daily) openMenu();
  else start();
}

// ---------- HUD ----------

function updateHud() {
  $('moves').textContent = game.moves;
  $('time').textContent = formatTime(game.elapsed);
  $('filled').textContent = `${game.filled}/${game.count}`;
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 판이 그 사이에 오도록 한다 */
function updateInsets() {
  const h = window.innerHeight;
  let top = $('top').getBoundingClientRect().bottom;
  if (!$('label').hidden) top = Math.max(top, $('label').getBoundingClientRect().bottom);
  const bottom = $('bar').hidden ? 0 : h - $('bar').getBoundingClientRect().top;
  scene.setInsets({ top, bottom, left: 0, right: 0 });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('top'));
new ResizeObserver(updateInsets).observe($('bar'));

// ---------- 사건 ----------

function flush() {
  let wasSolved = false;
  for (const event of game.drain()) {
    scene.handle(event);
    switch (event.type) {
      case 'rotate':
        sound.play('rotate');
        break;
      case 'fill':
        // 물길이 늘면 맑은 소리, 판이 찰수록 높아진다
        if (event.filled > event.before) sound.play('connect', 0.8 + 0.6 * (event.filled / game.count));
        break;
      case 'solved':
        wasSolved = true;
        break;
    }
  }
  updateHud();
  if (wasSolved) solved();
}

// ---------- 입력 ----------

function rotate(index, dir) {
  sound.unlock();
  if (state !== 'playing' || !game) return;
  if (game.rotate(index, dir)) flush();
}

scene.onTap = (index, dir) => {
  setKeyCursor(-1);
  rotate(index, dir);
};

scene.onHover = (index) => {
  if (state === 'playing' && keyCursor < 0) scene.setCursor(index);
};

function moveCursor(dx, dy) {
  const n = game.size;
  if (keyCursor < 0) {
    setKeyCursor(game.source);
    return;
  }
  const x = Math.min(n - 1, Math.max(0, (keyCursor % n) + dx));
  const y = Math.min(n - 1, Math.max(0, Math.floor(keyCursor / n) + dy));
  setKeyCursor(y * n + x);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
  if (state === 'menu') {
    if (enter) {
      e.preventDefault();
      start();
    }
    return;
  }
  if (e.code === 'KeyM') {
    toggleSound();
    return;
  }
  if (e.code === 'Escape') {
    openMenu();
    return;
  }
  if (e.code === 'KeyR') {
    reshuffle();
    return;
  }
  if (e.code === 'KeyN' && !game.daily) {
    start();
    return;
  }
  if (state === 'solved') {
    if (enter) {
      e.preventDefault();
      next();
    }
    return;
  }
  if (ARROWS[e.code]) {
    e.preventDefault();
    moveCursor(...ARROWS[e.code]);
    return;
  }
  // 아래 버튼에 포커스가 있으면 그 버튼이 눌리게 둔다
  if ((e.code === 'Space' || enter) && !e.target.closest?.('button, a')) {
    e.preventDefault();
    if (e.repeat) return;
    if (keyCursor < 0) setKeyCursor(game.source);
    else rotate(keyCursor, e.shiftKey ? -1 : 1);
  }
});

function toggleSound() {
  sound.setEnabled(!sound.enabled);
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

$('btn-start').addEventListener('click', start);
$('btn-next').addEventListener('click', next);
$('btn-view').addEventListener('click', () => show('result', false));
$('btn-result-menu').addEventListener('click', openMenu);
$('btn-new').addEventListener('click', start);
$('btn-reshuffle').addEventListener('click', reshuffle);
$('btn-menu').addEventListener('click', openMenu);
$('btn-sound').addEventListener('click', toggleSound);

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  if (!game) return;
  if (state === 'playing') {
    game.update(dt);
    const text = formatTime(game.elapsed);
    if ($('time').textContent !== text) $('time').textContent = text;
  }
  if (resultTimer > 0 && (resultTimer -= dt) <= 0) showResult();
};

// ?debug 로 열면 콘솔에서 상태를 들여다볼 수 있다
if (new URLSearchParams(location.search).has('debug')) {
  window.pipes = {
    scene,
    store,
    get game() {
      return game;
    },
    get state() {
      return state;
    },
  };
}

$('loading').hidden = true;
openMenu();
