// 투호: 규칙(game.js)·물리(physics.js)·컴퓨터(ai.js)와 3D 씬(scene.js)을 잇고, HUD·스와이프 입력·진행을 맡는다.
// 화살은 화면을 위로 밀어 올려(스와이프) 던진다. 끈 길이가 세기, 기울기가 좌우 방향이고, 놓는 순간의 손 흔들림만큼
// 어긋난다. 혼자서 화살 10개 기록에 도전하거나, 컴퓨터 또는 한 기기의 2~4명이 한 발씩 번갈아 던진다.

import { TuhoGame, LINES, EXTRA_LINE, SOLO_ARROWS, ARROW_OPTIONS, PLAYER_COUNTS } from './game.js';
import { Yard, launch, swipeToShot, swayAmplitude, swayOffset, applySway, aimFor, clamp, YAW_LIMIT, TARGETS } from './physics.js';
import { chooseShot, LEVEL_IDS } from './ai.js';
import { TuhoScene } from './scene.js';
import { SaveStore, browserStorage, MODES } from './save.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle } from '../../shared/i18n.js';
import { segmented, createToast, focusForKeyboard } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);

const CHARGE_PERIOD = 2.2; // 키보드: Space 를 누르고 있으면 세기가 0 → 최대 → 0 으로 오르내리는 시간 (초)
const YAW_STEP = 0.005; // 키보드로 한 번에 돌리는 방향 (라디안). Shift 는 0.0015
const KEEP_ARROWS = 8; // 마당에 남겨 두는 화살 수 (오래된 것부터 치운다)
const CPU_HOLD = 1000; // 컴퓨터가 화살을 들고 겨누는 시간 (ms)
const RESULT_HOLD = 1300; // 결과를 보여 주고 다음 차례로 넘어가기까지 (ms)
const DISTANCES = LINES.map((line) => line.distance);

document.title = t('pageTitle');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const coarse = matchMedia('(pointer: coarse)').matches;

const scene = new TuhoScene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.5);
const yard = new Yard();
scene.yard = yard;

let settings = store.loadSettings();
let game = null;
let seats = []; // 사람마다 { name, cpu }
let state = 'menu'; // menu | playing | done
let session = 0; // 새 판을 시작하거나 메뉴로 가면 늘어, 예전 진행 흐름을 멈춘다
let starter = 0; // 대결에서 먼저 던지는 사람. 한 판 더 하면 다음 사람으로 넘어간다
let aim = null; // 사람이 화살을 들고 있는 동안 { resolve, drag, yaw, charging, power, held, t, sway, distance }
let cpuAim = null; // 컴퓨터가 겨누는 동안 흔들림 보여 주기 { t }
let flight = null; // 결과를 기다리는 화살 { arrow, resolve }

sound.enabled = settings.sound;
$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

// ---------- 메뉴 ----------

function renderMenu() {
  const pick = (patch) => {
    settings = { ...settings, ...patch };
    renderMenu();
  };
  segmented(
    $('mode-options'),
    MODES.map((value) => ({ value, label: t(`mode.${value}`), detail: t(`mode.${value}.detail`) })),
    settings.mode,
    (mode) => pick({ mode }),
  );
  $('level-field').hidden = settings.mode !== 'cpu';
  segmented(
    $('level-options'),
    LEVEL_IDS.map((value) => ({ value, label: t(`level.${value}`), detail: t(`level.${value}.detail`) })),
    settings.level,
    (level) => pick({ level }),
  );
  $('players-field').hidden = settings.mode !== 'multi';
  segmented(
    $('players-options'),
    PLAYER_COUNTS.map((value) => ({ value, label: t('playersCount', { n: value }) })),
    settings.players,
    (players) => pick({ players }),
  );
  $('arrows-field').hidden = settings.mode === 'solo';
  segmented(
    $('arrows-options'),
    ARROW_OPTIONS.map((value) => ({ value, label: t('arrowsEach', { n: value }) })),
    settings.arrows,
    (arrows) => pick({ arrows }),
  );
  $('menu-record').textContent = recordText();
}

function recordText() {
  if (settings.mode === 'solo') {
    const best = store.loadBest();
    return best ? t('best', best) : t('noBest');
  }
  if (settings.mode === 'cpu') {
    const record = store.loadRecord(settings.level);
    return record ? t('record', { level: t(`level.${settings.level}`), ...record }) : t('noRecord');
  }
  return t('hotseat');
}

