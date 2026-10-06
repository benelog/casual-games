// 컬링: 규칙(game.js)·물리(physics.js)·컴퓨터(ai.js)와 3D 씬(scene.js)을 잇고, 점수판·조준·스위핑을 진행한다.
// 던지기는 두 단계다: ① 회전 방향을 고르고 브룸(겨눌 곳)을 옮긴다 → ② 오르내리는 세기 게이지를 멈춰 던진다.
// 스톤이 가는 동안 누르고 있으면 스위핑해서 더 멀리, 덜 휘게 간다.
// 컴퓨터와 1:1 로 하거나, 2인 대전에서는 한 기기로 두 사람이 번갈아 던진다.

import { CurlingMatch, END_OPTIONS, STONE_OPTIONS, scoreEnd } from './game.js';
import { chooseShot, LEVEL_IDS } from './ai.js';
import {
  Sheet,
  WEIGHT_KNOTS,
  ANGLE_LIMIT,
  angleToward,
  broomX,
  speedOfPower,
  powerOfSpeed,
  clamp,
} from './physics.js';
import { CurlingScene } from './scene.js';
import { SaveStore, browserStorage, OPPONENTS } from './save.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle } from '../../shared/i18n.js';
import { segmented, createToast, focusForKeyboard } from '../../shared/ui.js';
import { damp } from '../../shared/util.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);

const POWER_PERIOD = 3.2; // 세기가 0 → 최대 → 0 으로 한 번 오르내리는 시간 (초)
const BROOM_LIMIT = broomX(ANGLE_LIMIT);
const BROOM_STEP = 0.05; // 키보드로 한 번에 옮기는 브룸 거리 (m). Shift 는 1cm
const DEFAULT_BROOM = 1.2; // 처음 브룸 자리: 휘어 들어올 몫만큼 버튼 옆

document.title = t('pageTitle');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const tap = t(matchMedia('(pointer: coarse)').matches ? 'tap' : 'click');

