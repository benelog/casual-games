// 알까기: 규칙(game.js)·물리(physics.js)·컴퓨터(ai.js)와 3D 씬(scene.js)을 잇고, 점수판·조준·차례를 진행한다.
// 내 돌을 누르고 뒤로 당겼다 놓으면 당긴 반대쪽으로, 당긴 만큼 세게 튕긴다. 한 번 고른 돌은 판 어디에서 당겨도 된다.
// 컴퓨터와 1:1 로 하거나, 2인 대전에서는 한 기기로 두 사람이 번갈아 튕긴다.

import { AlkkagiMatch, STONE_OPTIONS } from './game.js';
import { chooseShot, LEVEL_IDS } from './ai.js';
import { MIN_POWER, speedOfPower, powerOfSpeed, angleOf, clamp } from './physics.js';
import { AlkkagiScene } from './scene.js';
import { SaveStore, browserStorage, OPPONENTS } from './save.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle } from '../../shared/i18n.js';
import { segmented, createToast, focusForKeyboard } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);
const show = (id, on) => {
  $(id).hidden = !on;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);

const PULL_MAX = 0.11; // 이만큼(m) 당기면 가장 세다
const DRAG_SLOP = 6; // 누른 자리에서 이만큼(픽셀) 넘게 움직여야 당기는 것으로 본다
const FIRE_SLOP = 14; // 이만큼(픽셀)은 당겨야 튕긴다. 탭하다 손가락이 조금 밀린 것으로는 튕기지 않는다
const AIM_STEP = 0.035; // 키보드로 한 번에 돌리는 방향 (라디안). Shift 는 미세
const AIM_FINE = 0.006;
const POWER_STEP = 0.05;
const KEY_POWER = 0.4; // 키보드로 처음 겨눌 때의 세기
const CPU_AIM_TIME = 0.8; // 컴퓨터가 당기는 모습을 보여 주는 시간 (초)

document.title = t('pageTitle');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new AlkkagiScene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.6);

let settings = store.loadSettings();
let match = null;
let state = 'menu'; // menu · aim(사람 차례) · cpu(컴퓨터 차례) · run(돌이 움직이는 중) · done
let session = 0; // 새 판을 시작하거나 메뉴로 가면 늘어, 예전 진행 흐름을 멈춘다
let aim = null; // 사람이 겨누는 중 { team, id, angle, power, pull, resolve }
let drag = null; // 당기는 중 { pointerId, start, sx, sy, moved, far }
let cpuAim = null; // 컴퓨터가 당기는 모습 { id, team, angle, power, t }
let lastPick = [null, null]; // 편마다 마지막으로 고른 돌. 다음 차례에 그대로 고른다
let outs = []; // 이번 수에 떨어진 돌
let starter = 0; // 먼저 튕기는 편. 한 판 더 하면 바뀐다

$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

/** 점수판·안내에 쓰는 이름. 컴퓨터 대전은 나/컴퓨터, 2인 대전은 흑/백 */
function nameOf(team) {
  if (match?.mode === 'versus') return t(team === 0 ? 'black' : 'white');
  return t(team === 0 ? 'me' : 'computer');
}

/** '내' · '컴퓨터의' · '백의' */
function possessive(team) {
  if (match?.mode !== 'versus' && team === 0) return t('mine');
  return t('possessive', { name: nameOf(team) });
}

function turnText(team) {
  if (match?.mode !== 'versus' && team === 0) return t('myTurn');
  return t('turnOf', { name: nameOf(team) });
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
  cancelAim();
  match = null;
  state = 'menu';
  cpuAim = null;
  sound.setSlide(0);
  // 메뉴 뒤에는 처음 배치를 보여 준다
  scene.setBoard(new AlkkagiMatch({ stones: settings.stones }).board);
  renderMenu();
  show('menu', true);
  show('result', false);
  updateChrome();
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
  starter = first;
  lastPick = [null, null];
  const mode = settings.opponent === 'computer' ? 'computer' : 'versus';
  match = new AlkkagiMatch({ stones: settings.stones, mode, starter: first });
  scene.setBoard(match.board);
  show('menu', false);
  show('result', false);
  state = 'run';
  updateChrome();
  updateHud();
  play(session);
}

// ---------- 점수판·차례 ----------

function updateHud() {
  if (!match) return;
  for (const team of [0, 1]) {
    const el = $(`player-${team}`);
    el.querySelector('.name').textContent = nameOf(team);
    const count = el.querySelector('.count');
    const n = String(match.count(team));
    // 돌이 떨어져 수가 줄었을 때만 흔든다 (새 판에서 늘어날 때는 그대로)
    if (Number(n) < Number(count.textContent)) {
      count.classList.remove('drop');
      void count.offsetWidth; // 애니메이션을 처음부터 다시
      count.classList.add('drop');
    }
    count.textContent = n;
  }
}

