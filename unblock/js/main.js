// 차 빼기: 규칙(game.js), 풀이기(solver.js), 단계(levels.js), 오늘의 퍼즐(generator.js), 3D 씬(scene.js),
// 저장(save.js)을 잇고 HUD·입력을 처리한다. 차를 눌러 놓인 방향으로 끌면 밀리고, 키보드는 Tab·방향키로 고르고 민다.

import { UnblockGame, parseBoard, TIERS, starsFor } from './game.js';
import { LEVELS } from './levels.js';
import { nextMove } from './solver.js';
import { dateKey, dailyPuzzle } from './generator.js';
import { SaveStore, browserStorage } from './save.js';
import { UnblockScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, formatNumber, mountLangToggle } from '../../shared/i18n.js';
import { createToast, focusForKeyboard } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);
const show = (id, visible) => {
  $(id).hidden = !visible;
};

const RESULT_DELAY = 1.7; // 내 차가 출구로 달려 나가는 것을 보여 준 뒤 결과 창을 띄운다
const DRAG_SLOP = 0.12; // 이만큼(칸) 넘게 끌어야 미는 것으로 본다. 그보다 짧으면 차를 고르기만 한다
const DRAG_HEIGHT = 0.35; // 끄는 손가락을 이 높이의 수평면에 비춰 칸 단위로 잰다

document.title = t('title');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new UnblockScene($('stage'));
const store = new SaveStore(
  browserStorage(),
  LEVELS.map((level) => level.id),
);
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.6);

let index = 0; // 지금 단계 (LEVELS 의 위치)
let daily = null; // 오늘의 퍼즐을 하는 중이면 { day, board, moves }
let game = null;
let state = 'select'; // select | playing | cleared
let hinted = false; // 이번 판에 힌트를 썼는지
let selected = -1;
let drag = null; // { pointerId, id, start, origin, range, pos, moved, atLimit }
let resultTimer = 0;
let padHeight = 0;
let outcome = null; // 방금 깬 기록을 저장한 결과
let dailyPending = null; // 오늘의 퍼즐을 만드는 중인 Promise

$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

const indexOfId = (id) => Math.max(0, LEVELS.findIndex((level) => level.id === id));
const tierOf = (i) => LEVELS[i].tier;
/** 난이도 안에서 몇 번째 단계인지 (1부터) */
const numberInTier = (i) => i - LEVELS.findIndex((level) => level.tier === LEVELS[i].tier) + 1;
const levelName = (i) => t('levelName', { tier: t(`tier.${tierOf(i)}`), n: numberInTier(i) });
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** 지금 판의 최소 수 */
const minimum = () => (daily ? daily.moves : LEVELS[index].moves);

// ---------- 단계 선택 ----------

function renderSelect() {
  const data = store.load();
  const solved = Object.keys(data.best).length;
  const total = LEVELS.length;
  $('progress').textContent = solved === total ? t('progressAll', { total }) : t('progress', { solved, total });

  const list = $('tiers');
  list.replaceChildren();
  for (const tier of TIERS) {
    const section = document.createElement('section');
    section.className = 'tier';
    const range = tier.max < 99 ? t('tierRange', { min: tier.min, max: tier.max }) : t('tierRangeOpen', { min: tier.min });
    section.innerHTML = `<h2>${t(`tier.${tier.id}`)} <small>${range}</small></h2>`;
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    LEVELS.forEach((level, i) => {
      if (level.tier !== tier.id) return;
      const record = data.best[level.id];
      const open = store.isUnlocked(i, data);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `level${record ? ' solved' : ''}${i === index && !daily ? ' current' : ''}`;
      button.disabled = !open;
      const stars = record ? starsFor(record.moves, level.moves) : 0;
      const mark = record ? `${starText(stars)}${record.hinted ? '<i class="hinted">💡</i>' : ''}` : open ? '' : '🔒';
      button.innerHTML = `<span>${numberInTier(i)}</span><small>${mark}</small>`;
      button.setAttribute(
        'aria-label',
        record
          ? t('levelSolved', { name: levelName(i), stars, moves: record.moves })
          : open
            ? t('levelLabel', { name: levelName(i), min: level.moves })
            : t('levelLocked', { name: levelName(i) }),
      );
      button.addEventListener('click', () => {
        sound.unlock();
        sound.play('select');
        startLevel(i);
      });
      grid.append(button);
    });
    section.append(grid);
    list.append(section);
  }
  $('continue-label').textContent = t('continue', { name: levelName(index) });
  renderDailyButton();
}

