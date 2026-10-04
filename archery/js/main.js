// 양궁: 경기 규칙(match.js)·토너먼트(tournament.js)와 3D 씬(scene.js)을 잇고
// 조준·시간 제한·점수판·효과음·시상식 진행을 맡는다.

import { applyI18n, formatNumber, mountLangToggle } from '../../shared/i18n.js';
import { JsonStore, browserStorage } from '../../shared/storage.js';
import { scoreAt, TIMEOUT_HIT } from './target.js';
import { ArcheryMatch } from './match.js';
import { Tournament, ROUNDS } from './tournament.js';
import { Wind, windDrift } from './wind.js';
import { computerAim, computerShot } from './ai.js';
import { swayAmplitude, swayOffset, SHOT_CLOCK, HAND_SPREAD } from './aim.js';
import { ArcheryScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);
// 손가락으로 조작하는 기기에서는 안내 문구를 '터치' 기준으로 바꾼다
const touch = matchMedia('(pointer: coarse)').matches;
const GOLDS_KEY = 'casual-games.archery.golds';
const store = new JsonStore(browserStorage());
const VERSUS_WIND = 3.5; // 2인 대전의 최대 풍속 (m/s)

applyI18n(t);
mountLangToggle($('actions'), { className: 'chip' });

const scene = new ArcheryScene($('stage'));
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
const wind = new Wind();

let mode = null; // 'tournament' | 'versus'
let tournament = null;
let match = null;
// 새 경기를 시작할 때마다 늘린다. 기다리던 이전 경기의 흐름은 자기 번호가 아니면 멈춘다
let session = 0;
let shot = null; // 사람이 겨누는 중: { player, drawnAt, clockStart, lastTick, seed }
let aiAim = null; // 컴퓨터가 겨누는 중: { from, to, start, duration }
let lastAim = [];
let gaugeTime = 0;

function gaussian() {
  const u = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function setStatus(text) {
  $('status').textContent = text;
}

function readGolds() {
  return Number(store.read(GOLDS_KEY)) || 0;
}

/** 저장하지 못해도 시상식은 그대로 한다 */
function addGold() {
  store.write(GOLDS_KEY, readGolds() + 1);
}

const roundName = (round) => t(`round.${round.id}`);

function nameOf(i) {
  if (mode === 'tournament' && i === 1) return tournament.opponent.name;
  return t(`player.${match.players[i].id}`);
}

function maxWind() {
  return mode === 'tournament' ? tournament.opponent.maxWind : VERSUS_WIND;
}

// ---------- 점수판 · 계기 ----------

function updateHud() {
  // 세트가 끝나 다음 세트를 기다리는 동안에는 방금 끝난 세트를 보여 준다
  const shown = match.pendingNext || match.over ? match.sets.length : match.setNumber;
  const setLabel = match.inShootOff ? t('set.shootOff') : t('set.n', { n: shown });
  const round = mode === 'tournament' ? roundName(tournament.opponent) : t('round.versus');
  $('round').textContent = `${round} · ${setLabel}`;
  const totals = match.totals;
  for (let i = 0; i < 2; i++) {
    $(`name-${i}`).textContent = nameOf(i);
    if (mode === 'tournament' && i === 1) $(`name-${i}`).title = tournament.opponent.country;
    const box = $(`arrows-${i}`);
    const arrows = match.arrows[i];
    box.replaceChildren(
      ...Array.from({ length: match.arrowsPerPlayer }, (_, k) => {
        const cell = document.createElement('i');
        const hit = arrows[k];
        if (hit) {
          cell.textContent = hit.label;
          cell.classList.add('filled');
          if (hit.score === 10) cell.classList.add('ten');
        }
        return cell;
      }),
    );
    $(`sum-${i}`).textContent = formatNumber(totals[i]);
    $(`points-${i}`).textContent = match.points[i];
    $(`row-${i}`).classList.toggle('active', !match.over && !match.pendingNext && match.current === i);
    $(`row-${i}`).classList.toggle('lead', match.points[i] > match.points[1 - i]);
  }
}

function updateGauges(force = false) {
  if (!force && scene.time - gaugeTime < 0.1) return;
  gaugeTime = scene.time;
  const speed = wind.speed.toFixed(1);
  $('wind-arrow').setAttribute('transform', `rotate(${(wind.angle * 180) / Math.PI})`);
  $('wind-speed').textContent = speed;
  $('wind').setAttribute('aria-label', t('wind.aria', { speed }));
}

function setClock(left) {
  const box = $('clock-box');
  if (left === null) {
    $('clock').textContent = '–';
    box.className = 'gauge clock idle';
    return;
  }
  $('clock').textContent = Math.max(0, Math.ceil(left));
  box.className = `gauge clock${left <= 5 ? ' urgent' : ''}`;
}

/** 과녁이 점수판·계기판·안내 문구에 가리지 않도록, 화면 가운데 줄과 겹치는 것들을 피한 영역을 씬에 알린다 */
function updateSafeArea() {
  const w = innerWidth;
  const h = innerHeight;
  let top = 56; // 머리글
  for (const el of [$('hud'), $('gauges')]) {
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.right > w * 0.15 && r.left < w * 0.85) top = Math.max(top, r.bottom + 8);
  }
  scene.setSafeArea(top, h - (w <= 560 ? 84 : 60)); // 아래는 안내 문구 자리
}

