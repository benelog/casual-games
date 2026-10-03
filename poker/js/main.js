// 게임 엔진의 이벤트를 3D 씬 애니메이션과 HUD 로 재생하는 컨트롤러.
// 종목은 ?game=holdem 처럼 주소로 고르고, 없으면 선택 메뉴를 보여 준다.

import { PokerGame } from './game.js';
import { decideAction, decideDraw } from './ai.js';
import { VARIANTS } from './variants.js';
import { TableScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('ko-KR');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const params = new URLSearchParams(location.search);
const variant = VARIANTS[params.get('game')];

const scene = new TableScene($('stage'));
const slider = $('raise-slider');

let game;
let legal = null; // 내가 베팅할 차례일 때만 설정된다
let drawing = false; // 내가 카드를 교환할 차례인지
let shownHole = []; // 화면에 이미 놓인 내 카드 (엔진은 애니메이션보다 앞서 간다)
let shownBoard = [];
let showdown = null;

function setStatus(text) {
  $('status').textContent = text;
}

function actionText(ev) {
  const suffix = ev.allIn ? ' (올인)' : '';
  switch (ev.action) {
    case 'fold':
      return '폴드';
    case 'check':
      return '체크';
    case 'call':
      return `콜 ${fmt(ev.amount)}${suffix}`;
    case 'bet':
      return `벳 ${fmt(ev.to)}${suffix}`;
    default:
      return `레이즈 ${fmt(ev.to)}${suffix}`;
  }
}

const drawText = (count) => (count ? `${count}장 교환` : '교환 없음');

function updateMyHand() {
  // 스터드는 받은 카드만으로, 나머지는 5장이 모인 뒤부터 족보를 보여 준다
  const ready = variant.id === 'stud' ? shownHole.length > 0 : shownHole.length + shownBoard.length >= 5;
  $('my-hand').textContent = ready ? `내 패: ${variant.evaluate(shownHole, shownBoard).name}` : '';
}

function showBanner(title, detail, tone) {
  $('banner-title').textContent = title;
  $('banner-detail').textContent = detail;
  $('banner').dataset.tone = tone;
  setStatus('');
  $('my-hand').textContent = '';
  $('banner').hidden = false;
}

async function handle(ev) {
  const snap = ev.snap;
  switch (ev.type) {
    case 'hand-start': {
      shownHole = [];
      shownBoard = [];
      showdown = null;
      scene.clearCards();
      scene.setChips(snap);
      scene.say('');
      scene.setMood(ev.handNumber === 1 ? 'hello' : 'neutral');
      setStatus('');
      $('my-hand').textContent = '';
      const stakes =
        variant.forced === 'ante' ? `앤티 ${game.smallBlind}` : `블라인드 ${game.smallBlind}/${game.bigBlind}`;
      $('info').textContent = `${variant.name} · 핸드 #${ev.handNumber} · ${stakes}`;
      await scene.setDealer(ev.dealer);
      break;
    }
    case 'blind':
      await scene.animateBet(ev.player, snap);
      break;
    case 'deal':
      await scene.dealCards(ev.cards);
      shownHole.push(...ev.cards.filter((c) => c.player === 0).map((c) => c.card));
      updateMyHand();
      await sleep(200);
      break;
    case 'draw':
      if (ev.player === 1) scene.say(drawText(ev.indices.length));
      else setStatus(`나: ${drawText(ev.indices.length)}`);
      await scene.replaceCards(ev.player, ev.indices, ev.cards);
      if (ev.player === 0) {
        ev.indices.forEach((index, k) => (shownHole[index] = ev.cards[k]));
        updateMyHand();
      }
      await sleep(350);
      break;
    case 'action':
      if (ev.player === 1) {
        scene.say(actionText(ev));
        if (ev.amount > 0) scene.setMood('act');
      } else {
        setStatus(`나: ${actionText(ev)}`);
      }
      await scene.animateBet(ev.player, snap);
      if (ev.action === 'fold') await scene.muck(ev.player);
      await sleep(350);
      break;
    case 'collect':
      await scene.collectBets(snap);
      scene.say('');
      break;
    case 'reveal':
      await scene.revealOpponent();
      await sleep(400);
      break;
    case 'street':
      await scene.dealBoard(ev.cards);
      shownBoard.push(...ev.cards);
      updateMyHand();
      await sleep(300);
      break;
    case 'showdown':
      showdown = ev;
      scene.highlight(ev.winners.flatMap((w) => ev.hands[w].cards));
      scene.say(ev.hands[1].name);
      await sleep(600);
      break;
    case 'award': {
      await scene.awardPot(ev.amounts, snap);
      const detail =
        ev.reason === 'showdown'
          ? `${showdown.hands[0].name} vs ${showdown.hands[1].name}`
          : ev.winners[0] === 0
            ? '컴퓨터가 폴드했습니다'
            : '폴드했습니다';
      if (ev.winners.length === 2) {
        showBanner('무승부', `${detail} · 팟을 나눕니다`, 'tie');
      } else if (ev.winners[0] === 0) {
        scene.setMood('sad');
        showBanner(`승리 +${fmt(ev.amounts[0])}`, detail, 'win');
      } else {
        scene.setMood('happy');
        showBanner(`패배 · 컴퓨터 +${fmt(ev.amounts[1])}`, detail, 'lose');
      }
      break;
    }
    case 'hand-end':
      if (ev.gameOver) {
        const won = ev.winner === 0;
        scene.setMood(won ? 'dead' : 'happy');
        showBanner(won ? '게임 승리!' : '게임 오버', won ? '컴퓨터의 칩을 모두 땄습니다' : '칩을 모두 잃었습니다', won ? 'win' : 'lose');
      }
      $('btn-next').textContent = ev.gameOver ? '새 게임' : '다음 핸드';
      $('btn-next').hidden = false;
      break;
  }
}

async function run(events) {
  for (const ev of events) await handle(ev);
  if (game.phase === 'betting') {
    if (game.toAct === 0) promptPlayer();
    else computerTurn(() => game.act(decideAction(game)));
  } else if (game.phase === 'drawing') {
    if (game.toAct === 0) promptDraw();
    else computerTurn(() => game.draw(decideDraw(game.players[1].hole)));
  }
}

async function computerTurn(decide) {
  setStatus('컴퓨터가 생각 중…');
  await sleep(600 + Math.random() * 700);
  setStatus('');
  run(decide());
}

// ---------- 베팅 ----------

function updateRaiseButton() {
  const amount = Number(slider.value);
  const verb = amount === legal.allInTo ? '올인' : game.currentBet === 0 ? '벳' : '레이즈';
  $('btn-raise').textContent = `${verb} ${fmt(amount)}`;
}

function setRaise(amount) {
  slider.value = Math.min(Math.max(amount, legal.minRaiseTo), legal.maxRaiseTo);
  updateRaiseButton();
}

function promptPlayer() {
  legal = game.legalActions();
  const allIn = legal.callAmount === game.players[0].chips;
  $('btn-fold').disabled = legal.canCheck;
  $('btn-call').textContent = legal.canCheck ? '체크' : `콜 ${fmt(legal.callAmount)}${allIn ? ' (올인)' : ''}`;
  $('raise-row').hidden = $('btn-raise').hidden = !legal.canRaise;
  if (legal.canRaise) {
    slider.min = legal.minRaiseTo;
    slider.max = legal.maxRaiseTo;
    slider.step = (legal.maxRaiseTo - legal.minRaiseTo) % 10 === 0 ? 10 : 1;
    setRaise(legal.minRaiseTo);
  }
  setStatus('당신 차례입니다');
  $('controls').hidden = false;
}

function playerAct(action) {
  if (!legal) return;
  legal = null;
  $('controls').hidden = true;
  run(game.act(action));
}

// ---------- 카드 교환 ----------

function promptDraw() {
  drawing = true;
  const update = (indices) => ($('btn-draw').textContent = indices.length ? drawText(indices.length) : '교환 없이 진행');
  scene.enableSelection(update);
  update([]);
  setStatus('바꿀 카드를 클릭해 고르세요');
  $('draw-controls').hidden = false;
}

function confirmDraw() {
  if (!drawing) return;
  drawing = false;
  const indices = scene.selection();
  scene.disableSelection();
  $('draw-controls').hidden = true;
  run(game.draw(indices));
}

function nextHand() {
  if ($('btn-next').hidden) return;
  $('btn-next').hidden = true;
  $('banner').hidden = true;
  if (game.phase === 'game-over') game = new PokerGame({ variant: variant.id });
  run(game.startHand());
}

$('btn-fold').addEventListener('click', () => !$('btn-fold').disabled && playerAct({ type: 'fold' }));
$('btn-call').addEventListener('click', () => playerAct({ type: 'call' }));
$('btn-raise').addEventListener('click', () => playerAct({ type: 'raise', amount: Number(slider.value) }));
$('btn-draw').addEventListener('click', confirmDraw);
$('btn-next').addEventListener('click', nextHand);
slider.addEventListener('input', updateRaiseButton);

for (const button of document.querySelectorAll('[data-preset]')) {
  button.addEventListener('click', () => {
    if (!legal) return;
    const preset = button.dataset.preset;
    if (preset === 'min') return setRaise(legal.minRaiseTo);
    if (preset === 'max') return setRaise(legal.maxRaiseTo);
    // 콜한 뒤의 팟을 기준으로 한 비율
    const size = (game.pot + legal.callAmount) * Number(preset);
    setRaise(game.currentBet + Math.round(size / 10) * 10);
  });
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
  const key = e.key.toLowerCase();
  if (legal) {
    if (key === 'f' && !legal.canCheck) playerAct({ type: 'fold' });
    else if (key === 'c') playerAct({ type: 'call' });
    else if (key === 'r' && legal.canRaise) playerAct({ type: 'raise', amount: Number(slider.value) });
  } else if (drawing) {
    if (key >= '1' && key <= '9') scene.toggleCard(Number(key) - 1);
    else if (key === 'enter') confirmDraw();
  } else if (key === 'enter' || key === ' ') {
    nextHand();
  }
});

function showMenu() {
  for (const v of Object.values(VARIANTS)) {
    const link = document.createElement('a');
    link.href = `?game=${v.id}`;
    const name = document.createElement('strong');
    name.textContent = v.name;
    const summary = document.createElement('span');
    summary.textContent = v.summary;
    link.append(name, summary);
    $('menu-list').append(link);
  }
  $('menu').hidden = false;
}

// ?debug 로 열면 콘솔에서 씬과 게임 상태를 들여다볼 수 있다
if (params.has('debug')) {
  window.poker = { scene, get game() { return game; } };
}

try {
  await scene.load();
  $('loading').hidden = true;
  if (variant) {
    document.title = `${variant.name} · 3D 포커`;
    $('change').hidden = false;
    document.querySelector('[data-preset="max"]').textContent = variant.potLimit ? '최대' : '올인';
    game = new PokerGame({ variant: variant.id });
    run(game.startHand());
  } else {
    showMenu();
  }
} catch (error) {
  console.error(error);
  $('loading').hidden = false;
  $('loading').textContent = `불러오기에 실패했습니다: ${error.message}`;
}
