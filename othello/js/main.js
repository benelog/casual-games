// 오델로: 규칙(game.js)·컴퓨터(ai.js, 웹 워커에서)와 3D 씬(scene.js)을 잇고, 점수판·차례·무르기를 진행한다.
// 점이 찍힌 칸을 누르거나 방향키로 고르고 Space/Enter 로 돌을 놓는다. 마우스를 올리면 뒤집힐 돌이 미리 보인다.
// 컴퓨터와 1:1 로 하거나(흑·백 중 고른다), 2인 대전에서는 한 기기로 두 사람이 번갈아 둔다.

import { OthelloMatch, BLACK, WHITE, SIZE, flipsFor, rowOf, colOf, indexOf, parseNotation } from './game.js';
import { chooseMove, LEVEL_IDS } from './ai.js';
import { OthelloScene } from './scene.js';
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

const MIN_THINK = 550; // 컴퓨터가 아무리 빨리 골라도 이만큼(밀리초)은 생각하는 척한다
const FALLBACK_TIME = 350; // 워커를 못 쓸 때 화면 스레드에서 생각하는 시간 (밀리초)
const PASS_PAUSE = 1300;
const BIG_FLIP = 6; // 한 번에 이만큼 넘게 뒤집으면 알린다

document.title = t('pageTitle');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new OthelloScene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.6);

let settings = store.loadSettings();
let match = null;
let state = 'menu'; // menu · turn(사람 차례) · cpu(컴퓨터 차례) · anim(돌이 움직이는 중) · done
let session = 0; // 새 판·무르기·메뉴로 늘어, 예전 진행 흐름을 멈춘다
let pending = null; // 사람이 둘 칸을 기다리는 중 { resolve }
let cursor = null; // 커서 칸 (없으면 null)
let cursorByKey = false; // 키보드로 옮긴 커서는 마우스가 판 밖으로 나가도 남긴다
let shown = [2, 2]; // 점수판의 돌 수. 돌이 놓이고 뒤집힐 때마다 하나씩 바뀐다
let mover = BLACK; // 점수판·안내에 차례로 보이는 사람. 돌이 움직이는 동안에는 방금 둔 사람이다

sound.enabled = settings.sound;
$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

/** 점수판·안내에 쓰는 이름. 컴퓨터 대전은 나/컴퓨터, 2인 대전은 흑/백 */
function nameOf(player) {
  if (match?.mode !== 'versus') return t(player === match?.human ? 'me' : 'computer');
  return t(player === BLACK ? 'black' : 'white');
}

function turnText(player) {
  if (match?.mode !== 'versus' && player === match?.human) return t('myTurn');
  return t('turnOf', { name: nameOf(player) });
}

// ---------- 메뉴 ----------

function renderMenu() {
  const pick = (key) => (value) => {
    settings = { ...settings, [key]: value };
    renderMenu();
  };
  segmented(
    $('opponent-options'),
    OPPONENTS.map((value) => ({ value, label: t(`opponent.${value}`), detail: t(`opponent.${value}.detail`) })),
    settings.opponent,
    pick('opponent'),
  );
  segmented(
    $('level-options'),
    LEVEL_IDS.map((value) => ({ value, label: t(`level.${value}`), detail: t(`level.${value}.detail`) })),
    settings.level,
    pick('level'),
  );
  segmented(
    $('color-options'),
    COLORS.map((value) => ({ value, label: t(`color.${value}`), detail: t(`color.${value}.detail`) })),
    settings.color,
    pick('color'),
  );
  segmented(
    $('hint-options'),
    [true, false].map((value) => ({ value, label: t(value ? 'hints.on' : 'hints.off') })),
    settings.hints,
    pick('hints'),
  );
  const computer = settings.opponent === 'computer';
  $('level-field').hidden = !computer;
  $('color-field').hidden = !computer;
  $('menu-record').textContent = computer ? recordText(settings.level) : t('versusHint');
}

function recordText(level) {
  const record = store.loadRecord(level);
  if (!record) return t('noRecord');
  const values = { level: t(`level.${level}`), ...record };
  const text = t(record.draws ? 'recordDraws' : 'record', values);
  return record.best ? text + t('recordBest', values) : text;
}

