// 윷놀이: 규칙(game.js), 컴퓨터(ai.js), 3D 씬(scene.js), 저장(save.js)을 잇고 HUD·입력을 처리한다.
//
// 게임은 사건(drain)을 한꺼번에 내놓지만 화면에는 하나씩 보여 준다. 윷가락이 굴러 멎거나 말이 다 뛰어간 뒤에
// 다음 사건을 꺼내므로(present), 결과 알림과 HUD 는 화면의 움직임이 끝난 다음에 바뀐다.
// 사람은 그 사이에 아무것도 누를 수 없고, 컴퓨터도 화면이 멎은 뒤에 뜸을 들였다가 둔다.

import { YutGame, WAIT, PIECES_PER_TEAM } from './game.js';
import { chooseMove, LEVELS, LEVEL_IDS } from './ai.js';
import { SaveStore, browserStorage, PLAYER_COUNTS, SEATS } from './save.js';
import { YutScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle } from '../../shared/i18n.js';
import { segmented, createToast } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);

const RESULT_DELAY = 2.2; // 이긴 뒤 말이 빠져나가는 것을 보여 주고 결과 창을 띄우기까지(초)
const CPU_SHOW = 0.55; // 컴퓨터가 고른 수를 미리 보여 주는 시간(초)

document.title = t('title');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new YutScene($('stage'), new URL('../assets/', import.meta.url));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.4);

let settings = store.loadSettings();
let game = null;
let state = 'menu'; // menu | playing | done
let starter = 0; // 먼저 던지는 편. 한 판 더 하면 다음 편으로 넘어간다
let queue = []; // 아직 화면에 보여 주지 않은 사건
let dirty = false; // 사건을 다 보여 준 뒤 HUD 를 다시 그려야 하나
let selected = null; // 고른 결과
let focus = -1; // 미리 보기에서 강조한 방법(키보드·마우스)
let cpuTimer = null; // 컴퓨터가 두기까지 남은 시간
let cpuChoice = null; // 컴퓨터가 고른 수(미리 보여 주는 중)
let resultTimer = 0;
let speed = 1; // ?debug 에서 판을 빨리 돌릴 때

sound.enabled = settings.sound;
$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

const seatOf = (team) => settings.seats[team];
const isCpu = (team) => seatOf(team) === 'cpu';
const teamName = (team) => t(`team.${team}`);
const playerName = (team) => (isCpu(team) ? `${teamName(team)} (${t('cpuTag')})` : teamName(team));
const resultName = (result) => t(`result.${result}`);

// ---------- 메뉴 ----------

function renderMenu() {
  const pick = (patch) => {
    const before = settings;
    settings = { ...settings, ...patch };
    renderMenu();
    if (state === 'menu' && (before.players !== settings.players || before.backdo !== settings.backdo)) {
      showBackdrop();
    }
  };
  segmented(
    $('player-options'),
    PLAYER_COUNTS.map((players) => ({ value: players, label: t(`players.${players}`) })),
    settings.players,
    (players) => pick({ players }),
  );

  const seats = $('seat-options');
  seats.replaceChildren();
  for (let team = 0; team < settings.players; team++) {
    const row = document.createElement('div');
    row.className = 'seat';
    row.dataset.team = team;
    const name = document.createElement('span');
    name.className = 'seat-name';
    name.textContent = teamName(team);
    const options = document.createElement('div');
    options.className = 'segmented';
    segmented(
      options,
      SEATS.map((seat) => ({ value: seat, label: t(seat) })),
      seatOf(team),
      (seat) => {
        const next = [...settings.seats];
        next[team] = seat;
        pick({ seats: next });
      },
    );
    row.append(name, options);
    seats.append(row);
  }

  const active = settings.seats.slice(0, settings.players);
  const anyCpu = active.includes('cpu');
  const anyHuman = active.includes('human');
  $('level-field').hidden = !anyCpu;
  segmented(
    $('level-options'),
    LEVEL_IDS.map((level) => ({ value: level, label: t(`level.${level}`), detail: t(`level.${level}.detail`) })),
    settings.level,
    (level) => pick({ level }),
  );
  segmented(
    $('backdo-options'),
    [true, false].map((on) => ({
      value: on,
      label: t(`backdo.${on ? 'on' : 'off'}`),
      detail: t(`backdo.${on ? 'on' : 'off'}.detail`),
    })),
    settings.backdo,
    (backdo) => pick({ backdo }),
  );
  $('menu-record').textContent = anyCpu && anyHuman ? recordText(settings.level) : anyHuman ? t('hotseat') : '';
}