/** 점수판·세기 막대·화면 테두리를 지금 상태에 맞춘다 */
function updateChrome() {
  const playing = !!match && state !== 'menu';
  show('versus', playing);
  show('controls', playing);
  show('bar', playing); // 끝난 뒤에도 남겨 두어 판이 들썩이지 않게 한다
  const team = match?.current ?? 0;
  const active = playing && state !== 'done';
  for (const p of [0, 1]) $(`player-${p}`).classList.toggle('active', active && p === team);
  show('glow', active);
  $('glow').dataset.player = team;
  if (!active) show('turn', false);
  setPower(0);
  updateInsets();
}

/** 차례 안내 줄: 누구 차례인지와 할 일 */
function updateTurn(hint = '') {
  if (!match || state === 'menu' || state === 'done') return show('turn', false);
  const banner = $('turn');
  const team = match.current;
  show('turn', true);
  if (banner.dataset.player !== String(team)) {
    banner.classList.remove('swap');
    void banner.offsetWidth; // 애니메이션을 처음부터 다시
    banner.classList.add('swap');
  }
  banner.dataset.player = team;
  $('turn-name').textContent = turnText(team);
  $('turn-hint').textContent = hint;
  updateInsets();
}

function setPower(power) {
  $('power-fill').style.width = `${Math.round(power * 100)}%`;
  $('power').setAttribute('aria-valuenow', String(Math.round(power * 100)));
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 바둑판이 그 사이에 오도록 한다 */
function updateInsets() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let top = $('top').getBoundingClientRect().bottom;
  const playing = !!match && state !== 'menu';
  // 차례 안내 줄 자리는 판이 차례마다 들썩이지 않도록 놀이 중에는 늘 비워 둔다
  if (playing) top = Math.max(top, $('turn').hidden ? top + 34 : $('turn').getBoundingClientRect().bottom);
  // 세기 막대가 판 아래에 오면 그만큼 비운다. 낮은 가로 화면에서는 오른쪽 구석으로 비켜 있어 비우지 않는다
  const pill = $('power').getBoundingClientRect();
  const under = !$('bar').hidden && pill.left < w * 0.62 && pill.right > w * 0.38;
  const bottom = under ? h - pill.top + 6 : 8;
  scene.setInsets({ top: top + 6, bottom: bottom + 4, left: 8, right: 8 });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('top'));
new ResizeObserver(updateInsets).observe($('bar'));

// ---------- 사람의 수 ----------

/** 돌에서 가장 가까운 상대 돌 쪽 (키보드로 처음 겨눌 때) */
function defaultAngle(id) {
  const s = match.board.byId(id);
  let best = null;
  for (const o of match.board.stonesOf(1 - s.team)) {
    const d = Math.hypot(o.x - s.x, o.z - s.z);
    if (!best || d < best.d) best = { d, angle: angleOf(o.x - s.x, o.z - s.z) };
  }
  return best ? best.angle : s.team === 0 ? 0 : Math.PI;
}

function playerShot(team) {
  return new Promise((resolve) => {
    const last = lastPick[team];
    const id = last !== null && match.board.byId(last)?.inPlay ? last : null;
    aim = { team, id: null, angle: 0, power: 0, pull: 0, resolve };
    scene.setSelectable(team);
    selectStone(id);
    updateTurn(t('hintPick'));
  });
}

function selectStone(id) {
  if (!aim) return;
  if (id !== aim.id) {
    aim.id = id;
    aim.power = 0;
    aim.pull = 0;
    if (id !== null) aim.angle = defaultAngle(id);
  }
  scene.select(id, aim.team);
  scene.setSelectable(aim.team); // 고른 돌의 옅은 테를 감춘다
  showAim();
}

function showAim() {
  if (!aim) return;
  scene.setAim(aim.id === null ? null : { id: aim.id, angle: aim.angle, power: aim.power, pull: aim.pull });
  setPower(aim.power);
}

function fire() {
  if (!aim || aim.id === null || aim.power < MIN_POWER) return;
  const { resolve, id, angle, power, team } = aim;
  lastPick[team] = id;
  aim = null;
  drag = null;
  resolve({ id, angle, speed: speedOfPower(power), power });
}

function cancelAim() {
  aim = null;
  drag = null;
}

// ---------- 입력 ----------