function openMenu() {
  session++;
  cancelThinking();
  pending = null;
  match = null;
  state = 'menu';
  // 메뉴 뒤에는 처음 배치를 보여 준다
  const preview = new OthelloMatch();
  scene.setBoard(preview.board);
  scene.setLastMove(null);
  scene.setHints([]);
  setCursor(null);
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
  cancelThinking();
  pending = null;
  const mode = settings.opponent === 'computer' ? 'computer' : 'versus';
  match = new OthelloMatch({ mode, human: settings.color === 'white' ? WHITE : BLACK });
  mover = match.current;
  scene.setBoard(match.board);
  scene.setLastMove(null);
  shown = match.counts;
  show('menu', false);
  show('result', false);
  state = 'anim';
  updateChrome();
  updateHud();
  play(session);
}

// ---------- 점수판·차례 ----------

function updateHud() {
  if (!match) return;
  for (const player of [BLACK, WHITE]) {
    const el = $(`player-${player}`);
    el.querySelector('.name').textContent = nameOf(player);
    const count = el.querySelector('.count');
    const n = String(shown[player]);
    if (Number(n) > Number(count.textContent)) {
      count.classList.remove('bump');
      void count.offsetWidth; // 애니메이션을 처음부터 다시
      count.classList.add('bump');
    }
    count.textContent = n;
  }
}

/** 점수판·버튼·화면 테두리를 지금 상태에 맞춘다 */
function updateChrome() {
  const playing = !!match && state !== 'menu';
  show('versus', playing);
  show('controls', playing);
  show('bar', playing);
  const player = mover;
  const active = playing && state !== 'done';
  for (const p of [BLACK, WHITE]) $(`player-${p}`).classList.toggle('active', active && p === player);
  show('glow', active);
  $('glow').dataset.player = player;
  if (!active) show('turn', false);
  $('btn-undo').disabled = !canUndo();
  updateInsets();
}

/** 차례 안내 줄: 누구 차례인지와 할 일 */
function updateTurn(hint = '') {
  if (!match || state === 'menu' || state === 'done') return show('turn', false);
  const banner = $('turn');
  const player = mover;
  show('turn', true);
  if (banner.dataset.player !== String(player)) {
    banner.classList.remove('swap');
    void banner.offsetWidth; // 애니메이션을 처음부터 다시
    banner.classList.add('swap');
  }
  banner.dataset.player = player;
  $('turn-name').textContent = turnText(player);
  $('turn-hint').textContent = hint;
  updateInsets();
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 판이 그 사이에 오도록 한다 */
function updateInsets() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let top = $('top').getBoundingClientRect().bottom;
  const playing = !!match && state !== 'menu';
  // 차례 안내 줄 자리는 판이 차례마다 들썩이지 않도록 놀이 중에는 늘 비워 둔다
  if (playing) top = Math.max(top, $('turn').hidden ? top + 34 : $('turn').getBoundingClientRect().bottom);
  // 버튼 줄이 판 아래에 오면 그만큼 비운다. 낮은 가로 화면에서는 오른쪽 구석으로 비켜 있어 비우지 않는다
  const bar = $('btn-undo').getBoundingClientRect();
  const under = !$('bar').hidden && bar.left < w * 0.62;
  const bottom = under ? h - bar.top + 6 : 8;
  scene.setInsets({ top: top + 6, bottom: bottom + 4, left: 8, right: 8 });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('top'));
new ResizeObserver(updateInsets).observe($('bar'));

// ---------- 사람의 수 ----------

function humanMove() {
  return new Promise((resolve) => {
    pending = { resolve };
    const moves = match.legalMoves();
    scene.setHints(settings.hints ? moves : [], match.current);
    // 키보드로 두던 중이면 커서를 둘 수 있는 칸으로 옮겨 둔다
    if (cursorByKey && (cursor === null || !match.canPlay(cursor))) cursor = moves[0] ?? cursor;
    setCursor(cursor);
    updateTurn(t('hintPlace', { n: moves.length }));
  });
}

/** 커서를 옮기고, 사람 차례에 둘 수 있는 칸이면 놓을 돌과 뒤집힐 돌을 미리 보인다 */
function setCursor(index) {
  cursor = index;
  if (index === null || !match || state === 'menu' || state === 'done') return scene.setCursor(null);
  const player = match.current;
  const preview = pending && match.canPlay(index) ? { player, flips: flipsFor(match.board, player, index) } : null;
  scene.setCursor(pending ? index : null, { player, preview });
}

function placeAt(index) {
  if (!pending || index === null) return;
  if (!match.canPlay(index)) {
    toast.show(t('illegal'), 'bad');
    return;
  }
  const { resolve } = pending;
  pending = null;
  resolve(index);
}