function renderDailyButton() {
  const day = dateKey();
  const done = store.loadDaily(day);
  const streak = store.loadStreak(day);
  $('daily-date').textContent = day;
  const parts = [];
  if (done) {
    const puzzle = store.loadDailyPuzzle(day);
    parts.push(t('dailyDone', { moves: done.moves, stars: starText(starsFor(done.moves, puzzle.moves)) }));
  } else {
    parts.push(t('dailyTodo'));
  }
  if (streak > 0) parts.push(t('streak', { n: streak }));
  $('daily-detail').textContent = parts.join(' · ');
}

function setState(next) {
  state = next;
  show('select', state === 'select');
  show('result', state === 'cleared' && resultTimer <= 0);
  show('stats', state !== 'select');
  show('pad', state === 'playing');
  // 포커스가 버튼에 남아 있으면 Space·Enter 가 그 버튼을 누르게 된다
  if (state === 'playing') document.activeElement?.blur?.();
  updateStatus();
  updateInsets();
}

function openSelect() {
  cancelDrag();
  // 방금 깬 판에서 왔으면 '하기' 버튼은 다음에 할 단계를 가리킨다
  if (game?.solved || (state === 'cleared' && daily)) index = indexOfId(store.nextUnsolved());
  renderSelect();
  setState('select');
  $('btn-continue').focus({ preventScroll: true }); // 긴 단계 목록이 맨 아래로 굴러가지 않게
  $('select').scrollTop = 0;
}

/** 판만 새로 놓는다 (단계 선택 뒤 배경으로도 쓴다) */
function loadBoard(board) {
  game = new UnblockGame(parseBoard(board));
  hinted = false;
  selected = -1;
  scene.setup(game);
  updateHud();
}

function startLevel(i) {
  sound.unlock();
  index = i;
  daily = null;
  loadBoard(LEVELS[i].board);
  store.saveLast(LEVELS[i].id);
  resultTimer = 0;
  setState('playing');
}

/** 오늘의 퍼즐. 처음 만들 때는 시간이 조금 걸려 일꾼(Web Worker)에게 맡긴다 */
async function startDaily() {
  sound.unlock();
  const day = dateKey();
  let puzzle = store.loadDailyPuzzle(day);
  if (!puzzle) {
    $('daily-detail').textContent = t('dailyMaking');
    $('btn-daily').disabled = true;
    try {
      puzzle = await makeDaily(day);
    } finally {
      $('btn-daily').disabled = false;
    }
    store.saveDailyPuzzle(day, puzzle);
  }
  if (state !== 'select') return; // 만드는 동안 다른 단계를 골랐다
  daily = { day, ...puzzle };
  loadBoard(puzzle.board);
  resultTimer = 0;
  setState('playing');
  toast.show(t('dailyLabel', { date: day }));
}

function makeDaily(day) {
  dailyPending ??= new Promise((resolve) => {
    // 일꾼을 못 쓰는 브라우저면 잠깐 화면이 멈추더라도 여기서 만든다
    const fallback = () => setTimeout(() => resolve(dailyPuzzle(day)), 30);
    try {
      const worker = new Worker(new URL('./daily-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        resolve(e.data);
        worker.terminate();
      };
      worker.onerror = () => {
        worker.terminate();
        fallback();
      };
      worker.postMessage(day);
    } catch {
      fallback();
    }
  }).finally(() => {
    dailyPending = null;
  });
  return dailyPending;
}

function levelCleared() {
  const record = { moves: game.moves, hinted };
  outcome = daily ? store.recordDaily(daily.day, record) : store.record(LEVELS[index].id, record);
  resultTimer = RESULT_DELAY;
  selected = -1;
  scene.select(-1);
  setState('cleared');
  updateHud();
}

function showResult() {
  const moves = game.moves;
  const min = minimum();
  const stars = starsFor(moves, min);
  const { first, improved, previous } = outcome;
  const last = !daily && index === LEVELS.length - 1;
  const all = store.solvedCount() === LEVELS.length;
  let title;
  if (daily) title = t('dailySolved');
  else if (last && all) title = t('clearedAll');
  else if (improved && !first) title = t('clearedBest', { name: levelName(index) });
  else title = t('cleared', { name: levelName(index) });
  $('result-title').textContent = title;
  $('result-stars').textContent = starText(stars);
  $('result-stars').setAttribute('aria-label', t('starsLabel', { n: stars }));
  const detail = [t('result', { moves: formatNumber(moves), min: formatNumber(min) })];
  if (hinted) detail.push(t('hintUsed'));
  $('result-detail').textContent = detail.join(' · ');
  const best = [];
  if (first) best.push(t('firstClear'));
  else best.push(t(improved ? 'previousBest' : 'best', { moves: formatNumber(previous.moves) }) + (previous.hinted ? ' 💡' : ''));
  if (daily && outcome.streak > 0) best.push(t('streak', { n: outcome.streak }));
  $('result-best').textContent = best.join(' · ');
  $('result').dataset.tone = improved ? 'win' : '';
  const hasNext = !daily && !last && store.isUnlocked(index + 1);
  show('btn-next', hasNext);
  show('result', true);
  focusForKeyboard(hasNext ? $('btn-next') : $('btn-result-levels'));
}

// ---------- HUD ----------

function updateHud() {
  $('level').textContent = daily ? t('dailyShort') : levelName(index);
  $('moves').textContent = formatNumber(game.moves);
  $('min').textContent = formatNumber(minimum());
  const best = daily ? store.loadDaily(daily.day) : store.loadBest(LEVELS[index].id);
  show('best-stat', !!best);
  if (best) $('best').textContent = formatNumber(best.moves) + (best.hinted ? '💡' : '');
  $('btn-undo').disabled = !game.canUndo;
  $('btn-restart').disabled = !game.canUndo;
  updateStatus();
}

/** 화면 위쪽의 한 줄 안내: 힌트를 썼는지, 고른 차를 키보드로 미는 법 */
function updateStatus() {
  const parts = [];
  if (state === 'playing' && hinted) parts.push(t('hintUsed'));
  $('status').textContent = parts.join(' · ');
  show('status', parts.length > 0);
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
        sound.slide(Math.abs(event.to - event.from));
        break;
      case 'blocked':
        if (!drag) sound.play('bump');
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
        sound.drive();
        levelCleared();
        break;
    }
  }
  updateHud();
}

