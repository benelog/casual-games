// 당구: 규칙(game.js)·물리(physics.js)·컴퓨터(ai.js)와 3D 씬(scene.js)을 잇고, HUD 와 조준 입력을 처리한다.
// 종목은 시작 화면에서 고르거나 ?game=fourball | threecushion | eightball 로 미리 고른다.
//
// 조준: 당구대를 누르면 그곳을 겨누고, 끌면 수구를 중심으로 천천히 돈다(큐 시점에서는 좌우로 끈다).
// 세기: 오른쪽 막대를 아래로 당긴 만큼 세지고, 놓으면 친다. 회전: 왼쪽 아래 공에서 큐 끝이 닿을 자리를 고른다.
// 볼 인 핸드(포켓볼 파울 뒤)에는 수구를 끌어 옮긴다.

import { BilliardsGame } from './game.js';
import { VARIANTS, VARIANT_IDS, LEVEL_IDS } from './variants.js';
import { Simulation } from './physics.js';
import { think, perturb, LEVELS } from './ai.js';
import { shortGuide, longGuide } from './guide.js';
import { groupOf, legalFirst } from './rules.js';
import { BilliardsScene } from './scene.js';
import { Sound } from './sound.js';
import { SaveStore, browserStorage, OPPONENTS, GUIDES } from './save.js';
import { t } from './i18n.js';
import { applyI18n, mountLangToggle } from '../../shared/i18n.js';
import { segmented, createToast, focusForKeyboard } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const MIN_SPEED = 0.15;
const KEY_TURN = (0.5 * Math.PI) / 180; // ←/→ 한 번에 도는 각도
const FINE_TURN = (0.05 * Math.PI) / 180; // Shift 를 누르면
const DRAG_SLOP = 7; // 이만큼(px) 넘게 움직이면 탭이 아니라 끌기
const POOL_GROUP_COLOR = { solid: '#d4251c', stripe: '#1d4fbf' };

document.title = t('title');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new BilliardsScene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const toast = createToast($('toast'), 1.6);