function setState(next) {
  state = next;
  const playing = next !== 'menu';
  $('menu').hidden = next !== 'menu';
  $('result').hidden = true;
  $('bottom').hidden = !playing;
  $('btn-menu').hidden = !playing;
  $('stats').hidden = !playing || game?.players > 1;
  $('board').hidden = !playing || !(game?.players > 1);
  $('spot').hidden = !playing;
  updateTurn();
}

function openMenu() {
  session++;
  cancelAim();
  cpuAim = null;
  flight = null;
  game = null;
  for (const arrow of [...yard.arrows]) yard.remove(arrow);
  scene.home();
  scene.showHand(null);
  scene.setLine(DISTANCES, 0, { cut: true });
  renderMenu();
  setState('menu');
  setStatus('');
  focusForKeyboard($('btn-start'));
}

function start() {
  sound.unlock();
  store.saveSettings(settings);
  newGame(0);
}

/** 고른 모드에 맞는 자리(사람·컴퓨터)들 */
function makeSeats() {
  if (settings.mode === 'solo') return [{ name: t('you'), cpu: false }];
  if (settings.mode === 'cpu') return [{ name: t('you'), cpu: false }, { name: t('computer'), cpu: true }];
  return Array.from({ length: settings.players }, (_, i) => ({ name: t('player', { n: i + 1 }), cpu: false }));
}

function newGame(first) {
  session++;
  cancelAim();
  cpuAim = null;
  flight = null;
  for (const arrow of [...yard.arrows]) yard.remove(arrow);
  seats = makeSeats();
  starter = first % seats.length;
  const players = seats.length;
  game = new TuhoGame({ players, arrows: players > 1 ? settings.arrows : SOLO_ARROWS, first: starter });
  buildBoard();
  scene.home();
  scene.setLine(DISTANCES, lineIndexOf(game.line), { cut: true });
  setState('playing');
  updateHud();
  play(session);
}

const lineIndexOf = (line) => LINES.indexOf(line);

// ---------- HUD ----------

/** 대결 점수판: 사람마다 칩 하나 */
function buildBoard() {
  const board = $('board');
  board.replaceChildren();
  seats.forEach((seat, p) => {
    const chip = document.createElement('div');
    chip.className = 'player';
    chip.id = `player-${p}`;
    chip.dataset.player = p;
    chip.innerHTML = `<span class="badge"></span><span class="name"></span><b class="score">0</b><small class="arrows"></small>`;
    chip.querySelector('.badge').textContent = t('yourTurn');
    chip.querySelector('.name').textContent = seat.name;
    board.append(chip);
  });
  board.dataset.count = seats.length;
}

function updateHud() {
  if (!game) return;
  $('score').textContent = game.scores[0];
  $('left').textContent = game.arrowsLeft(0);
  $('hits').textContent = `${game.hits(0)}/${game.thrown[0]}`;
  seats.forEach((_, p) => {
    const chip = $(`player-${p}`);
    if (!chip) return;
    chip.querySelector('.score').textContent = game.scores[p];
    chip.querySelector('.arrows').textContent = t('chipLine', { hits: game.hits(p), left: game.arrowsLeft(p) });
    chip.classList.toggle('out', game.inExtra && !game.extra.contenders.includes(p));
  });
  const line = game.line;
  $('spot-name').textContent = game.inExtra ? t('extraLine', { n: game.extra.round }) : t(`line.${line.id}`);
  $('spot-distance').textContent = t('meters', { n: line.distance });
}

/** 대결: 누구 차례인지를 점수판·안내 줄·화면 가장자리에 함께 알린다 */
function updateTurn() {
  const active = !!game && state === 'playing' && game.players > 1 && !game.over;
  const player = active ? game.current : -1;
  seats.forEach((_, p) => $(`player-${p}`)?.classList.toggle('active', p === player));
  $('turn').hidden = !active;
  $('glow').hidden = !active;
  if (!active) return;
  const banner = $('turn');
  if (banner.dataset.player !== String(player)) {
    banner.classList.remove('swap');
    void banner.offsetWidth; // 애니메이션을 처음부터 다시
    banner.classList.add('swap');
  }
  banner.dataset.player = player;
  $('glow').dataset.player = player;
  $('turn-name').textContent = t('turnOf', { name: seats[player].name });
  $('turn-hint').textContent = game.inExtra ? t('extraHint') : t('arrowsLeftOf', { n: game.arrowsLeft(player) });
}

function setStatus(text) {
  $('status').textContent = text;
}

function showPower(power) {
  $('power').hidden = power === null;
  if (power !== null) $('power-fill').style.height = `${power * 100}%`;
}

// ---------- 던지기 ----------

