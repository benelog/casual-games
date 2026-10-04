// 주차: 단계(levels.js), 판(game.js), 조작(controls.js), 3D 씬(scene.js), 저장(save.js)을 잇고 HUD·입력을 처리한다.

import { LEVELS } from './levels.js';
import { ParkingRun } from './game.js';
import { Driver, KEYS } from './controls.js';
import { SaveStore, browserStorage, CAMERAS } from './save.js';
import { ParkingScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, formatNumber, lang, mountLangToggle } from '../../shared/i18n.js';
import { createToast } from '../../shared/ui.js';
import { formatTime } from '../../shared/util.js';

const $ = (id) => document.getElementById(id);

const RESULT_DELAY = 1.4; // 주차 완료 연출을 보여 준 뒤 결과 창을 띄운다
const FAIL_DELAY = 1.1;
const BANNER_TIME = 4; // 단계 이름과 요령을 보여 주는 시간

const debug = new URLSearchParams(location.search).has('debug');

document.title = t('pageTitle');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const scene = new ParkingScene($('stage'));
const store = new SaveStore(
  browserStorage(),
  LEVELS.map((level) => level.id),
);
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const driver = new Driver();
const toast = createToast($('toast'));
const settings = store.loadSettings();
sound.enabled = settings.sound;

let index = 0; // 지금 단계 (LEVELS 의 위치)
let run = null;
let state = 'select'; // select | driving | parked | failed
let input = { throttle: 0, brake: 0, steer: 0 };
let resultTimer = 0;
let bannerTimer = 0;
let outcome = null; // 방금 남긴 기록의 결과
let padHeight = 0;

const levelName = (level) => level.name[lang] ?? level.name.ko;
const levelTip = (level) => level.tip[lang] ?? level.tip.ko;
const indexOfId = (id) => Math.max(0, LEVELS.findIndex((level) => level.id === id));
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

// ---------- 단계 선택 ----------

