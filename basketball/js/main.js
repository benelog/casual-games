// 농구 자유투: 규칙(game.js)·물리(physics.js)와 3D 씬(scene.js)을 잇고, HUD·스와이프 입력·진행을 맡는다.
// 공은 화면을 위로 밀어 올려(스와이프) 던진다. 끈 길이가 세기, 기울기가 좌우 방향이다.
// 혼자서 60초·12구 기록에 도전하거나, 2인 대전에서는 한 기기로 두 사람이 번갈아 던진다.

import { ShootoutGame, MODES, STAGES, TIME_LIMIT } from './game.js';
import { Court, launch, swipeToShot, clamp, YAW_LIMIT } from './physics.js';
import { BasketballScene } from './scene.js';
import { SaveStore, browserStorage } from './save.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle } from '../../shared/i18n.js';
import { segmented, createToast, focusForKeyboard } from '../../shared/ui.js';
import { formatTime } from '../../shared/util.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);

const CHARGE_PERIOD = 2.2; // 키보드: Space 를 누르고 있으면 세기가 0 → 최대 → 0 으로 오르내리는 시간 (초)
const YAW_STEP = 0.01; // 키보드로 한 번에 돌리는 방향 (라디안). Shift 는 0.003
const KEEP_BALLS = 3; // 코트에 남겨 두는 공 수 (오래된 공부터 치운다)
const TICK_FROM = 5; // 남은 시간이 이만큼일 때부터 초마다 똑딱

document.title = t('pageTitle');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const coarse = matchMedia('(pointer: coarse)').matches;

const scene = new BasketballScene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.5);
const court = new Court();
scene.court = court;

let settings = store.loadSettings();
let game = null;
let state = 'menu'; // menu | playing | done
let session = 0; // 새 판을 시작하거나 메뉴로 가면 늘어, 예전 진행 흐름을 멈춘다
let starter = 0; // 2인 대전에서 먼저 던지는 사람. 한 판 더 하면 바뀐다
let aim = null; // 공을 들고 있는 동안 { resolve, drag: { id, x, y, shot } | null, yaw, charging, power, t }
let flight = null; // 결과를 기다리는 공 { ball, resolve }
let clockRunning = false; // time 모드: 첫 슛부터 시간이 흐른다
let lastTick = 0;

const playerName = (player) => t('player', { n: player + 1 });
for (const player of [0, 1]) $(`player-${player}`).querySelector('.name').textContent = playerName(player);

$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

// ---------- 메뉴 ----------

function renderMenu() {
  segmented(
    $('mode-options'),
    MODES.map((value) => ({ value, label: t(`mode.${value}`), detail: t(`mode.${value}.detail`) })),
    settings.mode,
    (mode) => {
      settings = { ...settings, mode };
      renderMenu();
    },
  );
  $('menu-record').textContent = settings.mode === 'versus' ? t('versusHint') : bestText(settings.mode) ?? t('noBest');
}

function bestText(mode) {
  const best = store.loadBest(mode);
  if (!best) return null;
  return t('best', { score: best.score, makes: best.makes, shots: best.shots, streak: best.streak });
}

function setState(next) {
  state = next;
  const playing = next !== 'menu';
  $('menu').hidden = next !== 'menu';
  $('result').hidden = true;
  $('bottom').hidden = !playing;
  $('btn-menu').hidden = !playing;
  $('stats').hidden = !playing || game?.players > 1;
  $('versus').hidden = !playing || !(game?.players > 1);
  $('spot').hidden = !playing;
  updateTurn();
}

