// 과일 팡팡: 규칙(game.js), 컴퓨터(ai.js), 3D 씬(scene.js), 저장(save.js)을 잇고 HUD·입력을 처리한다.

import { Match, COLOR_COUNTS } from './game.js';
import { AiPlayer, LEVEL_IDS } from './ai.js';
import { SaveStore, browserStorage, OPPONENTS } from './save.js';
import { DuelScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, formatNumber, mountLangToggle } from '../../shared/i18n.js';

const $ = (id) => document.getElementById(id);

const COUNTDOWN = 1.5; // 시작 전 "준비 → 시작!" 시간(초)
const RESULT_DELAY = 1.6; // 승부가 난 뒤 결과 창이 뜰 때까지(초)

// 누르고 있으면 반복되는 동작: 처음 기다리는 시간과 반복 간격(초)
const REPEAT = {
  left: [0.17, 0.05],
  right: [0.17, 0.05],
  soft: [0.05, 0.04],
};

// 키 → [판 번호, 동작]. 혼자 할 때는 어느 쪽 키든 내 판을 움직인다
const KEYS = {
  cpu: {
    ArrowLeft: [0, 'left'],
    ArrowRight: [0, 'right'],
    ArrowDown: [0, 'soft'],
    ArrowUp: [0, 'cw'],
    KeyX: [0, 'cw'],
    KeyZ: [0, 'ccw'],
    KeyA: [0, 'left'],
    KeyD: [0, 'right'],
    KeyS: [0, 'soft'],
    KeyW: [0, 'cw'],
    KeyQ: [0, 'ccw'],
    Space: [0, 'drop'],
  },
  friend: {
    KeyA: [0, 'left'],
    KeyD: [0, 'right'],
    KeyS: [0, 'soft'],
    KeyW: [0, 'cw'],
    KeyQ: [0, 'ccw'],
    Space: [0, 'drop'],
    ArrowLeft: [1, 'left'],
    ArrowRight: [1, 'right'],
    ArrowDown: [1, 'soft'],
    ArrowUp: [1, 'cw'],
    Slash: [1, 'ccw'],
    Enter: [1, 'drop'],
    NumpadEnter: [1, 'drop'],
  },
};

// 조작판 버튼에 적는 키 이름
const KEY_HINTS = {
  cpu: [{ left: '←', right: '→', soft: '↓', cw: '↑', ccw: 'Z', drop: 'Space' }],
  friend: [
    { left: 'A', right: 'D', soft: 'S', cw: 'W', ccw: 'Q', drop: 'Space' },
    { left: '←', right: '→', soft: '↓', cw: '↑', ccw: '/', drop: 'Enter' },
  ],
};

document.title = t('title');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new DuelScene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));

let settings = store.loadSettings();
let match = null; // 진행 중인 대전. 메뉴에서는 뒤에서 도는 시범 대전
let ais = [null, null]; // 판마다 컴퓨터가 맡으면 AiPlayer
let state = 'menu'; // menu | countdown | playing | paused | over
let pausedFrom = 'playing';
let countdown = 0;
let resultTimer = 0;
let demoRestart = 0;
let tally = [0, 0]; // 설정을 바꾸기 전까지 이어지는 승수
const held = new Map(); // "판:동작" → 다음 반복까지 남은 시간
const chainTimers = [0, 0];
let toastTimer = 0;

const solo = () => settings.opponent === 'cpu';

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

function describeRecord(record) {
  if (!record) return '';
  return t('record', {
    level: t(`level.${settings.level}`),
    wins: record.wins,
    losses: record.losses,
    chain: record.bestChain,
  });
}

function renderMenu() {
  const pick = (key) => (value) => {
    settings = { ...settings, [key]: value };
    tally = [0, 0];
    renderMenu();
  };
  segmented(
    $('opponent-options'),
    OPPONENTS.map((id) => ({ value: id, label: t(`opponent.${id}`), detail: t(`opponent.${id}.detail`) })),
    settings.opponent,
    pick('opponent'),
  );
  segmented(
    $('level-options'),
    LEVEL_IDS.map((id) => ({ value: id, label: t(`level.${id}`) })),
    settings.level,
    pick('level'),
  );
  segmented(
    $('colors-options'),
    COLOR_COUNTS.map((n) => ({ value: n, label: t(`colors.${n}`), detail: t(`colors.${n}.detail`) })),
    settings.colors,
    (colors) => {
      pick('colors')(colors);
      startDemo(); // 뒤에서 도는 시범 대전도 고른 과일로
    },
  );
  $('level-field').hidden = !solo();
  $('menu-record').textContent = solo() ? describeRecord(store.loadRecord(settings)) : '';
}