const scene = new CurlingScene($('stage'), $('house-cam'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.6);

let settings = store.loadSettings();
let match = null;
let sheet = new Sheet();
let session = 0; // 새 경기를 시작하거나 메뉴로 가면 늘어, 예전 진행 흐름을 멈춘다
let aim = null; // 사람이 던지는 중의 상태 { team, phase: line|weight, broom, spin, power, t, resolve }
let lastAim = [
  { broom: -DEFAULT_BROOM, spin: 1 },
  { broom: -DEFAULT_BROOM, spin: 1 },
]; // 팀마다 마지막으로 고른 브룸·회전. 다음 투구에서 그대로 시작한다
let sweepHeld = { pointer: false, key: false, button: false };
let sweepLevel = 0;
let sweeper = false; // 지금 가는 스톤을 사람이 쓸 수 있는지
let throwing = null; // 스톤이 가는 동안 점수판에 차례로 표시할 팀
let starter = 1; // 첫 엔드의 해머. 한 판 더 하면 바뀐다

sound.enabled = settings.sound;
$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

/** 점수판·안내에 쓰는 이름. 컴퓨터 대전은 나/컴퓨터, 2인 대전은 플레이어 1/2 */
function nameOf(team) {
  if (match?.mode === 'versus') return t('player', { n: team + 1 });
  return t(team === 0 ? 'me' : 'computer');
}

/** 아래쪽 안내 문구. team 을 주면 그 팀 색 점을 앞에 붙인다 */
function setStatus(text, team = null) {
  const el = $('status');
  el.textContent = text;
  if (text && team !== null) {
    const dot = document.createElement('i');
    dot.className = `dot p${team}`;
    el.prepend(dot);
  }
}

// ---------- 메뉴 ----------

function renderMenu() {
  segmented(
    $('opponent-options'),
    OPPONENTS.map((value) => ({ value, label: t(`opponent.${value}`), detail: t(`opponent.${value}.detail`) })),
    settings.opponent,
    (opponent) => {
      settings = { ...settings, opponent };
      renderMenu();
    },
  );
  segmented(
    $('level-options'),
    LEVEL_IDS.map((value) => ({ value, label: t(`level.${value}`) })),
    settings.level,
    (level) => {
      settings = { ...settings, level };
      renderMenu();
    },
  );
  segmented(
    $('end-options'),
    END_OPTIONS.map((value) => ({ value, label: t('endsCount', { n: value }) })),
    settings.ends,
    (ends) => {
      settings = { ...settings, ends };
      renderMenu();
    },
  );
  segmented(
    $('stone-options'),
    STONE_OPTIONS.map((value) => ({ value, label: t('stonesCount', { n: value }), detail: t(`stones.${value}.detail`) })),
    settings.stones,
    (stones) => {
      settings = { ...settings, stones };
      renderMenu();
    },
  );
  $('level-field').hidden = settings.opponent !== 'computer';
  $('menu-record').textContent = settings.opponent === 'computer' ? recordText(settings.level) : t('versusHint');
}

function recordText(level) {
  const record = store.loadRecord(level);
  if (!record) return t('noRecord');
  return t('record', { level: t(`level.${level}`), wins: record.wins, losses: record.losses });
}

function openMenu() {
  session++;
  aim = null;
  match = null;
  sweeper = false;
  throwing = null;
  sound.setSlide(0);
  sound.setSweep(0);
  sheet = new Sheet();
  scene.setSheet(sheet);
  scene.showHouse('overview');
  renderMenu();
  $('menu').hidden = false;
  $('result').hidden = true;
  $('hud').hidden = true;
  $('bottom').hidden = true;
  $('btn-menu').hidden = true;
  setStatus('');
  focusForKeyboard($('btn-start'));
}

function start() {
  sound.unlock();
  store.saveSettings(settings);
  newGame(1);
}

function newGame(hammer) {
  session++;
  throwing = null;
  starter = hammer;
  const mode = settings.opponent === 'computer' ? 'computer' : 'versus';
  match = new CurlingMatch({ ends: settings.ends, stones: settings.stones, mode, hammer });
  lastAim = [
    { broom: -DEFAULT_BROOM, spin: 1 },
    { broom: -DEFAULT_BROOM, spin: 1 },
  ];
  $('menu').hidden = true;
  $('result').hidden = true;
  $('hud').hidden = false;
  $('bottom').hidden = false;
  $('btn-menu').hidden = false;
  buildBoard();
  play(session);
}

// ---------- 점수판 ----------

function buildBoard() {
  const columns = Math.max(match.ends, match.end + 1);
  const head = $('board-head');
  head.innerHTML = '<th class="col-name"></th>';
  for (let e = 0; e < columns; e++) {
    const th = document.createElement('th');
    th.textContent = e < match.ends ? e + 1 : t('extraShort');
    head.append(th);
  }
  head.insertAdjacentHTML('beforeend', `<th class="col-total">${t('total')}</th>`);
  const body = $('board-body');
  body.innerHTML = '';
  for (const team of [0, 1]) {
    const row = document.createElement('tr');
    row.id = `row-${team}`;
    row.innerHTML =
      `<td class="name"><span class="who"><i class="dot p${team}"></i><span class="label"></span>` +
      `<span class="hammer" title="${t('hammerTitle')}">${t('hammerMark')}</span></span><span class="pips"></span></td>` +
      '<td class="end"></td>'.repeat(columns) +
      '<td class="total">0</td>';
    body.append(row);
  }
  updateBoard();
}

function updateBoard() {
  if (!match) return;
  const columns = $('board-head').children.length - 2;
  if (columns < match.end + 1 && !match.over) return buildBoard();
  for (const team of [0, 1]) {
    const row = $(`row-${team}`);
    row.querySelector('.label').textContent = nameOf(team);
    row.querySelector('.hammer').hidden = match.over || match.hammer !== team;
    const active = !match.over && (throwing ?? (match.endComplete ? -1 : match.current)) === team;
    row.classList.toggle('active', active);
    // 이번 엔드에 남은 스톤
    const pips = row.querySelector('.pips');
    const left = match.over ? 0 : match.stonesLeft(team);
    pips.innerHTML = `<i class="pip p${team}"></i>`.repeat(left) + '<i class="pip used"></i>'.repeat(match.stones - left);
    const cells = row.querySelectorAll('td.end');
    cells.forEach((cell, e) => {
      const done = e < match.history.length;
      cell.textContent = done ? String(match.scores[team][e]) : '';
      cell.classList.toggle('scored', done && match.scores[team][e] > 0);
      cell.classList.toggle('current', !match.over && e === match.end);
    });
    row.querySelector('.total').textContent = match.total(team);
  }
}

// ---------- 사람의 투구 ----------

const pump = (time) => {
  const k = (time / POWER_PERIOD) % 1;
  return k < 0.5 ? k * 2 : 2 - k * 2;
};

function buildMeter() {
  const zones = $('meter-zones');
  zones.innerHTML = '';
  const names = ['short', 'guard', 'draw', 'takeout'];
  for (let i = 1; i < WEIGHT_KNOTS.length; i++) {
    const [from] = WEIGHT_KNOTS[i - 1];
    const [to] = WEIGHT_KNOTS[i];
    const zone = document.createElement('span');
    zone.className = `zone ${names[i - 1]}`;
    zone.style.left = `${from * 100}%`;
    zone.style.width = `${(to - from) * 100}%`;
    if (names[i - 1] !== 'short') zone.textContent = t(`zone.${names[i - 1]}`);
    zones.append(zone);
  }
}

function playerShot(team) {
  return new Promise((resolve) => {
    const last = lastAim[team];
    aim = { team, phase: 'line', broom: last.broom, spin: last.spin, power: 0, t: 0, resolve, dragging: false };
    setSpin(last.spin);
    scene.aim(team, aim.broom, aim.spin);
    enterPhase('line');
  });
}

function enterPhase(phase) {
  aim.phase = phase;
  aim.t = 0;
  aim.power = 0;
  $('aim-controls').hidden = false;
  $('weight').hidden = phase !== 'weight';
  $('btn-back').hidden = phase !== 'weight';
  $('btn-next').textContent = t(phase === 'line' ? 'next' : 'throw');
  $('power-fill').style.width = '0%';
  const text = t(phase === 'line' ? 'phaseLine' : 'phaseWeight', { tap });
  if (match.mode === 'versus') setStatus(t('whoseShot', { name: nameOf(aim.team), text }), aim.team);
  else setStatus(text, aim.team);
}

function setBroom(x) {
  if (!aim) return;
  aim.broom = clamp(x, -BROOM_LIMIT, BROOM_LIMIT);
  lastAim[aim.team].broom = aim.broom;
  scene.setBroom(aim.broom, aim.spin);
}

function setSpin(spin) {
  if (aim) {
    aim.spin = spin;
    lastAim[aim.team].spin = spin;
    scene.setBroom(aim.broom, spin);
  }
  for (const button of $('spin').children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.spin) === spin));
  }
}