function openMenu() {
  session++;
  cancelAim();
  flight = null;
  game = null;
  clockRunning = false;
  for (const ball of [...court.balls]) court.remove(ball);
  scene.setStage(STAGES[0]);
  scene.showHand(false);
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

function newGame(first) {
  session++;
  cancelAim();
  flight = null;
  starter = first;
  clockRunning = false;
  lastTick = 0;
  game = new ShootoutGame({ mode: settings.mode, first });
  scene.setStage(game.stage, { cut: true });
  setState('playing');
  updateHud();
  play(session);
}

// ---------- HUD ----------

function updateHud() {
  if (!game) return;
  const p = game.current;
  $('score').textContent = game.scores[0];
  $('streak').textContent = game.streak[0];
  $('stat-time').hidden = game.mode !== 'time';
  $('stat-left').hidden = game.mode === 'time';
  $('time').textContent = formatTime(Math.ceil(game.timeLeft));
  $('stat-time').classList.toggle('hurry', game.mode === 'time' && clockRunning && game.timeLeft <= 10);
  if (game.mode !== 'time') $('left').textContent = game.shotsLeft(0);
  for (const player of [0, 1]) {
    if (player >= game.players) break;
    const el = $(`player-${player}`);
    el.querySelector('.score').textContent = game.scores[player];
    el.querySelector('.balls').textContent = t('ballsShort', { n: game.shotsLeft(player) });
  }
  const stage = game.stage;
  $('spot-name').textContent = t(`stage.${stage.id}`);
  $('spot-points').textContent = t('pointsEach', { n: stage.points });
  $('spot').dataset.player = game.players > 1 ? p : '';
}

/** 2인 대전: 누구 차례인지를 점수판·안내 줄·화면 가장자리에 함께 알린다 */
function updateTurn() {
  const active = !!game && state === 'playing' && game.players > 1;
  const player = active ? game.current : -1;
  for (const p of [0, 1]) $(`player-${p}`).classList.toggle('active', p === player);
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
  $('turn-name').textContent = t('turnOf', { name: playerName(player) });
  $('turn-hint').textContent = t('ballsLeftOf', { n: game.shotsLeft(player) });
}

function setStatus(text) {
  $('status').textContent = text;
}

function showPower(power) {
  $('power').hidden = power === null;
  if (power !== null) $('power-fill').style.height = `${power * 100}%`;
}

// ---------- 던지기 ----------

/** 공을 손에 들고 사람이 던질 때까지 기다린다. 판이 끝나거나 시간이 다 되면 null */
function waitShot() {
  return new Promise((resolve) => {
    aim = { resolve, drag: null, yaw: 0, charging: false, power: 0, t: 0 };
    scene.showHand(true);
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
  scene.showHand(false);
  resolve(null);
}

function fire(shot) {
  if (!aim) return;
  const { resolve } = aim;
  aim = null;
  hideSwipe();
  showPower(null);
  scene.showHand(false);
  resolve(shot);
}

/** 던진 공의 결과(들어갔는지)를 기다린다 */
function waitResult(ball) {
  return new Promise((resolve) => {
    flight = { ball, resolve };
  });
}

/** 오래된 공을 치운다 (지금 날아가는 공은 남긴다) */
function tidyBalls() {
  const dead = court.balls.filter((b) => b.result);
  while (dead.length > KEEP_BALLS - 1) court.remove(dead.shift());
}

// ---------- 진행 ----------

async function play(token) {
  let previous = game.current;
  let first = true;
  while (token === session && !game.over) {
    const stage = game.stage;
    scene.setStage(stage);
    updateHud();
    updateTurn();
    if (game.players > 1 && (first || previous !== game.current)) {
      sound.play('turn');
      toast.show(t('turnOf', { name: playerName(game.current) }), `p${game.current}`);
    }
    previous = game.current;
    first = false;

    const shot = game.canShoot ? await waitShot() : null;
    if (token !== session) return;
    if (!shot) break; // 시간이 다 되었다

    game.release();
    if (game.mode === 'time' && !clockRunning) clockRunning = true;
    tidyBalls();
    const ball = court.add(launch(stage.distance, stage.angle, shot));
    sound.play('release', 1, { volume: 0.6 + 0.4 * shot.power });
    setStatus('');
    const outcome = await waitResult(ball);
    if (token !== session) return;

    const result = game.record(outcome);
    feedback(result, ball);
    updateHud();
    // 결과를 잠깐 보여 준다. 시간제는 쉬지 않고 다음 공을 준다
    await sleep(game.mode === 'time' ? (result.made ? 250 : 450) : 1300);
    if (token !== session) return;
    if (result.stageUp && !game.over) {
      const next = game.stage;
      toast.show(t('nextSpot', { name: t(`stage.${next.id}`), n: next.points }), 'big');
      if (game.mode !== 'time') await sleep(700);
    }
    game.nextTurn();
  }
  if (token === session) endGame();
}

/** 결과에 맞춰 알림·소리 */
function feedback(result, ball) {
  if (result.made) {
    const parts = [t('plus', { n: result.points })];
    if (result.clean) parts.push(t('clean'));
    else if (result.bank) parts.push(t('bank'));
    if (result.bonus > 0) parts.push(t('streakBonus', { n: result.streak, b: result.bonus }));
    const tone = game.players > 1 ? `p${result.player}` : result.clean ? 'gold' : 'good';
    toast.show(parts.join(' · '), tone);
    sound.play('score', 1 + Math.min(0.3, result.streak * 0.04));
    if (result.streak >= 3 && result.streak % 3 === 0) sound.play('cheer', 1, { volume: 0.6 });
  } else {
    const air = !ball.touchedRim && !ball.touchedBoard;
    toast.show(t(air ? 'airball' : 'miss'), 'miss');
  }
}

function endGame() {
  cancelAim();
  updateHud();
  setState('done');
  const versus = game.players > 1;
  let tone = '';
  let lines = [];
  if (versus) {
    const winner = game.winner;
    tone = winner < 0 ? '' : `p${winner}`;
    $('result-title').textContent = winner < 0 ? t('draw') : t('winner', { name: playerName(winner) });
    $('result-detail').textContent = t('finalScore', { a: playerName(0), x: game.scores[0], y: game.scores[1], b: playerName(1) });
    lines = [0, 1].map((p) => t('playerLine', { name: playerName(p), makes: game.makes[p], shots: game.shots[p], streak: game.bestStreak[p] }));
    sound.play('win');
    sound.play('cheer');
  } else {
    const result = game.result;
    const previous = store.loadBest(game.mode);
    const improved = store.recordBest(game.mode, result);
    const isBest = !!previous && improved.score;
    tone = isBest ? 'win' : '';
    $('result-title').textContent = isBest ? t('newBest') : t(game.mode === 'time' ? 'timeUp' : 'finished');
    $('result-detail').textContent = t('summary', {
      score: result.score,
      makes: result.makes,
      shots: result.shots,
      pct: result.shots ? Math.round((result.makes / result.shots) * 100) : 0,
      streak: result.streak,
    });
    if (previous && improved.streak && !improved.score) lines.push(t('bestStreak'));
    lines.push(bestText(game.mode));
    sound.play(isBest || !previous ? 'win' : 'lose');
    if (isBest) sound.play('cheer');
  }
  $('result-record').textContent = lines.filter(Boolean).join(' · ');
  $('result').dataset.tone = tone;
  setStatus('');
  $('result').hidden = false;
  focusForKeyboard($('btn-again'));
}

/** 한 판 더: 2인 대전에서는 먼저 던지는 사람을 바꾼다 */
function again() {
  newGame(game?.players > 1 ? 1 - starter : 0);
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
    scene.setAim(drag.shot ? drag.shot.yaw : null);
    return;
  }
  if (type === 'pointercancel') {
    aim.drag = null;
    hideSwipe();
    showPower(null);
    scene.setAim(null);
    return;
  }
  if (type === 'pointerup') {
    const shot = swipeToShot(event.clientX - drag.x, event.clientY - drag.y, height);
    aim.drag = null;
    if (shot) return fire(shot);
    hideSwipe();
    showPower(null);
    scene.setAim(null);
    setStatus(t('swipeUp'));
  }
};

// 브라우저는 사용자 입력이 있어야 소리를 내게 해 준다
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sound.unlock(), true);

function toggleSound() {
  sound.unlock();
  sound.setEnabled(!sound.enabled);
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
    const step = event.shiftKey ? 0.003 : YAW_STEP;
    aim.yaw = clamp(aim.yaw + (event.key === 'ArrowLeft' ? -step : step), -YAW_LIMIT, YAW_LIMIT);
    scene.setAim(aim.yaw);
  } else if (event.key === ' ' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (event.repeat || aim.charging) return;
    aim.charging = true;
    aim.t = 0;
    aim.power = 0;
    scene.setAim(aim.yaw);
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
  hideSwipe();
  showPower(null);
});