/** 메뉴 뒤에서 컴퓨터끼리 겨루는 시범 대전 */
function startDemo() {
  match = new Match({ colors: settings.colors });
  ais = [new AiPlayer('normal'), new AiPlayer('normal')];
  scene.setup(match, { solo: false });
  match.start();
  demoRestart = 0;
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function setState(next) {
  state = next;
  show('menu', state === 'menu');
  show('pause', state === 'paused');
  show('result', state === 'over' && resultTimer <= 0);
  const inGame = state !== 'menu';
  show('stats', inGame);
  show('controls', inGame);
  show('plate-0', inGame);
  show('plate-1', inGame);
  show('pad', state === 'playing' || state === 'countdown');
  $('btn-pause').textContent = state === 'paused' ? t('resume') : t('pause');
  held.clear();
  // 포커스가 버튼에 남아 있으면 Space 가 그 버튼을 누르게 된다
  if (state === 'playing' || state === 'countdown') document.activeElement?.blur?.();
  updateInsets();
}

function openMenu() {
  renderMenu();
  startDemo();
  setState('menu');
  $('btn-start').focus();
}

function start() {
  sound.unlock();
  store.saveSettings(settings);
  match = new Match({ colors: settings.colors });
  ais = [null, solo() ? new AiPlayer(settings.level) : null];
  scene.setup(match, { solo: solo() });
  setupPad();
  $('plate-0').querySelector('.who').textContent = solo() ? t('me') : t('p1');
  $('plate-1').querySelector('.who').textContent = solo() ? t('cpu') : t('p2');
  for (const i of [0, 1]) $(`chain-${i}`).classList.remove('show');
  resultTimer = 0;
  countdown = COUNTDOWN;
  updateHud();
  setState('countdown');
  toast(t('ready'));
}

function pause() {
  if (state !== 'playing' && state !== 'countdown') return;
  pausedFrom = state;
  setState('paused');
}

function resume() {
  if (state === 'paused') setState(pausedFrom);
}

function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function finish() {
  const { winner, boards } = match;
  if (winner !== 'draw') tally[winner]++;
  scene.showResult(winner);
  const time = formatTime(match.time);
  let title;
  let tone = '';
  if (winner === 'draw') {
    title = t('draw');
  } else if (solo()) {
    title = winner === 0 ? t('win') : t('lose');
    tone = winner === 0 ? 'win' : '';
  } else {
    title = winner === 0 ? t('winP1') : t('winP2');
    tone = 'win';
  }
  sound.play(solo() && winner === 1 ? 'lose' : 'win');
  $('result-title').textContent = title;
  $('result').dataset.tone = tone;
  $('result-tally').textContent = t('tally', { a: tally[0], b: tally[1] });
  if (solo()) {
    $('result-detail').textContent = t('resultSolo', {
      time,
      chain: boards[0].maxChain,
      score: formatNumber(boards[0].score),
    });
    const record = store.recordResult(settings, { won: winner === 0, lost: winner === 1, chain: boards[0].maxChain });
    $('result-record').textContent = describeRecord(record);
  } else {
    $('result-detail').textContent = t('resultDuo', { time, a: boards[0].maxChain, b: boards[1].maxChain });
    $('result-record').textContent = '';
  }
  updateHud();
  resultTimer = RESULT_DELAY; // 과일이 쏟아지는 것을 보여 준 뒤 결과 창을 띄운다
  setState('over');
}

// ---------- HUD ----------

function updateHud() {
  $('time').textContent = formatTime(match.time);
  $('tally').textContent = `${tally[0]} : ${tally[1]}`;
  match.boards.forEach((board, i) => {
    const plate = $(`plate-${i}`);
    plate.querySelector('.score').textContent = formatNumber(board.score);
    plate.querySelector('.wins').textContent = '★'.repeat(Math.min(tally[i], 5));
  });
}

function toast(text, tone = '') {
  const el = $('toast');
  el.textContent = text;
  el.dataset.tone = tone;
  el.classList.remove('show');
  void el.offsetWidth; // 애니메이션을 처음부터 다시
  el.classList.add('show');
  toastTimer = 1.1;
}

/** 판 위에 연쇄 알림을 띄운다 */
function chainToast(player, text, tone = '') {
  const el = $(`chain-${player}`);
  el.textContent = text;
  el.dataset.tone = tone;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  chainTimers[player] = 1.1;
}

/** 이름·점수와 연쇄 알림을 씬의 판 자리에 맞춘다 */
function placeHud() {
  for (const i of [0, 1]) {
    const rect = scene.boardRect(i);
    if (!rect) continue;
    const plate = $(`plate-${i}`);
    const width = rect.right - rect.left;
    const key = `${Math.round(rect.left)},${Math.round(rect.trayTop)},${Math.round(width)}`;
    if (plate.dataset.key === key) continue;
    plate.dataset.key = key;
    plate.style.left = `${rect.left}px`;
    plate.style.width = `${width}px`;
    plate.style.top = `${rect.trayTop}px`;
    plate.classList.toggle('small', width < 150);
    const chain = $(`chain-${i}`);
    chain.style.left = `${rect.left + width / 2}px`;
    chain.style.top = `${rect.top + (rect.bottom - rect.top) * 0.38}px`;
    chain.style.fontSize = `${Math.max(16, Math.min(34, width * 0.16))}px`;
  }
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 판이 그 사이에 오도록 한다 */
function updateInsets() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // 메뉴에서는 조작판·이름표가 없지만, 시작할 때 판이 튀지 않게 조금 남겨 둔다
  const insets = { top: $('top').getBoundingClientRect().bottom + 34, bottom: 12, left: 0, right: 0 };
  if (!$('pad').hidden) {
    if (sideways.matches) {
      // 조작판이 양옆에 있다: 가운데보다 왼쪽에 있는 묶음과 오른쪽에 있는 묶음 사이를 쓴다
      for (const cluster of $('pad').querySelectorAll('.cluster')) {
        const rect = cluster.getBoundingClientRect();
        if (!rect.width) continue;
        if (rect.left + rect.width / 2 < w / 2) insets.left = Math.max(insets.left, rect.right);
        else insets.right = Math.max(insets.right, w - rect.left);
      }
    } else {
      insets.bottom = h - $('pad').getBoundingClientRect().top;
    }
  }
  scene.setInsets(insets);
}

const sideways = window.matchMedia('(max-height: 520px) and (orientation: landscape)');
sideways.addEventListener('change', updateInsets);
window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('pad'));
new ResizeObserver(updateInsets).observe($('top'));

