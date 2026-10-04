// 육목: 규칙(game.js)·컴퓨터(ai.js)와 3D 씬(scene.js)을 잇고, 점수판·차례·입력을 진행한다.
// 마우스는 누른 자리에 바로 두고, 터치는 처음 누르면 미리 보여 준 뒤 같은 자리를 한 번 더 누르거나
// [여기에 두기]를 눌러야 둔다(19줄이라 휴대폰에서는 칸이 작아 잘못 두기 쉽다). 키보드는 방향키로 옮기고 Space/Enter.
// 휠·두 손가락·+/− 로 확대하고, 확대한 판은 두 손가락으로 끌어 옮긴다.
// 컴퓨터와 1:1 로 하거나(흑·백 고르기), 2인 대전에서는 한 기기로 두 사람이 번갈아 둔다.

import { Connect6Game, SIZE, indexOf, rowOf, colOf, inside } from './game.js';
import { chooseTurn, LEVEL_IDS } from './ai.js';
import { Connect6Scene, cellPoint, ZOOM_MIN } from './scene.js';
import { SaveStore, browserStorage, OPPONENTS, COLORS } from './save.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle } from '../../shared/i18n.js';
import { segmented, createToast } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);
const show = (id, on) => {
  $(id).hidden = !on;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);

const CENTER = indexOf((SIZE - 1) / 2, (SIZE - 1) / 2);
const CPU_THINK = 420; // 컴퓨터 차례가 시작되고 첫 돌을 둘 때까지 (밀리초)
const CPU_GAP = 380; // 컴퓨터가 두 돌 사이에 쉬는 시간
const END_DELAY = 900; // 마지막 돌이 놓이고 결과 창이 뜰 때까지
const ZOOM_STEP = 1.35; // +/− 버튼·키 한 번의 배율
const WHEEL_ZOOM = 0.0015;
const DRAG_SLOP = 8; // 두 손가락이 이만큼(픽셀) 넘게 움직여야 끄는 것으로 본다

document.title = t('pageTitle');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new Connect6Scene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.6);

let settings = store.loadSettings();
let game = null;
let state = 'menu'; // menu · human(사람 차례) · cpu(컴퓨터 차례) · done
let session = 0; // 새 판을 시작하거나 메뉴로 가면 늘어, 예전 진행 흐름을 멈춘다
let preview = null; // 놓을 자리 미리보기 { index, armed, source: 'mouse' · 'touch' · 'key' }
let cursor = null; // 키보드로 옮기던 자리 (차례가 바뀌어도 기억한다)
let input = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse'; // 마지막으로 쓴 입력 방식 (안내 문구용)
let press = null; // 누르고 있는 손가락·버튼 { pointerId, touch, cell, again, before }
let pinch = null; // 두 손가락 확대·끌기 { dist, zoom, anchor, x, y, moved }
const pointers = new Map(); // 화면에 닿은 포인터 id → { x, y }

sound.enabled = settings.sound;
$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
scene.setView(settings.view);

/** 점수판·안내에 쓰는 이름. 컴퓨터 대전은 나/컴퓨터, 2인 대전은 흑/백 */
function nameOf(team) {
  if (!game || game.mode === 'versus') return t(team === 0 ? 'black' : 'white');
  return t(team === game.human ? 'me' : 'computer');
}

/** '내' · '컴퓨터의' · '백의' */
function possessive(team) {
  if (game?.mode !== 'versus' && team === game?.human) return t('mine');
  return t('possessive', { name: nameOf(team) });
}

function turnText(team) {
  if (game?.mode !== 'versus' && team === game?.human) return t('myTurn');
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
    $('color-options'),
    COLORS.map((value) => ({ value, label: t(`color.${value}`), detail: t(`color.${value}.detail`) })),
    settings.color,
    (color) => {
      settings = { ...settings, color };
      renderMenu();
    },
  );
  const computer = settings.opponent === 'computer';
  $('level-field').hidden = !computer;
  $('color-field').hidden = !computer;
  $('menu-record').textContent = computer ? recordText(settings.level) : t('versusHint');
}