function confirm() {
  if (!aim) return;
  if (aim.phase === 'line') return enterPhase('weight');
  const shot = { angle: angleToward(aim.broom, 0), speed: speedOfPower(aim.power), spin: aim.spin };
  finishAim(shot);
}

function finishAim(shot) {
  const { resolve } = aim;
  aim = null;
  $('aim-controls').hidden = true;
  resolve(shot);
}

// ---------- 입력 ----------

scene.onPointer = (type, event) => {
  if (type === 'pointerdown') sound.unlock();
  // 결과 창을 닫고 하우스를 보던 중이면 다시 띄운다
  if (type === 'pointerup' && match?.over && $('result').hidden && $('menu').hidden) {
    $('result').hidden = false;
    return;
  }
  // 스톤이 가는 동안: 화면 아무 곳이나 누르고 있으면 스위핑
  if (sweeper) {
    if (type === 'pointerdown') sweepHeld.pointer = true;
    if (type === 'pointerup' || type === 'pointercancel') sweepHeld.pointer = false;
    return;
  }
  if (!aim) return;
  if (aim.phase === 'line') {
    // 누르거나 끄는 곳을 향해 브룸이 따라온다. 다음 단계로는 버튼·Space 로 넘어간다
    if (type === 'pointerdown') aim.dragging = true;
    if (type === 'pointerdown' || (type === 'pointermove' && aim.dragging)) {
      const p = scene.groundPoint(event);
      if (p) setBroom(broomX(angleToward(p.x, p.z)));
    }
    if (type === 'pointerup' || type === 'pointercancel') aim.dragging = false;
    return;
  }
  if (type === 'pointerup' && (event.pointerType !== 'mouse' || event.button === 0)) confirm();
};

// 하우스 창을 눌러 브룸을 바로 옮길 수 있다
$('house-cam').addEventListener('pointerdown', (event) => {
  if (!aim || aim.phase !== 'line') return;
  event.preventDefault();
  const move = (e) => {
    const p = scene.insetPoint(e.clientX, e.clientY);
    setBroom(broomX(angleToward(p.x, p.z)));
  };
  move(event);
  const frame = $('house-cam');
  frame.setPointerCapture(event.pointerId);
  frame.onpointermove = move;
  frame.onpointerup = frame.onpointercancel = () => {
    frame.onpointermove = frame.onpointerup = frame.onpointercancel = null;
  };
});

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

$('spin').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  setSpin(Number(button.dataset.spin));
  button.blur();
});
$('btn-next').addEventListener('click', (event) => {
  event.currentTarget.blur();
  confirm();
});
$('btn-back').addEventListener('click', (event) => {
  event.currentTarget.blur();
  if (aim) enterPhase('line');
});

