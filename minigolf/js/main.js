// 미니 골프: 규칙(game.js)·코스(course.js)·물리(physics.js)와 3D 씬(scene.js)을 잇고, 점수판·조준·차례를 진행한다.
// 화면을 누르고 뒤로 당겼다 놓으면 당긴 반대쪽으로, 당긴 만큼 세게 친다. 키보드는 ←/→ 로 겨누고 Space 를 누르고 있다 뗀다.
// 혼자서 9홀 기록에 도전하거나, 2~4명이 한 기기로 홀마다 차례대로 친다.

import { GolfRound, PLAYER_OPTIONS, scoreName, formatToPar } from './game.js';
import { HOLES, COURSE_PAR } from './course.js';
import { Green, Putt, MIN_POWER, speedOfPower, angleOf, clamp } from './physics.js';
import { GolfScene, PLAYER_COLORS } from './scene.js';
import { SaveStore, browserStorage, CAMERAS, SETTINGS_KEY } from './save.js';
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

const DRAG_SLOP = 6; // 누른 자리에서 이만큼(픽셀) 넘게 움직여야 당기는 것으로 본다
const FIRE_SLOP = 14; // 이만큼(픽셀)은 당겨야 친다. 탭하다 손가락이 조금 밀린 것으로는 치지 않는다
const AIM_STEP = 0.03; // 키보드로 한 번에 돌리는 방향 (라디안). Shift 는 미세
const AIM_FINE = 0.005;
const CHARGE_TIME = 1.3; // Space 를 누르고 있으면 이 시간에 세기가 끝까지 찼다가 다시 내려온다 (초)
const INTRO_TIME = 1300; // 새 홀에서 홀 전체를 보여 주는 시간 (밀리초)
const SCORE_TONES = { ace: 'big', albatross: 'big', eagle: 'big', birdie: 'good', par: '', bogey: 'bad', double: 'bad', triple: 'bad', over: 'bad' };

document.title = t('pageTitle');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new GolfScene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.6);

let settings = store.loadSettings();
// 처음 여는 세로 화면(휴대폰)에서는 공이 작게 보이지 않도록 따라가기 시점으로 시작한다
if (store.read(SETTINGS_KEY) === null && window.innerWidth < window.innerHeight) settings = { ...settings, camera: 'follow' };
let round = null;
let green = null;
let state = 'menu'; // menu · aim(겨누는 중) · run(공이 구르는 중) · between(홀을 마친 점수표) · done
let session = 0; // 새 게임을 시작하거나 메뉴로 가면 늘어, 예전 진행 흐름을 멈춘다
let ball = { x: 0, z: 0 }; // 지금 치는 사람의 공 자리
let aim = null; // 겨누는 중 { angle, power, pull, resolve }
let drag = null; // 당기는 중 { pointerId, start, sx, sy, moved, far }
let charge = null; // Space 를 누르고 있는 중 { t }
let introTimer = 0;
let proceed = null; // 홀을 마친 점수표에서 [다음 홀] 을 누르면 부른다

$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

const solo = () => round?.players === 1;

/** 점수판·안내에 쓰는 이름. 혼자서는 '나', 여럿이는 1P ~ 4P */
function nameOf(player) {
  return solo() ? t('me') : t('playerN', { n: player + 1 });
}

const colorOf = (player) => (solo() ? null : PLAYER_COLORS[player]);

// ---------- 메뉴 ----------

function renderMenu() {
  segmented(
    $('player-options'),
    PLAYER_OPTIONS.map((value) => ({
      value,
      label: value === 1 ? t('players.solo') : t('players.n', { n: value }),
      detail: value === 1 ? t('players.solo.detail') : t('players.multi.detail'),
    })),
    settings.players,
    (players) => {
      settings = { ...settings, players };
      renderMenu();
    },
  );
  $('menu-record').textContent = settings.players === 1 ? recordText() : t('multiHint');
}

function recordText() {
  const record = store.loadRecord();
  if (record.total === null) return t('noRecord', { par: COURSE_PAR });
  return t('bestRound', { total: record.total, toPar: formatToPar(record.total - COURSE_PAR) });
}

