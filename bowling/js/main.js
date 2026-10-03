// 볼링: 규칙(game.js)·컴퓨터(ai.js)와 3D 씬(scene.js)을 잇고, 점수표와 조준 단계를 진행한다.
// 조준은 세 단계다: ① 공을 놓을 자리 → ② 좌우로 흔들리는 방향 → ③ 오르내리는 세기. 단계마다 클릭(탭)으로 확정한다.

import { BowlingGame, FRAMES } from './game.js';
import { computerThrow } from './ai.js';
import { LANE_WIDTH, START_LIMIT, SPEED_MIN, SPEED_MAX, clamp } from './lane.js';
import { BowlingScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);

const SWING = 0.026; // 방향이 좌우로 흔들리는 폭 (라디안). 1번 핀 자리에서 약 ±47cm
const SWING_PERIOD = 2.4; // 초
const POWER_PERIOD = 1.7; // 세기가 0 → 최대 → 0 으로 한 번 오르내리는 시간
const PREVIEW_SPEED = 7.5; // 세기를 고르기 전에 조준선을 그릴 때 쓰는 속도
const BOARD = LANE_WIDTH / 39; // 키보드로 한 번에 옮기는 거리 (판재 한 장)

const tap = matchMedia('(pointer: coarse)').matches ? '탭' : '클릭';
const PHASE_TEXT = {
  position: `① 좌우로 움직여 공을 놓을 자리를 고르고 ${tap}`,
  direction: `② 흔들리는 조준선이 원하는 방향일 때 ${tap}`,
  power: `③ 원하는 세기에서 ${tap}하면 굴러갑니다`,
};

const scene = new BowlingScene($('stage'), $('pin-cam'));
let game;
let spin = 0;
let lastX = 0; // 사람이 마지막으로 고른 출발 위치. 다음 투구에서 그대로 시작한다
let aim = null; // 사람이 조준하는 동안의 상태 { phase, startX, angle, power, t, resolve }

function setStatus(text) {
  $('status').textContent = text;
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
  head.insertAdjacentHTML('beforeend', '<th class="col-total">합계</th>');

  const body = $('card-body');
  body.innerHTML = '';
  ['me', 'computer'].forEach((who, i) => {
    const row = document.createElement('tr');
    row.id = `row-${i}`;
    row.innerHTML = `<td class="name"><i class="dot ${who}"></i><span class="label">${i === 0 ? '나' : '컴퓨터'}</span></td>`;
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
    row.lastElementChild.textContent = card.total;
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
    spin,
  };
}

function playerShot() {
  return new Promise((resolve) => {
    aim = { phase: 'position', startX: lastX, angle: 0, power: 0, t: 0, resolve };
    setStartX(lastX);
    enterPhase('position');
  });
}

function enterPhase(phase) {
  aim.phase = phase;
  aim.t = 0;
  $('power').hidden = phase !== 'power';
  setStatus(PHASE_TEXT[phase]);
}

function setStartX(x) {
  aim.startX = clamp(x, -START_LIMIT, START_LIMIT);
  lastX = aim.startX;
  scene.placeBall(0, aim.startX);
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
  spin = value;
  for (const button of $('spin').children) {
    button.setAttribute('aria-checked', String(Number(button.dataset.spin) === value));
  }
}

scene.onFrame = (dt) => {
  if (!aim) return;
  aim.t += dt;
  if (aim.phase === 'direction') aim.angle = swing(aim.t);
  if (aim.phase === 'power') {
    aim.power = pump(aim.t);
    $('power-fill').style.width = `${aim.power * 100}%`;
  }
  scene.setGuide(shotOf(aim));
};

scene.onPointer = (type, event) => {
  if (!aim) return;
  if (aim.phase === 'position' && type !== 'pointerup') return setStartX(scene.laneX(event));
  if (type !== 'pointerup' || (event.pointerType === 'mouse' && event.button !== 0)) return;
  if (aim.phase === 'position') setStartX(scene.laneX(event));
  confirm();
};

document.addEventListener('keydown', (event) => {
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
  setStatus('컴퓨터 차례');
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
  if (result.strike) return ['스트라이크!', true];
  if (result.spare) return ['스페어!', true];
  if (knocked === 0) return [gutter ? '거터' : '0핀', false];
  return [`${knocked}핀`, false];
}

async function play() {
  while (!game.over) {
    updateHud();
    const player = game.current;
    const before = scene.standing();
    $('pin-cam').hidden = false;
    $('controls').hidden = player !== 0;
    scene.placeBall(player, player === 0 ? lastX : 0);
    const shot = player === 0 ? await playerShot() : await computerShot(before);

    $('controls').hidden = true;
    $('pin-cam').hidden = true;
    setStatus('');
    const { standing, gutter } = await scene.roll(player, shot);
    // 물리에서 센 핀 수가 규칙상 가능한 범위를 벗어나지 않게 한 번 더 막는다
    const knocked = clamp(before.length - standing.length, 0, game.next.standing);
    const result = game.roll(knocked);
    updateHud();
    callout(...resultText(result, knocked, gutter));
    await sleep(1600);
    if (result.gameOver) break;
    if (result.rerack) scene.rack();
    else scene.sweep();
    if (result.turnOver) game.nextTurn();
  }
  endGame();
}

function endGame() {
  updateHud();
  const [mine, theirs] = game.players.map((_, i) => game.card(i).total);
  const winner = game.winner;
  $('banner-title').textContent = winner === 0 ? '승리!' : winner === 1 ? '패배' : '무승부';
  $('banner-detail').textContent = `나 ${mine} : ${theirs} 컴퓨터`;
  $('banner').dataset.tone = winner === 0 ? 'win' : 'lose';
  $('banner').hidden = false;
  $('btn-new').hidden = false;
  setStatus('');
}

function newGame() {
  game = new BowlingGame();
  scene.rack();
  $('banner').hidden = true;
  $('btn-new').hidden = true;
  play();
}

$('btn-new').addEventListener('click', newGame);

// ?debug 로 열면 콘솔에서 씬과 게임 상태를 들여다볼 수 있다
if (params.has('debug')) {
  window.bowling = { scene, get game() { return game; } };
}

try {
  buildCard();
  setSpin(0);
  await scene.load();
  $('loading').hidden = true;
  $('hud').hidden = false;
  newGame();
} catch (error) {
  console.error(error);
  $('loading').textContent = `불러오기에 실패했습니다: ${error.message}`;
}