/** 사람이 화살을 들고 던질 때까지 기다린다. 메뉴로 가면 null */
function waitShot(player) {
  return new Promise((resolve) => {
    aim = { resolve, drag: null, yaw: 0, charging: false, power: 0, held: null, t: Math.random() * 20, sway: { x: 0, y: 0 }, distance: game.line.distance };
    scene.showHand(player, { line: true });
    showPower(null);
    setStatus(t(coarse ? 'hintTouch' : 'hintMouse'));
  });
}

function cancelAim() {
  if (!aim) return;
  const { resolve } = aim;
  aim = null;
  hideSwipe();
  showPower(null);
  scene.showHand(null);
  resolve(null);
}

/** 겨눈 shot 에 놓는 순간의 흔들림을 더해 던진다 */
function fire(shot) {
  if (!aim) return;
  const { resolve, sway } = aim;
  aim = null;
  hideSwipe();
  showPower(null);
  scene.showHand(null);
  resolve(applySway(shot, sway));
}

/** 컴퓨터 차례: 잠깐 화살을 들고 겨누다 던진다 */
async function cpuShot(player) {
  scene.showHand(player);
  cpuAim = { t: Math.random() * 20 };
  setStatus(t('cpuAiming'));
  await sleep(CPU_HOLD);
  cpuAim = null;
  scene.showHand(null);
  setStatus('');
  const top = Math.max(...game.scores);
  const context = { behind: top - game.scores[player], left: game.inExtra ? 0 : game.arrowsLeft(player) - 1 };
  return chooseShot(game.line.distance, settings.level, context);
}

/** 던진 화살의 결과를 기다린다 */
function waitResult(arrow) {
  return new Promise((resolve) => {
    flight = { arrow, resolve };
  });
}

/** 오래된 화살을 치운다 (지금 날아가는 화살은 남긴다) */
function tidyArrows() {
  const old = yard.arrows.filter((a) => a.result);
  while (old.length > KEEP_ARROWS - 1) yard.remove(old.shift());
}

// ---------- 진행 ----------

async function play(token) {
  let previous = -1;
  while (token === session && !game.over) {
    const player = game.current;
    const line = game.line;
    scene.setLine(DISTANCES, game.inExtra ? EXTRA_LINE : lineIndexOf(line));
    updateHud();
    updateTurn();
    if (game.players > 1 && previous !== player) {
      sound.play('turn');
      toast.show(t('turnOf', { name: seats[player].name }), `p${player}`);
    }
    previous = player;

    const shot = seats[player].cpu ? await cpuShot(player) : await waitShot(player);
    if (token !== session || !shot) return;

    tidyArrows();
    const arrow = launch(line.distance, shot);
    arrow.player = player;
    yard.add(arrow);
    scene.follow(arrow);
    sound.whoosh(shot.power);
    sound.play('release', 1.2, { volume: 0.5 + 0.5 * shot.power });
    setStatus('');
    const result = await waitResult(arrow);
    if (token !== session) return;

    const info = game.record(result);
    feedback(info, arrow);
    updateHud();
    await sleep(RESULT_HOLD);
    if (token !== session) return;
    scene.home();
    if (info.extraStarted) {
      sound.play('turn');
      toast.show(t('extraStart', { n: game.extra.round, names: game.extra.contenders.map((p) => seats[p].name).join(' · ') }), 'big');
      await sleep(1200);
    } else if (info.lineUp && game.players === 1) {
      toast.show(t('lineBack', { name: t(`line.${game.line.id}`), n: game.line.distance }), 'big');
    }
  }
  if (token === session) endGame();
}

/** 결과에 맞춰 알림·소리·고리 */
function feedback(info, arrow) {
  const player = game.players > 1 ? `p${info.player}` : '';
  switch (info.result) {
    case 'mouth':
      toast.show(t('resultMouth', { n: info.points }), player || 'good');
      sound.play('score');
      scene.flash('mouth');
      break;
    case 'ear':
      toast.show(t('resultEar', { n: info.points }), player || 'gold');
      sound.play('score', 1.2);
      sound.play('cheer', 1, { volume: 0.7 });
      scene.flash('ear', arrow.x);
      break;
    case 'lean':
      toast.show(t('resultLean', { n: info.points }), 'big');
      sound.play('score', 0.85, { volume: 0.6 });
      break;
    default:
      toast.show(t(arrow.touchedPot ? 'bounced' : 'missed'), 'miss');
  }
}

function countsText(p) {
  const c = game.counts[p];
  return t('counts', { mouth: c.mouth, ear: c.ear, lean: c.lean });
}