const sweepButton = $('btn-sweep');
sweepButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  sweepButton.setPointerCapture(event.pointerId);
  sweepHeld.button = true;
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  sweepButton.addEventListener(type, () => {
    sweepHeld.button = false;
  });
}
sweepButton.addEventListener('contextmenu', (event) => event.preventDefault());

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const enter = event.key === 'Enter';
  if (!$('menu').hidden) {
    if (enter && !event.target.closest?.('button, a, summary')) {
      event.preventDefault();
      start();
    }
    return;
  }
  if (event.key === 'm' || event.key === 'M') return toggleSound();
  if (event.key === 'Escape') {
    if (aim?.phase === 'weight') return enterPhase('line');
    if (!$('result').hidden || match) return openMenu();
    return;
  }
  if (!$('result').hidden) {
    if (enter) {
      event.preventDefault();
      again();
    }
    return;
  }
  if (sweeper && (event.key === ' ' || event.key === 'ArrowUp')) {
    event.preventDefault();
    // 던질 때 누른 Space 를 계속 누르고 있는 것(자동 반복)은 스위핑으로 치지 않는다
    if (!event.repeat) sweepHeld.key = true;
    return;
  }
  if (!aim) return;
  if (event.key === '1') return setSpin(-1);
  if (event.key === '2') return setSpin(1);
  if (event.key === ' ' || enter) {
    event.preventDefault();
    if (!event.repeat) confirm();
  } else if (aim.phase === 'line' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    const step = event.shiftKey ? 0.01 : BROOM_STEP;
    setBroom(aim.broom + (event.key === 'ArrowLeft' ? -step : step));
  }
});

document.addEventListener('keyup', (event) => {
  if (event.key === ' ' || event.key === 'ArrowUp') sweepHeld.key = false;
});
// 창을 벗어나면 누르고 있던 것을 놓은 것으로 본다
window.addEventListener('blur', () => {
  sweepHeld = { pointer: false, key: false, button: false };
});

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  toast.tick(dt);
  // 스위핑: 누르고 있으면 세기가 빠르게 오르고, 떼면 곧 멈춘다
  const held = sweeper && (sweepHeld.pointer || sweepHeld.key || sweepHeld.button);
  sweepLevel += ((held ? 1 : 0) - sweepLevel) * damp(held ? 10 : 14, dt);
  if (sweepLevel < 0.01) sweepLevel = 0;
  scene.sweep = sweepLevel;
  sound.setSweep(sweepLevel);
  sweepButton.classList.toggle('active', held);
  // 가장 빠른 스톤의 속도에 맞춰 미끄러지는 소리
  let fastest = 0;
  if (scene.mode === 'run') {
    for (const s of sheet.stones) if (s.inPlay && s.moving) fastest = Math.max(fastest, Math.hypot(s.vx, s.vz));
  }
  sound.setSlide(fastest);
  if (!aim || aim.phase !== 'weight') return sweepLevel > 0;
  aim.t += dt;
  aim.power = pump(aim.t);
  $('power-fill').style.width = `${aim.power * 100}%`;
  return true;
};

scene.onEvent = (event) => {
  if (event.type === 'hit') sound.hit(event.speed);
  if (event.type === 'out') {
    if (event.reason !== 'hog') sound.play('board', 1, { volume: 0.6 });
    toast.show(t(`out.${event.reason}`), `p${event.stone.team}`);
  }
};

// ---------- 컴퓨터 ----------

async function computerShot(team, token) {
  setStatus(t('computerTurn'), team);
  await sleep(500);
  if (token !== session) return null;
  const choice = chooseShot(sheet.inPlay, { team, last: match.lastStone }, settings.level);
  scene.aim(team, choice.broom, choice.plan.spin);
  setStatus(t('computerPlan', { shot: t(`shotType.${choice.type}`) }), team);
  $('aim-controls').hidden = false;
  $('weight').hidden = false;
  $('btn-back').hidden = true;
  $('btn-next').hidden = true;
  $('spin').classList.add('readonly');
  setSpinDisplay(choice.plan.spin);
  $('power-fill').style.width = `${powerOfSpeed(choice.plan.speed) * 100}%`;
  await sleep(1400);
  $('aim-controls').hidden = true;
  $('btn-next').hidden = false;
  $('spin').classList.remove('readonly');
  return choice.shot;
}

function setSpinDisplay(spin) {
  for (const button of $('spin').children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.spin) === spin));
  }
}

