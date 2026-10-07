// 메모리 카드: 규칙(game.js), 3D 씬(scene.js), 저장(save.js)을 잇고 HUD·입력을 처리한다.

import { MemoryGame, SIZES, formatTime } from './game.js';
import { SaveStore, browserStorage, PLAYER_COUNTS } from './save.js';
import { MemoryScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle } from '../../shared/i18n.js';
import { segmented, createToast, focusForKeyboard } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);

const RESULT_DELAY = 2; // 다 맞춘 뒤 카드가 들썩이는 것을 보여 주고 결과 창을 띄우기까지(초)
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

document.title = t('title');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new MemoryScene($('stage'), new URL('../assets/', import.meta.url));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));

let settings = store.loadSettings();
let game = null;
let backdrop = null; // 메뉴 뒤에 보여 줄, 그림이 모두 펼쳐진 판
let state = 'menu'; // menu | playing | done
let starter = 0; // 2인 대전에서 먼저 하는 사람. 한 판 더 하면 바뀐다
let resultTimer = 0; // 결과 창을 띄우기까지 남은 시간
const toast = createToast($('toast'));
let keyCursor = -1; // 키보드로 고른 카드

const playerName = (player) => t('player', { n: player + 1 });
for (const player of [0, 1]) $(`player-${player}`).querySelector('.name').textContent = playerName(player);

$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

// ---------- 메뉴 ----------

const describe = (key, { time, turns }) => t(key, { time: formatTime(time), turns });