function recordText(level) {
  const record = store.loadRecord(level);
  if (!record) return t('noRecord');
  return t('record', { level: t(`level.${level}`), ...record });
}

function openMenu() {
  session++;
  game = null;
  state = 'menu';
  press = pinch = null;
  setPreview(null);
  // 메뉴 뒤에는 빈 판을 보여 준다
  scene.setBoard(new Connect6Game().cells);
  scene.setMarks();
  scene.setWinLine(null);
  scene.setZoom(ZOOM_MIN, { x: 0, z: 0 });
  renderMenu();
  show('menu', true);
  show('result', false);
  updateChrome();
  $('btn-start').focus();
}

function start() {
  sound.unlock();
  store.saveSettings(settings);
  newGame();
}

function newGame() {
  session++;
  press = pinch = null;
  const mode = settings.opponent === 'computer' ? 'computer' : 'versus';
  game = new Connect6Game({ mode, human: settings.color === 'white' ? 1 : 0 });
  cursor = null;
  setPreview(null);
  scene.setBoard(game.cells);
  scene.setWinLine(null);
  show('menu', false);
  show('result', false);
  startTurn();
}

// ---------- 점수판·차례 ----------

function updateHud() {
  if (!game) return;
  for (const team of [0, 1]) {
    const el = $(`player-${team}`);
    el.querySelector('.name').textContent = nameOf(team);
    el.querySelector('.count').textContent = String(game.count(team));
  }
}

/** 점수판·버튼·화면 테두리를 지금 상태에 맞춘다 */
function updateChrome() {
  const playing = !!game && state !== 'menu';
  show('versus', playing);
  show('controls', playing);
  show('bar', playing);
  const team = game?.current ?? 0;
  const active = playing && state !== 'done';
  for (const p of [0, 1]) $(`player-${p}`).classList.toggle('active', active && p === team);
  show('glow', active);
  $('glow').dataset.player = team;
  $('btn-undo').disabled = !canUndo();
  if (!active) show('turn', false);
  updateConfirm();
  updateInsets();
}

/** 차례 안내 줄: 누구 차례인지, 이번 차례에 남은 돌, 할 일 */
function updateTurn() {
  if (!game || state === 'menu' || state === 'done') return show('turn', false);
  const banner = $('turn');
  const team = game.current;
  show('turn', true);
  const key = `${team}:${game.turns.length}`;
  if (banner.dataset.key !== key) {
    banner.classList.remove('swap');
    void banner.offsetWidth; // 애니메이션을 처음부터 다시
    banner.classList.add('swap');
  }
  banner.dataset.key = key;
  banner.dataset.player = team;
  $('turn-name').textContent = turnText(team);
  // 이번 차례에 둘 돌: 남은 돌은 채운 돌, 이미 둔 돌은 빈 테로
  const pips = $('turn-pips');
  pips.replaceChildren();
  for (let i = 0; i < game.perTurn; i++) {
    const pip = document.createElement('i');
    pip.className = `stone ${team === 0 ? 'black' : 'white'}`;
    pip.classList.toggle('used', i < game.placed.length);
    pips.append(pip);
  }
  $('turn-count').textContent = t('left', { n: game.remaining, total: game.perTurn });
  $('turn-hint').textContent = hintText();
  updateInsets();
}

function hintText() {
  if (state === 'cpu') return t('computerTurn');
  if (state !== 'human') return '';
  if (input === 'key') return t('hintKeys');
  if (input === 'touch') return preview?.armed && preview.source === 'touch' ? t('hintArmed') : t('hintTouch');
  return t('hintMouse');
}

