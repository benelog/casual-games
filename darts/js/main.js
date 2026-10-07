// 다트 301: 규칙(game.js)과 3D 씬(scene.js)을 잇고 HUD·효과음·대전 방식 선택을 맡는다.

import { applyI18n, formatNumber, mountLangToggle } from '../../shared/i18n.js';
import { scoreAt } from './board.js';
import { DartsGame, DARTS_PER_TURN } from './game.js';
import { computerThrow } from './ai.js';
import { DartsScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { focusForKeyboard } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);
// 손가락으로 조작하는 기기에서는 안내 문구를 '탭' 기준으로 바꾼다
const touch = matchMedia('(pointer: coarse)').matches;

applyI18n(t);
mountLangToggle($('actions'), { className: 'chip' });

const scene = new DartsScene($('stage'));
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));
let game = null;
// 새 게임을 시작하거나 그만둘 때마다 늘린다. 기다리던 이전 판의 흐름은 자기 번호가 아니면 멈춘다
let session = 0;

function setStatus(text) {
  $('status').textContent = text;
}

const nameOf = (i) => t(`player.${game.players[i].id}`);

/** 보드의 라벨(불스아이·불·빗나감)은 화면 언어로 바꾼다. T20 같은 표기는 그대로 */
function hitLabel(hit) {
  if (hit.number === 25) return t(hit.multiplier === 2 ? 'hit.bullseye' : 'hit.bull');
  if (!hit.score) return t('hit.miss');
  return hit.label;
}

function updateHud() {
  game.players.forEach((player, i) => {
    $(`name-${i}`).textContent = nameOf(i);
    $(`score-${i}`).textContent = formatNumber(player.remaining);
    $(`player-${i}`).classList.toggle('active', !game.over && game.current === i);
  });
  const slots = $('darts').children;
  for (let i = 0; i < DARTS_PER_TURN; i++) {
    slots[i].textContent = game.darts[i] ? hitLabel(game.darts[i]) : '';
    slots[i].classList.toggle('filled', i < game.darts.length);
  }
  $('turn-total').textContent = formatNumber(game.turnTotal);
}

/** 다트 하나를 던지고 규칙을 적용한다. point 는 보드 위 좌표 (미터) */
async function throwAt(point) {
  const id = session;
  const player = game.current;
  const hit = scoreAt(point.x * 1000, point.y * 1000);
  const label = hitLabel(hit);
  scene.setHitText(hit.score ? `${label} · ${hit.score}` : label);
  sound.play('throw');
  await scene.throwDart(player, point);
  // 날아가는 사이 판을 그만뒀으면 새 판에 점수를 더하지 않는다. 부른 쪽도 세션을 확인하고 멈춘다
  if (id !== session) return {};
  sound.play(hit.score ? 'hit' : 'miss');
  const result = game.throwDart(hit);
  // 불스아이·높은 트레블, 또는 한 턴에 100점 이상이면 환호
  const great = hit.score >= 50 || (result.turnOver && game.turnTotal >= 100);
  if (great && !result.bust && !result.win) sound.play('great');
  updateHud();
  return result;
}

/** 턴을 마무리한다. 기다리는 사이 판이 바뀌었으면 false */
async function finishTurn(result) {
  const id = session;
  if (result.bust) {
    const who = game.player.id;
    setStatus(who === 'me' ? t('bust.me') : t('bust.of', { name: nameOf(game.current) }));
    sound.play('bust');
  }
  await sleep(result.bust ? 1500 : 900);
  if (id !== session) return false;
  scene.clearDarts();
  game.nextTurn();
  updateHud();
  sound.play('turn');
  return true;
}