addEventListener('resize', updateSafeArea);

// ---------- 프레임마다: 바람 · 조준점 · 시간 ----------

scene.onFrame = (dt) => {
  wind.step(dt);
  scene.setWind(wind);
  if (!$('gauges').hidden) updateGauges();

  const now = scene.time;
  if (shot) {
    const held = shot.drawnAt === null ? null : now - shot.drawnAt;
    const amplitude = swayAmplitude(held);
    const offset = swayOffset(now + shot.seed);
    scene.reticlePoint = { x: scene.aim.x + offset.x * amplitude, y: scene.aim.y + offset.y * amplitude };
    const left = SHOT_CLOCK - (now - shot.clockStart);
    setClock(left);
    if (left <= 5 && left > 0 && Math.ceil(left) !== shot.lastTick) {
      shot.lastTick = Math.ceil(left);
      sound.play('tick');
    }
    if (left <= 0) timeout();
  } else if (aiAim) {
    // 컴퓨터의 조준점: 엉뚱한 곳에서 겨눌 곳으로 차츰 모이며 흔들림이 줄어든다
    const k = Math.min(1, (now - aiAim.start) / aiAim.duration);
    const e = 1 - (1 - k) ** 3;
    const amplitude = 0.012 + 0.06 * (1 - e);
    const offset = swayOffset(now * 1.1 + 3);
    scene.reticlePoint = {
      x: aiAim.from.x + (aiAim.to.x - aiAim.from.x) * e + offset.x * amplitude,
      y: aiAim.from.y + (aiAim.to.y - aiAim.from.y) * e + offset.y * amplitude,
    };
  }
};

// ---------- 차례 ----------

async function nextTurn(id) {
  if (id !== session || match.over) return;
  updateHud();
  const player = match.current;
  await scene.showLane(player);
  if (id !== session) return;
  if (match.player.human) startAiming(player);
  else computerTurn(id);
}

function startAiming(player) {
  scene.aim.set(lastAim[player].x, lastAim[player].y);
  scene.reticlePoint = { ...lastAim[player] };
  scene.setAiming(player);
  shot = { player, drawnAt: null, clockStart: scene.time, lastTick: null, seed: Math.random() * 100 };
  const how = t(touch ? 'prompt.tap' : 'prompt.click');
  setStatus(mode === 'versus' ? t('prompt.turn', { name: nameOf(player), prompt: how }) : how);
}

/** 시위를 당긴다: 마우스·터치를 누르거나 Space */
function draw() {
  if (!shot || shot.drawnAt !== null) return;
  sound.unlock();
  shot.drawnAt = scene.time;
  sound.play('draw');
}