let settings = store.loadSettings();
if (VARIANT_IDS.includes(params.get('game'))) settings.variant = params.get('game');
sound.enabled = settings.sound;
$('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

let game = null;
let match = null; // 경기를 시작할 때의 { variant, opponent, level }
let state = 'idle'; // idle(불러오는 중) | menu | aim | cpu | roll | wait | done
let starter = 0; // 먼저 치는 사람. 한 판 더 하면 바뀐다
const aim = { angle: 0, power: 0, keyPower: 0.45, side: 0, vert: 0 };
let pull = null; // 세기 막대를 당기는 중 { id, y0 }
let drag = null; // 당구대를 누른 채 움직이는 중
let cpu = null; // 컴퓨터 차례의 진행
let timers = []; // 프레임으로 재는 지연 [{ t, fn }]
let guideDirty = false;
let guideAt = 0;
let hold = null; // ◀ ▶ 를 누르고 있는 중 { dir, t }

const variant = () => VARIANTS[match?.variant ?? settings.variant];
const isCpu = (player) => match?.opponent === 'cpu' && player === 1;
const nameOf = (player) => {
  if (match?.opponent === 'cpu') return t(player === 0 ? 'me' : 'computer');
  return t('player', { n: player + 1 });
};
const speedOf = (power) => MIN_SPEED + power * (variant().maxSpeed - MIN_SPEED);
const powerOf = (speed) => Math.min(1, Math.max(0, (speed - MIN_SPEED) / (variant().maxSpeed - MIN_SPEED)));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (k) => k * k * (3 - 2 * k);

function after(seconds, fn) {
  timers.push({ t: seconds, fn });
}

function show(id, visible) {
  $(id).hidden = !visible;
}

// ---------- 메뉴 ----------

function setUrl(id) {
  const next = new URLSearchParams(location.search);
  next.set('game', id);
  history.replaceState(null, '', `?${next}`);
}

function renderMenu() {
  const v = VARIANTS[settings.variant];
  segmented(
    $('variant-options'),
    VARIANT_IDS.map((id) => ({ value: id, label: t(`variant.${id}`), detail: t(`variant.${id}.detail`) })),
    settings.variant,
    (id) => {
      settings = { ...settings, variant: id };
      setUrl(id);
      renderMenu();
    },
  );
  $('variant-lead').textContent = t(`variant.${v.id}.lead`);
  $('help-rules').textContent = t(`rules.${v.id}`);
  segmented(
    $('opponent-options'),
    OPPONENTS.map((id) => ({ value: id, label: t(`opponent.${id}`), detail: t(`opponent.${id}.detail`) })),
    settings.opponent,
    (opponent) => {
      settings = { ...settings, opponent };
      renderMenu();
    },
  );
  show('level-field', settings.opponent === 'cpu');
  segmented(
    $('level-options'),
    LEVEL_IDS.map((id) => ({ value: id, label: t(`level.${id}`) })),
    settings.level,
    (level) => {
      settings = { ...settings, level };
      renderMenu();
    },
  );
  const pool = v.kind === 'pool';
  $('target-legend').textContent = t(pool ? 'raceLegend' : 'targetLegend');
  segmented(
    $('target-options'),
    v.targets.map((n) => ({
      value: n,
      label: t(pool ? 'racks' : 'points', { n }),
      detail: pool ? t('raceDetail', { n }) : v.id === 'fourball' ? t('dama', { n: n * 10 }) : '',
    })),
    settings.targets[v.id],
    (n) => {
      settings = { ...settings, targets: { ...settings.targets, [v.id]: n } };
      renderMenu();
    },
  );
  segmented(
    $('guide-options'),
    GUIDES.map((id) => ({ value: id, label: t(`guide.${id}`), detail: t(`guide.${id}.detail`) })),
    settings.guide,
    (guide) => {
      settings = { ...settings, guide };
      renderMenu();
    },
  );
  if (settings.opponent === 'cpu') {
    const record = store.loadRecord(v.id, settings.level);
    $('menu-record').textContent = record ? t('record', { ...record, level: t(`level.${settings.level}`) }) : t('noRecord');
  } else $('menu-record').textContent = t('friendHint');
  // 메뉴 뒤에는 고른 종목의 당구대를 보여 준다
  if (!game || state === 'menu') {
    scene.setVariant(v);
    if (!game || game.variant !== v) {
      const preview = new BilliardsGame({ variant: v.id });
      scene.setBalls(preview.balls);
    }
  }
}

function openMenu() {
  sound.unlock();
  if (state === 'menu') return;
  // 구르는 중이면 끝까지 돌려 결과를 먼저 반영한다 (그 뒤의 진행은 메뉴를 닫을 때까지 멈춘다)
  if (state === 'roll') scene.finishNow();
  const inGame = !!game && !game.over;
  if (inGame) $('menu').dataset.from = state;
  else delete $('menu').dataset.from;
  show('btn-resume', inGame);
  cancelInput();
  state = 'menu';
  show('menu', true);
  show('result', false);
  updateChrome();
  renderMenu();
  focusForKeyboard($('btn-start'));
}

function resume() {
  const from = $('menu').dataset.from;
  if (!game || game.over || !from) return start();
  show('menu', false);
  delete $('menu').dataset.from;
  // 메뉴를 열기 전에 하던 것을 이어 간다
  scene.setVariant(game.variant);
  scene.setBalls(game.balls);
  if (from === 'aim') {
    state = 'aim';
    updateChrome();
    updateTurn(game.ballInHand ? 'hintHand' : 'hintAim');
    showAim();
  } else if (from === 'cpu') prepareTurn();
  else {
    // 샷 결과를 보여 주던 중: 멈춰 둔 다음 진행(타이머)을 이어 간다
    state = 'wait';
    updateChrome();
    updateTurn('');
    if (!timers.length) prepareTurn();
  }
}

function start() {
  sound.unlock();
  store.saveSettings(settings);
  starter = 0;
  newGame();
}

function newGame() {
  match = { variant: settings.variant, opponent: settings.opponent, level: settings.level };
  timers = [];
  game = new BilliardsGame({ variant: match.variant, target: settings.targets[match.variant], first: starter });
  scene.setVariant(game.variant);
  scene.setCamera(settings.camera);
  scene.setBalls(game.balls);
  show('menu', false);
  show('result', false);
  delete $('menu').dataset.from;
  $('goal').textContent = game.pool ? t('raceGoal', { n: game.target }) : t('pointsGoal', { n: game.target });
  for (const p of [0, 1]) $(`player-${p}`).querySelector('.name').textContent = nameOf(p);
  prepareTurn();
  toast.show(t('turnOf', { name: nameOf(game.current) }), `p${game.current}`);
}

/** 한 판 더: 먼저 치는 사람을 바꾼다 */
function again() {
  starter = 1 - starter;
  newGame();
}

// ---------- 차례 ----------

/** 수구에서 가장 가까운, 먼저 맞혀도 되는 공 쪽 */
function defaultAngle() {
  const cue = game.balls[game.cue];
  let targets;
  if (game.pool) {
    const onTable = game.onTable();
    const group = game.groups[game.current];
    targets = onTable.filter((n) => legalFirst(n, { group, isBreak: game.isBreak, onTable }));
  } else targets = game.variant.id === 'fourball' ? [2, 3] : [2, 1 - game.cue];
  let best = null;
  for (const id of targets) {
    const b = game.balls[id];
    if (!b.on) continue;
    const d = Math.hypot(b.x - cue.x, b.y - cue.y);
    if (!best || d < best.d) best = { d, angle: Math.atan2(b.y - cue.y, b.x - cue.x) };
  }
  return best ? best.angle : aim.angle;
}

function prepareTurn() {
  if (!game || game.over) return;
  const player = game.current;
  const human = !isCpu(player);
  state = human ? 'aim' : 'cpu';
  aim.side = 0;
  aim.vert = 0;
  aim.power = 0;
  aim.angle = defaultAngle();
  scene.setBalls(game.balls);
  updateSpin();
  updatePower();
  updateHud();
  updateChrome();
  showAim();
  if (human) {
    updateTurn(game.ballInHand ? (game.isBreak ? 'hintBreakHand' : 'hintHand') : 'hintAim');
    guideDirty = true;
  } else {
    scene.setGuide(null);
    updateTurn('hintThinking');
    cpu = { thinking: think(game, LEVELS[match.level], Math.random), elapsed: 0, plan: null, phase: 'think', t: 0 };
  }
}

function showAim() {
  scene.setAim({ cue: game.cue, angle: aim.angle, power: aim.power, side: aim.side, vert: aim.vert, visible: true });
  scene.setPlacement(state === 'aim' && game.ballInHand ? { ...game.balls[game.cue], valid: true } : null);
  guideDirty = true;
}

/** 지금 조준한 샷 */
function currentShot(power = aim.power || aim.keyPower) {
  return { angle: aim.angle, speed: speedOf(power), side: aim.side, vert: aim.vert };
}

function updateGuide() {
  guideDirty = false;
  if (state !== 'aim') return scene.setGuide(null);
  const v = game.variant;
  const balls = game.layout();
  let guide;
  if (settings.guide === 'long') {
    const options =
      v.kind === 'pool'
        ? { balls: 1, after: 0.35, length: 3.5, objectLength: 0.5 }
        : { balls: 2, length: v.id === 'threecushion' ? 9 : 4, objectLength: 0.3 };
    guide = longGuide(game.table, balls, game.cue, currentShot(), options);
  } else guide = shortGuide(game.table, balls, game.cue, aim.angle);
  scene.setGuide(guide);
}

/** 사람이 친다 */
function shoot(power) {
  if (state !== 'aim' || power < 0.02) return;
  aim.power = power;
  fire(currentShot(power));
}

function fire(shot) {
  cancelInput();
  state = 'roll';
  const sim = new Simulation(game.table, game.layout());
  sim.strike(game.cue, shot);
  scene.setAim({ cue: game.cue, angle: shot.angle, power: powerOf(shot.speed), side: shot.side, vert: shot.vert, visible: true });
  scene.shoot(sim);
  cushionCount = 0;
  updateChrome();
  updateTurn('hintRoll');
}

let cushionCount = 0;

scene.onEvents = (events) => {
  const sim = scene.sim;
  const half = game.table.length / 2;
  for (const e of events) {
    const id = e.ball ?? e.a ?? 0;
    const b = sim?.balls[id];
    const pan = b ? Math.max(-1, Math.min(1, b.x / half)) * 0.6 : 0;
    sound.impact(e.type, e.speed, pan);
    // 3쿠션은 수구가 쿠션에 닿은 횟수를 세어 보여 준다
    if (game.variant.id === 'threecushion' && e.type === 'cushion' && e.ball === game.cue) {
      cushionCount++;
      $('turn-hint').textContent = t('cushions', { n: cushionCount });
    }
  }
};

scene.onShotEnd = (sim) => {
  if (state !== 'roll') return;
  const outcome = game.applyShot({ events: sim.events, balls: sim.snapshot() });
  state = 'wait';
  scene.setBalls(game.balls);
  updateHud();
  feedback(outcome);
  if (outcome.over) after(1.4, finish);
  else if (outcome.rackOver) {
    after(2.2, () => {
      game.nextRack();
      scene.setBalls(game.balls);
      prepareTurn();
      toast.show(t('breakOf', { name: nameOf(game.current) }), `p${game.current}`);
    });
  } else {
    const passed = outcome.next !== outcome.player;
    after(passed ? 0.9 : 0.5, () => {
      prepareTurn();
      if (passed) {
        sound.play('turn');
        toast.show(t('turnOf', { name: nameOf(game.current) }), `p${game.current}`);
      }
    });
  }
};

/** 샷 결과를 알림과 소리로 */
function feedback(o) {
  const name = nameOf(o.player);
  if (!game.pool) {
    if (o.scored) {
      sound.play('score', 1 + Math.min(0.4, game.runs[o.player] * 0.04));
      toast.show(t(game.runs[o.player] > 1 ? 'scoredRun' : 'scored', { n: game.runs[o.player] }), 'big');
    } else if (o.foul) {
      sound.play('foul');
      toast.show(o.points < 0 ? t('foulTouchMinus') : t('foulTouch'), 'foul');
    } else if (game.variant.id === 'threecushion' && o.objects === 2) {
      toast.show(t('missCushions', { n: o.cushions }));
    }
    return;
  }
  if (o.rackOver) {
    const winner = nameOf(o.rackWinner);
    if (o.lostOnEight) sound.play('foul');
    else sound.play('score', 1.2);
    toast.show(o.lostOnEight ? t('lostEight', { name, winner }) : t('wonRack', { name: winner }), o.lostOnEight ? 'foul' : 'big');
    return;
  }
  if (o.foul) {
    sound.play('foul');
    toast.show(t(`foul.${o.foul}`), 'foul');
  } else if (o.assigned) {
    sound.play('score');
    toast.show(t('assigned', { name, group: t(`group.${o.assigned}`) }), `p${o.player}`);
  } else if (o.respotEight) toast.show(t('respot'));
  else if (o.keepTurn) {
    sound.play('score', 1 + Math.min(0.4, game.runs[o.player] * 0.04));
    toast.show(t('potted'), 'big');
  }
}

function finish() {
  state = 'done';
  const [a, b] = game.scores;
  const winner = game.winner;
  let tone = `p${winner}`;
  let title = t('wins', { name: nameOf(winner) });
  const lines = [];
  if (match.opponent === 'cpu') {
    const won = winner === 0;
    tone = won ? 'win' : 'lose';
    title = t(won ? 'youWin' : 'youLose');
    const saved = store.recordResult(match.variant, match.level, won, game.bestRuns[0]);
    if (saved) {
      if (saved.newBest && !game.pool) lines.push(t('newHighRun', { n: game.bestRuns[0] }));
      lines.push(t('record', { ...saved.record, level: t(`level.${match.level}`) }));
    }
    sound.play(won ? 'win' : 'lose');
  } else sound.play('win');
  $('result-title').textContent = title;
  $('result').dataset.tone = tone;
  const detail = `${nameOf(0)} ${a} : ${b} ${nameOf(1)}`;
  $('result-detail').textContent = game.pool ? detail : `${detail} · ${t('highRuns', { a: game.bestRuns[0], b: game.bestRuns[1] })}`;
  $('result-record').textContent = lines.join(' · ');
  toast.show(title, tone === 'lose' ? 'foul' : 'big');
  updateChrome();
  after(1.2, () => {
    if (state !== 'done') return;
    show('result', true);
    focusForKeyboard($('btn-again'));
  });
}

// ---------- HUD ----------

function updateHud() {
  if (!game) return;
  for (const p of [0, 1]) {
    const el = $(`player-${p}`);
    el.querySelector('.score').textContent = game.scores[p];
    const ball = el.querySelector('.ball');
    const group = el.querySelector('.group');
    ball.className = 'ball';
    if (game.pool) {
      const g = game.groups[p];
      if (!g) {
        ball.classList.add('none');
        group.textContent = '';
      } else {
        ball.style.setProperty('--ball', POOL_GROUP_COLOR[g]);
        if (g === 'stripe') ball.classList.add('stripe');
        const left = game.remaining(p).length;
        if (left === 0) {
          ball.style.setProperty('--ball', '#141414');
          ball.classList.remove('stripe');
        }
        group.textContent = left ? t('groupLeft', { group: t(`group.${g}`), n: left }) : t('onEight');
      }
    } else {
      ball.style.setProperty('--ball', p === 0 ? '#f4f1e6' : '#f4c21c');
      group.textContent = '';
    }
  }
}

/** 점수판·조작부·화면 테두리를 지금 상태에 맞춘다 */
function updateChrome() {
  const playing = !!game && state !== 'menu';
  show('versus', playing);
  const aiming = playing && state === 'aim';
  show('bar', playing); // 끝난 뒤 '당구대 보기'에서도 메뉴로 돌아갈 수 있게 남겨 둔다
  $('bar').classList.toggle('locked', !aiming);
  // 컴퓨터 차례에도 세기 막대는 보여 주어(누를 수는 없다) 얼마나 당기는지 보이게 한다
  show('power', aiming || (playing && state === 'cpu'));
  $('power-track').classList.toggle('locked', !aiming);
  const player = game?.current ?? 0;
  const active = playing && state !== 'done';
  for (const p of [0, 1]) $(`player-${p}`).classList.toggle('active', active && p === player);
  show('glow', active);
  $('glow').dataset.player = player;
  $('btn-camera').textContent = t(`camera.${settings.camera}`);
  if (!active) show('turn', false);
  updateInsets();
}

/** 차례 안내 줄: 누구 차례인지와 할 일 */
function updateTurn(hint) {
  if (!game || state === 'menu' || state === 'done') return show('turn', false);
  const banner = $('turn');
  const player = game.current;
  show('turn', true);
  if (banner.dataset.player !== String(player)) {
    banner.classList.remove('swap');
    void banner.offsetWidth; // 애니메이션을 처음부터 다시
    banner.classList.add('swap');
  }
  banner.dataset.player = player;
  $('turn-name').textContent = t('turnOf', { name: nameOf(player) });
  $('turn-hint').textContent = hint ? t(hint) : '';
  updateInsets();
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 당구대가 그 사이에 오도록 한다 */
function updateInsets() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let top = $('top').getBoundingClientRect().bottom;
  if (!$('turn').hidden) top = Math.max(top, $('turn').getBoundingClientRect().bottom);
  const bottom = $('bar').hidden ? 8 : h - $('bar').getBoundingClientRect().top;
  // 세기 막대 자리는 차례와 상관없이 비워 두어 당구대가 차례마다 들썩이지 않게 한다. 가운데에 오도록 양쪽 같게
  const side = game && state !== 'menu' ? Math.min(w <= 720 ? 54 : 62, w * 0.14) : 8;
  scene.setInsets({ top: top + 4, bottom: bottom + 2, left: side, right: side });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('top'));
new ResizeObserver(updateInsets).observe($('bar'));

// ---------- 조준 입력 ----------

function cancelInput() {
  pull = null;
  drag = null;
  hold = null;
  $('power-track').classList.remove('pulling');
}

function setAngle(angle) {
  aim.angle = wrap(angle);
  scene.setAim({ cue: game.cue, angle: aim.angle, power: aim.power, side: aim.side, vert: aim.vert, visible: true });
  guideDirty = true;
}

scene.onPointer = (type, e) => {
  if (type === 'pointerdown') sound.unlock();
  if (!game) return;
  if (state === 'roll') {
    // 구르는 동안 탭하면 빨리 감기
    if (type === 'pointerdown') {
      scene.setSpeed(scene.speed > 1 ? 1 : 3);
      $('turn-hint').textContent = t(scene.speed > 1 ? 'hintFast' : 'hintRoll');
    }
    return;
  }
  if (state !== 'aim') return;
  const cue = game.balls[game.cue];
  const R = game.table.ballRadius;
  if (type === 'pointerdown') {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = scene.toTable(e.clientX, e.clientY);
    const grab = Math.max(2.4 * R, (26 / Math.max(1, scene.ballPixels())) * R);
    if (game.ballInHand && p && Math.hypot(p.x - cue.x, p.y - cue.y) < grab) {
      drag = { kind: 'place', id: e.pointerId };
      return;
    }
    drag = { kind: 'aim', id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, moved: false, polar: null };
    if (p) drag.polar = Math.atan2(p.y - cue.y, p.x - cue.x);
    return;
  }
  if (!drag || drag.id !== e.pointerId) return;
  if (type === 'pointercancel') {
    drag = null;
    return;
  }
  if (drag.kind === 'place') {
    const p = scene.toTable(e.clientX, e.clientY);
    if (p) {
      const spot = game.canPlace(p.x, p.y) ? p : game.nearestPlace(p.x, p.y);
      if (Math.hypot(spot.x - p.x, spot.y - p.y) < 3 * R && game.placeCue(spot.x, spot.y)) {
        scene.setBalls(game.balls);
        showAim();
      }
      scene.setPlacement({ ...game.balls[game.cue], valid: game.canPlace(p.x, p.y) });
    }
    if (type === 'pointerup') {
      drag = null;
      scene.setPlacement({ ...game.balls[game.cue], valid: true });
    }
    return;
  }
  if (type === 'pointermove') {
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_SLOP) drag.moved = true;
    if (!drag.moved) return;
    if (settings.camera === 'cue' || drag.polar === null) {
      // 큐 시점: 오른쪽으로 끌면 오른쪽(시계 방향)으로 돈다
      setAngle(aim.angle - (e.clientX - drag.lastX) * 0.0022);
    } else {
      const p = scene.toTable(e.clientX, e.clientY);
      if (p && Math.hypot(p.x - cue.x, p.y - cue.y) > R) {
        const polar = Math.atan2(p.y - cue.y, p.x - cue.x);
        // 손가락이 수구를 도는 각도의 절반만 돌아 정밀하게 맞출 수 있다
        setAngle(aim.angle + wrap(polar - drag.polar) * 0.5);
        drag.polar = polar;
      }
    }
    drag.lastX = e.clientX;
    return;
  }
  if (type === 'pointerup') {
    if (!drag.moved) {
      const p = scene.toTable(e.clientX, e.clientY);
      if (p && Math.hypot(p.x - cue.x, p.y - cue.y) > R) setAngle(Math.atan2(p.y - cue.y, p.x - cue.x));
    }
    drag = null;
  }
};