function openMenu() {
  session++;
  proceed = null;
  cancelAim();
  round = null;
  state = 'menu';
  sound.setRoll(0);
  clearTimeout(introTimer);
  // 메뉴 뒤에는 첫 홀을 보여 준다
  green = new Green(HOLES[0]);
  scene.setHole(green);
  scene.setCameraMode('overview');
  scene.hideBall();
  renderMenu();
  show('menu', true);
  show('result', false);
  show('scorecard', false);
  updateChrome();
  focusForKeyboard($('btn-start'));
}

function start() {
  sound.unlock();
  store.saveSettings(settings);
  newGame();
}

function newGame() {
  session++;
  proceed = null;
  cancelAim();
  round = new GolfRound({ players: settings.players });
  show('menu', false);
  show('result', false);
  show('scorecard', false);
  play(session);
}

// ---------- 점수판·차례 ----------

function updateHud() {
  if (!round) return;
  const player = round.current;
  $('hole-label').textContent = t('holeOf', { n: round.holeIndex + 1, total: round.holes.length });
  $('par-label').textContent = t('parOf', { par: round.par });
  $('stroke-count').textContent = String(round.strokes);
  $('stroke-max').textContent = t('maxOf', { max: round.max });
  $('stroke-stat').classList.toggle('warn', round.strokes >= round.max - 1);
  const played = round.played(player);
  $('total-label').textContent = played ? formatToPar(round.toPar(player)) : '–';
  $('total-stat').title = t('totalTitle', { total: round.total(player) });
}

/** 점수판·세기 막대·화면 테두리를 지금 상태에 맞춘다 */
function updateChrome() {
  const playing = !!round && state !== 'menu';
  show('hud', playing);
  show('controls', playing);
  show('bar', playing);
  const active = playing && (state === 'aim' || state === 'run');
  const multi = playing && !solo();
  show('glow', active && multi);
  if (round) $('glow').dataset.player = round.current;
  if (!active) show('turn', false);
  $('btn-camera').textContent = t(`camera.${settings.camera}`);
  setPower(0);
  updateInsets();
}

/** 차례 안내 줄: 누구 차례(여럿이)·몇 타째와 할 일 */
function updateTurn(hint = '') {
  if (!round || (state !== 'aim' && state !== 'run')) return show('turn', false);
  const banner = $('turn');
  const player = round.current;
  show('turn', true);
  const key = `${round.holeIndex}:${player}`;
  if (banner.dataset.key !== key) {
    banner.classList.remove('swap');
    void banner.offsetWidth; // 애니메이션을 처음부터 다시
    banner.classList.add('swap');
  }
  banner.dataset.key = key;
  banner.dataset.player = solo() ? '' : player;
  // 겨누는 중에는 칠 타수, 구르는 중에는 친 타수
  const shot = t('shotNth', { n: state === 'run' ? round.strokes : Math.min(round.strokes + 1, round.max) });
  $('turn-name').textContent = solo() ? shot : `${t('turnOf', { name: nameOf(player) })} · ${shot}`;
  $('turn-hint').textContent = hint;
  updateInsets();
}

function setPower(power) {
  $('power-fill').style.width = `${Math.round(power * 100)}%`;
  $('power').setAttribute('aria-valuenow', String(Math.round(power * 100)));
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 코스가 그 사이에 오도록 한다 */
function updateInsets() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let top = $('top').getBoundingClientRect().bottom;
  // 차례 안내 줄은 위쪽 막대 바로 밑에 (좁은 화면에서 막대가 여러 줄이 되어도 겹치지 않게)
  $('turn').style.top = `${Math.round(top + 4)}px`;
  const playing = !!round && state !== 'menu';
  // 차례 안내 줄 자리는 화면이 차례마다 들썩이지 않도록 놀이 중에는 늘 비워 둔다
  if (playing) top = Math.max(top, $('turn').hidden ? top + 34 : $('turn').getBoundingClientRect().bottom);
  // 세기 막대가 코스 아래에 오면 그만큼 비운다. 낮은 가로 화면에서는 오른쪽 구석으로 비켜 있어 비우지 않는다
  const pill = $('power').getBoundingClientRect();
  const under = !$('bar').hidden && pill.left < w * 0.62 && pill.right > w * 0.38;
  const bottom = under ? h - pill.top + 6 : 8;
  scene.setInsets({ top: top + 6, bottom: bottom + 4, left: 8, right: 8 });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('top'));