/** 조작판을 대전 방식에 맞춘다: 혼자면 하나를 넓게, 둘이면 판마다 하나씩 */
function setupPad() {
  const pad = $('pad');
  pad.dataset.mode = settings.opponent;
  const hints = KEY_HINTS[settings.opponent];
  for (const playerPad of pad.querySelectorAll('.player-pad')) {
    const player = Number(playerPad.dataset.player);
    playerPad.hidden = !hints[player];
    if (!hints[player]) continue;
    for (const button of playerPad.querySelectorAll('[data-action]')) {
      button.querySelector('kbd').textContent = hints[player][button.dataset.action];
    }
  }
}

// ---------- 사건 ----------

function flush() {
  const audible = state !== 'menu';
  for (const event of match.drain()) {
    scene.handle(event);
    if (!audible) continue;
    const pan = event.player === 0 ? -0.4 : 0.4;
    const human = !ais[event.player];
    switch (event.type) {
      case 'move':
        if (human) sound.play('move', 1, pan);
        break;
      case 'rotate':
        if (human) sound.play('rotate', 1, pan);
        break;
      case 'drop':
        sound.play('drop', 1, pan);
        break;
      case 'lock':
        sound.play('lock', 1.25, pan);
        break;
      case 'pop':
        // 연쇄가 이어질수록 높은 소리
        sound.play('pop', 2 ** (Math.min(event.chain - 1, 9) / 6), pan);
        if (event.chain >= 2) chainToast(event.player, t('chain', { n: event.chain }), event.chain >= 4 ? 'big' : '');
        break;
      case 'chainEnd':
        if (event.allClear) {
          sound.play('allclear', 1, pan);
          chainToast(event.player, t('allClear'), 'big');
        }
        break;
      case 'garbage':
        sound.play('lock', 0.6, pan);
        break;
    }
  }
}