scene.onPointer = (type, event) => {
  if (type === 'pointerdown') sound.unlock();
  // 결과 창을 닫고 판을 보던 중이면 다시 띄운다
  if (type === 'pointerup' && state === 'done' && $('result').hidden) {
    show('result', true);
    return;
  }
  if (state !== 'aim' || !aim) return;
  const canvas = scene.renderer.domElement;
  if (type === 'pointerdown') {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const id = scene.stoneAt(event, aim.team);
    if (id !== null) selectStone(id);
    if (aim.id === null) return;
    const p = scene.groundPoint(event);
    if (!p) return;
    drag = { pointerId: event.pointerId, start: p, sx: event.clientX, sy: event.clientY, moved: false, far: false };
    canvas.setPointerCapture?.(event.pointerId);
    return;
  }
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (type === 'pointermove') {
    const screen = Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy);
    drag.far = screen >= FIRE_SLOP;
    if (!drag.moved && screen < DRAG_SLOP) return;
    const p = scene.groundPoint(event);
    if (!p) return;
    if (!drag.moved) {
      drag.moved = true;
      updateTurn(t('hintPull'));
    }
    const dx = p.x - drag.start.x;
    const dz = p.z - drag.start.z;
    const pull = Math.hypot(dx, dz);
    aim.pull = Math.min(pull, PULL_MAX);
    aim.power = clamp(pull / PULL_MAX, 0, 1);
    if (pull > 1e-4) aim.angle = angleOf(-dx, -dz);
    showAim();
    return;
  }
  // 놓았다: 충분히 당겼으면 튕기고, 아니면 고르기만 한다
  const { moved, far } = drag;
  drag = null;
  if (type === 'pointerup' && moved && far && aim.power >= MIN_POWER) return fire();
  aim.power = 0;
  aim.pull = 0;
  showAim();
  updateTurn(t('hintPick'));
};

// 브라우저는 사용자 입력이 있어야 소리를 내게 해 준다
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sound.unlock(), true);

// 창을 벗어나면 당기던 것을 놓은 것으로 본다 (튕기지 않는다)
window.addEventListener('blur', () => {
  if (!drag || !aim) return;
  drag = null;
  aim.power = 0;
  aim.pull = 0;
  showAim();
});

function toggleSound() {
  sound.unlock();
  sound.setEnabled(!sound.enabled);
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

$('btn-sound').addEventListener('click', (event) => {
  toggleSound();
  event.currentTarget.blur(); // 스페이스로 튕길 때 버튼이 다시 눌리지 않게
});

/** 키보드로 돌 고르기: 왼쪽부터 차례로 */
function cycleStone(step) {
  const stones = match.board.stonesOf(aim.team).sort((a, b) => a.x - b.x || a.z - b.z);
  if (!stones.length) return;
  const index = stones.findIndex((s) => s.id === aim.id);
  const next = index < 0 ? (step > 0 ? 0 : stones.length - 1) : (index + step + stones.length) % stones.length;
  selectStone(stones[next].id);
}

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
    if (drag && aim) {
      drag = null;
      aim.power = aim.pull = 0;
      return showAim();
    }
    if (match) return openMenu();
    return;
  }
  if (state === 'done') {
    if (enter && !$('result').hidden && !event.target.closest?.('button')) {
      event.preventDefault();
      again();
    }
    return;
  }
  if (state !== 'aim' || !aim || drag) return;
  if (event.key === 'Tab') {
    event.preventDefault();
    return cycleStone(event.shiftKey ? -1 : 1);
  }
  const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (arrows.includes(event.key)) {
    event.preventDefault();
    if (aim.id === null) cycleStone(1);
    if (aim.power === 0) aim.power = KEY_POWER;
    const step = event.shiftKey ? AIM_FINE : AIM_STEP;
    if (event.key === 'ArrowLeft') aim.angle -= step;
    if (event.key === 'ArrowRight') aim.angle += step;
    if (event.key === 'ArrowUp') aim.power = clamp(aim.power + POWER_STEP, POWER_STEP, 1);
    if (event.key === 'ArrowDown') aim.power = clamp(aim.power - POWER_STEP, POWER_STEP, 1);
    aim.pull = 0;
    showAim();
    updateTurn(t('hintKeys'));
    return;
  }
  if ((event.key === ' ' || enter) && !event.repeat && !event.target.closest?.('button, a')) {
    event.preventDefault();
    fire();
  }
});

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  // 가장 빠른 돌의 속도에 맞춰 미끄러지는 소리
  let fastest = 0;
  if (state === 'run' && match) {
    for (const s of match.board.stones) if (s.inPlay && s.moving) fastest = Math.max(fastest, Math.hypot(s.vx, s.vz));
  }
  sound.setSlide(fastest);
  if (!cpuAim) return false;
  // 컴퓨터가 돌을 천천히 당긴다
  cpuAim.t = Math.min(1, cpuAim.t + dt / CPU_AIM_TIME);
  const k = 1 - (1 - cpuAim.t) ** 2;
  const power = cpuAim.power * k;
  scene.setAim({ id: cpuAim.id, angle: cpuAim.angle, power, pull: power * PULL_MAX });
  setPower(power);
  return cpuAim.t < 1;
};