new ResizeObserver(updateInsets).observe($('bar'));

// ---------- 스코어카드 ----------

/** 스코어카드 표를 그린다. current 는 강조할 홀 번호 */
function renderTable(table, current = -1) {
  const holes = round.holes;
  const rows = [];
  const cell = (text, className = '', title = '') =>
    `<td class="${className}"${title ? ` title="${title}"` : ''}>${text}</td>`;
  const head = holes.map((_, i) => `<th class="${i === current ? 'now' : ''}">${i + 1}</th>`).join('');
  rows.push(`<thead><tr><th class="name">${t('hole')}</th>${head}<th>${t('total')}</th></tr></thead>`);
  const pars = holes.map((hole, i) => cell(hole.par, i === current ? 'now' : '')).join('');
  rows.push(`<tbody><tr class="par"><th class="name">${t('par')}</th>${pars}${cell(COURSE_PAR)}</tr>`);
  for (let p = 0; p < round.players; p++) {
    const scores = round.scores[p]
      .map((s, i) => {
        const now = i === current ? ' now' : '';
        if (s === null) return cell('', now.trim());
        const name = scoreName(s, holes[i].par);
        const water = round.penalties[p][i] ? ` (${t('penaltyShort', { n: round.penalties[p][i] })})` : '';
        return cell(`<span>${s}</span>`, `s-${name}${now}`, `${t(`score.${name}`)}${water}`);
      })
      .join('');
    const played = round.played(p);
    const total = played ? `${round.total(p)} <small>${formatToPar(round.toPar(p))}</small>` : '–';
    const dot = solo() ? '' : `<i class="dot" style="--color: ${PLAYER_COLORS[p]}"></i>`;
    rows.push(`<tr><th class="name">${dot}${nameOf(p)}</th>${scores}${cell(total, 'sum')}</tr>`);
  }
  if (solo()) {
    const record = store.loadRecord();
    const bests = record.holes.map((b, i) => cell(b ?? '', i === current ? 'now best' : 'best')).join('');
    rows.push(`<tr class="best"><th class="name">${t('bestRow')}</th>${bests}${cell(record.total ?? '', 'best')}</tr>`);
  }
  rows.push('</tbody>');
  table.innerHTML = rows.join('');
}

/** 놀이 중에 스코어카드를 펼친다 (닫으면 하던 것을 잇는다) */
function openCard() {
  if (!round || state === 'between' || state === 'done') return;
  cancelDrag();
  $('card-title').textContent = t('card');
  $('card-detail').textContent = t('cardDetail', { n: round.holeIndex + 1, par: round.par });
  renderTable($('card-table'), round.holeIndex);
  $('card-legend').textContent = t('legend');
  show('btn-next', false);
  show('btn-card-close', true);
  show('scorecard', true);
  focusForKeyboard($('btn-card-close'));
}

function closeCard() {
  if (state === 'between') return;
  show('scorecard', false);
}

// ---------- 사람의 샷 ----------

function playerShot() {
  return new Promise((resolve) => {
    const cup = green.cup;
    aim = { angle: angleOf(cup.x - ball.x, cup.z - ball.z), power: 0, pull: 0, resolve };
    charge = null;
    showAim();
    updateTurn(t('hintDrag'));
  });
}

function showAim() {
  if (!aim) return;
  scene.setAim({ angle: aim.angle, power: aim.power, pull: aim.pull });
  setPower(aim.power);
}

function fire() {
  if (!aim || aim.power < MIN_POWER) return;
  const { resolve, angle, power } = aim;
  aim = null;
  drag = null;
  charge = null;
  resolve({ angle, speed: speedOfPower(power), power });
}

function cancelAim() {
  aim = null;
  drag = null;
  charge = null;
}

