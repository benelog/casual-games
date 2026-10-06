// 3D 소코반: 규칙(game.js), 레벨(levels.js), 3D 씬(scene.js), 저장(save.js)을 잇고 HUD·입력을 처리한다.

import { Sokoban, parseLevel, DIRS } from './game.js';
import { LEVELS } from './levels.js';
import { KEYS, swipeDirection } from './controls.js';
import { SaveStore, browserStorage } from './save.js';
import { SokobanScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, formatNumber, mountLangToggle } from '../../shared/i18n.js';
import { createToast, focusForKeyboard } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);

// 누르고 있으면 반복되는 걸음: 처음 기다리는 시간과 반복 간격(초). 간격은 한 칸 걷는 시간과 비슷하게
const REPEAT = [0.2, 0.125];
const RESULT_DELAY = 1.5; // 클리어 연출을 보여 준 뒤 결과 창을 띄운다

document.title = t('title');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new SokobanScene($('stage'));
const store = new SaveStore(
  browserStorage(),
  LEVELS.map((level) => level.id),
);
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));

let index = 0; // 지금 레벨 (LEVELS 의 위치)
let game = null;
let state = 'select'; // select | playing | cleared
const held = new Map(); // 누르고 있는 방향 → 다음 반복까지 남은 시간
const toast = createToast($('toast'));
let resultTimer = 0;
let padHeight = 0;
let outcome = null; // 방금 깬 기록을 저장한 결과

const indexOfId = (id) => Math.max(0, LEVELS.findIndex((level) => level.id === id));

// ---------- 레벨 선택 ----------