// ---------- 동작 ----------

function select(id) {
  if (id === selected) return;
  selected = id;
  scene.select(id);
}

/** 고른 차를 dir(-1, 1) 쪽으로 한 칸 민다 */
function nudge(id, dir) {
  game.move(id, game.positions[id] + dir);
  flush();
}

function hint() {
  if (game.solved) return;
  const move = nextMove(game.pieces, game.positions);
  if (!move) return;
  if (!hinted) {
    hinted = true;
    updateStatus();
  }
  scene.showHint(move);
  select(move.id);
  sound.play('hint');
  toast.show(t('hintToast', { n: move.moves }));
}

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
  cancelDrag();
  if (action === 'undo') game.undo();
  else if (action === 'restart') game.restart();
  else if (action === 'hint') hint();
  flush();
}

/** 지금 고른 차에서 dir 방향(화면의 위·아래·왼쪽·오른쪽)으로 가장 가까운 차 */
function neighborCar(dx, dy) {
  const center = (id) => {
    const piece = game.pieces[id];
    const pos = game.positions[id] + piece.length / 2;
    return piece.horizontal ? [pos, piece.fixed + 0.5] : [piece.fixed + 0.5, pos];
  };
  const [x0, y0] = center(selected < 0 ? 0 : selected);
  let best = -1;
  let bestScore = Infinity;
  game.pieces.forEach((_, id) => {
    if (id === selected) return;
    const [x, y] = center(id);
    const along = (x - x0) * dx + (y - y0) * dy;
    if (along <= 0.3) return;
    const across = Math.abs((x - x0) * dy) + Math.abs((y - y0) * dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  });
  return best;
}

const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

function arrow(dx, dy) {
  if (selected < 0) {
    select(0);
    sound.play('select');
    if (dy !== 0) return; // 내 차는 가로라 위아래는 고르기만
  }
  const piece = game.pieces[selected];
  const along = piece.horizontal ? dx : dy;
  if (along !== 0) {
    nudge(selected, along);
    return;
  }
  // 고른 차가 못 가는 방향이면 그쪽의 차를 고른다
  const next = neighborCar(dx, dy);
  if (next >= 0) {
    select(next);
    sound.play('select');
  }
}

function cycle(step) {
  const n = game.pieces.length;
  select(selected < 0 ? (step > 0 ? 0 : n - 1) : (selected + step + n) % n);
  sound.play('select');
}

// ---------- 키보드 ----------

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  sound.unlock();
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (state === 'select' && document.activeElement?.tagName !== 'BUTTON') {
      e.preventDefault();
      startLevel(index);
    } else if (state === 'cleared' && resultTimer <= 0 && document.activeElement?.tagName !== 'BUTTON') {
      e.preventDefault();
      nextLevel();
    }
    return;
  }
  if (e.code === 'Escape') {
    if (state !== 'select') openSelect();
    else if (game && !game.solved) setState('playing');
    else startLevel(index);
    return;
  }
  if (e.code === 'KeyM') {
    toggleSound();
    return;
  }
  if (state === 'select') return;
  if (e.code === 'KeyZ' || e.code === 'KeyU' || e.code === 'Backspace') {
    e.preventDefault();
    perform('undo');
  } else if (e.code === 'KeyR' && !e.repeat) {
    perform('restart');
  } else if (e.code === 'KeyH' && !e.repeat) {
    perform('hint');
  } else if (state === 'playing' && e.code === 'Tab') {
    e.preventDefault();
    cycle(e.shiftKey ? -1 : 1);
  } else if (state === 'playing' && ARROWS[e.code]) {
    e.preventDefault();
    arrow(...ARROWS[e.code]);
  }
});