/** 당기던 것을 놓은 것으로 본다 (치지 않는다) */
function cancelDrag() {
  drag = null;
  charge = null;
  if (!aim) return;
  aim.power = 0;
  aim.pull = 0;
  showAim();
}

// ---------- 입력 ----------

/** 끝까지 당긴 것으로 보는 화면 거리 (픽셀) */
const pullPixels = () => clamp(Math.min(window.innerWidth, window.innerHeight) * 0.38, 120, 240);

scene.onPointer = (type, event) => {
  if (type === 'pointerdown') sound.unlock();
  // 결과 창을 닫고 코스를 보던 중이면 다시 띄운다
  if (type === 'pointerup' && state === 'done' && $('result').hidden) {
    show('result', true);
    return;
  }
  if (state !== 'aim' || !aim || charge) return;
  const canvas = scene.renderer.domElement;
  if (type === 'pointerdown') {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
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
    aim.power = clamp(screen / pullPixels(), 0, 1);
    aim.pull = 0.04 + aim.power * 0.3;
    if (Math.hypot(dx, dz) > 1e-4) aim.angle = angleOf(-dx, -dz);
    showAim();
    return;
  }
  // 놓았다: 충분히 당겼으면 치고, 아니면 그대로 둔다
  const { moved, far } = drag;
  drag = null;
  if (type === 'pointerup' && moved && far && aim.power >= MIN_POWER) return fire();
  aim.power = 0;
  aim.pull = 0;
  showAim();
  updateTurn(t('hintDrag'));
};

// 브라우저는 사용자 입력이 있어야 소리를 내게 해 준다
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sound.unlock(), true);

// 창을 벗어나면 당기던 것을 놓은 것으로 본다 (치지 않는다)
window.addEventListener('blur', () => {
  if (drag || charge) cancelDrag();
});

function toggleSound() {
  sound.unlock();
  sound.setEnabled(!sound.enabled);
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

function toggleCamera() {
  const camera = CAMERAS[(CAMERAS.indexOf(settings.camera) + 1) % CAMERAS.length];
  settings = { ...settings, camera };
  store.saveSettings(settings);
  clearTimeout(introTimer);
  scene.setCameraMode(camera);
  $('btn-camera').textContent = t(`camera.${camera}`);
}

for (const [id, action] of [
  ['btn-sound', toggleSound],
  ['btn-camera', toggleCamera],
  ['btn-card', openCard],
]) {
  $(id).addEventListener('click', (event) => {
    action();
    event.currentTarget.blur(); // 스페이스로 칠 때 버튼이 다시 눌리지 않게
  });
}

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const enter = event.key === 'Enter';
  const onButton = event.target.closest?.('button, a, summary');
  if (!$('menu').hidden) {
    if (enter && !onButton) {
      event.preventDefault();
      start();
    }
    return;
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === 'm') return toggleSound();
  if (!$('scorecard').hidden) {
    if (state === 'between' && enter && !onButton) {
      event.preventDefault();
      proceed?.();
    } else if (state === 'between' && key === 'Escape') openMenu();
    else if (state !== 'between' && (key === 'Escape' || key === 's')) closeCard();
    return;
  }
  if (key === 'Escape') {
    if (drag || charge) return cancelDrag();
    if (round) return openMenu();
    return;
  }
  if (state === 'done') {
    if (enter && !$('result').hidden && !onButton) {
      event.preventDefault();
      newGame();
    }
    return;
  }
  if (key === 'c') return toggleCamera();
  if (key === 's') return openCard();
  if (state !== 'aim' || !aim || drag) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const step = event.shiftKey ? AIM_FINE : AIM_STEP;
    aim.angle += event.key === 'ArrowLeft' ? -step : step;
    if (!charge) aim.pull = 0;
    showAim();
    if (!charge) updateTurn(t('hintKeys'));
    return;
  }
  if (event.key === ' ' && !onButton) {
    event.preventDefault();
    if (event.repeat || charge) return;
    charge = { t: 0 };
    aim.pull = 0;
    updateTurn(t('hintCharge'));
  }
});

