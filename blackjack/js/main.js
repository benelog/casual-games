// 게임 엔진의 이벤트를 3D 씬 애니메이션과 HUD 로 재생하는 컨트롤러.

import { BlackjackGame } from './game.js';
import { describeHand } from './rules.js';
import { TableScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('ko-KR');
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const params = new URLSearchParams(location.search);
const scene = new TableScene($('stage'));
const CHIP_VALUES = [10, 50, 100, 500];

let game;
let pendingBet = 50; // 베팅 단계에서 고르는 중인 금액
let betting = false; // 베팅을 고를 차례인지
let insuring = false; // 인슈어런스를 고를 차례인지
let legal = null; // 내가 행동할 차례일 때만 설정된다
let busy = false; // 이벤트 재생 중
// 화면에 이미 놓인 카드 (엔진은 애니메이션보다 앞서 간다)
let shownHands = [];
let shownDealer = [];
let bets = [];
let split = false;
let insuranceNote = '';
let dealing = []; // 첫 딜처럼 겹쳐서 재생 중인 애니메이션

function setStatus(text) {
  $('status').textContent = text;
}

function showBanner(title, detail, tone) {
  $('banner-title').textContent = title;
  $('banner-detail').textContent = detail;
  $('banner').dataset.tone = tone;
  $('banner').hidden = false;
}

function handText(i) {
  return describeHand(shownHands[i], { fromSplit: split });
}

function updateLabels() {
  shownHands.forEach((cards, i) => {
    const value = handText(i);
    const tone = value.startsWith('버스트') ? 'lose' : undefined;
    scene.setHandLabel(i, value && bets[i] ? `${value} · ${fmt(bets[i])}` : value, tone);
  });
  const visible = shownDealer.filter(Boolean);
  // 앞면 한 장만 보일 때 A 는 '소프트 11' 대신 A 로
  const dealer = visible.length === 1 && visible[0].rank === 14 ? 'A' : describeHand(visible);
  scene.setDealerLabel(visible.length ? `딜러 ${dealer}` : '');
  const active = legal ? game.active : -1;
  $('my-hand').textContent = shownHands[active] ? `내 핸드: ${handText(active)}` : '';
}

function updateInfo(snap) {
  $('info').textContent = `핸드 #${game.round} · 슈 ${snap.shoe}장 남음`;
}

const ACTION_TEXT = { hit: '히트', stand: '스탠드', double: '더블 다운', split: '스플릿' };

const OUTCOME = {
  blackjack: { text: '블랙잭', tone: 'win' },
  win: { text: '승', tone: 'win' },
  push: { text: '푸시', tone: 'push' },
  lose: { text: '패', tone: 'lose' },
  bust: { text: '버스트', tone: 'lose' },
};

async function flushDealing() {
  if (dealing.length === 0) return;
  await Promise.all(dealing);
  dealing = [];
  updateLabels();
}

async function handle(ev) {
  const snap = ev.snap;
  if (!(ev.type === 'deal' && ev.initial)) await flushDealing();
  switch (ev.type) {
    case 'shuffle':
      setStatus('컷 카드가 나왔습니다. 슈를 다시 섞습니다');
      scene.say('셔플');
      await scene.shuffle();
      await sleep(300);
      scene.say('');
      break;
    case 'round-start':
      shownHands = [[]];
      shownDealer = [];
      bets = [...snap.bets];
      split = false;
      insuranceNote = '';
      scene.setMood(ev.round === 1 ? 'hello' : 'act');
      scene.setChips(snap);
      scene.setActive(null);
      setStatus('');
      updateInfo(snap);
      break;
    case 'deal': {
      if (ev.to === 'player') shownHands[ev.hand].push(ev.card);
      else shownDealer.push(ev.card); // 홀 카드는 null
      const animation = scene.dealCard(ev);
      if (ev.initial) {
        dealing.push(animation);
        await sleep(190);
      } else {
        await animation;
        updateLabels();
      }
      break;
    }
    case 'insurance-offer':
      scene.say('인슈어런스?');
      break;
    case 'insurance':
      scene.say('');
      if (ev.taken) await scene.animateBet(snap);
      setStatus(ev.taken ? `나: 보험 ${fmt(ev.amount)}` : '나: 보험 거절');
      break;
    case 'peek':
      setStatus('딜러가 홀 카드를 확인합니다');
      await scene.peek();
      setStatus('');
      if (ev.blackjack) scene.say('블랙잭!');
      break;
    case 'insurance-result':
      insuranceNote = ev.won ? `보험 ${signed(ev.payout - ev.amount)}` : `보험 ${signed(-ev.amount)}`;
      setStatus(ev.won ? `보험금 ${fmt(ev.payout - ev.amount)} 을 받았습니다` : '딜러가 블랙잭이 아니라 보험금을 잃었습니다');
      await scene.insuranceResult(ev, snap);
      break;
    case 'turn':
      scene.setActive(ev.hand);
      break;
    case 'action':
      setStatus(`나: ${ACTION_TEXT[ev.action]}${shownHands.length > 1 ? ` (핸드 ${ev.hand + 1})` : ''}`);
      break;
    case 'double':
      bets = [...snap.bets];
      await scene.animateBet(snap);
      updateLabels();
      break;
    case 'split':
      split = true;
      shownHands.splice(ev.hand + 1, 0, [shownHands[ev.hand].pop()]);
      bets = [...snap.bets];
      await scene.splitHand(ev.hand);
      await scene.animateBet(snap);
      updateLabels();
      break;
    case 'hand-done':
      if (ev.reason === 'bust') {
        bets[ev.hand] = 0;
        scene.setHandLabel(ev.hand, handText(ev.hand), 'lose');
        await scene.loseHand(ev.hand);
        scene.setMood('happy');
      } else if (ev.reason === 'blackjack') {
        scene.say('블랙잭!');
      }
      await sleep(250);
      break;
    case 'reveal':
      scene.setActive(null);
      shownDealer[1] = ev.card;
      await scene.revealHole(ev.card);
      updateLabels();
      await sleep(350);
      break;
    case 'dealer-done':
      scene.say(ev.bust ? '버스트!' : `${ev.total}`);
      await sleep(500);
      break;
    case 'settle': {
      for (const r of ev.results) {
        const { text, tone } = OUTCOME[r.outcome];
        const amount = r.payout - r.bet;
        scene.setHandLabel(r.hand, amount ? `${text} ${signed(amount)}` : text, tone);
      }
      await scene.settle(ev.results, snap);
      const dealer = describeHand(shownDealer);
      const mine = shownHands.map((_, i) => handText(i)).join(' / ');
      const detail = [`딜러 ${dealer} · 나 ${mine}`, insuranceNote].filter(Boolean).join(' · ');
      const natural = ev.results.length === 1 && ev.results[0].outcome === 'blackjack';
      if (ev.net > 0) {
        scene.setMood('sad');
        showBanner(natural ? `블랙잭! ${signed(ev.net)}` : `승리 ${signed(ev.net)}`, natural ? `3:2 지급 · ${detail}` : detail, 'win');
      } else if (ev.net < 0) {
        scene.setMood('happy');
        showBanner(`패배 ${signed(ev.net)}`, detail, 'lose');
      } else if (ev.results.every((r) => r.outcome === 'push')) {
        showBanner('푸시', `베팅을 돌려받습니다 · ${detail}`, 'push');
      } else {
        showBanner('본전', detail, 'push');
      }
      setStatus('');
      $('my-hand').textContent = '';
      break;
    }
    case 'round-end':
      scene.say('');
      updateInfo(snap);
      if (ev.gameOver) {
        scene.setMood('happy');
        showBanner('게임 오버', `칩이 ${fmt(snap.chips)} 남아 더 베팅할 수 없습니다`, 'lose');
      }
      break;
  }
}

async function run(events) {
  busy = true;
  for (const ev of events) await handle(ev);
  await flushDealing();
  busy = false;
  if (game.phase === 'insurance') promptInsurance();
  else if (game.phase === 'playing') promptPlayer();
  else if (game.phase === 'betting') promptBet();
  else if (game.phase === 'game-over') {
    $('btn-next').hidden = false;
  }
}

// ---------- 베팅 ----------

function updateBetControls() {
  pendingBet = Math.min(pendingBet, game.chips);
  for (const button of document.querySelectorAll('[data-chip]')) {
    button.disabled = pendingBet + Number(button.dataset.chip) > game.chips;
  }
  $('btn-clear').disabled = pendingBet === 0;
  $('btn-deal').disabled = !game.canBet(pendingBet);
  $('btn-deal').textContent = pendingBet ? `딜 · ${fmt(pendingBet)}` : '딜';
  scene.previewBet(pendingBet, game.chips);
}

function promptBet() {
  betting = true;
  if (game.lastBet) pendingBet = game.lastBet;
  updateBetControls();
  setStatus(`베팅액을 고르세요 (최소 ${game.rules.minBet})`);
  $('bet-controls').hidden = false;
}

function addChip(value) {
  if (!betting || pendingBet + value > game.chips) return;
  pendingBet += value;
  updateBetControls();
}

function clearBet() {
  if (!betting) return;
  pendingBet = 0;
  updateBetControls();
}

async function deal() {
  if (!betting || !game.canBet(pendingBet)) return;
  betting = false;
  $('bet-controls').hidden = true;
  $('banner').hidden = true;
  setStatus('');
  await scene.clearTable();
  run(game.deal(pendingBet));
}

// ---------- 인슈어런스 ----------

function promptInsurance() {
  insuring = true;
  const cost = Math.floor(game.hands[0].bet / 2);
  $('btn-insure').textContent = `보험 들기 · ${fmt(cost)}`;
  setStatus('딜러가 A 를 보입니다. 보험(인슈어런스)을 들까요? 딜러가 블랙잭이면 2:1 로 받습니다');
  $('insurance-controls').hidden = false;
}

function insure(take) {
  if (!insuring) return;
  insuring = false;
  $('insurance-controls').hidden = true;
  run(game.insure(take));
}

// ---------- 행동 ----------

function promptPlayer() {
  legal = game.legalActions();
  $('btn-hit').disabled = !legal.hit;
  $('btn-stand').disabled = !legal.stand;
  $('btn-double').disabled = !legal.double;
  $('btn-split').disabled = !legal.split;
  $('btn-double').textContent = legal.double ? `더블 · ${fmt(game.activeHand.bet)}` : '더블';
  scene.setActive(game.active);
  setStatus(game.hands.length > 1 ? `핸드 ${game.active + 1} / ${game.hands.length} 차례입니다` : '당신 차례입니다');
  updateLabels();
  $('controls').hidden = false;
}

function playerAct(type) {
  if (!legal || !legal[type]) return;
  legal = null;
  $('controls').hidden = true;
  run(game.act(type));
}

function newGame() {
  if ($('btn-next').hidden) return;
  $('btn-next').hidden = true;
  $('banner').hidden = true;
  game = new BlackjackGame();
  pendingBet = 50;
  scene.clearTable().then(() => {
    scene.setDiscarded(0);
    scene.setChips(game.snapshot());
    $('info').textContent = '';
    promptBet();
  });
}

for (const button of document.querySelectorAll('[data-chip]')) {
  button.addEventListener('click', () => addChip(Number(button.dataset.chip)));
}
$('btn-clear').addEventListener('click', clearBet);
$('btn-deal').addEventListener('click', deal);
$('btn-insure').addEventListener('click', () => insure(true));
$('btn-decline').addEventListener('click', () => insure(false));
$('btn-hit').addEventListener('click', () => playerAct('hit'));
$('btn-stand').addEventListener('click', () => playerAct('stand'));
$('btn-double').addEventListener('click', () => playerAct('double'));
$('btn-split').addEventListener('click', () => playerAct('split'));
$('btn-next').addEventListener('click', newGame);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const key = e.key.toLowerCase();
  let handled = true;
  if (legal) {
    const actions = { h: 'hit', s: 'stand', d: 'double', p: 'split' };
    if (actions[key]) playerAct(actions[key]);
    else handled = false;
  } else if (insuring) {
    if (key === 'y' || key === 'i') insure(true);
    else if (key === 'n') insure(false);
    else handled = false;
  } else if (betting) {
    if (key >= '1' && key <= '4') addChip(CHIP_VALUES[Number(key) - 1]);
    else if (key === 'backspace' || key === 'delete') clearBet();
    else if (key === 'enter' || key === ' ') deal();
    else handled = false;
  } else if (key === 'enter' || key === ' ') {
    newGame();
  } else {
    handled = false;
  }
  if (handled) e.preventDefault();
});

// ?debug 로 열면 콘솔에서 씬과 게임 상태를 들여다볼 수 있다
if (params.has('debug')) {
  window.blackjack = {
    scene,
    get game() {
      return game;
    },
    get busy() {
      return busy;
    },
  };
}

try {
  await scene.load();
  $('loading').hidden = true;
  game = new BlackjackGame();
  scene.setChips(game.snapshot());
  promptBet();
} catch (error) {
  console.error(error);
  $('loading').hidden = false;
  $('loading').textContent = `불러오기에 실패했습니다: ${error.message}`;
}