/** 마지막 차례에 둔 돌(빨간 점)과 이번 차례에 이미 둔 돌(금색 점) */
function updateMarks() {
  if (!game) return scene.setMarks();
  scene.setMarks({ last: game.lastTurn?.moves ?? [], current: game.placed });
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 바둑판이 그 사이에 오도록 한다 */
function updateInsets() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let top = $('top').getBoundingClientRect().bottom;
  const playing = !!game && state !== 'menu';
  // 차례 안내 줄 자리는 판이 차례마다 들썩이지 않도록 놀이 중에는 늘 비워 둔다
  if (playing) top = Math.max(top, $('turn').hidden ? top + 34 : $('turn').getBoundingClientRect().bottom);
  // 아래 막대가 판 아래에 오면 그만큼 비운다. 낮은 가로 화면에서는 오른쪽 구석으로 비켜 있어 비우지 않는다
  const bar = $('bar').getBoundingClientRect();
  const under = !$('bar').hidden && bar.left < w * 0.5;
  const bottom = under ? h - bar.top + 4 : 8;
  scene.setInsets({ top: top + 6, bottom: bottom + 4, left: 8, right: 8 });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('top'));
new ResizeObserver(updateInsets).observe($('bar'));

// ---------- 미리보기 ----------

/** 놓을 자리 미리보기를 바꾼다. index 가 null 이면 치운다 */
function setPreview(index, { armed = false, source = 'mouse' } = {}) {
  preview = index === null || index === undefined || !game ? null : { index, armed, source };
  scene.setPreview(preview && state === 'human' ? { ...preview, team: game.current } : null);
  updateConfirm();
  if (state === 'human') $('turn-hint').textContent = hintText();
}

/** 터치로 고른 자리가 있으면 [여기에 두기] 버튼을 띄운다 */
function updateConfirm() {
  const on = state === 'human' && preview?.source === 'touch' && preview.armed && game.canPlace(preview.index);
  show('confirm', !!on);
}

function canPlay() {
  return state === 'human' && !!game && !game.over;
}

// ---------- 두기 ----------

/** 지금 편의 돌을 index 에 둔다. 차례가 끝나면 다음 차례로 넘긴다 */
function placeStone(index) {
  if (!game || !game.canPlace(index)) return null;
  const team = game.current;
  const result = game.place(index);
  scene.addStone(index, team);
  if (preview?.source === 'key') cursor = index;
  setPreview(preview?.source === 'key' && state === 'human' && !result.turnEnded ? index : null, { armed: true, source: 'key' });
  updateMarks();
  updateHud();
  if (game.over) {
    endGame(session);
    return result;
  }
  if (result.turnEnded) startTurn();
  else {
    updateTurn();
    updateChrome();
  }
  return result;
}

/** 차례를 시작한다. 사람이면 입력을 기다리고, 컴퓨터면 생각해서 둔다 */
function startTurn() {
  const team = game.current;
  const human = game.isHuman(team);
  state = human ? 'human' : 'cpu';
  if (game.mode === 'versus' && game.stones > 0) {
    sound.play('turn');
    toast.show(turnText(team), `p${team}`);
  }
  updateChrome();
  updateHud();
  updateMarks();
  updateTurn();
  if (human) {
    // 키보드로 두던 사람에게는 커서를 다시 보여 준다
    if (input === 'key') setPreview(cursor ?? CENTER, { armed: true, source: 'key' });
    else setPreview(null);
  } else {
    setPreview(null);
    computerTurn(session);
  }
}

// 컴퓨터의 수는 Web Worker 에서 계산한다. 워커를 만들 수 없으면 여기서 바로 계산한다
let worker = null;
let thinkId = 0;
const pending = new Map(); // 계산을 맡긴 id → resolve
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    pending.get(data.id)?.(data.moves);
    pending.delete(data.id);
  };
  worker.onerror = (event) => {
    // 워커를 불러오지 못하면 기다리던 계산도 여기서 마친다
    event.preventDefault?.();
    worker = null;
    for (const [, resolve] of pending) resolve(null);
    pending.clear();
  };
} catch {
  worker = null;
}

/** 컴퓨터가 둘 칸들 */
function think(cells, team, count, level) {
  if (!worker) return Promise.resolve(chooseTurn(cells, team, count, level));
  const id = ++thinkId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, cells: Array.from(cells), team, count, level });
  }).then((moves) => moves ?? chooseTurn(cells, team, count, level));
}

async function computerTurn(token) {
  const [moves] = await Promise.all([think(game.cells, game.current, game.remaining, settings.level), sleep(CPU_THINK)]);
  if (token !== session || !game) return;
  for (let k = 0; k < moves.length; k++) {
    if (token !== session || state !== 'cpu') return;
    placeStone(moves[k]);
    if (game.over || k === moves.length - 1) return;
    await sleep(CPU_GAP);
  }
}