document.addEventListener('keyup', (event) => {
  if (event.key !== ' ' || !charge || !aim) return;
  event.preventDefault();
  charge = null;
  if (aim.power >= MIN_POWER) fire();
  else updateTurn(t('hintKeys'));
});

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  if (state !== 'run') sound.setRoll(0);
  if (!charge || !aim) return false;
  // 세기가 0 → 1 → 0 으로 오르내린다
  charge.t += dt / CHARGE_TIME;
  const phase = charge.t % 2;
  aim.power = phase < 1 ? phase : 2 - phase;
  showAim();
  return true;
};

scene.onEvent = (event) => {
  if (event.type === 'wall') sound.hit(event.speed, event.kind);
  else if (event.type === 'lip') sound.lip(event.depth);
  else if (event.type === 'cup') sound.play('cup');
  else if (event.type === 'water') sound.splash();
};

// ---------- 진행 ----------

async function play(token) {
  while (token === session && !round.over) {
    await playHole(token);
    if (token !== session) return;
    const next = await holeSummary(token);
    if (token !== session || !next) return;
    round.nextHole();
  }
  if (token === session) endRound();
}

/** 한 홀: 모두 차례대로 홀아웃할 때까지 */
async function playHole(token) {
  green = new Green(round.hole);
  scene.setHole(green);
  // 새 홀은 잠깐 홀 전체를 보여 준 뒤 고른 시점으로
  scene.setCameraMode('overview');
  clearTimeout(introTimer);
  if (settings.camera !== 'overview') introTimer = setTimeout(() => scene.setCameraMode(settings.camera), INTRO_TIME);
  for (;;) {
    await playTurn(token);
    if (token !== session) return;
    if (round.nextPlayer().holeDone) return;
  }
}

/** 한 사람이 홀아웃(또는 최대 타수)할 때까지 */
async function playTurn(token) {
  const player = round.current;
  ball = { ...green.tee };
  scene.setBall(ball, colorOf(player));
  if (!solo()) {
    if (round.holeIndex > 0 || round.turn > 0) sound.play('turn');
    toast.show(t('turnOf', { name: nameOf(player) }), `p${player}`);
  }
  for (;;) {
    state = 'aim';
    updateChrome();
    updateHud();
    const shot = await playerShot();
    if (token !== session || !shot) return;

    state = 'run';
    round.stroke();
    updateHud();
    updateTurn('');
    setPower(shot.power);
    sound.putt(shot.power);
    const from = { ...ball };
    const putt = new Putt(green, from, scene.clock).strike(shot);
    const rolling = trackRoll(putt, token);
    await scene.run(putt);
    rolling.stop();
    if (token !== session) return;
    setPower(0);

    let result = putt.result;
    if (result === 'water') {
      toast.show(t('water'), 'bad');
      ball = from;
    } else if (result === 'out') {
      toast.show(t('outOfBounds'), 'bad');
      ball = from;
      result = 'stopped';
    } else if (result === 'stopped') {
      const spot = green.clearSpot(putt.ball.x, putt.ball.z);
      ball = { x: spot.x, z: spot.z };
      if (spot.moved) toast.show(t('moved'));
    }
    const r = round.shotResult(result);
    updateHud();
    if (r.done) {
      await finishTurn(player, r, token);
      return;
    }
    if (result === 'water') await sleep(500);
    if (token !== session) return;
    scene.setBall(ball, colorOf(player));
  }
}

/** 공이 구르는 동안 구르는 소리를 속도에 맞춘다 */
function trackRoll(putt, token) {
  let id = 0;
  const tick = () => {
    if (token !== session) return sound.setRoll(0);
    const sand = green.inSand(putt.ball.x, putt.ball.z);
    sound.setRoll(putt.moving && !putt.overCup ? putt.speed : 0, sand);
    id = setTimeout(tick, 50);
  };
  tick();
  return {
    stop() {
      clearTimeout(id);
      sound.setRoll(0);
    },
  };
}