// ---------- 입력 ----------

scene.onPointer = (type, event) => {
  if (type === 'pointerdown') sound.unlock();
  // 결과 창을 닫고 판을 보던 중이면 다시 띄운다
  if (type === 'pointerup' && state === 'done' && $('result').hidden) {
    show('result', true);
    return;
  }
  if (!match || state === 'menu') return;
  if (type === 'pointerleave') {
    if (!cursorByKey) setCursor(null);
    return;
  }
  // 마우스는 올리기만 해도 미리 보인다. 손가락은 누른 칸에 바로 둔다
  if (type === 'pointermove' && event.pointerType === 'mouse') {
    const index = scene.cellAt(event);
    cursorByKey = false;
    if (index !== cursor) setCursor(index);
    return;
  }
  if (type === 'pointerup' && (event.pointerType !== 'mouse' || event.button === 0)) {
    const index = scene.cellAt(event);
    if (index === null) return;
    cursorByKey = false;
    setCursor(index);
    placeAt(index);
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
  event.currentTarget.blur(); // 스페이스로 놓을 때 버튼이 다시 눌리지 않게
});

/** 키보드로 커서 옮기기. 처음에는 둘 수 있는 첫 칸에서 시작한다 */
function moveCursor(dr, dc) {
  cursorByKey = true;
  if (cursor === null) {
    const moves = pending ? match.legalMoves() : [];
    return setCursor(moves[0] ?? indexOf(3, 3));
  }
  const row = Math.min(SIZE - 1, Math.max(0, rowOf(cursor) + dr));
  const col = Math.min(SIZE - 1, Math.max(0, colOf(cursor) + dc));
  setCursor(indexOf(row, col));
  if (pending) updateTurn(t('hintKeys'));
}

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    // Ctrl+Z 도 무르기
    if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z') && $('menu').hidden) {
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
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === 'm') return toggleSound();
  if (event.key === 'Escape') return match ? openMenu() : undefined;
  if (state === 'done') {
    if (enter && !$('result').hidden && !event.target.closest?.('button')) {
      event.preventDefault();
      newGame();
    }
    return;
  }
  if (key === 'u' || event.key === 'Backspace') {
    event.preventDefault();
    return undo();
  }
  if (key === 'n') return newGame();
  if (ARROWS[event.key]) {
    event.preventDefault();
    return moveCursor(...ARROWS[event.key]);
  }
  if ((event.key === ' ' || enter) && !event.repeat && !event.target.closest?.('button, a')) {
    event.preventDefault();
    if (cursor === null) return moveCursor(0, 0);
    cursorByKey = true;
    placeAt(cursor);
  }
});

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  toast.tick(dt);
  return false;
};

scene.onEvent = (event) => {
  if (!match) return;
  if (event.type === 'place') {
    sound.place(event.x);
    shown[match.board[event.index]]++;
  }
  if (event.type === 'flip') {
    sound.flip(event.k, event.x);
    shown[event.color]++;
    shown[1 - event.color]--;
  }
  updateHud();
};

// ---------- 컴퓨터 ----------