// 세기 막대: 누른 자리에서 아래로 당긴 만큼
const track = $('power-track');
track.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (state !== 'aim') return;
  track.setPointerCapture(e.pointerId);
  pull = { id: e.pointerId, y0: e.clientY };
  track.classList.add('pulling');
  e.preventDefault();
});
track.addEventListener('pointermove', (e) => {
  if (!pull || pull.id !== e.pointerId) return;
  const height = track.getBoundingClientRect().height;
  aim.power = Math.min(1, Math.max(0, (e.clientY - pull.y0) / (height * 0.85)));
  updatePower();
  scene.setAim({ cue: game.cue, angle: aim.angle, power: aim.power, side: aim.side, vert: aim.vert, visible: true });
  if (settings.guide === 'long') guideDirty = true;
});
const release = (e) => {
  if (!pull || pull.id !== e.pointerId) return;
  pull = null;
  track.classList.remove('pulling');
  const power = aim.power;
  if (power >= 0.02) {
    aim.keyPower = power;
    shoot(power);
  } else {
    aim.power = 0;
    updatePower();
    showAim();
  }
};
track.addEventListener('pointerup', release);
track.addEventListener('pointercancel', (e) => {
  if (!pull || pull.id !== e.pointerId) return;
  pull = null;
  aim.power = 0;
  track.classList.remove('pulling');
  updatePower();
  showAim();
});