function renderSelect() {
  const { best } = store.load();
  const total = store.totalStars(best);
  $('progress').textContent = t('progress', { stars: total, max: LEVELS.length * 3, solved: Object.keys(best).length, total: LEVELS.length });
  const grid = $('level-grid');
  grid.replaceChildren();
  LEVELS.forEach((level, i) => {
    const record = best[level.id];
    const open = debug || store.unlocked(level.id, best);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `level${record ? ' solved' : ''}${i === index ? ' current' : ''}`;
    button.disabled = !open;
    button.innerHTML = `<span class="n">${i + 1}</span><span class="name">${levelName(level)}</span><small>${
      record ? stars(record.stars) : open ? '' : '🔒'
    }</small>`;
    button.setAttribute(
      'aria-label',
      record
        ? t('levelSolved', { n: i + 1, name: levelName(level), stars: record.stars, score: record.score })
        : open
          ? t('levelLabel', { n: i + 1, name: levelName(level) })
          : t('levelLocked', { n: i + 1 }),
    );
    button.addEventListener('click', () => {
      sound.unlock();
      sound.play('select');
      startLevel(i);
    });
    grid.append(button);
  });
  $('continue-label').textContent = t('continue', { n: index + 1 });
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function setState(next) {
  state = next;
  show('select', state === 'select');
  show('result', state === 'parked' && resultTimer <= 0 && !!outcome);
  show('fail', state === 'failed' && resultTimer <= 0);
  show('stats', state !== 'select');
  show('controls', state !== 'select');
  show('drive', state !== 'select');
  show('view', state !== 'select');
  if (state !== 'driving') {
    show('park-meter', false);
    show('sensor', false);
  }
  driver.release();
  // 포커스가 버튼에 남아 있으면 Space·Enter 가 그 버튼을 누르게 된다
  if (state === 'driving') document.activeElement?.blur?.();
  updateInsets();
}

function openSelect() {
  renderSelect();
  setState('select');
  $('banner').classList.remove('show');
  sound.setEngine(0, 0);
  $('btn-continue').focus();
}

/** 판만 새로 놓는다 (단계 선택 뒤 배경으로도 쓴다) */
function loadLevel(i) {
  index = i;
  run = new ParkingRun(LEVELS[i]);
  driver.reset();
  input = { throttle: 0, brake: 0, steer: 0 };
  scene.input = input;
  scene.setup(run);
  updateHud();
}

function startLevel(i) {
  sound.unlock();
  const open = debug || store.unlocked(LEVELS[i].id);
  if (!open) return;
  loadLevel(i);
  store.saveLast(LEVELS[i].id);
  resultTimer = 0;
  outcome = null;
  setState('driving');
  const level = LEVELS[i];
  $('banner-name').textContent = t('bannerName', { n: i + 1, name: levelName(level) });
  $('banner-tip').textContent = levelTip(level);
  $('banner').classList.add('show');
  bannerTimer = BANNER_TIME;
}

function restart() {
  if (!run) return;
  startLevel(index);
  toast.show(t('restarted'));
}

function nextLevel() {
  startLevel(Math.min(index + 1, LEVELS.length - 1));
}

// ---------- 결과 ----------

function showResult() {
  const result = run.result;
  const level = LEVELS[index];
  const last = index === LEVELS.length - 1;
  const { first, improved, previous } = outcome;
  const allDone = Object.keys(store.load().best).length === LEVELS.length;
  $('result-title').textContent = last && allDone ? t('clearedAll') : improved && !first ? t('newBest') : t('parked');
  $('result-stars').innerHTML = [1, 2, 3].map((k) => `<span class="${k <= result.stars ? 'on' : ''}">★</span>`).join('');
  $('result-score').textContent = t('score', { n: result.score });
  const d = result.deductions;
  const rows = [
    [t('time'), `${formatTime(result.time)} <small>${t('par', { value: formatTime(level.par.time) })}</small>`, d.time],
    [t('switches'), `${result.switches} <small>${t('par', { value: level.par.switches })}</small>`, d.switches],
    [t('contacts'), `${result.contacts}`, d.contacts],
    [
      t('accuracy'),
      t('accuracyValue', { m: result.offset.toFixed(2), deg: ((result.angle * 180) / Math.PI).toFixed(1) }),
      d.accuracy,
    ],
  ];
  $('result-table').innerHTML = rows
    .map(([label, value, minus]) => `<tr><th>${label}</th><td>${value}</td><td class="minus">${minus ? `−${minus}` : ''}</td></tr>`)
    .join('');
  $('result-best').textContent = first
    ? t('firstClear')
    : t(improved ? 'previousBest' : 'best', { score: previous.score, stars: stars(previous.stars) });
  $('result').dataset.tone = result.stars === 3 ? 'win' : '';
  show('btn-next', !last);
  show('result', true);
  (last ? $('btn-result-levels') : $('btn-next')).focus();
}

function showFail() {
  const level = LEVELS[index];
  $('fail-reason').textContent = run.failReason === 'crash' ? t('reason.crash') : t('reason.contacts', { n: level.maxContacts + 1 });
  show('fail', true);
  $('btn-retry').focus();
}

// ---------- HUD ----------

let shown = {};
function setText(id, text) {
  if (shown[id] === text) return;
  shown[id] = text;
  $(id).textContent = text;
}

function updateHud() {
  if (!run) return;
  const level = LEVELS[index];
  setText('level', `${index + 1}/${LEVELS.length}`);
  setText('time', formatTime(run.time));
  setText('switches', formatNumber(run.switches));
  const limit = level.maxContacts;
  setText('contacts', limit != null ? `${run.contacts}/${limit + 1}` : formatNumber(run.contacts));
  $('contacts-stat').classList.toggle('bad', run.contacts > 0);
  const { car } = run;
  $('gear').dataset.gear = car.gear;
  setText('speed', t('kmh', { n: Math.round(Math.abs(car.speed) * 3.6) }));
  $('wheel').style.transform = `rotate(${driver.wheelAngle}rad)`;
  $('wheel').setAttribute('aria-valuenow', String(Math.round(driver.steer * 100)));
  $('gas').classList.toggle('down', input.throttle > 0);
  $('brake').classList.toggle('down', input.brake > 0);

  const settling = state === 'driving' && run.hold > 0;
  show('park-meter', settling);
  if (settling) $('park-fill').style.width = `${Math.round(run.holdProgress * 100)}%`;
}

/** 주차 감지기: 가장 가까운 장애물까지의 거리를 막대와 숫자로, 소리로 */
function updateSensor(dt) {
  const { car } = run;
  const active = state === 'driving' && (car.gear === 'R' || Math.abs(car.speed) > 0.05);
  const gap = active ? run.sensorGap() : Infinity;
  sound.sensor(gap, dt);
  const near = Number.isFinite(gap);
  show('sensor', near);
  if (!near) return;
  const level = gap < 0.3 ? 4 : gap < 0.6 ? 3 : gap < 1 ? 2 : 1;
  $('sensor').dataset.level = String(level);
  $('sensor').dataset.side = car.gear === 'R' ? 'rear' : 'front';
  setText('sensor-text', t(car.gear === 'R' ? 'sensorRear' : 'sensorFront', { m: gap.toFixed(1) }));
}

/** 화면 가장자리를 가리는 HUD 크기를 씬에 알려 차가 그 사이에 오도록 한다 */
function updateInsets() {
  const top = $('top').getBoundingClientRect().bottom;
  if (!$('drive').hidden) padHeight = window.innerHeight - $('drive').getBoundingClientRect().top;
  scene.setInsets({ top, bottom: state === 'select' ? 0 : padHeight * 0.75, left: 0, right: 0 });
}

window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('drive'));
new ResizeObserver(updateInsets).observe($('top'));