// ---------- 무르기 ----------

/** 무를 수 있는지. 컴퓨터 대전에서는 내 돌이 있어야 하고, 끝난 판은 무를 수 없다(전적을 남겼으므로) */
function canUndo() {
  if (!game || state === 'menu' || state === 'cpu') return false;
  if (game.mode === 'versus') return game.canUndo;
  if (state === 'done') return false;
  return (game.current === game.human && game.placed.length > 0) || game.turns.some((turn) => turn.team === game.human);
}

/** 한 차례를 무른다. 컴퓨터 대전에서는 컴퓨터의 차례도 함께 물러 다시 내 차례가 되게 한다 */
function undo() {
  if (!canUndo()) {
    if (game && state !== 'menu') toast.show(t('nothingToUndo'), 'bad');
    return;
  }
  session++; // 결과 창을 띄우려던 흐름을 멈춘다
  if (game.mode === 'versus') game.undo();
  else {
    let mine = false;
    while (!mine && game.canUndo) mine = game.undo().team === game.human;
  }
  scene.setBoard(game.cells);
  scene.setWinLine(null);
  sound.play('undo');
  toast.show(t('undone'));
  show('result', false);
  state = 'human';
  if (input === 'key' && cursor !== null && !game.canPlace(cursor)) cursor = null;
  startTurn();
}

// ---------- 확대·시점 ----------

function zoomTo(zoom, focus = null) {
  scene.setZoom(zoom, focus);
}

/** 화면 점 screen 아래의 판 위 점 anchor 가 그대로 그 자리에 있도록 확대한다 */
function zoomAround(zoom, screen) {
  const anchor = scene.groundPoint(screen);
  scene.setZoom(zoom);
  if (anchor) scene.keepPoint(anchor, screen);
}

/** 키보드 커서나 미리보기 자리가 보이도록 확대한 판을 옮긴다 */
function follow(index) {
  if (scene.zoom <= ZOOM_MIN + 0.01 || index === null) return;
  const p = cellPoint(index);
  scene.setFocus(p.x, p.z);
}

function zoomStep(dir) {
  const zoom = scene.zoom * (dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  const target = preview?.index ?? game?.lastTurn?.moves.at(-1) ?? null;
  const p = target !== null && dir > 0 ? cellPoint(target) : null;
  zoomTo(zoom, scene.zoom <= ZOOM_MIN + 0.01 && p ? p : null);
}

function toggleView() {
  settings = { ...settings, view: settings.view === 'tilt' ? 'top' : 'tilt' };
  scene.setView(settings.view);
  store.saveSettings(settings);
}

// ---------- 입력 ----------

function startPinch() {
  const [a, b] = [...pointers.values()];
  const center = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
  pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: scene.zoom, anchor: scene.groundPoint(center), x: center.clientX, y: center.clientY, moved: false };
}

function updatePinch() {
  const [a, b] = [...pointers.values()];
  const center = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (!pinch.moved && Math.abs(dist - pinch.dist) < DRAG_SLOP && Math.hypot(center.clientX - pinch.x, center.clientY - pinch.y) < DRAG_SLOP) return;
  pinch.moved = true;
  scene.setZoom(pinch.zoom * (dist / pinch.dist));
  if (pinch.anchor) scene.keepPoint(pinch.anchor, center);
}