// ---------- 진행 ----------

async function play(token) {
  while (token === session && !match.over) {
    // 엔드 시작
    sheet = new Sheet();
    scene.setSheet(sheet);
    scene.setCounting([]);
    updateBoard();
    const endLabel = match.extra ? t('extraEnd') : t('endOf', { n: match.end + 1, total: match.ends });
    toast.show(endLabel, 'big');
    setStatus(t('hammerInfo', { name: nameOf(match.hammer) }), match.hammer);
    scene.showHouse('house');
    await sleep(1600);
    if (token !== session) return;

    while (!match.endComplete) {
      const team = match.current;
      const human = match.isHuman(team);
      updateBoard();
      if (match.mode === 'versus' && (match.shot > 0 || match.end > 0)) {
        sound.play('turn');
        toast.show(t('turnOf', { name: nameOf(team) }), `p${team}`);
      }
      const shot = human ? await playerShot(team) : await computerShot(team, token);
      if (token !== session || !shot) return;

      setStatus(human ? t('sweepHint', { tap }) : t('computerThrows'), team);
      sound.play('release', 1, { volume: 0.5 + 0.5 * powerOfSpeed(shot.speed) });
      sheet.deliver(team, shot);
      throwing = team;
      match.thrown();
      updateBoard();
      sweeper = human;
      $('btn-sweep').hidden = !human;
      await scene.run(sheet);
      sweeper = false;
      throwing = null;
      sweepHeld = { pointer: false, key: false, button: false };
      $('btn-sweep').hidden = true;
      if (token !== session) return;
      await sleep(700);
      if (token !== session) return;
    }

    // 엔드 점수
    const result = scoreEnd(sheet.inPlay);
    scene.setCounting(result.counting);
    const outcome = match.finishEnd(result);
    updateBoard();
    if (outcome.blank) {
      toast.show(t('blank'), 'big');
      setStatus(t('blankDetail', { name: nameOf(outcome.hammer) }), outcome.hammer);
    } else {
      toast.show(t('scores', { name: nameOf(outcome.team), n: outcome.points }), `p${outcome.team}`);
      setStatus(t('scoresDetail', { name: nameOf(outcome.hammer) }), outcome.hammer);
      // 사람이 점수를 냈거나 2인 대전이면 박수
      if (match.isHuman(outcome.team)) sound.play('cheer', 1, { volume: 0.5 + 0.15 * outcome.points });
    }
    await sleep(3000);
    if (token !== session) return;
  }
  if (token === session) endGame();
}

function endGame() {
  updateBoard();
  const winner = match.winner;
  const versus = match.mode === 'versus';
  const [a, b] = [match.total(0), match.total(1)];
  $('result-title').textContent = versus ? t('winner', { name: nameOf(winner) }) : t(winner === 0 ? 'win' : 'lose');
  $('result-detail').textContent = t('finalScore', { a: nameOf(0), x: a, y: b, b: nameOf(1) });
  if (!versus) {
    store.recordResult(settings.level, winner === 0);
    $('result-record').textContent = recordText(settings.level);
  } else $('result-record').textContent = '';
  const won = versus || winner === 0;
  $('result').dataset.tone = versus ? `p${winner}` : won ? 'win' : 'lose';
  sound.play(won ? 'win' : 'lose');
  if (won) sound.play('cheer');
  setStatus('');
  $('result').hidden = false;
  focusForKeyboard($('btn-again'));
}

/** 한 판 더: 첫 엔드의 해머를 바꾼다 */
function again() {
  newGame(1 - starter);
}

$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', again);
$('btn-view').addEventListener('click', () => {
  $('result').hidden = true;
});
$('btn-result-menu').addEventListener('click', openMenu);
$('btn-menu').addEventListener('click', (event) => {
  event.currentTarget.blur();
  openMenu();
});

// ?debug 로 열면 콘솔에서 씬과 경기 상태를 들여다보고, 사람 차례에 shoot({ angle, speed, spin }) 으로 대신 던질 수 있다
if (params.has('debug')) {
  window.curling = {
    scene,
    sound,
    store,
    get match() {
      return match;
    },
    get sheet() {
      return sheet;
    },
    get aim() {
      return aim;
    },
    shoot(shot) {
      if (aim) finishAim(shot);
    },
    sweep(on) {
      sweepHeld.key = on;
    },
  };
}

try {
  buildMeter();
  await scene.load();
  $('loading').hidden = true;
  openMenu();
} catch (error) {
  console.error(error);
  $('loading').textContent = t('loadFailed', { message: error.message });
}