function updatePower() {
  $('power-fill').style.height = `${aim.power * 100}%`;
  $('power-mark').style.top = `calc(${aim.keyPower * 100}% - 1px)`;
  track.setAttribute('aria-valuenow', String(Math.round((aim.power || aim.keyPower) * 100)));
}

// 회전: 공 그림에서 누른 자리 (위 = 밀어치기, 아래 = 끌어치기, 옆 = 회전)
const spinBall = $('spin-ball');
let spinning = null;
const setSpinFrom = (e) => {
  const rect = spinBall.getBoundingClientRect();
  // 공 그림 반지름의 0.64 가 큐 끝이 갈 수 있는 끝 (점선)
  let x = (e.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.32);
  let y = -(e.clientY - (rect.top + rect.height / 2)) / (rect.height * 0.32);
  const r = Math.hypot(x, y);
  if (r > 1) {
    x /= r;
    y /= r;
  }
  if (r < 0.15) x = y = 0;
  setSpin(x, y);
};
spinBall.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (state !== 'aim') return;
  spinBall.setPointerCapture(e.pointerId);
  spinning = e.pointerId;
  setSpinFrom(e);
});
spinBall.addEventListener('pointermove', (e) => {
  if (spinning === e.pointerId) setSpinFrom(e);
});
spinBall.addEventListener('pointerup', () => (spinning = null));
spinBall.addEventListener('pointercancel', () => (spinning = null));