scene.onPointer = (type, event) => {
  if (type === 'pointerdown') sound.unlock();
  const touch = event.pointerType !== 'mouse';
  const canvas = scene.renderer.domElement;
  if (type === 'pointerdown') {
    if (!touch && event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // 이미 끝난 포인터면 붙잡지 못해도 그대로 진행한다
    }
    if (pointers.size >= 2) {
      // 두 손가락: 누르던 자리는 없던 일로 하고 확대·끌기
      if (press) setPreview(press.before?.index ?? null, press.before ?? {});
      press = null;
      if (pointers.size === 2) startPinch();
      return;
    }
    input = touch ? 'touch' : 'mouse';
    if (!canPlay()) return;
    const cell = scene.cellAt(event);
    const again = !!preview?.armed && preview.source === 'touch' && preview.index === cell;
    press = { pointerId: event.pointerId, touch, cell, again, before: preview };
    if (touch && cell !== null && game.canPlace(cell)) setPreview(cell, { armed: again, source: 'touch' });
    return;
  }
  if (type === 'pointermove') {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch) return pointers.size >= 2 && updatePinch();
    if (!canPlay()) return;
    if (press && press.pointerId === event.pointerId) {
      if (!press.touch) return;
      // 손가락을 끌면 미리보기가 따라온다. 손가락에 가린 자리는 가로·세로 줄로 알아본다
      const cell = scene.cellAt(event);
      if (cell === press.cell) return;
      press.cell = cell;
      press.again = false;
      setPreview(cell !== null && game.canPlace(cell) ? cell : null, { source: 'touch' });
      return;
    }
    if (!touch && !press) {
      const cell = scene.cellAt(event);
      if (cell === null && preview?.source === 'key') return;
      if (cell !== null) input = 'mouse';
      if (cell !== preview?.index || preview?.source !== 'mouse') setPreview(cell !== null && game.canPlace(cell) ? cell : null);
    }
    return;
  }
  if (type === 'pointerleave') {
    if (!touch && !press && preview?.source === 'mouse') setPreview(null);
    return;
  }
  // 뗐다 (pointerup · pointercancel)
  pointers.delete(event.pointerId);
  if (pinch) {
    // 두 손가락을 모두 뗄 때까지는 확대·끌기로 본다
    if (pointers.size === 0) pinch = null;
    return;
  }
  // 결과 창을 닫고 판을 보던 중이면 다시 띄운다
  if (type === 'pointerup' && state === 'done' && $('result').hidden) return show('result', true);
  if (!press || press.pointerId !== event.pointerId) return;
  const p = press;
  press = null;
  if (type !== 'pointerup' || !canPlay()) return;
  const cell = scene.cellAt(event);
  if (p.touch) {
    if (cell === null || !game.canPlace(cell)) return setPreview(null);
    // 미리 보던 자리를 한 번 더 눌렀으면 둔다. 아니면 이 자리를 미리 보여 주고 확정을 기다린다
    if (p.again && cell === p.cell) placeStone(cell);
    else setPreview(cell, { armed: true, source: 'touch' });
    return;
  }
  if (cell !== null && cell === p.cell) placeStone(cell);
};

scene.onWheel = (event) => {
  event.preventDefault();
  if (!game && state === 'menu') return;
  zoomAround(scene.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM), event);
};

scene.onEvent = (event) => {
  if (event.type === 'land') sound.place(Math.max(-1, Math.min(1, event.x / 0.2)));
};

// 브라우저는 사용자 입력이 있어야 소리를 내게 해 준다
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sound.unlock(), true);

// 창을 벗어나면 누르던 것을 없던 일로 한다
window.addEventListener('blur', () => {
  press = pinch = null;
  pointers.clear();
});