// ---------- 프레임 ----------

/** 결과가 난 공이 되굴러 던지는 사람 앞까지 오면 받은 것으로 보고 치운다 (카메라를 지나가지 않게) */
function catchRebounds() {
  const reach = scene.stage.distance + 0.6;
  for (const ball of court.balls) {
    if (ball.result && Math.hypot(ball.x, ball.z) > reach) court.remove(ball);
  }
}

scene.onFrame = (dt) => {
  catchRebounds();
  if (game && state === 'playing' && clockRunning) {
    const up = game.tick(dt);
    const left = Math.ceil(game.timeLeft);
    if (left !== lastTick) {
      lastTick = left;
      if (left > 0 && left <= TICK_FROM) sound.play('tick');
      updateHud();
    }
    if (up) {
      sound.buzzer();
      toast.show(t('buzzer'), 'big');
      if (aim) cancelAim();
    }
  }
  if (!aim?.charging) return false;
  aim.t += dt;
  const k = (aim.t / CHARGE_PERIOD) % 1;
  aim.power = k < 0.5 ? k * 2 : 2 - k * 2;
  showPower(aim.power);
  return true;
};

scene.onEvent = (event) => {
  switch (event.type) {
    case 'floor':
      sound.bounce(event.speed);
      break;
    case 'rim':
      sound.rim(event.speed);
      break;
    case 'board':
      sound.board(event.speed);
      break;
    case 'net':
      sound.swish(!event.ball.touchedRim && !event.ball.touchedBoard);
      break;
    case 'score':
    case 'miss':
      if (flight?.ball === event.ball) {
        const { resolve } = flight;
        flight = null;
        resolve({ made: event.type === 'score', clean: !!event.clean, bank: !!event.bank });
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

// ?debug 로 열면 콘솔에서 상태를 들여다보고, 공을 든 동안 shoot({ power, yaw }) 로 대신 던질 수 있다
if (params.has('debug')) {
  window.basketball = {
    scene,
    sound,
    store,
    court,
    get game() {
      return game;
    },
    get aim() {
      return aim;
    },
    get state() {
      return state;
    },
    shoot(shot) {
      if (aim) fire({ power: 0.5, yaw: 0, ...shot });
    },
    setTime(seconds) {
      if (game?.mode === 'time') game.timeLeft = Math.min(TIME_LIMIT, seconds);
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
