// 볼링: 규칙(game.js)·컴퓨터(ai.js)와 3D 씬(scene.js)을 잇고, 점수표와 조준 단계를 진행한다.
// 조준은 세 단계다: ① 공을 놓을 자리 → ② 좌우로 흔들리는 방향 → ③ 오르내리는 세기. 단계마다 클릭(탭)으로 확정한다.
// 컴퓨터와 1:1 로 치거나, 2인 대전에서는 한 기기로 두 사람이 프레임마다 번갈아 같은 방식으로 던진다.

import { BowlingGame, FRAMES } from './game.js';
import { computerThrow } from './ai.js';
import { LANE_WIDTH, START_LIMIT, SPEED_MIN, SPEED_MAX, clamp } from './lane.js';
import { BowlingScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle, formatNumber } from '../../shared/i18n.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);

const SWING = 0.026; // 방향이 좌우로 흔들리는 폭 (라디안). 1번 핀 자리에서 약 ±47cm
const SWING_PERIOD = 2.4; // 초
const POWER_PERIOD = 1.7; // 세기가 0 → 최대 → 0 으로 한 번 오르내리는 시간
const PREVIEW_SPEED = 7.5; // 세기를 고르기 전에 조준선을 그릴 때 쓰는 속도
const BOARD = LANE_WIDTH / 39; // 키보드로 한 번에 옮기는 거리 (판재 한 장)

applyI18n(t);
mountLangToggle($('tools'), { className: 'chip' });

const tap = t(matchMedia('(pointer: coarse)').matches ? 'tap' : 'click');

const scene = new BowlingScene($('stage'), $('pin-cam'));
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
let game;
let spins = [0, 0]; // 사람마다 고른 스핀
let lastX = [0, 0]; // 사람마다 마지막으로 고른 출발 위치. 다음 투구에서 그대로 시작한다
let aim = null; // 사람이 조준하는 동안의 상태 { player, phase, startX, angle, power, t, resolve }

/** 점수표·배너에 쓰는 이름. 컴퓨터 대전은 나/컴퓨터, 2인 대전은 플레이어 1/2 */
function nameOf(player) {
  if (game?.mode === 'versus') return t(player === 0 ? 'player1' : 'player2');
  return t(player === 0 ? 'me' : 'computer');
}

/** 아래쪽 안내 문구. player 를 주면 그 사람의 공 색 점을 앞에 붙인다 */
function setStatus(text, player = null) {
  const el = $('status');
  el.textContent = text;
  if (text && player !== null) {
    const dot = document.createElement('i');
    dot.className = `dot ${player === 0 ? 'me' : 'computer'}`;
    el.prepend(dot);
  }
}

// ---------- 점수표 ----------

function buildCard() {
  const head = $('card-head');
  head.innerHTML = '<th class="col-name"></th>';
  for (let f = 1; f <= FRAMES; f++) {
    const th = document.createElement('th');
    th.textContent = f;
    if (f === FRAMES) th.className = 'col-tenth';
    head.append(th);
  }
  const total = document.createElement('th');
  total.className = 'col-total';
  total.textContent = t('total');
  head.append(total);

  const body = $('card-body');
  body.innerHTML = '';
  ['me', 'computer'].forEach((who, i) => {
    const row = document.createElement('tr');
    row.id = `row-${i}`;
    row.innerHTML = `<td class="name"><i class="dot ${who}"></i><span class="label"></span><span class="short">${i + 1}</span></td>`;
    for (let f = 0; f < FRAMES; f++) {
      const boxes = f === FRAMES - 1 ? 3 : 2;
      const cell = document.createElement('td');
      cell.className = f === FRAMES - 1 ? 'frame tenth' : 'frame';
      cell.innerHTML = `<div class="marks">${'<span></span>'.repeat(boxes)}</div><div class="cum"></div>`;
      row.append(cell);
    }
    row.insertAdjacentHTML('beforeend', '<td class="total">0</td>');
    body.append(row);
  });
}