function setSpin(side, vert) {
  aim.side = Math.max(-1, Math.min(1, side));
  aim.vert = Math.max(-1, Math.min(1, vert));
  const r = Math.hypot(aim.side, aim.vert);
  if (r > 1) {
    aim.side /= r;
    aim.vert /= r;
  }
  updateSpin();
  if (game && state === 'aim') showAim();
}

function updateSpin() {
  $('spin-dot').style.transform = `translate(${aim.side * 16.6}px, ${-aim.vert * 16.6}px)`;
  const words = [];
  if (aim.vert > 0.15) words.push(t('spin.follow'));
  if (aim.vert < -0.15) words.push(t('spin.draw'));
  if (aim.side > 0.15) words.push(t('spin.right'));
  if (aim.side < -0.15) words.push(t('spin.left'));
  $('spin').title = `${t('spinTitle')} — ${words.join(' · ') || t('spin.center')}`;
}

// ◀ ▶: 누르고 있으면 점점 빨리 돈다
for (const [id, dir] of [
  ['btn-left', 1],
  ['btn-right', -1],
]) {
  const button = $(id);
  button.addEventListener('pointerdown', (e) => {
    sound.unlock();
    if (state !== 'aim') return;
    button.setPointerCapture(e.pointerId);
    hold = { dir, t: 0 };
    setAngle(aim.angle + dir * FINE_TURN * 2);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => (hold = null));
  button.addEventListener('click', (e) => {
    // 키보드(Enter·Space)로 누른 경우
    if (e.detail === 0 && state === 'aim') setAngle(aim.angle + dir * KEY_TURN);
  });
}

$('btn-shoot').addEventListener('click', () => shoot(aim.keyPower));

// ---------- 키보드 ----------

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const enter = e.code === 'Enter' || e.code === 'NumpadEnter';
  if (state === 'menu') {
    if (enter && !e.target.closest?.('button, a, summary')) {
      e.preventDefault();
      start();
    }
    if (e.code === 'Escape' && !$('btn-resume').hidden) resume();
    return;
  }
  if (e.code === 'KeyM') return toggleSound();
  if (e.code === 'Escape') return openMenu();
  if (e.code === 'KeyC') return toggleCamera();
  if (state === 'done') {
    if (enter) {
      e.preventDefault();
      again();
    }
    return;
  }
  if (state === 'roll' && e.code === 'KeyF') {
    scene.setSpeed(scene.speed > 1 ? 1 : 3);
    return;
  }
  if (state !== 'aim') return;
  const turn = e.shiftKey ? FINE_TURN : KEY_TURN;
  switch (e.code) {
    case 'ArrowLeft':
      e.preventDefault();
      return setAngle(aim.angle + turn);
    case 'ArrowRight':
      e.preventDefault();
      return setAngle(aim.angle - turn);
    case 'ArrowUp':
    case 'ArrowDown':
      e.preventDefault();
      aim.keyPower = Math.min(1, Math.max(0.05, aim.keyPower + (e.code === 'ArrowDown' ? 0.05 : -0.05)));
      updatePower();
      if (settings.guide === 'long') guideDirty = true;
      return;
    case 'KeyW':
      return setSpin(aim.side, aim.vert + 0.2);
    case 'KeyS':
      return setSpin(aim.side, aim.vert - 0.2);
    case 'KeyA':
      return setSpin(aim.side - 0.2, aim.vert);
    case 'KeyD':
      return setSpin(aim.side + 0.2, aim.vert);
    case 'KeyX':
      return setSpin(0, 0);
    case 'Space':
    case 'Enter':
    case 'NumpadEnter':
      if (e.target.closest?.('button, a') && e.target !== $('btn-shoot')) return;
      e.preventDefault();
      if (!e.repeat) shoot(aim.keyPower);
  }
});