scene.onEvent = (event) => {
  if (event.type === 'hit') sound.hit(event.speed);
  if (event.type === 'out') {
    outs.push(event.stone);
    updateHud();
  }
  if (event.type === 'land') sound.land(clamp(event.x / 0.4, -1, 1));
};

// ---------- 컴퓨터 ----------

async function computerShot(team, token) {
  updateTurn(t('computerTurn'));
  await sleep(450);
  if (token !== session) return null;
  const choice = chooseShot(match.board.stones, team, settings.level);
  updateTurn(t('computerAim'));
  scene.select(choice.stoneId, team);
  cpuAim = { id: choice.stoneId, team, angle: choice.plan.angle, power: powerOfSpeed(choice.plan.speed), t: 0 };
  await sleep(CPU_AIM_TIME * 1000 + 350);
  cpuAim = null;
  if (token !== session) return null;
  return { id: choice.stoneId, angle: choice.shot.angle, speed: choice.shot.speed, power: powerOfSpeed(choice.shot.speed) };
}

// ---------- 진행 ----------

async function play(token) {
  while (token === session && !match.over) {
    const team = match.current;
    const human = match.isHuman(team);
    state = human ? 'aim' : 'cpu';
    updateChrome();
    updateHud();
    if (match.mode === 'versus' && match.turns > 0) {
      sound.play('turn');
      toast.show(turnText(team), `p${team}`);
    }
    const shot = human ? await playerShot(team) : await computerShot(team, token);
    if (token !== session || !shot) return;

    state = 'run';
    updateTurn('');
    scene.select(null);
    scene.setAim(null);
    setPower(shot.power);
    sound.flick(shot.power);
    outs = [];
    match.board.flick(shot.id, { angle: shot.angle, speed: shot.speed });
    await scene.run(match.board);
    if (token !== session) return;
    setPower(0);
    const result = match.finishShot(outs);
    updateHud();
    if (!result.over) announce(team, result);
    await sleep(result.knocked || result.lost ? 1000 : 450);
    if (token !== session) return;
  }
  if (token === session) endGame();
}

/** 한 수의 결과를 알린다 */
function announce(team, { knocked, lost }) {
  if (knocked) toast.show(t('knocked', { n: knocked }), `p${team}`);
  else if (lost) toast.show(t('selfOut', { n: lost }), 'bad');
}

function endGame() {
  state = 'done';
  updateChrome();
  updateHud();
  const winner = match.winner;
  const versus = match.mode === 'versus';
  $('result-title').textContent = versus ? t('winner', { name: nameOf(winner) }) : t(winner === 0 ? 'win' : 'lose');
  $('result-detail').textContent = t('finalDetail', {
    reason: t(`reason.${match.reason}`, { loser: possessive(1 - winner) }),
    a: match.count(0),
    b: match.count(1),
    turns: match.turns,
  });
  if (!versus) {
    store.recordResult(settings.level, winner === 0);
    $('result-record').textContent = recordText(settings.level);
  } else $('result-record').textContent = '';
  const won = versus || winner === 0;
  $('result').dataset.tone = versus ? `p${winner}` : won ? 'win' : 'lose';
  sound.play(won ? 'win' : 'lose');
  show('result', true);
  focusForKeyboard($('btn-again'));
}

/** 한 판 더: 먼저 하는 편을 바꾼다 */
function again() {
  newGame(1 - starter);
}

$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', again);
$('btn-view').addEventListener('click', () => show('result', false));
$('btn-result-menu').addEventListener('click', openMenu);
$('btn-menu').addEventListener('click', (event) => {
  event.currentTarget.blur();
  openMenu();
});

// ?debug 로 열면 콘솔에서 씬과 판 상태를 들여다보고, 사람 차례에 shoot({ id, angle, power }) 으로 대신 튕길 수 있다
if (params.has('debug')) {
  window.alkkagi = {
    scene,
    sound,
    store,
    get match() {
      return match;
    },
    get state() {
      return state;
    },
    get aim() {
      return aim;
    },
    shoot({ id, angle, power }) {
      if (!aim) return false;
      aim.id = id ?? aim.id;
      aim.angle = angle;
      aim.power = power;
      fire();
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