// ---------- 입력 ----------

function perform(player, action) {
  if (state !== 'playing' || ais[player]) return;
  const board = match.boards[player];
  if (action === 'left') board.move(-1);
  else if (action === 'right') board.move(1);
  else if (action === 'soft') board.softDrop();
  else if (action === 'cw') board.rotate(1);
  else if (action === 'ccw') board.rotate(-1);
  else if (action === 'drop') board.hardDrop();
}

function press(player, action) {
  sound.unlock();
  const key = `${player}:${action}`;
  if (held.has(key)) return;
  perform(player, action);
  if (REPEAT[action]) held.set(key, REPEAT[action][0]);
}

function release(player, action) {
  held.delete(`${player}:${action}`);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
  if (enter && (state === 'menu' || (state === 'over' && resultTimer <= 0))) {
    e.preventDefault();
    start();
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === 'paused') resume();
    else pause();
    return;
  }
  if (e.code === 'KeyM') {
    toggleSound();
    return;
  }
  const bound = KEYS[settings.opponent][e.code];
  if (!bound || (state !== 'playing' && state !== 'countdown')) return;
  e.preventDefault();
  if (e.repeat) return; // 반복은 직접 처리한다
  press(...bound);
});

window.addEventListener('keyup', (e) => {
  const bound = KEYS[settings.opponent][e.code];
  if (bound) release(...bound);
});

for (const playerPad of $('pad').querySelectorAll('.player-pad')) {
  const player = Number(playerPad.dataset.player);
  for (const button of playerPad.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      press(player, action);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, () => release(player, action));
    }
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }
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

function runMatch(dt) {
  ais.forEach((ai, i) => ai?.update(dt, match.boards[i], match.colors));
  match.update(dt);
  flush();
}

scene.onFrame = (dt) => {
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) $('toast').classList.remove('show');
  for (const i of [0, 1]) {
    if (chainTimers[i] > 0 && (chainTimers[i] -= dt) <= 0) $(`chain-${i}`).classList.remove('show');
  }
  if (!match) return;
  if (state === 'menu') {
    if (!match.over) {
      runMatch(dt);
      if (match.over) {
        scene.showResult(match.winner);
        demoRestart = 2.5;
      }
    } else if ((demoRestart -= dt) <= 0) {
      startDemo();
    }
  } else if (state === 'countdown') {
    countdown -= dt;
    if (countdown <= 0) {
      match.start();
      toast(t('go'), 'big');
      setState('playing');
    }
  } else if (state === 'playing') {
    for (const [key, wait] of held) {
      const [player, action] = key.split(':');
      let left = wait - dt;
      while (left <= 0 && held.has(key)) {
        perform(Number(player), action);
        left += REPEAT[action][1];
      }
      if (held.has(key)) held.set(key, left);
    }
    runMatch(dt);
    updateHud();
    if (match.over) finish();
  } else if (state === 'over' && resultTimer > 0) {
    resultTimer -= dt;
    if (resultTimer <= 0) {
      show('result', true);
      $('btn-again').focus();
    }
  }
  placeHud();
};

// ?debug 로 열면 콘솔에서 대전과 씬을 들여다볼 수 있다
if (new URLSearchParams(location.search).has('debug')) {
  window.fruitpop = {
    scene,
    store,
    get match() {
      return match;
    },
    get state() {
      return state;
    },
    start,
    press,
    release,
  };
}

try {
  await scene.load();
  $('loading').hidden = true;
  openMenu();
} catch (error) {
  console.error(error);
  if ($('loading').childElementCount === 0) $('loading').textContent = t('loadError'); // WebGL 안내가 떠 있으면 그대로 둔다
}