function renderSelect() {
  const { best } = store.load();
  const solved = Object.keys(best).length;
  const total = LEVELS.length;
  $('progress').textContent = solved === total ? t('progressAll', { total }) : t('progress', { solved, total });
  const grid = $('level-grid');
  grid.replaceChildren();
  LEVELS.forEach((level, i) => {
    const record = best[level.id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `level${record ? ' solved' : ''}${i === index ? ' current' : ''}`;
    button.innerHTML = `<span>${i + 1}</span><small>${record ? `✓ ${formatNumber(record.moves)}` : ''}</small>`;
    button.setAttribute(
      'aria-label',
      record ? t('levelSolved', { n: i + 1, moves: record.moves }) : t('levelLabel', { n: i + 1 }),
    );
    button.addEventListener('click', () => {
      sound.unlock();
      sound.play('select');
      startLevel(i);
    });
    grid.append(button);
  });
  $('continue-label').textContent = t('continue', { n: index + 1 });
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function setState(next) {
  state = next;
  show('select', state === 'select');
  show('result', state === 'cleared' && resultTimer <= 0);
  show('stats', state !== 'select');
  show('pad', state === 'playing');
  held.clear();
  // 포커스가 버튼에 남아 있으면 Space·Enter 가 그 버튼을 누르게 된다
  if (state === 'playing') document.activeElement?.blur?.();
  updateInsets();
}

function openSelect() {
  renderSelect();
  setState('select');
  focusForKeyboard($('btn-continue'));
}

/** 판만 새로 놓는다 (레벨 선택 뒤 배경으로도 쓴다) */
function loadLevel(i) {
  index = i;
  game = new Sokoban(parseLevel(LEVELS[i].map));
  scene.setup(game);
  updateHud();
}

function startLevel(i) {
  sound.unlock();
  loadLevel(i);
  store.saveLast(LEVELS[i].id);
  resultTimer = 0;
  setState('playing');
}

function levelCleared() {
  outcome = store.record(LEVELS[index].id, { moves: game.moves, pushes: game.pushes });
  resultTimer = RESULT_DELAY;
  setState('cleared');
  updateHud();
}

function showResult() {
  const last = index === LEVELS.length - 1;
  const n = index + 1;
  const { first, improved, previous } = outcome;
  const all = store.solvedCount() === LEVELS.length;
  $('result-title').textContent =
    last && all ? t('clearedAll') : improved && !first ? t('clearedBest', { n }) : t('cleared', { n });
  $('result-detail').textContent = t('result', { moves: formatNumber(game.moves), pushes: formatNumber(game.pushes) });
  $('result-best').textContent = first
    ? t('firstClear')
    : t(improved ? 'previousBest' : 'best', { moves: formatNumber(previous.moves), pushes: formatNumber(previous.pushes) });
  $('result').dataset.tone = improved ? 'win' : '';
  show('btn-next', !last);
  show('result', true);
  focusForKeyboard(last ? $('btn-result-levels') : $('btn-next'));
}

// ---------- HUD ----------

function updateHud() {
  $('level').textContent = `${index + 1}/${LEVELS.length}`;
  $('moves').textContent = formatNumber(game.moves);
  $('pushes').textContent = formatNumber(game.pushes);
  const best = store.loadBest(LEVELS[index].id);
  show('best-stat', !!best);
  if (best) $('best').textContent = formatNumber(best.moves);
  $('btn-undo').disabled = !game.canUndo;
  $('btn-restart').disabled = !game.canUndo;
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 판이 그 사이에 오도록 한다 */
function updateInsets() {
  const top = $('top').getBoundingClientRect().bottom;
  // 조작판이 잠깐 숨는 동안(클리어 연출·결과 창)에도 판이 움직이지 않게 마지막 높이를 그대로 쓴다
  if (!$('pad').hidden) padHeight = window.innerHeight - $('pad').getBoundingClientRect().top;
  const bottom = state === 'select' ? 0 : padHeight;
  scene.setInsets({ top, bottom, left: 0, right: 0 });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('pad'));
new ResizeObserver(updateInsets).observe($('top'));

// ---------- 사건 ----------

function flush() {
  const events = game.drain();
  if (events.length === 0) return;
  for (const event of events) {
    scene.handle(event);
    switch (event.type) {
      case 'move':
        if (!event.pushed) sound.play('step');
        else if (event.pushed.onGoal) sound.play('goal');
        else sound.play('push');
        break;
      case 'blocked':
        sound.play('blocked');
        break;
      case 'undo':
        sound.play('undo');
        break;
      case 'restart':
        sound.play('restart');
        toast.show(t('restarted'));
        break;
      case 'solved':
        sound.play('win');
        levelCleared();
        break;
    }
  }
  updateHud();
}

// ---------- 입력 ----------

function perform(action) {
  if (!game) return;
  if (action === 'levels') {
    if (state !== 'select') openSelect();
    return;
  }
  if (state === 'cleared') {
    // 깬 뒤에는 되돌리기·다시 시작만 받는다 (결과 창을 닫고 이어서 한다)
    if (action !== 'undo' && action !== 'restart') return;
    resultTimer = 0;
    setState('playing');
  }
  if (state !== 'playing') return;
  if (action in DIRS) game.move(action);
  else if (action === 'undo') game.undo();
  else if (action === 'restart') game.restart();
  flush();
}

function press(action) {
  sound.unlock();
  if (held.has(action)) return;
  perform(action);
  if (action in DIRS || action === 'undo') held.set(action, REPEAT[0]);
}

function release(action) {
  held.delete(action);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (state === 'select') {
      e.preventDefault();
      startLevel(index);
    } else if (state === 'cleared' && resultTimer <= 0 && document.activeElement?.tagName !== 'BUTTON') {
      e.preventDefault();
      nextLevel();
    }
    return;
  }
  if (e.code === 'Escape') {
    if (state === 'select') startLevel(index);
    else openSelect();
    return;
  }
  if (e.code === 'KeyM') {
    toggleSound();
    return;
  }
  const action = KEYS[e.code];
  if (!action || state === 'select') return;
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

// 화면을 쓸면 그 방향으로 걷는다. 손을 떼지 않고 계속 끌면 일정 거리마다 한 칸씩 더 간다
const stage = $('stage');
let swipe = null; // { id, x, y }
stage.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (state !== 'playing') return;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!swipe || swipe.id !== e.pointerId) return;
  const dir = swipeDirection(e.clientX - swipe.x, e.clientY - swipe.y);
  if (!dir) return;
  swipe.x = e.clientX;
  swipe.y = e.clientY;
  perform(dir);
});
for (const type of ['pointerup', 'pointercancel']) {
  stage.addEventListener(type, (e) => {
    if (swipe?.id === e.pointerId) swipe = null;
  });
}

function toggleSound() {
  sound.enabled = !sound.enabled;
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

function nextLevel() {
  startLevel(Math.min(index + 1, LEVELS.length - 1));
}

$('btn-continue').addEventListener('click', () => startLevel(index));
$('btn-next').addEventListener('click', nextLevel);
$('btn-again').addEventListener('click', () => startLevel(index));
$('btn-result-levels').addEventListener('click', openSelect);
$('btn-sound').addEventListener('click', toggleSound);

// 다른 창으로 가면 누르고 있던 키를 놓은 것으로 친다
window.addEventListener('blur', () => held.clear());

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  toast.tick(dt);
  if (state === 'cleared' && resultTimer > 0 && (resultTimer -= dt) <= 0) showResult();
  if (state !== 'playing') return;
  for (const [action, wait] of held) {
    let left = wait - dt;
    while (left <= 0 && held.has(action)) {
      perform(action);
      left += REPEAT[1];
    }
    if (held.has(action)) held.set(action, left);
  }
};

// ?debug 로 열면 콘솔에서 게임과 씬을 들여다볼 수 있다
if (new URLSearchParams(location.search).has('debug')) {
  window.sokoban = {
    scene,
    store,
    sound,
    perform,
    startLevel,
    get game() {
      return game;
    },
    get state() {
      return state;
    },
  };
}

try {
  await scene.load();
  loadLevel(indexOfId(store.nextUnsolved()));
  $('loading').hidden = true;
  openSelect();
} catch (error) {
  console.error(error);
  $('loading').textContent = t('loadError');
}