function toggleSound() {
  sound.unlock();
  sound.setEnabled(!sound.enabled);
  settings = { ...settings, sound: sound.enabled };
  store.saveSettings({ ...store.loadSettings(), sound: sound.enabled });
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

function toggleCamera() {
  settings = { ...settings, camera: settings.camera === 'top' ? 'cue' : 'top' };
  store.saveSettings({ ...store.loadSettings(), camera: settings.camera });
  scene.setCamera(settings.camera);
  $('btn-camera').textContent = t(`camera.${settings.camera}`);
}

$('btn-sound').addEventListener('click', toggleSound);
$('btn-camera').addEventListener('click', toggleCamera);
$('btn-menu').addEventListener('click', openMenu);
$('btn-start').addEventListener('click', start);
$('btn-resume').addEventListener('click', resume);
$('btn-again').addEventListener('click', again);
$('btn-view').addEventListener('click', () => show('result', false));
$('btn-result-menu').addEventListener('click', openMenu);
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sound.unlock(), true);

// ---------- 프레임 ----------

/** 컴퓨터 차례: 생각하고, 큐를 돌려 겨누고, 당겨서 친다. 움직이는 중이면 true */
function runCpu(dt) {
  if (state !== 'cpu' || !cpu) return false;
  cpu.elapsed += dt;
  if (cpu.thinking) {
    // 한 프레임에 몇 밀리초씩만 생각해 화면이 끊기지 않게 한다
    const until = performance.now() + 8;
    while (performance.now() < until) {
      const { done, value } = cpu.thinking.next();
      if (done) {
        cpu.plan = value;
        cpu.thinking = null;
        break;
      }
    }
    return false;
  }
  const level = LEVELS[match.level];
  if (cpu.phase === 'think') {
    if (cpu.elapsed < level.think) return false;
    const { plan } = cpu;
    if (plan.place) {
      game.placeCue(plan.place.x, plan.place.y);
      scene.setBalls(game.balls);
    }
    cpu.phase = 'turn';
    cpu.t = 0;
    cpu.from = aim.angle;
    cpu.to = aim.angle + wrap(plan.shot.angle - aim.angle);
    setSpin(plan.shot.side, plan.shot.vert);
    updateTurn('hintCpuAim');
  }
  cpu.t += dt;
  if (cpu.phase === 'turn') {
    const k = smooth(Math.min(1, cpu.t / 0.7));
    aim.angle = cpu.from + (cpu.to - cpu.from) * k;
    scene.setAim({ cue: game.cue, angle: aim.angle, power: 0, side: aim.side, vert: aim.vert, visible: true });
    if (k >= 1) {
      cpu.phase = 'pull';
      cpu.t = 0;
    }
    return true;
  }
  if (cpu.phase === 'pull') {
    const target = powerOf(cpu.plan.shot.speed);
    const k = smooth(Math.min(1, cpu.t / 0.6));
    aim.power = target * k;
    updatePower();
    scene.setAim({ cue: game.cue, angle: aim.angle, power: aim.power, side: aim.side, vert: aim.vert, visible: true });
    if (cpu.t > 0.85) {
      const shot = perturb(cpu.plan.shot, level, Math.random, game.variant.maxSpeed);
      cpu = null;
      fire(shot);
    }
    return true;
  }
  return false;
}