function endGame() {
  cancelAim();
  updateHud();
  setState('done');
  let tone = '';
  let lines = [];
  let record = '';
  if (game.players === 1) {
    const result = game.result;
    const previous = store.loadBest();
    const improved = store.recordBest(result);
    const isBest = !!previous && improved;
    tone = isBest ? 'win' : '';
    $('result-title').textContent = isBest ? t('newBest') : t('finished');
    $('result-detail').textContent = t('summary', { score: result.score, hits: result.hits, arrows: SOLO_ARROWS });
    lines = [countsText(0)];
    record = t('best', store.loadBest() ?? result);
    sound.play(isBest || !previous ? 'win' : 'lose');
    if (isBest) sound.play('cheer');
  } else {
    const winner = game.winner;
    tone = winner < 0 ? '' : `p${winner}`;
    if (settings.mode === 'cpu') {
      const outcome = winner < 0 ? 'draw' : winner === 0 ? 'win' : 'loss';
      const stats = store.recordResult(settings.level, outcome);
      $('result-title').textContent = t(`outcome.${outcome}`);
      if (stats) record = t('record', { level: t(`level.${settings.level}`), ...stats });
      sound.play(outcome === 'loss' ? 'lose' : 'win');
      if (outcome === 'win') sound.play('cheer');
    } else {
      $('result-title').textContent = winner < 0 ? t('draw') : t('winner', { name: seats[winner].name });
      sound.play('win');
      sound.play('cheer');
    }
    $('result-detail').textContent = game.extraWinners ? t('afterExtra', { n: game.extra.round }) : t('arrowsEachDetail', { n: game.arrows });
    lines = game.ranking.map((p, rank) =>
      t('rankLine', { rank: rank + 1, name: seats[p].name, score: game.scores[p], counts: countsText(p) }),
    );
  }
  const list = $('result-lines');
  list.replaceChildren(
    ...lines.map((text, i) => {
      const li = document.createElement('li');
      li.textContent = text;
      if (game.players > 1) li.dataset.player = game.ranking[i];
      return li;
    }),
  );
  $('result-record').textContent = record;
  $('result').dataset.tone = tone;
  setStatus('');
  $('result').hidden = false;
  focusForKeyboard($('btn-again'));
}

/** 한 판 더: 대결에서는 먼저 던지는 사람을 바꾼다 */
function again() {
  newGame(game?.players > 1 ? starter + 1 : 0);
}

// ---------- 입력 ----------

function showSwipe(x0, y0, x1, y1, ok) {
  const svg = $('swipe');
  svg.removeAttribute('hidden'); // SVG 요소에는 hidden 속성 대응 프로퍼티가 없다
  const line = $('swipe-line');
  line.setAttribute('x1', x0);
  line.setAttribute('y1', y0);
  line.setAttribute('x2', x1);
  line.setAttribute('y2', y1);
  svg.classList.toggle('weak', !ok);
  const dot = $('swipe-start');
  dot.setAttribute('cx', x0);
  dot.setAttribute('cy', y0);
}

function hideSwipe() {
  $('swipe').setAttribute('hidden', '');
}

scene.onPointer = (type, event) => {
  if (type === 'pointerdown') sound.unlock();
  if (!aim) return;
  const height = window.innerHeight;
  if (type === 'pointerdown') {
    if (aim.drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    aim.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, shot: null };
    aim.charging = false;
    aim.held = 0; // 누른 채 기다리면 손이 차분해진다
    try {
      event.target.setPointerCapture(event.pointerId); // 손가락이 화면 밖으로 나가도 놓을 때까지 따라간다
    } catch {
      // 잡지 못해도 캔버스 안에서는 그대로 따라간다
    }
    return;
  }
  const drag = aim.drag;
  if (!drag || event.pointerId !== drag.id) return;
  if (type === 'pointermove') {
    drag.shot = swipeToShot(event.clientX - drag.x, event.clientY - drag.y, height);
    showSwipe(drag.x, drag.y, event.clientX, event.clientY, !!drag.shot);
    showPower(drag.shot ? drag.shot.power : 0);
    return;
  }
  if (type === 'pointercancel') {
    aim.drag = null;
    aim.held = null;
    hideSwipe();
    showPower(null);
    return;
  }
  if (type === 'pointerup') {
    const shot = swipeToShot(event.clientX - drag.x, event.clientY - drag.y, height);
    aim.drag = null;
    if (shot) return fire(shot);
    aim.held = null;
    hideSwipe();
    showPower(null);
    setStatus(t('swipeUp'));
  }
};

// 브라우저는 사용자 입력이 있어야 소리를 내게 해 준다
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sound.unlock(), true);