/** 한 사람이 홀을 마쳤다: 점수 이름을 알리고 혼자서면 홀 기록을 남긴다 */
async function finishTurn(player, { holed, picked, strokes }, token) {
  const name = scoreName(strokes, round.par);
  if (holed) {
    toast.show(t(`score.${name}`), SCORE_TONES[name] || (solo() ? '' : `p${player}`));
    if (name === 'ace' || name === 'albatross' || name === 'eagle') {
      sound.play('cheer');
      sound.play('birdie');
    } else if (name === 'birdie') sound.play('birdie');
  } else if (picked) {
    scene.hideBall();
    toast.show(t('pickedUp', { max: round.max }), 'bad');
  }
  if (solo() && store.recordHole(round.holeIndex, strokes) && holed) {
    await sleep(1200);
    if (token !== session) return;
    toast.show(t('holeRecord'), 'big');
  }
  await sleep(1400);
}

/** 모두 홀을 마친 뒤의 점수표. 다음 홀(또는 결과)로 가면 true */
function holeSummary(token) {
  state = 'between';
  updateChrome();
  const index = round.holeIndex;
  const last = index + 1 >= round.holes.length;
  $('card-title').textContent = t('holeDone', { n: index + 1 });
  if (solo()) {
    const s = round.scores[0][index];
    $('card-detail').textContent = t('holeDetailSolo', { score: t(`score.${scoreName(s, round.par)}`), strokes: s, par: round.par });
  } else {
    const order = [...Array(round.players).keys()].sort((a, b) => round.scores[a][index] - round.scores[b][index]);
    $('card-detail').textContent = last ? '' : t('honor', { name: nameOf(order[0]) });
  }
  renderTable($('card-table'), index);
  $('card-legend').textContent = t('legend');
  $('btn-next-label').textContent = t(last ? 'seeResult' : 'nextHole', { n: index + 2 });
  show('btn-next', true);
  show('btn-card-close', false);
  show('scorecard', true);
  focusForKeyboard($('btn-next'));
  return new Promise((resolve) => {
    proceed = () => {
      proceed = null;
      show('scorecard', false);
      resolve(token === session);
    };
  });
}

function endRound() {
  state = 'done';
  scene.hideBall();
  updateChrome();
  const totals = round.scores.map((_, p) => round.total(p));
  let record = '';
  if (solo()) {
    const total = totals[0];
    const best = store.recordRound(total);
    $('result-title').textContent = t('finished');
    $('result-detail').textContent = t('finalSolo', { total, toPar: formatToPar(total - COURSE_PAR), par: COURSE_PAR });
    record = best ? t('newRecord') : recordText();
    $('result').dataset.tone = best ? 'win' : '';
    sound.play('win');
    if (best) sound.play('cheer');
  } else {
    const leaders = round.leaders();
    $('result-title').textContent =
      leaders.length === 1 ? t('winner', { name: nameOf(leaders[0]) }) : t('tie', { names: leaders.map(nameOf).join(', ') });
    const ranks = round.ranks();
    const order = [...Array(round.players).keys()].sort((a, b) => ranks[a] - ranks[b]);
    $('result-detail').textContent = order
      .map((p) => t('rankLine', { rank: ranks[p], name: nameOf(p), total: totals[p], toPar: formatToPar(round.toPar(p)) }))
      .join('\n');
    $('result').dataset.tone = leaders.length === 1 ? `p${leaders[0]}` : '';
    sound.play('win');
  }
  $('result-record').textContent = record;
  renderTable($('result-table'));
  show('result', true);
  focusForKeyboard($('btn-again'));
}

$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', newGame);
$('btn-view').addEventListener('click', () => show('result', false));
$('btn-result-menu').addEventListener('click', openMenu);
$('btn-card-close').addEventListener('click', closeCard);
$('btn-next').addEventListener('click', () => proceed?.());
$('btn-menu').addEventListener('click', (event) => {
  event.currentTarget.blur();
  openMenu();
});

// ?debug 로 열면 콘솔에서 씬과 진행 상태를 들여다보고, 겨누는 중에 shoot({ angle, power }) 으로 대신 칠 수 있다
if (params.has('debug')) {
  window.minigolf = {
    scene,
    sound,
    store,
    get round() {
      return round;
    },
    get green() {
      return green;
    },
    get state() {
      return state;
    },
    get ball() {
      return ball;
    },
    shoot({ angle, power }) {
      if (!aim) return false;
      aim.angle = angle ?? aim.angle;
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