function endGame() {
  const name = nameOf(game.winner);
  let won = true;
  if (game.mode === 'versus') {
    $('banner-title').textContent = t('end.winner', { name });
    $('banner-detail').textContent = t('end.versusDetail', { name });
  } else {
    won = game.players[game.winner].human;
    $('banner-title').textContent = t(won ? 'end.win' : 'end.lose');
    $('banner-detail').textContent = t(won ? 'end.winDetail' : 'end.loseDetail');
  }
  sound.play(won ? 'win' : 'lose');
  $('banner').dataset.tone = won ? 'win' : 'lose';
  $('banner').hidden = false;
  setStatus('');
  showModes();
}

function promptPlayer() {
  const how = t(touch ? 'prompt.tap' : 'prompt.click');
  setStatus(game.mode === 'versus' ? t('prompt.turn', { name: nameOf(game.current), prompt: how }) : how);
  scene.setAiming(true);
}

async function computerTurn() {
  const id = session;
  setStatus(t('turn.of', { name: nameOf(game.current) }));
  while (!game.over && !game.player.human) {
    await sleep(800);
    if (id !== session) return;
    const aim = computerThrow(game.player.remaining);
    const result = await throwAt({ x: aim.x / 1000, y: aim.y / 1000 });
    if (id !== session) return;
    if (result.win) return endGame();
    if (result.turnOver && !(await finishTurn(result))) return;
  }
  promptPlayer();
}

/** 차례가 넘어간 뒤: 사람이면 조준을 켜고, 컴퓨터면 대신 던진다 */
function nextPlayer() {
  if (game.player.human) promptPlayer();
  else computerTurn();
}

scene.onThrow = async (point) => {
  if (!game || game.over || !game.player.human) return;
  const id = session;
  scene.setAiming(false);
  const result = await throwAt(point);
  if (id !== session) return;
  if (result.win) return endGame();
  if (!result.turnOver) return promptPlayer();
  if (await finishTurn(result)) nextPlayer();
};

/** 처음과 게임이 끝난 뒤에 대전 방식 버튼을 보인다 */
function showModes() {
  $('modes').hidden = false;
  $('btn-new').hidden = true;
  if (!game) setStatus(t('mode.choose'));
  focusForKeyboard($('modes').querySelector('button'));
}

function newGame(mode) {
  sound.unlock();
  session += 1;
  game = new DartsGame({ mode });
  scene.clearDarts();
  scene.setAiming(false);
  $('banner').hidden = true;
  $('modes').hidden = true;
  $('hud').hidden = false;
  $('btn-new').hidden = false;
  updateHud();
  nextPlayer();
}

/** 진행 중인 판을 그만두고 대전 방식 고르기로 돌아간다 */
function abandonGame() {
  if (!game || $('btn-new').hidden) return;
  session += 1;
  game = null;
  scene.setAiming(false);
  scene.clearDarts();
  $('hud').hidden = true;
  $('banner').hidden = true;
  showModes();
}

for (const button of $('modes').querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => newGame(button.dataset.mode));
}
$('btn-new').addEventListener('click', abandonGame);

// ---------- 도움말 ----------

function openHelp() {
  $('help').hidden = false;
  focusForKeyboard($('btn-help-close'));
}

function closeHelp() {
  if ($('help').hidden) return;
  $('help').hidden = true;
  $('btn-help').focus({ preventScroll: true });
}

$('btn-help').addEventListener('click', openHelp);
$('btn-help-close').addEventListener('click', closeHelp);
$('help').addEventListener('click', (e) => e.target === $('help') && closeHelp());

// ---------- 소리 ----------

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
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.key === 'Escape') return closeHelp();
  if (e.key === '?') return openHelp();
  if (!$('help').hidden) return;
  if (e.code === 'KeyM') toggleSound();
  else if (e.code === 'KeyN') abandonGame();
});

// ?debug 로 열면 점수 규격선이 보이고, 콘솔에서 씬과 게임 상태를 들여다볼 수 있다
if (params.has('debug')) {
  window.darts = { scene, sound, get game() { return game; } };
}

try {
  await scene.load({ debug: params.has('debug') });
  $('loading').hidden = true;
  showModes();
} catch (error) {
  console.error(error);
  $('loading').textContent = t('loadFailed', { message: error.message });
}