/** 시위를 놓는다. cancel 이면 쏘지 않고 당기기만 푼다 */
function loose(cancel = false) {
  if (!shot || shot.drawnAt === null) return;
  if (cancel) {
    shot.drawnAt = null;
    return;
  }
  const { player } = shot;
  shot = null;
  lastAim[player] = { x: scene.aim.x, y: scene.aim.y };
  const point = { ...scene.reticlePoint };
  scene.setAiming(null);
  setClock(null);
  // 조준점에서 바람에 밀리고 손이 조금 흔들린다
  const drift = windDrift(wind);
  release(player, {
    x: point.x + drift.x + gaussian() * HAND_SPREAD,
    y: point.y + drift.y + gaussian() * HAND_SPREAD,
  });
}

scene.onDraw = draw;
scene.onRelease = loose;

function timeout() {
  const { player } = shot;
  shot = null;
  scene.setAiming(null);
  setClock(null);
  sound.play('miss');
  scene.popLabel(scene.facePosition(player, { x: 0, y: 0 }), t('shot.timeout'), 'miss');
  setStatus(t('shot.timeoutStatus'));
  afterShot(match.shoot(TIMEOUT_HIT), session);
}

/** 화살을 날리고 점수를 매긴다 */
async function release(player, landing) {
  const id = session;
  sound.play('release');
  sound.whoosh();
  setStatus('');
  const hit = scoreAt(landing.x, landing.y);
  const { position } = await scene.shoot(player, player, landing);
  if (id !== session) return;
  sound.play(hit.score ? 'hit' : 'miss');
  if (hit.score === 10) sound.play('applause');
  scene.popLabel(position, hit.label, hit.score === 10 ? 'great' : hit.score ? '' : 'miss');
  await afterShot(match.shoot(hit), id);
}

async function computerTurn(id) {
  setStatus(t('turn.of', { name: nameOf(1) }));
  const skill = tournament.opponent;
  const to = computerAim(wind, skill);
  aiAim = {
    from: { x: (Math.random() - 0.5) * 0.4, y: 0.25 + Math.random() * 0.2 },
    to,
    start: scene.time,
    duration: 1.6 + Math.random() * 1.4,
  };
  scene.reticlePoint = { ...aiAim.from };
  scene.setAiming(1);
  await sleep(aiAim.duration * 1000 + 350);
  aiAim = null;
  if (id !== session) return;
  scene.setAiming(null);
  release(1, computerShot(to, wind, skill));
}

async function afterShot(result, id) {
  updateHud();
  if (!result.setOver) {
    await sleep(900);
    if (id !== session) return;
    sound.play('turn');
    return nextTurn(id);
  }
  await sleep(600);
  if (id !== session) return;
  announceSet(result);
  await sleep(2600);
  if (id !== session) return;
  if (result.over) return endMatch(id);

  const wasShootOff = match.inShootOff;
  match.nextSet();
  scene.clearArrows();
  wind.shuffle(maxWind());
  updateHud();
  if (match.inShootOff && !wasShootOff) {
    setStatus(t('shootOff.start'));
    await sleep(1800);
    if (id !== session) return;
  }
  nextTurn(id);
}

function announceSet(result) {
  const winner = result.setWinner;
  if (winner === null) sound.play('turn');
  else if (mode === 'versus' || winner === 0) sound.play('set-win');

  if (match.inShootOff) {
    if (winner === null) return setStatus(t('shootOff.again'));
    const [a, b] = match.arrows.map((arrows) => arrows[0]);
    if (a.score === b.score) {
      const cm = (hit) => (hit.distance === Infinity ? '–' : (hit.distance * 100).toFixed(1));
      return setStatus(t('shootOff.closer', { name: nameOf(winner), a: cm(a), b: cm(b) }));
    }
    return setStatus(t('set.won', { set: t('set.shootOff'), name: nameOf(winner), a: a.score, b: b.score }));
  }
  const last = match.sets.at(-1);
  const set = t('set.n', { n: match.sets.length });
  const [a, b] = last.totals;
  setStatus(winner === null ? t('set.tied', { set, a, b }) : t('set.won', { set, name: nameOf(winner), a, b }));
}

// ---------- 경기 끝 · 토너먼트 ----------