scene.onFrame = (dt) => {
  toast.tick(dt);
  if (timers.length && state !== 'menu') {
    const due = [];
    timers = timers.filter((timer) => {
      timer.t -= dt;
      if (timer.t > 0) return true;
      due.push(timer.fn);
      return false;
    });
    for (const fn of due) fn();
  }
  let lively = runCpu(dt);
  if (hold && state === 'aim') {
    hold.t += dt;
    const rate = hold.t < 0.35 ? 0 : Math.min(10, 1 + (hold.t - 0.35) * 12); // 도/초
    if (rate) setAngle(aim.angle + hold.dir * ((rate * Math.PI) / 180) * dt);
    lively = true;
  }
  if (guideDirty && state === 'aim') {
    // 긴 보조선은 물리로 쳐 보므로 너무 자주 다시 그리지 않는다
    const now = performance.now();
    if (settings.guide !== 'long' || now - guideAt > 60) {
      guideAt = now;
      updateGuide();
    }
    lively = true;
  }
  return lively;
};

// ?debug 로 열면 콘솔에서 상태를 들여다볼 수 있다
if (params.has('debug')) {
  window.billiards = {
    scene,
    store,
    sound,
    aim,
    shoot,
    fire,
    get game() {
      return game;
    },
    get state() {
      return state;
    },
  };
}

try {
  await scene.load();
  $('loading').hidden = true;
  openMenu();
} catch (error) {
  console.error(error);
  $('loading').hidden = false;
  $('loading').textContent = t('loadFailed', { message: error.message });
}