// ---------- 사건 ----------

function flush() {
  for (const event of run.drain()) {
    scene.handle(event);
    switch (event.type) {
      case 'gear':
        sound.play('gear', event.gear === 'R' ? 0.9 : 1.05);
        break;
      case 'contact': {
        sound.contact(event.severity);
        const limit = LEVELS[index].maxContacts;
        if (event.severity !== 'crash') {
          toast.show(limit != null ? t('contactLimit', { n: event.contacts, max: limit + 1 }) : t('contact', { n: event.contacts }), 'bad');
        }
        break;
      }
      case 'parked':
        sound.play('parked');
        sound.play('win');
        sound.setEngine(0, 0);
        outcome = store.record(LEVELS[index].id, event.result);
        resultTimer = RESULT_DELAY;
        setState('parked');
        toast.show(t('parkedToast'), 'big');
        break;
      case 'failed':
        sound.play('lose');
        sound.setEngine(0, 0);
        resultTimer = FAIL_DELAY;
        setState('failed');
        toast.show(event.reason === 'crash' ? t('crashToast') : t('disqualified'), 'bad');
        break;
    }
  }
}

// ---------- 입력 ----------

function toggleGear() {
  if (state !== 'driving') return;
  sound.unlock();
  run.setGear(run.car.gear === 'D' ? 'R' : 'D');
  flush();
}

function cycleCamera() {
  settings.camera = CAMERAS[(CAMERAS.indexOf(settings.camera) + 1) % CAMERAS.length];
  applySettings();
  toast.show(t(`camera.${settings.camera}`));
}

function toggleGuide() {
  settings.guide = !settings.guide;
  applySettings();
}

function toggleSound() {
  settings.sound = !settings.sound;
  sound.setEnabled(settings.sound);
  applySettings();
}

function applySettings() {
  scene.setMode(settings.camera);
  scene.setGuide(settings.guide);
  $('camera-label').textContent = t(`camera.${settings.camera}`);
  $('btn-guide').setAttribute('aria-pressed', String(settings.guide));
  $('btn-sound').setAttribute('aria-pressed', String(settings.sound));
  store.saveSettings(settings);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    driver.gentle = true;
    return;
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (document.activeElement?.tagName === 'BUTTON' && state !== 'driving') return; // 버튼이 직접 처리한다
    e.preventDefault();
    if (state === 'select') startLevel(index);
    else if (state === 'parked' && resultTimer <= 0) nextLevel();
    else if (state === 'failed' && resultTimer <= 0) startLevel(index);
    return;
  }
  if (e.code === 'Escape') {
    if (state === 'select') startLevel(index);
    else openSelect();
    return;
  }
  if (e.code === 'KeyM') return toggleSound();
  if (e.code === 'KeyC') return cycleCamera();
  if (e.code === 'KeyV') return toggleGuide();
  if (e.code === 'KeyR' && state !== 'select') return restart();
  if (e.code === 'KeyG') return toggleGear();
  const action = KEYS[e.code];
  if (!action || state !== 'driving') return;
  e.preventDefault();
  sound.unlock();
  if (e.repeat) return;
  const gear = driver.key(action, true);
  if (gear) run.setGear(gear);
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') driver.gentle = false;
  const action = KEYS[e.code];
  if (action) driver.key(action, false);
});

// 다른 창으로 가면 누르고 있던 키·페달을 놓은 것으로 친다
window.addEventListener('blur', () => driver.release());