let worker = null;
let workerBroken = false;
let request = null; // 워커에 맡긴 계산 { id, resolve }
let requestId = 0;

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      if (request?.id !== event.data.id) return;
      const { resolve } = request;
      request = null;
      resolve(event.data.move);
    };
    worker.onerror = (event) => {
      // 모듈 워커를 못 쓰는 브라우저: 이후로는 화면 스레드에서 계산한다
      event.preventDefault?.();
      workerBroken = true;
      worker?.terminate();
      worker = null;
      const failed = request;
      request = null;
      failed?.retry();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

/** 화면 스레드에서 계산한다. 생각하는 중 안내가 먼저 그려지도록 한 박자 쉬고 시작한다 */
async function thinkHere(board, player, level) {
  await sleep(30);
  return chooseMove(board, player, level, { time: FALLBACK_TIME });
}

function think(board, player, level) {
  const w = getWorker();
  if (!w) return thinkHere(board, player, level);
  return new Promise((resolve) => {
    const id = ++requestId;
    request = { id, resolve, retry: () => thinkHere(board, player, level).then(resolve) };
    w.postMessage({ id, board: Array.from(board), player, level });
  });
}

/** 하던 계산을 버린다. 워커는 계산을 중간에 멈출 수 없어 새로 만든다 */
function cancelThinking() {
  if (!request) return;
  request.resolve(null);
  request = null;
  worker?.terminate();
  worker = null;
}

async function computerMove(token) {
  updateTurn(t('computerTurn'));
  scene.setHints([]);
  const started = performance.now();
  const move = await think(match.board, match.current, settings.level);
  if (token !== session) return null;
  const wait = MIN_THINK - (performance.now() - started);
  if (wait > 0) await sleep(wait);
  if (token !== session) return null;
  return move;
}

// ---------- 진행 ----------

async function play(token) {
  while (token === session && !match.over) {
    const player = match.current;
    const human = match.isHuman(player);
    mover = player;
    state = human ? 'turn' : 'cpu';
    updateChrome();
    updateHud();
    const index = human ? await humanMove() : await computerMove(token);
    if (token !== session || index === null || index < 0) return;

    state = 'anim';
    pending = null;
    scene.setHints([]);
    setCursor(cursorByKey ? cursor : null);
    const result = match.play(index);
    updateChrome();
    updateTurn('');
    await scene.placeDisc(index, player, result.flips);
    if (token !== session) return;
    shown = match.counts;
    updateHud();
    if (result.flips.length >= BIG_FLIP && !result.over) toast.show(t('flipped', { n: result.flips.length }), `p${player}`);
    if (result.passed !== null) {
      await sleep(250);
      if (token !== session) return;
      announcePass(result.passed);
      await sleep(PASS_PAUSE);
      if (token !== session) return;
    } else if (match.mode === 'versus' && !result.over) {
      sound.play('turn');
    }
  }
  if (token === session) endGame();
}

function announcePass(passer) {
  sound.play('pass');
  const mine = match.mode !== 'versus' && passer === match.human;
  toast.show(mine ? t('passMe') : t('pass', { name: nameOf(passer) }), 'bad');
}

/** 지금 무를 수 있는지: 사람 차례이거나 컴퓨터가 생각하는 중이고, 무를 수가 있어야 한다 */
function canUndo() {
  return !!match && (state === 'turn' || state === 'cpu') && match.canUndo();
}

function undo() {
  if (!canUndo()) return;
  session++;
  cancelThinking();
  pending = null;
  match.undo();
  mover = match.current;
  scene.setBoard(match.board);
  scene.setLastMove(match.lastMove);
  shown = match.counts;
  sound.play('undo');
  toast.show(t('undone'));
  updateHud();
  play(session);
}

function endGame() {
  state = 'done';
  pending = null;
  scene.setHints([]);
  setCursor(null);
  updateChrome();
  updateHud();
  const [a, b] = match.counts;
  const winner = match.winner;
  const versus = match.mode === 'versus';
  let tone;
  if (versus) {
    $('result-title').textContent = winner === -1 ? t('draw') : t('winner', { name: nameOf(winner) });
    tone = winner === -1 ? 'draw' : `p${winner}`;
  } else {
    const outcome = winner === -1 ? 'draw' : winner === match.human ? 'win' : 'loss';
    $('result-title').textContent = t(outcome === 'loss' ? 'lose' : outcome);
    tone = outcome === 'loss' ? 'lose' : outcome;
    store.recordResult(settings.level, outcome, match.count(match.human));
  }
  $('result-detail').textContent = t('finalDetail', { a, b, moves: t('movesCount', { n: match.moves }) });
  $('result-record').textContent = versus ? '' : recordText(settings.level);
  $('result').dataset.tone = tone;
  sound.play(tone === 'lose' ? 'lose' : 'win');
  show('result', true);
  $('btn-again').focus();
}

$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', newGame);
$('btn-view').addEventListener('click', () => show('result', false));
$('btn-result-menu').addEventListener('click', openMenu);
$('btn-menu').addEventListener('click', (event) => {
  event.currentTarget.blur();
  openMenu();
});
$('btn-undo').addEventListener('click', (event) => {
  event.currentTarget.blur();
  undo();
});
$('btn-new').addEventListener('click', (event) => {
  event.currentTarget.blur();
  newGame();
});

// ?debug 로 열면 콘솔에서 씬과 판 상태를 들여다보고, 사람 차례에 place('d3') 처럼 대신 둘 수 있다
if (params.has('debug')) {
  window.othello = {
    scene,
    sound,
    store,
    get match() {
      return match;
    },
    get state() {
      return state;
    },
    place(cell) {
      if (!pending) return false;
      placeAt(typeof cell === 'string' ? parseNotation(cell) : cell);
      return true;
    },
    undo,
    newGame,
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