/** 메뉴 뒤에는 말이 모두 마구간에 선 빈 판을 보여 준다 */
function showBackdrop() {
  scene.setup(new YutGame({ players: settings.players, backdo: settings.backdo }), {
    labels: { start: t('startLabel') },
    backdo: settings.backdo,
  });
}

function recordText(level) {
  const record = store.loadRecord(level);
  return record ? t('record', { level: t(`level.${level}`), ...record }) : t('noRecord');
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function setState(next) {
  state = next;
  resultTimer = 0;
  const inGame = !!game && state !== 'menu';
  show('menu', state === 'menu');
  show('result', false);
  show('teams', inGame);
  show('controls', inGame);
  show('dock', state === 'playing');
  dirty = true;
  if (state === 'playing') $('stage').focus({ preventScroll: true });
  updateTurn();
  updateInsets();
}

function openMenu() {
  if (game) scene.finish();
  game = null;
  showBackdrop();
  queue = [];
  cpuTimer = null;
  cpuChoice = null;
  renderMenu();
  setState('menu');
  scene.setPreview(null);
  scene.setTurn(-1);
  $('btn-start').focus();
}

function newGame(first) {
  sound.unlock();
  starter = first;
  game = new YutGame({ players: settings.players, backdo: settings.backdo, first });
  scene.setup(game, { labels: { start: t('startLabel') }, backdo: settings.backdo });
  queue = [];
  selected = null;
  focus = -1;
  cpuTimer = null;
  cpuChoice = null;
  renderTeams();
  setState('playing');
  scene.setTurn(game.current);
  sound.play('turn');
  toast.show(t('turnOf', { name: playerName(game.current) }), `p${game.current}`);
}

function start() {
  store.saveSettings(settings);
  newGame(0);
}

/** 한 판 더: 먼저 던지는 편이 다음 편으로 넘어간다 */
function again() {
  newGame((starter + 1) % settings.players);
}

function finished(team) {
  const humans = settings.seats.slice(0, game.players).filter((seat) => seat === 'human').length;
  const cpus = game.players - humans;
  const won = !isCpu(team);
  $('result-title').textContent = t('wins', { name: playerName(team) });
  $('result-detail').textContent = t('resultTurns', { turns: game.turns + 1 });
  $('result').dataset.tone = `p${team}`;
  let line = '';
  if (humans && cpus) {
    store.recordResult(settings.level, won);
    line = recordText(settings.level);
  }
  $('result-record').textContent = line;
  sound.play(won || !cpus ? 'win' : 'lose');
  toast.show(t('wins', { name: playerName(team) }), `p${team}`);
  setState('done');
  scene.setPreview(null);
  resultTimer = RESULT_DELAY;
}

function showResult() {
  show('result', true);
  $('btn-next').focus();
}

// ---------- HUD ----------

/** 위쪽 편 카드: 이름과 말 네 개의 처지(기다림·판 위·남) */
function renderTeams() {
  const box = $('teams');
  box.replaceChildren();
  for (let team = 0; team < game.players; team++) {
    const card = document.createElement('div');
    card.className = 'team';
    card.id = `team-${team}`;
    card.dataset.team = team;
    card.innerHTML = `<span class="badge">${t('yourTurn')}</span><span class="name"></span><span class="pips"></span>`;
    card.querySelector('.name').textContent = teamName(team);
    if (isCpu(team)) {
      const tag = document.createElement('small');
      tag.className = 'cpu';
      tag.textContent = t('cpuTag');
      card.querySelector('.name').append(tag);
    }
    box.append(card);
  }
  updateTeams();
}

function updateTeams() {
  for (let team = 0; team < game.players; team++) {
    const card = $(`team-${team}`);
    if (!card) continue;
    const counts = game.counts(team);
    const pips = card.querySelector('.pips');
    const kinds = [
      ...Array(counts.home).fill('home'),
      ...Array(counts.board).fill('board'),
      ...Array(counts.wait).fill('wait'),
    ];
    pips.replaceChildren(
      ...kinds.slice(0, PIECES_PER_TEAM).map((kind) => {
        const pip = document.createElement('i');
        pip.className = kind;
        return pip;
      }),
    );
    card.title = t('pips', counts);
    card.classList.toggle('active', state === 'playing' && team === game.current);
  }
}

/** 지금 사람이 판을 만질 수 있나 */
function canAct() {
  return state === 'playing' && !!game && !queue.length && !scene.busy && !isCpu(game.current) && game.phase !== 'done';
}

/** 아래 칸: 쌓인 결과 칩과 던지기 단추 */
function renderDock() {
  const box = $('results');
  box.replaceChildren();
  const human = !isCpu(game.current);
  const moving = game.phase === 'move';
  if (moving && human && (!selected || !game.pending.includes(selected) || !game.canUse(selected))) {
    selected = game.pending.find((result) => game.canUse(result)) ?? null;
  }
  game.pending.forEach((result, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `result ${result}`;
    const usable = moving && game.canUse(result);
    chip.disabled = !human || !usable || state !== 'playing';
    // 같은 결과가 둘이면 첫째만 고른 것으로 표시한다
    chip.setAttribute('aria-pressed', String(moving && result === selected && game.pending.indexOf(result) === index));
    chip.innerHTML = `<b>${resultName(result)}</b><small>${t(`steps.${result}`)}</small>${human && moving ? `<kbd>${index + 1}</kbd>` : ''}`;
    chip.addEventListener('click', () => selectResult(result));
    box.append(chip);
  });
  const button = $('btn-throw');
  button.hidden = moving;
  button.disabled = !human || game.phase !== 'throw' || state !== 'playing';
}

/** 화면이 움직이는 동안 아래 칸을 잠근다(결과는 윷가락이 멎은 뒤에 보여 준다) */
function lockDock() {
  for (const button of $('dock').querySelectorAll('button')) button.disabled = true;
}

/** 미리 보기: 고른 결과로 옮길 수 있는 말과 갈 자리 */
function currentOptions() {
  if (!game || game.phase !== 'move' || !selected) return [];
  return game.options(selected);
}

function previewOptions(options) {
  return options.map((option) => {
    let label = '';
    let tone;
    if (option.capture.length) {
      label = t('label.capture');
      tone = 'capture';
    } else if (option.stack.length) label = t('label.stack');
    else if (option.home) label = t('label.home');
    return { ...option, label, tone };
  });
}

function updatePreview() {
  if (state !== 'playing' || !game || game.phase !== 'move') {
    scene.setPreview(null);
    return;
  }
  if (cpuChoice) {
    const options = game.options(cpuChoice.result);
    const index = options.findIndex((o) => o.from === cpuChoice.from);
    scene.setPreview({ team: game.current, focus: 0, options: previewOptions([options[index]]) });
    return;
  }
  if (isCpu(game.current)) {
    scene.setPreview(null);
    return;
  }
  const options = currentOptions();
  if (focus >= options.length) focus = -1;
  scene.setPreview({ team: game.current, focus: options.length === 1 ? 0 : focus, options: previewOptions(options) });
}

/** HUD 를 게임 상태에 맞춘다(사건을 다 보여 준 뒤) */
function refresh() {
  updateTeams();
  renderDock();
  updatePreview();
  updateTurn();
}

/** 누구 차례인지를 여러 곳에 한꺼번에 알린다: 편 카드, 안내 줄, 화면 가장자리 빛, 판의 마구간 */
function updateTurn() {
  const active = !!game && state === 'playing';
  const team = active ? game.current : -1;
  show('turn', active);
  show('glow', active);
  if (!active) return;
  const banner = $('turn');
  if (banner.dataset.team !== String(team)) {
    banner.classList.remove('swap');
    void banner.offsetWidth; // 애니메이션을 처음부터 다시
    banner.classList.add('swap');
  }
  banner.dataset.team = team;
  $('glow').dataset.team = team;
  $('turn-name').textContent = t('turnOf', { name: playerName(team) });
  let hint;
  if (isCpu(team)) hint = t('hintCpu');
  else if (game.phase === 'throw') hint = game.pending.length ? t('hintThrowAgain') : t('hintThrow');
  else if (selected) hint = t('hintMove', { result: resultName(selected), steps: t(`steps.${selected}`) });
  else hint = t('hintPick');
  $('turn-hint').textContent = hint;
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 판이 그 사이에 오도록 한다 */
function updateInsets() {
  const h = window.innerHeight;
  let top = $('top').getBoundingClientRect().bottom;
  // 편 카드가 두 줄로 늘어나도 안내 줄이 그 아래에 오게 한다
  $('turn').style.top = `${Math.round(top + 4)}px`;
  if (!$('turn').hidden) top = Math.max(top, $('turn').getBoundingClientRect().bottom);
  const bottom = $('dock').hidden ? 0 : h - $('dock').getBoundingClientRect().top;
  scene.setInsets({ top, bottom, left: 0, right: 0 });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('top'));
new ResizeObserver(updateInsets).observe($('dock'));

// ---------- 사건 ----------

function pull() {
  queue.push(...game.drain());
}

/** 사건 하나를 화면에 옮긴다. 움직임이 끝난 뒤에 보여 줄 것은 'landed'·'moved' 로 앞에 끼운다 */
function present(event) {
  switch (event.type) {
    case 'throw':
      scene.handle(event);
      queue.unshift({ ...event, type: 'landed' });
      break;
    case 'landed': {
      const name = resultName(event.result);
      if (event.bonus) {
        sound.play('bonus');
        toast.show(t('bonus', { result: name }), 'big');
      } else {
        if (event.result === 'backdo') sound.play('backdo');
        toast.show(t('thrown', { result: name }), `p${event.team}`);
      }
      dirty = true;
      break;
    }
    case 'move':
      scene.handle(event);
      queue.unshift({ ...event, type: 'moved' });
      break;
    case 'moved':
      if (event.capture.length) toast.show(t('captureAgain'), 'big');
      else if (event.stack.length) toast.show(t('stacked'), `p${event.team}`);
      else if (event.home) toast.show(t('homeToast'), `p${event.team}`);
      dirty = true;
      break;
    case 'discard':
      sound.play('backdo');
      toast.show(t('discard'), '');
      dirty = true;
      break;
    case 'turn':
      scene.handle(event);
      sound.play('turn');
      selected = null;
      focus = -1;
      toast.show(t('turnOf', { name: playerName(event.team) }), `p${event.team}`);
      dirty = true;
      break;
    case 'win':
      finished(event.team);
      break;
  }
}

scene.onSound = (name, { strength = 1, pan = 0 } = {}) => {
  if (name === 'clack') sound.clack(strength, pan);
  else if (name === 'whoosh') sound.whoosh(0.7 / speed);
  else sound.play(name, 1, { volume: strength, pan });
};

// ---------- 입력 ----------

function doThrow() {
  sound.unlock();
  if (!canAct() || game.phase !== 'throw') return;
  game.throw();
  pull();
  dirty = true;
  lockDock();
}

function doMove(result, from) {
  if (!game.move(result, from)) return false;
  focus = -1;
  scene.setPreview(null);
  pull();
  dirty = true;
  lockDock();
  return true;
}

function selectResult(result) {
  sound.unlock();
  if (!canAct() || game.phase !== 'move' || !game.canUse(result)) return;
  if (selected !== result) sound.play('select');
  selected = result;
  focus = -1;
  refresh();
}

/** 판에서 누른 것 → 옮길 방법. 그 자리의 말이거나, 그 자리로 갈 수 있는 말이 하나뿐이면 그 말 */
function optionAt(target, options) {
  if (target?.type === 'station') {
    return (
      options.find((o) => o.from === target.id) ??
      (options.filter((o) => o.to === target.id).length === 1 ? options.find((o) => o.to === target.id) : null)
    );
  }
  if (target?.type === 'stable' && target.team === game.current) return options.find((o) => o.from === WAIT) ?? null;
  return null;
}

scene.onPick = (target) => {
  sound.unlock();
  if (!canAct()) return;
  if (game.phase === 'throw') {
    if (target.type === 'mat') doThrow();
    return;
  }
  const option = optionAt(target, currentOptions());
  if (option) doMove(option.result, option.from);
};

scene.onHover = (target) => {
  if (!canAct() || game.phase !== 'move') return;
  const options = currentOptions();
  const option = optionAt(target, options);
  const index = option ? options.indexOf(option) : -1;
  if (index !== focus) {
    focus = index;
    updatePreview();
  }
  $('stage').style.cursor = option || (target?.type === 'mat' && game.phase === 'throw') ? 'pointer' : '';
};

function cycleFocus(delta) {
  const options = currentOptions();
  if (!options.length) return;
  focus = focus < 0 ? (delta > 0 ? 0 : options.length - 1) : (focus + delta + options.length) % options.length;
  updatePreview();
}

function cycleResult(delta) {
  const usable = [...new Set(game.pending)].filter((r) => game.canUse(r));
  if (!usable.length) return;
  const index = usable.indexOf(selected);
  selectResult(usable[(index + delta + usable.length) % usable.length]);
}

function moveFocused() {
  const options = currentOptions();
  const option = options[focus] ?? (options.length === 1 ? options[0] : null);
  if (option) doMove(option.result, option.from);
  else cycleFocus(1);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
  if (state === 'menu') {
    if (enter && !e.target.closest?.('button, summary')) {
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
  if (state === 'done') {
    if (enter) {
      e.preventDefault();
      again();
    }
    return;
  }
  // 아래 버튼에 포커스가 있으면 그 버튼이 눌리게 둔다
  const onButton = !!e.target.closest?.('button, a');
  if (!canAct()) {
    if (e.code === 'Space' && !onButton) e.preventDefault();
    return;
  }
  const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code);
  if (digit && game.phase === 'move') {
    const result = game.pending[Number(digit[2]) - 1];
    if (result) selectResult(result);
    return;
  }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault();
    cycleFocus(e.code === 'ArrowRight' ? 1 : -1);
    return;
  }
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    e.preventDefault();
    if (game.phase === 'move') cycleResult(e.code === 'ArrowDown' ? 1 : -1);
    return;
  }
  if ((e.code === 'Space' || enter) && !onButton) {
    e.preventDefault();
    if (e.repeat) return;
    if (game.phase === 'throw') doThrow();
    else moveFocused();
  }
});