// 화면 핸들: 가운데에 대한 손가락 각도가 바뀐 만큼 돌린다
const wheel = $('wheel');
const wheelCenter = () => {
  const r = wheel.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
/** 손가락이 요소 밖으로 나가도 계속 받는다. 잡을 수 없는 포인터면 그냥 둔다 */
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // 이미 떨어진 포인터 등: 잡지 못해도 누른 상태는 그대로 쓴다
  }
}

wheel.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sound.unlock();
  const c = wheelCenter();
  driver.grabWheel(e.pointerId, e.clientX - c.x, e.clientY - c.y);
  wheel.classList.add('held');
  capture(wheel, e.pointerId);
});
wheel.addEventListener('pointermove', (e) => {
  const c = wheelCenter();
  driver.turnWheel(e.pointerId, e.clientX - c.x, e.clientY - c.y);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  wheel.addEventListener(type, (e) => {
    driver.dropWheel(e.pointerId);
    wheel.classList.remove('held');
  });
}

// 페달: 누르고 있는 동안 밟는다
for (const name of ['gas', 'brake']) {
  const pedal = $(name);
  pedal.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sound.unlock();
    driver.pedals[name] = true;
    capture(pedal, e.pointerId);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    pedal.addEventListener(type, () => {
      driver.pedals[name] = false;
    });
  }
}
$('gear').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  toggleGear();
});
for (const el of [wheel, $('gas'), $('brake'), $('gear')]) el.addEventListener('contextmenu', (e) => e.preventDefault());

$('btn-continue').addEventListener('click', () => startLevel(index));
$('btn-next').addEventListener('click', nextLevel);
$('btn-again').addEventListener('click', () => startLevel(index));
$('btn-retry').addEventListener('click', () => startLevel(index));
$('btn-result-levels').addEventListener('click', openSelect);
$('btn-fail-levels').addEventListener('click', openSelect);
$('btn-restart').addEventListener('click', restart);
$('btn-menu').addEventListener('click', openSelect);
$('btn-sound').addEventListener('click', toggleSound);
$('btn-camera').addEventListener('click', cycleCamera);
$('btn-guide').addEventListener('click', toggleGuide);
$('stage').addEventListener('pointerdown', () => sound.unlock());

// 두 손가락으로 벌리고 오므리면 위에서 보기를 확대·축소한다 (마우스는 휠)
const pinch = new Map(); // pointerId → { x, y }
let pinchDistance = 0;
const spread = () => {
  const [a, b] = [...pinch.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
$('stage').addEventListener('pointerdown', (e) => {
  pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch.size === 2) pinchDistance = spread();
});
$('stage').addEventListener('pointermove', (e) => {
  if (!pinch.has(e.pointerId)) return;
  pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch.size !== 2) return;
  const distance = spread();
  if (pinchDistance > 0 && distance > 0) scene.zoom(pinchDistance / distance);
  pinchDistance = distance;
});
for (const type of ['pointerup', 'pointercancel']) {
  $('stage').addEventListener(type, (e) => {
    pinch.delete(e.pointerId);
    pinchDistance = 0;
  });
}

// ---------- 프레임 ----------

scene.onFrame = (dt) => {
  toast.tick(dt);
  if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) $('banner').classList.remove('show');
  if (resultTimer > 0 && (resultTimer -= dt) <= 0) {
    if (state === 'parked') showResult();
    else if (state === 'failed') showFail();
  }
  if (!run) return;
  input = driver.update(dt);
  if (state === 'driving') {
    run.update(dt, input);
    flush();
  } else {
    input = { throttle: 0, brake: 0, steer: driver.steer };
  }
  scene.input = input;
  if (state === 'driving') sound.setEngine(input.throttle, Math.abs(run.car.speed));
  if (run.started && bannerTimer > 0.4) bannerTimer = 0.4; // 출발하면 요령을 빨리 치운다
  updateHud();
  updateSensor(dt);
};

// ?debug 로 열면 콘솔에서 판과 씬을 들여다볼 수 있고, 모든 단계가 열린다
if (debug) {
  window.parking = {
    scene,
    store,
    sound,
    driver,
    startLevel,
    toggleGear,
    get run() {
      return run;
    },
    get state() {
      return state;
    },
  };
}

try {
  await scene.load();
  applySettings();
  loadLevel(indexOfId(store.nextUnsolved()));
  $('loading').hidden = true;
  openSelect();
} catch (error) {
  console.error(error);
  $('loading').textContent = t('loadError');
}