function toggleSound() {
  sound.unlock();
  sound.setEnabled(!sound.enabled);
  settings = { ...settings, sound: sound.enabled };
  store.saveSettings(settings);
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

/** 버튼을 누른 뒤 포커스를 풀어 Space/Enter 가 버튼을 다시 누르지 않게 한다 */
function onButton(id, action) {
  $(id).addEventListener('click', (event) => {
    event.currentTarget.blur();
    action();
  });
}

onButton('btn-sound', toggleSound);
onButton('btn-undo', undo);
onButton('btn-new', () => game && newGame());
onButton('btn-zoom-in', () => zoomStep(1));
onButton('btn-zoom-out', () => zoomStep(-1));
onButton('btn-view', toggleView);
onButton('btn-place', () => preview && canPlay() && placeStone(preview.index));
onButton('btn-cancel', () => setPreview(null));

/** 키보드 커서를 옮긴다 */
function moveCursor(dr, dc) {
  input = 'key';
  const from = preview?.index ?? cursor ?? game.lastTurn?.moves.at(-1) ?? CENTER;
  const moved = preview || cursor !== null ? true : false;
  let row = rowOf(from);
  let col = colOf(from);
  if (moved && inside(row + dr, col + dc)) {
    row += dr;
    col += dc;
  }
  cursor = indexOf(row, col);
  sound.play('select');
  setPreview(cursor, { armed: true, source: 'key' });
  follow(cursor);
}

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    // Ctrl+Z 도 무르기
    if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z') && game) {
      event.preventDefault();
      undo();
    }
    return;
  }
  const enter = event.key === 'Enter';
  if (!$('menu').hidden) {
    if (enter && !event.target.closest?.('button, a, summary')) {
      event.preventDefault();
      start();
    }
    return;
  }
  if (event.key === 'm' || event.key === 'M') return toggleSound();
  if (!game) return;
  if (event.key === 'Escape') {
    if (preview && preview.source !== 'mouse' && state === 'human') return setPreview(null);
    return openMenu();
  }
  if (event.key === 'u' || event.key === 'U' || event.key === 'Backspace') {
    event.preventDefault();
    return undo();
  }
  if (event.key === 'n' || event.key === 'N') return newGame();
  if (event.key === 'v' || event.key === 'V') return toggleView();
  if (event.key === '+' || event.key === '=') return zoomStep(1);
  if (event.key === '-' || event.key === '_') return zoomStep(-1);
  if (state === 'done') {
    if (enter && !$('result').hidden && !event.target.closest?.('button')) {
      event.preventDefault();
      newGame();
    }
    return;
  }
  if (!canPlay()) return;
  if (ARROWS[event.key]) {
    event.preventDefault();
    return moveCursor(...ARROWS[event.key]);
  }
  if ((event.key === ' ' || enter) && !event.repeat && !event.target.closest?.('button, a')) {
    event.preventDefault();
    if (preview && game.canPlace(preview.index)) placeStone(preview.index);
    else if (!preview) moveCursor(0, 0);
  }
});

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  toast.tick(dt);
  return false;
};

// ---------- 끝 ----------

async function endGame(token) {
  state = 'done';
  setPreview(null);
  updateChrome();
  updateHud();
  scene.setWinLine(game.line);
  const winner = game.winner;
  const versus = game.mode === 'versus';
  const humanWon = !versus && winner === game.human;
  if (!versus) {
    store.recordResult(settings.level, winner === null ? 'draw' : humanWon ? 'win' : 'loss');
    $('result-record').textContent = recordText(settings.level);
  } else $('result-record').textContent = '';
  $('btn-undo').disabled = !canUndo();
  await sleep(END_DELAY);
  if (token !== session || !game?.over) return;
  if (winner === null) $('result-title').textContent = t('draw');
  else $('result-title').textContent = versus ? t('winner', { name: nameOf(winner) }) : t(humanWon ? 'win' : 'lose');
  const reason =
    game.reason === 'full'
      ? t('reason.full')
      : t(`reason.${game.reason}`, { name: possessive(winner), n: game.line.length });
  $('result-detail').textContent = t('finalDetail', { reason, moves: t('moves', { turns: game.turns.length, moves: game.stones }) });
  const won = versus || humanWon;
  $('result').dataset.tone = winner === null ? '' : versus ? `p${winner}` : won ? 'win' : 'lose';
  sound.play(winner === null || won ? 'win' : 'lose');
  show('result', true);
  $('btn-again').focus();
}

onButton('btn-start', start);
onButton('btn-again', newGame);
onButton('btn-view-board', () => show('result', false));
onButton('btn-result-menu', openMenu);
onButton('btn-menu', openMenu);

// ?debug 로 열면 콘솔에서 씬과 판 상태를 들여다보고, 사람 차례에 place(row, col) 로 대신 둘 수 있다
if (params.has('debug')) {
  window.connect6 = {
    scene,
    sound,
    store,
    get game() {
      return game;
    },
    get state() {
      return state;
    },
    place(row, col) {
      return canPlay() ? placeStone(indexOf(row, col)) : null;
    },
    undo,
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