function toggleSound() {
  sound.unlock();
  sound.setEnabled(!sound.enabled);
  settings = { ...settings, sound: sound.enabled };
  store.saveSettings(settings);
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

$('btn-sound').addEventListener('click', (event) => {
  toggleSound();
  event.currentTarget.blur(); // 스페이스로 던질 때 버튼이 다시 눌리지 않게
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const enter = event.key === 'Enter';
  if (state === 'menu') {
    if (enter && !event.target.closest?.('button, a, summary')) {
      event.preventDefault();
      start();
    }
    return;
  }
  if (event.key === 'm' || event.key === 'M') return toggleSound();
  if (event.key === 'Escape') return openMenu();
  if (!$('result').hidden) {
    if (enter) {
      event.preventDefault();
      again();
    }
    return;
  }
  if (!aim || aim.drag) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const step = event.shiftKey ? 0.0015 : YAW_STEP;
    aim.yaw = clamp(aim.yaw + (event.key === 'ArrowLeft' ? -step : step), -YAW_LIMIT, YAW_LIMIT);
  } else if (event.key === ' ' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (event.repeat || aim.charging) return;
    aim.charging = true;
    aim.t0 = 0;
    aim.power = 0;
    aim.held = 0;
    showPower(0);
  }
});

document.addEventListener('keyup', (event) => {
  if ((event.key === ' ' || event.key === 'ArrowUp') && aim?.charging) {
    event.preventDefault();
    fire({ power: aim.power, yaw: aim.yaw });
  }
});

// 창을 벗어나면 누르고 있던 것을 놓은 것으로 본다 (던지지는 않는다)
window.addEventListener('blur', () => {
  if (!aim) return;
  aim.charging = false;
  aim.drag = null;
  aim.held = null;
  hideSwipe();
  showPower(null);
});

// ---------- 프레임 ----------

/** 손 흔들림을 움직이고 손에 든 화살·조준선에 보여 준다. 움직이는 것이 있으면 true */
scene.onFrame = (dt) => {
  toast.tick(dt);
  if (cpuAim) {
    cpuAim.t += dt;
    const off = swayOffset(cpuAim.t);
    scene.setAim(0, { x: off.x * 0.5, y: off.y * 0.5 });
    return true;
  }
  if (!aim) return false;
  aim.t += dt;
  if (aim.held !== null) aim.held += dt;
  const amp = swayAmplitude(aim.held, aim.distance);
  const off = swayOffset(aim.t);
  aim.sway = { x: off.x * amp, y: off.y * amp };
  if (aim.charging) {
    aim.t0 += dt;
    const k = (aim.t0 / CHARGE_PERIOD) % 1;
    aim.power = k < 0.5 ? k * 2 : 2 - k * 2;
    showPower(aim.power);
  }
  scene.setAim(aim.drag ? (aim.drag.shot?.yaw ?? 0) : aim.yaw, aim.sway);
  return true;
};

scene.onEvent = (event) => {
  switch (event.type) {
    case 'pot':
      sound.pot(event.speed);
      break;
    case 'ground':
      sound.ground(event.speed);
      break;
    case 'enter':
      sound.ring(event.hole === 'ear');
      break;
    case 'result':
      if (flight?.arrow === event.arrow) {
        const { resolve } = flight;
        flight = null;
        resolve(event.result);
      }
      break;
  }
};

$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', again);
$('btn-result-menu').addEventListener('click', openMenu);
$('btn-menu').addEventListener('click', (event) => {
  event.currentTarget.blur();
  openMenu();
});

// ?debug 로 열면 콘솔에서 상태를 들여다보고, 화살을 든 동안 shoot({ power, yaw }) 로 대신 던질 수 있다
// (흔들림 없이 그대로 던진다). target 을 'earLeft' | 'earRight' 로 주면 그 귀를 겨눈 세기·방향으로 던진다
if (params.has('debug')) {
  window.tuho = {
    scene,
    sound,
    store,
    yard,
    get game() {
      return game;
    },
    get aim() {
      return aim;
    },
    get state() {
      return state;
    },
    shoot(shot = {}) {
      if (!aim) return false;
      const { resolve, distance } = aim;
      const base = shot.target ? aimFor(distance, TARGETS[shot.target]) : { power: 0.5, yaw: 0 };
      aim = null;
      hideSwipe();
      showPower(null);
      scene.showHand(null);
      resolve({ ...base, pitch: 0, ...shot });
      return true;
    },
  };
}

try {
  await scene.load();
  $('loading').hidden = true;
  openMenu();
} catch (error) {
  console.error(error);
  $('loading').textContent = t('loadFailed', { message: error.message });
}
