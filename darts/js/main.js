// 다트 301: 규칙(game.js)과 3D 씬(scene.js)을 잇고 HUD 를 갱신한다.

import { scoreAt } from './board.js';
import { DartsGame, DARTS_PER_TURN } from './game.js';
import { computerThrow } from './ai.js';
import { DartsScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);

const scene = new DartsScene($('stage'));
let game;

function setStatus(text) {
  $('status').textContent = text;
}

function updateHud() {
  game.players.forEach((player, i) => {
    $(`score-${i}`).textContent = player.remaining;
    $(`player-${i}`).classList.toggle('active', !game.over && game.current === i);
  });
  const slots = $('darts').children;
  for (let i = 0; i < DARTS_PER_TURN; i++) {
    slots[i].textContent = game.darts[i]?.label ?? '';
    slots[i].classList.toggle('filled', i < game.darts.length);
  }
  $('turn-total').textContent = game.darts.reduce((sum, d) => sum + d.score, 0);
}

/** 다트 하나를 던지고 규칙을 적용한다. point 는 보드 위 좌표 (미터) */
async function throwAt(point) {
  const player = game.current;
  const hit = scoreAt(point.x * 1000, point.y * 1000);
  scene.setHitText(hit.score ? `${hit.label} · ${hit.score}` : hit.label);
  await scene.throwDart(player, point);
  const result = game.throwDart(hit);
  updateHud();
  return result;
}

async function finishTurn(result) {
  if (result.bust) setStatus(`버스트! ${game.players[game.current].name}의 이번 턴 점수는 무효입니다`);
  await sleep(result.bust ? 1500 : 900);
  scene.clearDarts();
  game.nextTurn();
  updateHud();
}

function endGame() {
  const won = game.winner === 0;
  $('banner-title').textContent = won ? '승리!' : '패배';
  $('banner-detail').textContent = won ? '먼저 0점을 만들었습니다' : '컴퓨터가 먼저 0점을 만들었습니다';
  $('banner').dataset.tone = won ? 'win' : 'lose';
  $('banner').hidden = false;
  $('btn-new').hidden = false;
  setStatus('');
}

function promptPlayer() {
  setStatus('흔들리는 조준점이 원하는 곳에 왔을 때 클릭해 던지세요');
  scene.setAiming(true);
}

async function computerTurn() {
  setStatus('컴퓨터 차례');
  while (!game.over && game.current === 1) {
    await sleep(800);
    const aim = computerThrow(game.players[1].remaining);
    const result = await throwAt({ x: aim.x / 1000, y: aim.y / 1000 });
    if (result.win) return endGame();
    if (result.turnOver) await finishTurn(result);
  }
  promptPlayer();
}

scene.onThrow = async (point) => {
  scene.setAiming(false);
  const result = await throwAt(point);
  if (result.win) return endGame();
  if (!result.turnOver) return promptPlayer();
  await finishTurn(result);
  computerTurn();
};

function newGame() {
  game = new DartsGame();
  scene.clearDarts();
  $('banner').hidden = true;
  $('btn-new').hidden = true;
  updateHud();
  promptPlayer();
}

$('btn-new').addEventListener('click', newGame);

// ?debug 로 열면 점수 규격선이 보이고, 콘솔에서 씬과 게임 상태를 들여다볼 수 있다
if (params.has('debug')) {
  window.darts = { scene, get game() { return game; } };
}

try {
  await scene.load({ debug: params.has('debug') });
  $('loading').hidden = true;
  $('hud').hidden = false;
  newGame();
} catch (error) {
  console.error(error);
  $('loading').textContent = `불러오기에 실패했습니다: ${error.message}`;
}