function updateHud() {
  game.players.forEach((_, i) => {
    const card = game.card(i);
    const row = $(`row-${i}`);
    row.querySelector('.label').textContent = nameOf(i);
    row.classList.toggle('versus', game.mode === 'versus');
    const active = !game.over && game.current === i;
    row.classList.toggle('active', active);
    for (let f = 0; f < FRAMES; f++) {
      const cell = row.children[f + 1];
      const frame = card.frames[f];
      [...cell.querySelector('.marks').children].forEach((box, k) => {
        const mark = frame?.marks[k] ?? '';
        box.textContent = mark;
        box.className = mark === 'X' ? 'x' : mark === '/' ? 'spare' : '';
      });
      cell.querySelector('.cum').textContent = frame?.total ?? '';
      cell.classList.toggle('current', active && card.next?.frame === f);
    }
    row.lastElementChild.textContent = formatNumber(card.total);
  });
}

function callout(text, great) {
  const el = $('callout');
  el.hidden = true;
  el.textContent = text;
  el.dataset.tone = great ? 'great' : '';
  void el.offsetWidth; // 애니메이션을 처음부터 다시 돌린다
  el.hidden = false;
}

// ---------- 사람의 조준 ----------

const swing = (t) => SWING * Math.sin((2 * Math.PI * t) / SWING_PERIOD);
const pump = (t) => {
  const k = (t / POWER_PERIOD) % 1;
  return k < 0.5 ? k * 2 : 2 - k * 2;
};
const speedOf = (power) => SPEED_MIN + power * (SPEED_MAX - SPEED_MIN);

function shotOf(a) {
  return {
    startX: a.startX,
    angle: a.phase === 'position' ? 0 : a.angle,
    speed: a.phase === 'power' ? speedOf(a.power) : PREVIEW_SPEED,
    spin: spins[a.player],
  };
}

function playerShot(player) {
  return new Promise((resolve) => {
    aim = { player, phase: 'position', startX: lastX[player], angle: 0, power: 0, t: 0, resolve };
    setSpin(spins[player]);
    setStartX(lastX[player]);
    enterPhase('position');
  });
}

function enterPhase(phase) {
  aim.phase = phase;
  aim.t = 0;
  $('power').hidden = phase !== 'power';
  const text = t(phase, { tap });
  // 2인 대전에서는 누구 차례인지 함께 적는다
  if (game.mode === 'versus') setStatus(t('whoseShot', { name: nameOf(aim.player), text }), aim.player);
  else setStatus(text);
}

function setStartX(x) {
  aim.startX = clamp(x, -START_LIMIT, START_LIMIT);
  lastX[aim.player] = aim.startX;
  scene.placeBall(aim.player, aim.startX);
}

function confirm() {
  if (aim.phase === 'position') return enterPhase('direction');
  if (aim.phase === 'direction') return enterPhase('power');
  const shot = shotOf(aim);
  const { resolve } = aim;
  aim = null;
  $('power').hidden = true;
  resolve(shot);
}

function setSpin(value) {
  if (aim) spins[aim.player] = value;
  for (const button of $('spin').children) {
    button.setAttribute('aria-checked', String(Number(button.dataset.spin) === value));
  }
}

scene.onFrame = (dt) => {
  // 공이 바닥을 구르는 동안 속도에 맞춰 굴러가는 소리를 낸다
  const roll = scene.mode === 'roll' ? scene.physics.ballRoll() : null;
  sound.setRoll(roll?.speed ?? 0, roll?.gutter);
  if (!aim) return;
  aim.t += dt;
  if (aim.phase === 'direction') aim.angle = swing(aim.t);
  if (aim.phase === 'power') {
    aim.power = pump(aim.t);
    $('power-fill').style.width = `${aim.power * 100}%`;
  }
  scene.setGuide(shotOf(aim));
  return aim.phase !== 'position'; // 방향·세기 게이지가 움직이는 중
};

scene.onPointer = (type, event) => {
  if (!aim) return;
  if (aim.phase === 'position' && type !== 'pointerup') return setStartX(scene.laneX(event));
  if (type !== 'pointerup' || (event.pointerType === 'mouse' && event.button !== 0)) return;
  if (aim.phase === 'position') setStartX(scene.laneX(event));
  confirm();
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
  event.currentTarget.blur(); // 스페이스로 조준을 확정할 때 버튼이 다시 눌리지 않게
});

scene.physics.onImpact = (kind, speed) => sound.impact(kind, speed);
scene.physics.onGutter = () => sound.play('gutter');

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'm' || event.key === 'M') return toggleSound();
  if (['1', '2', '3'].includes(event.key) && !$('controls').hidden) return setSpin(Number(event.key) - 2);
  if (!aim) return;
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat) confirm();
  } else if (event.key === 'Escape') {
    enterPhase('position');
  } else if (aim.phase === 'position' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    setStartX(aim.startX + (event.key === 'ArrowLeft' ? -BOARD : BOARD));
  }
});