function toggleSound() {
  sound.unlock();
  sound.enabled = !sound.enabled;
  settings = { ...settings, sound: sound.enabled };
  store.saveSettings({ ...store.loadSettings(), sound: sound.enabled });
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

$('btn-start').addEventListener('click', start);
$('btn-next').addEventListener('click', again);
$('btn-view').addEventListener('click', () => show('result', false));
$('btn-result-menu').addEventListener('click', openMenu);
$('btn-menu').addEventListener('click', openMenu);
$('btn-sound').addEventListener('click', toggleSound);
$('btn-throw').addEventListener('click', doThrow);

// ---------- 컴퓨터 ----------

/** 컴퓨터 차례면 뜸을 들인 뒤 던지거나, 고른 수를 잠깐 보여 주고 옮긴다 */
function driveCpu(dt) {
  if (!isCpu(game.current) || game.phase === 'done') {
    cpuTimer = null;
    return;
  }
  const level = LEVELS[settings.level] ?? LEVELS.normal;
  if (cpuTimer === null) cpuTimer = level.think;
  if ((cpuTimer -= dt * speed) > 0) return;
  cpuTimer = null;
  if (game.phase === 'throw') {
    game.throw();
    pull();
    dirty = true;
    lockDock();
    return;
  }
  if (cpuChoice) {
    const { result, from } = cpuChoice;
    cpuChoice = null;
    doMove(result, from);
    return;
  }
  cpuChoice = chooseMove(game, settings.level);
  if (!cpuChoice) return;
  selected = cpuChoice.result;
  renderDock();
  updatePreview();
  cpuTimer = CPU_SHOW;
}

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  toast.tick(dt);
  if (!game || state === 'menu') return;
  if (resultTimer > 0 && (resultTimer -= dt) <= 0) showResult();
  while (queue.length && !scene.busy && state !== 'menu') present(queue.shift());
  if (scene.busy || queue.length) return;
  if (dirty) {
    dirty = false;
    refresh();
  }
  if (state === 'playing') driveCpu(dt);
};

// ?debug 로 열면 콘솔에서 상태를 들여다보고, speed 로 판을 빨리 돌릴 수 있다
if (new URLSearchParams(location.search).has('debug')) {
  window.yut = {
    scene,
    store,
    get game() {
      return game;
    },
    get state() {
      return state;
    },
    get settings() {
      return settings;
    },
    set speed(value) {
      speed = value;
      scene.speed = value;
    },
    get speed() {
      return speed;
    },
    start,
    newGame,
    openMenu,
    doThrow,
    doMove,
    pick: (target) => scene.onPick(target),
    setSettings(patch) {
      settings = { ...settings, ...patch };
      renderMenu();
    },
  };
}

renderMenu();
try {
  await scene.load();
  $('loading').hidden = true;
  openMenu();
} catch (error) {
  console.error(error);
  if ($('loading').childElementCount === 0) $('loading').textContent = t('loadError'); // WebGL 안내가 떠 있으면 그대로 둔다
}