function renderMenu() {
  segmented(
    $('player-options'),
    PLAYER_COUNTS.map((players) => ({
      value: players,
      label: t(`players.${players}`),
      detail: t(`players.${players}.detail`),
    })),
    settings.players,
    (players) => {
      settings = { ...settings, players };
      renderMenu();
    },
  );
  segmented(
    $('size-options'),
    SIZES.map((size) => ({ value: size, label: t('cards', { n: size }), detail: t(`size.${size}`) })),
    settings.size,
    (size) => {
      settings = { ...settings, size };
      renderMenu();
    },
  );
  const best = store.loadBest(settings.size);
  $('menu-best').textContent = settings.players > 1 ? t('versusHint') : best ? describe('best', best) : t('noBest');
  if (!backdrop || backdrop.count !== settings.size) {
    backdrop = new MemoryGame({ count: settings.size });
    for (const card of backdrop.cards) card.state = 'up';
    backdrop.done = true;
    scene.setup(backdrop, { deal: false });
  }
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function setState(next) {
  state = next;
  resultTimer = 0;
  const inGame = !!game && state !== 'menu';
  const versus = inGame && game.players > 1;
  show('menu', state === 'menu');
  show('result', false);
  show('stats', inGame && !versus);
  show('versus', versus);
  show('bar', inGame);
  updateTurn();
  // 포커스가 버튼에 남아 있으면 Space 가 그 버튼을 누르게 된다
  if (state === 'playing') $('stage').focus({ preventScroll: true });
  updateInsets();
}

function setKeyCursor(index) {
  keyCursor = index;
  scene.setCursor(index);
}

function openMenu() {
  game = null;
  backdrop = null;
  setKeyCursor(-1);
  renderMenu();
  setState('menu');
  focusForKeyboard($('btn-start'));
}

function deal(first) {
  sound.unlock();
  const { players, size } = settings;
  starter = first;
  game = new MemoryGame({ count: size, players, first });
  scene.setup(game);
  setKeyCursor(-1);
  sound.play('shuffle');
  updateHud();
  setState('playing');
  if (players > 1) toast.show(t('turnOf', { name: playerName(game.current) }), `p${game.current}`);
}

function start() {
  store.saveSettings(settings);
  deal(0);
}

/** 같은 설정으로 카드를 다시 섞는다. 먼저 하는 사람은 그대로다 */
function restart() {
  if (!game || state === 'menu') return;
  deal(starter);
}

/** 한 판 더: 2인 대전에서는 먼저 하는 사람을 바꾼다 */
function next() {
  deal(game?.players > 1 ? 1 - starter : 0);
}

function finished() {
  const { count, players, turns, elapsed: time, scores, winner } = game;
  const lines = [];
  let tone = '';
  if (players > 1) {
    tone = winner < 0 ? '' : `p${winner}`;
    $('result-title').textContent = winner < 0 ? t('draw') : t('wins', { name: playerName(winner) });
    $('result-detail').textContent = `${playerName(0)} ${t('score', { a: scores[0], b: scores[1] })} ${playerName(1)}`;
    lines.push(t('versusTurns', { turns }));
  } else {
    const previous = store.loadBest(count);
    const improved = store.recordBest(count, { time, turns });
    const isBest = !!previous && (improved.time || improved.turns);
    tone = isBest ? 'win' : '';
    $('result-title').textContent = isBest ? t('newBest') : t('cleared');
    $('result-detail').textContent = describe('result', { time, turns });
    if (isBest) lines.push(t(improved.time && improved.turns ? 'bestBoth' : improved.time ? 'bestTime' : 'bestTurns'));
    if (previous) lines.push(describe('best', store.loadBest(count)));
  }
  $('result-best').textContent = lines.join(' · ');
  $('result').dataset.tone = tone;

  sound.play('win');
  toast.show($('result-title').textContent, tone === 'win' ? 'big' : tone);
  setState('done');
  setKeyCursor(-1);
  resultTimer = RESULT_DELAY;
}

function showResult() {
  show('result', true);
  focusForKeyboard($('btn-next'));
}

// ---------- HUD ----------

function updateHud() {
  $('turns').textContent = game.turns;
  $('time').textContent = formatTime(game.elapsed);
  $('found').textContent = `${game.found}/${game.pairs}`;
  game.scores.forEach((score, player) => {
    $(`player-${player}`).querySelector('.score').textContent = score;
  });
}

/**
 * 누구 차례인지를 여러 곳에 한꺼번에 알린다: 점수판의 이름표, 그 아래 안내 줄, 화면 가장자리 빛, 펠트 테두리.
 * hint 는 안내 줄에 이름 옆에 붙일 말.
 */
function updateTurn(hint = 'turnHint') {
  const active = !!game && state === 'playing' && game.players > 1;
  const player = active ? game.current : -1;
  for (const p of [0, 1]) $(`player-${p}`).classList.toggle('active', p === player);
  show('turn', active);
  show('glow', active);
  scene.setTurn(player);
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
  $('turn-hint').textContent = t(hint);
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 판이 그 사이에 오도록 한다 */
function updateInsets() {
  const h = window.innerHeight;
  let top = $('top').getBoundingClientRect().bottom;
  if (!$('turn').hidden) top = Math.max(top, $('turn').getBoundingClientRect().bottom);
  const bottom = $('bar').hidden ? 0 : h - $('bar').getBoundingClientRect().top;
  scene.setInsets({ top, bottom, left: 0, right: 0 });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('top'));
new ResizeObserver(updateInsets).observe($('bar'));

// ---------- 사건 ----------

function flush() {
  let wasDone = false;
  for (const event of game.drain()) {
    scene.handle(event);
    switch (event.type) {
      case 'flip':
        sound.play('flip');
        break;
      case 'match':
        // 짝이 늘수록 높아진다
        sound.play('match', 0.85 + 0.4 * (game.found / game.pairs));
        if (game.players > 1) {
          updateTurn('turnAgain');
          if (!game.done) toast.show(t('matchAgain'), `p${event.player}`);
        }
        break;
      case 'miss':
        if (game.players > 1) updateTurn('turnPass');
        break;
      case 'hide':
        sound.play('hide');
        break;
      case 'turn':
        sound.play('turn');
        updateTurn();
        toast.show(t('turnOf', { name: playerName(event.player) }), `p${event.player}`);
        break;
      case 'done':
        wasDone = true;
        break;
    }
  }
  updateHud();
  if (wasDone) finished();
}

// ---------- 입력 ----------

function flip(index) {
  sound.unlock();
  if (state !== 'playing' || !game) return;
  if (game.flip(index)) flush();
}

scene.onTap = (index) => {
  setKeyCursor(-1);
  flip(index);
};

scene.onHover = (index) => {
  if (state === 'playing' && keyCursor < 0) scene.setCursor(index);
};

function moveCursor(dx, dy) {
  const { cols, rows } = scene;
  if (keyCursor < 0) {
    setKeyCursor(0);
    return;
  }
  const x = Math.min(cols - 1, Math.max(0, (keyCursor % cols) + dx));
  const y = Math.min(rows - 1, Math.max(0, Math.floor(keyCursor / cols) + dy));
  setKeyCursor(y * cols + x);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
  if (state === 'menu') {
    if (enter) {
      e.preventDefault();
      start();
    }
    return;
  }
  if (e.code === 'KeyM') {
    toggleSound();
    return;
  }
  if (e.code === 'Escape') {
    openMenu();
    return;
  }
  if (e.code === 'KeyR') {
    restart();
    return;
  }
  if (state === 'done') {
    if (enter) {
      e.preventDefault();
      next();
    }
    return;
  }
  if (ARROWS[e.code]) {
    e.preventDefault();
    moveCursor(...ARROWS[e.code]);
    return;
  }
  // 아래 버튼에 포커스가 있으면 그 버튼이 눌리게 둔다
  if ((e.code === 'Space' || enter) && !e.target.closest?.('button, a')) {
    e.preventDefault();
    if (e.repeat) return;
    if (keyCursor < 0) setKeyCursor(0);
    else flip(keyCursor);
  }
});

function toggleSound() {
  sound.setEnabled(!sound.enabled);
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

$('btn-start').addEventListener('click', start);
$('btn-next').addEventListener('click', next);
$('btn-view').addEventListener('click', () => show('result', false));
$('btn-result-menu').addEventListener('click', openMenu);
$('btn-restart').addEventListener('click', restart);
$('btn-menu').addEventListener('click', openMenu);
$('btn-sound').addEventListener('click', toggleSound);

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  if (!game) return;
  if (state === 'playing') {
    game.update(dt);
    if (game.events.length) flush(); // 틀린 카드가 덮이고 차례가 넘어갔다
    const text = formatTime(game.elapsed);
    if ($('time').textContent !== text) $('time').textContent = text;
  }
  if (resultTimer > 0 && (resultTimer -= dt) <= 0) showResult();
};

// ?debug 로 열면 콘솔에서 상태를 들여다볼 수 있다
if (new URLSearchParams(location.search).has('debug')) {
  window.memory = {
    scene,
    store,
    get game() {
      return game;
    },
    get state() {
      return state;
    },
  };
}

$('loading').hidden = true;
openMenu();