for (const button of $('pad').querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => {
    sound.unlock();
    perform(button.dataset.action);
  });
}

// ---------- 끌기 ----------

const stage = $('stage');

function cancelDrag() {
  if (!drag) return;
  scene.settle(drag.id);
  drag = null;
}

stage.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (state !== 'playing' || drag) return;
  const id = scene.pickCar(e.clientX, e.clientY);
  if (id < 0) {
    select(-1);
    return;
  }
  const origin = scene.boardPoint(e.clientX, e.clientY, DRAG_HEIGHT);
  if (!origin) return;
  if (id !== selected) sound.play('select');
  select(id);
  const start = game.positions[id];
  drag = { pointerId: e.pointerId, id, start, origin, range: game.range(id), pos: start, moved: false, atLimit: false };
  stage.setPointerCapture(e.pointerId);
});

stage.addEventListener('pointermove', (e) => {
  if (!drag || drag.pointerId !== e.pointerId) return;
  const point = scene.boardPoint(e.clientX, e.clientY, DRAG_HEIGHT);
  if (!point) return;
  const piece = game.pieces[drag.id];
  const delta = piece.horizontal ? point.u - drag.origin.u : point.v - drag.origin.v;
  if (Math.abs(delta) > DRAG_SLOP) drag.moved = true;
  if (!drag.moved) return;
  const wanted = drag.start + delta;
  const { min, max } = drag.range;
  drag.pos = Math.min(max, Math.max(min, wanted));
  // 막힌 곳에 닿으면 한 번 툭 소리를 낸다
  const atLimit = wanted < min - 0.15 || wanted > max + 0.15;
  if (atLimit && !drag.atLimit) sound.play('bump');
  drag.atLimit = atLimit;
  scene.drag(drag.id, drag.pos);
});

function endDrag(e) {
  if (!drag || drag.pointerId !== e.pointerId) return;
  const { id, start, pos, moved } = drag;
  drag = null;
  const to = Math.round(pos);
  if (moved && to !== start) {
    game.move(id, to);
    flush();
  } else {
    scene.settle(id);
  }
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// ---------- 버튼 ----------

function toggleSound() {
  sound.setEnabled(!sound.enabled);
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

function nextLevel() {
  if (daily || index === LEVELS.length - 1 || !store.isUnlocked(index + 1)) openSelect();
  else startLevel(index + 1);
}

$('btn-continue').addEventListener('click', () => startLevel(index));
$('btn-daily').addEventListener('click', () => startDaily());
$('btn-next').addEventListener('click', nextLevel);
$('btn-again').addEventListener('click', () => (daily ? restartDaily() : startLevel(index)));
$('btn-result-levels').addEventListener('click', openSelect);
$('btn-sound').addEventListener('click', toggleSound);

function restartDaily() {
  loadBoard(daily.board);
  resultTimer = 0;
  setState('playing');
}

// 다른 창으로 가면 끌던 차를 놓는다
window.addEventListener('blur', cancelDrag);

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  if (state === 'cleared' && resultTimer > 0 && (resultTimer -= dt) <= 0) showResult();
};

// ?debug 로 열면 콘솔에서 게임과 씬을 들여다볼 수 있다
if (new URLSearchParams(location.search).has('debug')) {
  window.unblock = {
    scene,
    store,
    sound,
    perform,
    startLevel,
    startDaily,
    /** 풀이기의 풀이대로 끝까지 민다 */
    solve() {
      for (let move = nextMove(game.pieces, game.positions); move; move = nextMove(game.pieces, game.positions)) {
        game.move(move.id, move.to);
        flush();
        if (game.solved) break;
      }
    },
    move(id, to) {
      game.move(id, to);
      flush();
    },
    get game() {
      return game;
    },
    get state() {
      return state;
    },
  };
}

try {
  await scene.load({ exitLabel: t('exitLabel') });
  index = indexOfId(store.nextUnsolved());
  loadBoard(LEVELS[index].board);
  $('loading').hidden = true;
  openSelect();
} catch (error) {
  console.error(error);
  $('loading').textContent = t('loadError');
}