$('spin').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  setSpin(Number(button.dataset.spin));
  button.blur(); // 스페이스로 조준을 확정할 때 버튼이 다시 눌리지 않게
});

// ---------- 컴퓨터 ----------

async function computerShot(standing) {
  setStatus(t('computerTurn'), 1);
  const shot = computerThrow(standing);
  await sleep(600);
  scene.placeBall(1, shot.startX);
  await sleep(500);
  scene.setGuide(shot);
  await sleep(900);
  return shot;
}

// ---------- 진행 ----------

function resultText(result, knocked, gutter) {
  if (result.strike) return [t('strike'), true];
  if (result.spare) return [t('spare'), true];
  if (knocked === 0 && gutter) return [t('gutter'), false];
  return [t('pins', { n: knocked }), false];
}

async function play() {
  while (!game.over) {
    updateHud();
    const player = game.current;
    const human = game.isHuman(player);
    const before = scene.standing();
    $('pin-cam').hidden = false;
    $('controls').hidden = !human;
    scene.placeBall(player, human ? lastX[player] : 0);
    const shot = human ? await playerShot(player) : await computerShot(before);

    $('controls').hidden = true;
    $('pin-cam').hidden = true;
    setStatus('');
    sound.play('release', 1, 0.6 + 0.4 * ((shot.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)));
    const { standing, gutter } = await scene.roll(player, shot);
    // 물리에서 센 핀 수가 규칙상 가능한 범위를 벗어나지 않게 한 번 더 막는다
    const knocked = clamp(before.length - standing.length, 0, game.next.standing);
    const result = game.roll(knocked);
    updateHud();
    callout(...resultText(result, knocked, gutter));
    if (result.strike) sound.play('strike');
    else if (result.spare) sound.play('spare');
    await sleep(1600);
    if (result.gameOver) break;
    if (result.rerack) scene.rack();
    else scene.sweep();
    if (result.turnOver) {
      game.nextTurn();
      if (game.current !== player) {
        sound.play('turn');
        // 2인 대전에서는 기기를 넘겨받는 사람이 알아보도록 차례를 크게 띄운다
        if (game.mode === 'versus') {
          callout(t('turnOf', { name: nameOf(game.current) }), false);
          updateHud();
          scene.placeBall(game.current, lastX[game.current]);
          await sleep(1000);
        }
      }
    }
  }
  endGame();
}

function endGame() {
  updateHud();
  const [a, b] = game.players.map((_, i) => game.card(i).total);
  const winner = game.winner;
  const versus = game.mode === 'versus';
  let title;
  if (winner === null) title = t('draw');
  else if (versus) title = t('winner', { name: nameOf(winner) });
  else title = t(winner === 0 ? 'win' : 'lose');
  $('banner-title').textContent = title;
  $('banner-detail').textContent = t('score', {
    a: nameOf(0),
    x: formatNumber(a),
    y: formatNumber(b),
    b: nameOf(1),
  });
  const won = versus ? winner !== null : winner === 0;
  $('banner').dataset.tone = won ? 'win' : 'lose';
  $('banner').hidden = false;
  sound.play(won ? 'win' : 'lose');
  setStatus('');
  showMenu(true);
}

/** 대전 방식을 고르는 창. again 이면 끝난 게임 아래에 띄운다 */
function showMenu(again = false) {
  $('menu-title').textContent = t(again ? 'againTitle' : 'menuTitle');
  $('menu').hidden = false;
  $('controls').hidden = true;
  $('pin-cam').hidden = true;
}

function newGame(mode) {
  game = new BowlingGame(mode);
  spins = [0, 0];
  lastX = [0, 0];
  aim = null;
  scene.rack();
  $('banner').hidden = true;
  $('menu').hidden = true;
  play();
}

$('menu').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  button.blur();
  newGame(button.dataset.mode);
});

// ?debug 로 열면 콘솔에서 씬과 게임 상태를 들여다볼 수 있다
if (params.has('debug')) {
  window.bowling = { scene, sound, get game() { return game; } };
}

try {
  buildCard();
  setSpin(0);
  await scene.load();
  $('loading').hidden = true;
  $('hud').hidden = false;
  game = new BowlingGame();
  updateHud();
  showMenu();
} catch (error) {
  console.error(error);
  $('loading').textContent = t('loadFailed', { message: error.message });
}