async function endMatch(id) {
  updateHud();
  setClock(null);
  const [a, b] = match.points;
  if (mode === 'versus') {
    sound.play('win');
    setStatus('');
    scene.showWide();
    showPanel({
      title: t('end.winner', { name: nameOf(match.winner) }),
      detail: t('end.versusDetail', { a, b }),
      tone: 'win',
      buttons: [
        { label: t('end.again'), action: startVersus },
        { label: t('mode.tournament'), ghost: true, action: startTournament },
      ],
    });
    return;
  }

  const won = match.winner === 0;
  const round = tournament.opponent;
  tournament.record(won, match.points);
  if (tournament.champion) return ceremony(id);

  sound.play(won ? 'win' : 'lose');
  setStatus('');
  scene.showWide();
  if (won) {
    const next = tournament.opponent;
    showPanel({
      title: t('end.won', { round: roundName(round) }),
      detail: t('end.wonDetail', { a, b, next: roundName(next) }),
      tone: 'win',
      bracket: true,
      buttons: [{ label: t('match.start', { round: roundName(next) }), action: startMatch }],
    });
  } else {
    showPanel({
      title: t('end.lost', { round: roundName(round) }),
      detail: t('end.lostDetail', { a, b, name: round.name }),
      bracket: true,
      buttons: [
        { label: t('end.retry'), action: startTournament },
        { label: t('mode.versus'), ghost: true, action: startVersus },
      ],
    });
  }
}

/** 세 경기를 모두 이기면: 동 → 은 → 금 순서로 메달을 건다 */
async function ceremony(id) {
  addGold();
  $('hud').hidden = true;
  $('gauges').hidden = true;
  scene.clearArrows();
  setStatus(t('ceremony.status'));
  sound.play('win');
  const [, silver, bronze] = tournament.podium();
  const names = [t('player.me'), `${silver.name} (${silver.country})`, `${bronze.name} (${bronze.country})`];
  await scene.setupCeremony(names);
  if (id !== session) return;
  sound.play('ceremony-applause');
  await sleep(700);
  for (const [rank, key] of [
    [2, 'ceremony.bronze'],
    [1, 'ceremony.silver'],
  ]) {
    if (id !== session) return;
    setStatus(t(key, { name: names[rank] }));
    await scene.awardMedal(rank);
    await sleep(1500);
  }
  if (id !== session) return;
  setStatus(t('ceremony.goldStatus', { name: names[0] }));
  sound.play('fanfare');
  await scene.awardMedal(0);
  scene.startConfetti();
  await sleep(1800);
  if (id !== session) return;
  setStatus('');
  // 시상대를 가리지 않게 대진표 대신 세 경기 결과를 한 줄로
  const record = tournament.results.map((r, i) => `${roundName(ROUNDS[i])} ${r.points.join('-')}`).join(' · ');
  showPanel({
    title: `🥇 ${t('ceremony.gold')}`,
    detail: `${t('ceremony.detail')}\n${record}`,
    tone: 'gold',
    buttons: [
      { label: t('end.retry'), action: startTournament },
      { label: t('mode.versus'), ghost: true, action: startVersus },
    ],
  });
}

function renderBracket() {
  const list = $('bracket');
  list.replaceChildren(
    ...ROUNDS.map((round, i) => {
      const opponent = tournament.opponents[i];
      const result = tournament.results[i];
      const item = document.createElement('li');
      const stage = document.createElement('span');
      stage.className = 'stage';
      stage.textContent = roundName(round);
      const who = document.createElement('span');
      who.textContent = `${opponent.name} · ${opponent.country}`;
      const mark = document.createElement('span');
      mark.className = 'result';
      if (result) {
        const [a, b] = result.points;
        mark.textContent = t(result.won ? 'bracket.win' : 'bracket.lose', { a, b });
        item.classList.add(result.won ? 'won' : 'lost');
      } else if (i === tournament.round && !tournament.finished) {
        mark.textContent = t('bracket.next');
        item.classList.add('current');
      }
      item.append(stage, who, mark);
      return item;
    }),
  );
}

