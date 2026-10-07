// 게임 엔진의 이벤트를 3D 씬 애니메이션과 HUD 로 재생하는 컨트롤러.

import { BlackjackGame } from './game.js';
import { describeHand, isBust } from './rules.js';
import { TableScene } from './scene.js';
import { applyI18n, formatNumber, mountLangToggle } from '../../shared/i18n.js';
import { t } from './i18n.js';
import { focusForKeyboard } from '../../shared/ui.js';

const $ = (id) => document.getElementById(id);
const fmt = formatNumber;
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const params = new URLSearchParams(location.search);

applyI18n(t);
for (const el of document.querySelectorAll('[data-shortcut]')) el.title = t('shortcut', { key: el.dataset.shortcut });
mountLangToggle($('lang-controls'), { className: 'chip' });

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
    const tone = isBust(cards) ? 'lose' : undefined;
    scene.setHandLabel(i, value && bets[i] ? `${value} · ${fmt(bets[i])}` : value, tone);
  });
  const visible = shownDealer.filter(Boolean);
  // 앞면 한 장만 보일 때 A 는 '소프트 11' 대신 A 로
  const dealer = visible.length === 1 && visible[0].rank === 14 ? 'A' : describeHand(visible);
  scene.setDealerLabel(visible.length ? t('dealer', { hand: dealer }) : '');
  const active = legal ? game.active : -1;
  $('my-hand').textContent = shownHands[active] ? t('myHand', { hand: handText(active) }) : '';
}

function updateInfo(snap) {
  $('info').textContent = t('info', { n: game.round, shoe: fmt(snap.shoe) });
}

const OUTCOME_TONE = { blackjack: 'win', win: 'win', push: 'push', lose: 'lose', bust: 'lose' };

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
      setStatus(t('shuffling'));
      scene.say(t('sayShuffle'));
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
      scene.say(t('sayInsurance'));
      break;
    case 'insurance':
      scene.say('');
      if (ev.taken) await scene.animateBet(snap);
      setStatus(ev.taken ? t('insuranceTaken', { amount: fmt(ev.amount) }) : t('insuranceDeclined'));
      break;
    case 'peek':
      setStatus(t('peeking'));
      await scene.peek();
      setStatus('');
      if (ev.blackjack) scene.say(t('sayBlackjack'));
      break;
    case 'insurance-result':
      insuranceNote = t('insuranceNote', { amount: signed(ev.won ? ev.payout - ev.amount : -ev.amount) });
      setStatus(ev.won ? t('insuranceWon', { amount: fmt(ev.payout - ev.amount) }) : t('insuranceLost'));
      await scene.insuranceResult(ev, snap);
      break;
    case 'turn':
      scene.setActive(ev.hand);
      break;
    case 'action': {
      const text = t(`action.${ev.action}`);
      setStatus(t('mine', { text: shownHands.length > 1 ? t('handN', { text, n: ev.hand + 1 }) : text }));
      break;
    }
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
        scene.say(t('sayBlackjack'));
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
      scene.say(ev.bust ? t('sayBust') : `${ev.total}`);
      await sleep(500);
      break;
    case 'settle': {
      for (const r of ev.results) {
        const text = t(`outcome.${r.outcome}`);
        const tone = OUTCOME_TONE[r.outcome];
        const amount = r.payout - r.bet;
        scene.setHandLabel(r.hand, amount ? `${text} ${signed(amount)}` : text, tone);
      }
      await scene.settle(ev.results, snap);
      const dealer = describeHand(shownDealer);
      const mine = shownHands.map((_, i) => handText(i)).join(' / ');
      const detail = [t('settleDetail', { dealer, mine }), insuranceNote].filter(Boolean).join(' · ');
      const natural = ev.results.length === 1 && ev.results[0].outcome === 'blackjack';
      if (ev.net > 0) {
        scene.setMood('sad');
        showBanner(
          t(natural ? 'bannerBlackjack' : 'bannerWin', { amount: signed(ev.net) }),
          natural ? t('paid32', { detail }) : detail,
          'win',
        );
      } else if (ev.net < 0) {
        scene.setMood('happy');
        showBanner(t('bannerLose', { amount: signed(ev.net) }), detail, 'lose');
      } else if (ev.results.every((r) => r.outcome === 'push')) {
        showBanner(t('bannerPush'), t('pushDetail', { detail }), 'push');
      } else {
        showBanner(t('bannerEven'), detail, 'push');
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
        showBanner(t('gameOver'), t('gameOverDetail', { amount: fmt(snap.chips) }), 'lose');
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
    focusForKeyboard($('btn-next'));
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
  $('btn-deal').textContent = pendingBet ? t('dealAmount', { amount: fmt(pendingBet) }) : t('deal');
  scene.previewBet(pendingBet, game.chips);
}

function promptBet() {
  betting = true;
  $('btn-new').disabled = false;
  if (game.lastBet) pendingBet = game.lastBet;
  updateBetControls();
  setStatus(t('placeBet', { min: fmt(game.rules.minBet) }));
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
  $('btn-new').disabled = true;
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
  $('btn-insure').textContent = t('insureAmount', { amount: fmt(cost) });
  setStatus(t('insurancePrompt'));
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
  $('btn-double').textContent = legal.double ? t('doubleAmount', { amount: fmt(game.activeHand.bet) }) : t('double');
  scene.setActive(game.active);
  setStatus(game.hands.length > 1 ? t('handTurn', { n: game.active + 1, count: game.hands.length }) : t('yourTurn'));
  updateLabels();
  $('controls').hidden = false;
}

function playerAct(type) {
  if (!legal || !legal[type]) return;
  legal = null;
  $('controls').hidden = true;
  run(game.act(type));
}

/** 칩 1,000 으로 새 게임. 게임 오버 뒤(btn-next)와 베팅을 고르는 단계(머리글 btn-new)에서만 */
function newGame() {
  if ($('btn-next').hidden && !betting) return;
  betting = false;
  $('btn-new').disabled = true;
  $('bet-controls').hidden = true;
  $('btn-next').hidden = true;
  $('banner').hidden = true;
  setStatus('');
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
$('btn-new').addEventListener('click', newGame);

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

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (e.key === 'Escape') return closeHelp();
  if (e.key === '?') return openHelp();
  // 도움말이 열려 있는 동안은 게임 단축키를 받지 않는다
  if (!$('help').hidden || e.target instanceof HTMLInputElement) return;
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
    else if (key === 'n') newGame();
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
  $('loading').textContent = t('loadFailed', { message: error.message });
}