/** 가운데 아래 패널: 제목·설명·(토너먼트 대진)·버튼 */
function showPanel({ title, detail = '', tone = '', bracket = false, buttons = [] }) {
  $('panel-title').textContent = title;
  $('panel-detail').textContent = detail;
  $('panel').dataset.tone = tone;
  $('bracket').hidden = !bracket;
  if (bracket) renderBracket();
  $('panel-buttons').replaceChildren(
    ...buttons.map(({ label, ghost, action, title: hint }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (hint) button.title = hint;
      if (ghost) button.className = 'ghost';
      button.addEventListener('click', action);
      return button;
    }),
  );
  $('panel').hidden = false;
  $('panel-buttons').querySelector('button')?.focus({ preventScroll: true });
}

function hidePanel() {
  $('panel').hidden = true;
}

function showModes() {
  const golds = readGolds();
  showPanel({
    title: t('intro.title'),
    detail: golds ? `${t('intro.detail')} · ${t('intro.golds', { n: golds })}` : t('intro.detail'),
    buttons: [
      { label: t('mode.tournament'), title: t('mode.tournament.title'), action: startTournament },
      { label: t('mode.versus'), title: t('mode.versus.title'), ghost: true, action: startVersus },
    ],
  });
}

/** 경기를 멈추고 진행 중이던 조준을 모두 거둔다 */
function stopPlay() {
  session += 1;
  shot = null;
  aiAim = null;
  scene.setAiming(null);
  sound.stopLong();
  scene.endCeremony();
  scene.clearArrows();
}

function startTournament() {
  sound.unlock();
  stopPlay();
  mode = 'tournament';
  tournament = new Tournament();
  $('hud').hidden = true;
  $('gauges').hidden = true;
  setStatus('');
  scene.showWide();
  const round = tournament.opponent;
  showPanel({
    title: roundName(round),
    detail: t('match.vs', { name: round.name, country: round.country }),
    bracket: true,
    buttons: [{ label: t('match.start', { round: roundName(round) }), action: startMatch }],
  });
}

function startVersus() {
  sound.unlock();
  mode = 'versus';
  tournament = null;
  startMatch();
}

async function startMatch() {
  sound.unlock();
  stopPlay();
  const id = session;
  hidePanel();
  match = new ArcheryMatch({ mode: mode === 'versus' ? 'versus' : 'computer' });
  lastAim = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  wind.shuffle(maxWind());
  $('hud').hidden = false;
  $('gauges').hidden = false;
  updateHud();
  updateGauges(true);
  updateSafeArea();
  setClock(null);
  setStatus(
    mode === 'tournament'
      ? `${roundName(tournament.opponent)} · ${t('match.vs', { name: tournament.opponent.name, country: tournament.opponent.country })}`
      : t('round.versus'),
  );
  await scene.intro(match.current);
  if (id !== session) return;
  nextTurn(id);
}

// ---------- 키보드 · 소리 ----------

function syncSoundButton() {
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

function toggleSound() {
  sound.unlock();
  sound.setEnabled(!sound.enabled);
  syncSoundButton();
}

syncSoundButton();
$('btn-sound').addEventListener('click', toggleSound);
// 브라우저는 사용자 입력이 있어야 소리를 허락한다. 터치는 손을 뗄 때 허락되는 경우가 있어 둘 다 듣는다
for (const type of ['pointerdown', 'pointerup', 'keydown']) {
  window.addEventListener(type, () => sound.unlock(), { capture: true });
}

const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'KeyM' && !e.repeat) toggleSound();
  if (!shot) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) draw();
  } else if (NUDGE[e.key]) {
    e.preventDefault();
    const step = e.shiftKey ? 0.003 : 0.012;
    scene.nudge(NUDGE[e.key][0] * step, NUDGE[e.key][1] * step);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && shot) {
    e.preventDefault();
    loose();
  }
});

// ?debug 로 열면 콘솔에서 씬과 경기 상태를 들여다볼 수 있다
if (params.has('debug')) {
  window.archery = {
    scene,
    sound,
    wind,
    get match() {
      return match;
    },
    get tournament() {
      return tournament;
    },
  };
}

try {
  await scene.load();
  wind.shuffle(2);
  $('loading').hidden = true;
  showModes();
} catch (error) {
  console.error(error);
  $('loading').textContent = t('loadFailed', { message: error.message });
}
