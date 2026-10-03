import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blackjackWin,
  dealerShouldHit,
  describeHand,
  handValue,
  insuranceCost,
  isBlackjack,
  isBust,
  isPair,
  settleHand,
} from '../js/rules.js';
import { Shoe } from '../js/shoe.js';
import { BlackjackGame } from '../js/game.js';

const SUIT = { s: 0, h: 1, d: 2, c: 3 };
const RANK = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
const cards = (text) =>
  text.split(' ').map((t) => ({ rank: RANK[t[0]] ?? Number(t[0]), suit: SUIT[t[1]] }));
const value = (text) => handValue(cards(text));

function seededRng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 정해진 순서로 카드를 내주는 슈. 첫 딜 순서는 플레이어, 딜러(앞면), 플레이어, 딜러(홀 카드).
 * 예: rigged('Ts 6h 9d Kc', ...) → 플레이어 T 9, 딜러 6 K
 */
function rigged(...texts) {
  const queue = cards(texts.join(' '));
  return {
    remaining: 300,
    needsShuffle: false,
    shuffle() {},
    draw() {
      if (queue.length === 0) throw new Error('준비한 카드가 떨어졌습니다');
      return queue.shift();
    },
  };
}

const game = (...texts) => new BlackjackGame({ shoe: rigged(...texts) });
const types = (events) => events.map((e) => e.type);

test('핸드 값: A 는 소프트/하드로 바뀐다', () => {
  assert.deepEqual(value('As 6h'), { total: 17, soft: true });
  assert.deepEqual(value('As 6h Th'), { total: 17, soft: false });
  assert.deepEqual(value('As Ah'), { total: 12, soft: true });
  assert.deepEqual(value('As Ah 9d'), { total: 21, soft: true });
  assert.deepEqual(value('As Ah Ad Ac'), { total: 14, soft: true });
  assert.deepEqual(value('As Ah Ad Ac Kd 7c'), { total: 21, soft: false });
  assert.deepEqual(value('Ks Qh'), { total: 20, soft: false });
  assert.deepEqual(value('Ks Qh 5d'), { total: 25, soft: false });
  assert.deepEqual(value('2s 3h 4d 5c 6s'), { total: 20, soft: false });
});

test('블랙잭과 버스트 판정', () => {
  assert.ok(isBlackjack(cards('As Kh')));
  assert.ok(isBlackjack(cards('Ts Ad')));
  assert.ok(!isBlackjack(cards('7s 7h 7d'))); // 세 장 21 은 블랙잭이 아니다
  assert.ok(!isBlackjack(cards('As 9h')));
  assert.ok(isBust(cards('Ks Qh 2d')));
  assert.ok(!isBust(cards('As Kh Qd')));
  assert.equal(describeHand(cards('As Kh')), '블랙잭');
  assert.equal(describeHand(cards('As Kh'), { fromSplit: true }), '21');
  assert.equal(describeHand(cards('As 6h')), '소프트 17');
  assert.equal(describeHand(cards('Ks 6h 9c')), '버스트 25');
});

test('스플릿은 같은 랭크 한 쌍만', () => {
  assert.ok(isPair(cards('8s 8h')));
  assert.ok(isPair(cards('As Ad')));
  assert.ok(!isPair(cards('Ks Qh')));
  assert.ok(!isPair(cards('8s 8h 8d')));
});

test('딜러는 16 이하에서 히트, 소프트 17 을 포함한 17 이상에서 스탠드', () => {
  assert.ok(dealerShouldHit(cards('Ts 6h')));
  assert.ok(dealerShouldHit(cards('As 5h')));
  assert.ok(!dealerShouldHit(cards('Ts 7h')));
  assert.ok(!dealerShouldHit(cards('As 6h')));
  assert.ok(dealerShouldHit(cards('As 6h'), { hitSoft17: true }));
  assert.ok(!dealerShouldHit(cards('As 7h'), { hitSoft17: true }));
  assert.ok(!dealerShouldHit(cards('As 6h Th'))); // 하드 17
  assert.ok(!dealerShouldHit(cards('As 6h Th'), { hitSoft17: true }));
});

test('정산: 블랙잭 3:2, 승리 1:1, 푸시 반환, 패배', () => {
  const settle = (player, dealer, bet = 100, fromSplit = false) =>
    settleHand({ cards: cards(player), bet, fromSplit }, cards(dealer));
  assert.deepEqual(settle('As Kh', 'Ts 9h'), { outcome: 'blackjack', payout: 250 });
  assert.deepEqual(settle('As Kh', 'Ad Qc'), { outcome: 'push', payout: 100 });
  assert.deepEqual(settle('Ts 9h Ad', 'Ad Qc'), { outcome: 'lose', payout: 0 });
  assert.deepEqual(settle('As Kh', 'Ts 9h', 100, true), { outcome: 'win', payout: 200 }); // 스플릿 후 21
  assert.deepEqual(settle('Ts 9h', 'Ts 8h'), { outcome: 'win', payout: 200 });
  assert.deepEqual(settle('Ts 8h', 'Ts 8h'), { outcome: 'push', payout: 100 });
  assert.deepEqual(settle('Ts 7h', 'Ts 8h'), { outcome: 'lose', payout: 0 });
  assert.deepEqual(settle('Ts 7h', 'Ts 6h 9c'), { outcome: 'win', payout: 200 }); // 딜러 버스트
  assert.deepEqual(settle('Ts 7h 9c', 'Ts 6h 9c'), { outcome: 'bust', payout: 0 }); // 둘 다 버스트면 플레이어가 진다
  assert.equal(blackjackWin(10), 15);
  assert.equal(blackjackWin(25), 37); // 끝수는 버린다
  assert.equal(insuranceCost(100), 50);
});

test('슈: 6덱, 컷 카드 이후 다음 라운드에서 다시 섞는다', () => {
  const shoe = new Shoe({ decks: 6, penetration: 0.75, rng: seededRng(1) });
  assert.equal(shoe.remaining, 312);
  const counts = new Map();
  for (const c of shoe.cards) counts.set(`${c.rank}-${c.suit}`, (counts.get(`${c.rank}-${c.suit}`) ?? 0) + 1);
  assert.equal(counts.size, 52);
  assert.ok([...counts.values()].every((n) => n === 6));
  for (let i = 0; i < 233; i++) shoe.draw();
  assert.ok(!shoe.needsShuffle);
  shoe.draw();
  assert.ok(shoe.needsShuffle); // 234 = 312 × 0.75

  const g = new BlackjackGame({ shoe, startingChips: 1000 });
  const events = g.deal(10);
  assert.equal(events[0].type, 'shuffle');
  assert.equal(shoe.shuffleCount, 2);
  assert.equal(shoe.remaining, 312 - 4);
});

test('슈가 바닥나면 새로 섞어 이어 간다', () => {
  const shoe = new Shoe({ decks: 1, rng: seededRng(2) });
  for (let i = 0; i < 52; i++) shoe.draw();
  assert.ok(shoe.draw());
  assert.equal(shoe.remaining, 51);
});

test('스탠드하면 딜러가 17 까지 받고 이기면 1:1', () => {
  const g = game('Ts 6h 9d Kc', '5s'); // 나 T9 = 19, 딜러 6K = 16 → 5 받아 21
  g.deal(100);
  assert.equal(g.phase, 'playing');
  assert.equal(g.chips, 900);
  const events = g.act('stand');
  assert.deepEqual(types(events), ['action', 'hand-done', 'reveal', 'deal', 'dealer-done', 'settle', 'round-end']);
  assert.equal(handValue(g.dealer).total, 21);
  assert.equal(g.chips, 900);
  assert.equal(g.phase, 'betting');

  const g2 = game('Ts 6h 9d Kc', '8s'); // 딜러 버스트
  g2.deal(100);
  const settle = g2.act('stand').find((e) => e.type === 'settle');
  assert.equal(settle.results[0].outcome, 'win');
  assert.equal(settle.net, 100);
  assert.equal(g2.chips, 1100);
});

test('딜러는 소프트 17 에서 스탠드한다', () => {
  const g = game('Ts As 8d 6c'); // 나 18, 딜러 A6 = 소프트 17
  g.deal(100);
  // A 를 보였으니 인슈어런스부터
  assert.equal(g.phase, 'insurance');
  g.insure(false);
  const events = g.act('stand');
  assert.equal(g.dealer.length, 2);
  assert.equal(events.find((e) => e.type === 'settle').results[0].outcome, 'win');
});

test('히트로 버스트하면 딜러는 더 받지 않고 진다', () => {
  const g = game('Ts 6h 6d Kc', 'Qs'); // 나 16 → Q 받아 26
  g.deal(50);
  const events = g.act('hit');
  assert.deepEqual(
    events.filter((e) => e.type === 'hand-done').map((e) => e.reason),
    ['bust'],
  );
  assert.equal(g.dealer.length, 2);
  assert.equal(events.find((e) => e.type === 'settle').results[0].outcome, 'bust');
  assert.equal(g.chips, 950);
});

test('히트로 21 이 되면 자동으로 스탠드', () => {
  const g = game('5s 6h 6d Kc', 'Ts 2s'); // 나 11 → T 받아 21, 딜러 16 → 2 받아 18
  g.deal(100);
  const events = g.act('hit');
  assert.ok(events.some((e) => e.type === 'hand-done' && e.reason === '21'));
  assert.equal(g.phase, 'betting');
  assert.equal(g.chips, 1100);
});

test('블랙잭은 3:2 로 즉시 지급', () => {
  const g = game('As 9h Kd 7c');
  const events = g.deal(100);
  assert.ok(types(events).includes('settle'));
  assert.equal(events.find((e) => e.type === 'settle').results[0].outcome, 'blackjack');
  assert.equal(g.chips, 1150);
  assert.equal(g.phase, 'betting');
});

test('둘 다 블랙잭이면 푸시', () => {
  const g = game('As Ah Kd Kc'); // 나 A K, 딜러 A K
  g.deal(100);
  const events = g.insure(false);
  assert.ok(events.some((e) => e.type === 'peek' && e.blackjack));
  assert.equal(events.find((e) => e.type === 'settle').results[0].outcome, 'push');
  assert.equal(g.chips, 1000);
});

test('딜러가 10 을 보이고 블랙잭이면 피크로 바로 끝난다', () => {
  const g = game('9s Kh 9d Ac');
  const events = g.deal(100);
  assert.deepEqual(types(events).slice(-4), ['peek', 'reveal', 'settle', 'round-end']);
  assert.ok(events.some((e) => e.type === 'peek' && e.blackjack));
  assert.equal(g.phase, 'betting');
  assert.equal(g.chips, 900);

  const g2 = game('9s Kh 9d 7c');
  const events2 = g2.deal(100);
  assert.ok(events2.some((e) => e.type === 'peek' && !e.blackjack));
  assert.equal(g2.phase, 'playing');
});

test('인슈어런스: 딜러 블랙잭이면 2:1, 아니면 잃는다', () => {
  const g = game('Ts Ah 9d Kc'); // 딜러 A K 블랙잭
  g.deal(100);
  assert.equal(g.phase, 'insurance');
  const events = g.insure(true);
  const result = events.find((e) => e.type === 'insurance-result');
  assert.deepEqual([result.won, result.amount, result.payout], [true, 50, 150]);
  assert.equal(g.chips, 1000); // 본 베팅 -100, 인슈어런스 +100
  assert.equal(g.phase, 'betting');

  const g2 = game('Ts Ah 9d 7c', '2s'); // 딜러 A7 = 소프트 18
  g2.deal(100);
  const events2 = g2.insure(true);
  assert.equal(events2.find((e) => e.type === 'insurance-result').won, false);
  assert.equal(g2.chips, 850);
  assert.equal(g2.insurance, 0);
  g2.act('stand'); // 19 vs 18
  assert.equal(g2.chips, 1050);
});

test('블랙잭으로 인슈어런스를 들면 이븐 머니와 같다', () => {
  for (const hole of ['Kc', '7c']) {
    const g = game(`As Ah Kd ${hole}`);
    g.deal(100);
    g.insure(true);
    assert.equal(g.chips, 1100, hole);
  }
});

test('칩이 부족하면 인슈어런스를 묻지 않는다', () => {
  const g = new BlackjackGame({ shoe: rigged('Ts Ah 9d 7c'), startingChips: 100 });
  g.deal(100);
  assert.equal(g.phase, 'playing');
});

test('더블: 베팅 두 배, 한 장만 받고 끝', () => {
  const g = game('6s 6h 5d Tc', 'Ts', '7s'); // 나 11 → T 받아 21, 딜러 16 + 7 = 23 버스트
  g.deal(100);
  assert.ok(g.legalActions().double);
  const events = g.act('double');
  const deal = events.find((e) => e.type === 'deal' && e.to === 'player');
  assert.ok(deal.sideways); // 더블로 받은 카드는 옆으로 눕혀 놓는다
  assert.deepEqual(deal.snap.bets, [200]);
  assert.equal(g.hands[0].cards.length, 3);
  assert.ok(events.some((e) => e.type === 'hand-done' && e.reason === 'double'));
  assert.equal(g.chips, 1200);
});

test('더블 후 정산', () => {
  const g2 = game('6s 6h 5d Tc', '2s', '9s'); // 나 13, 딜러 16 + 9 = 25 버스트
  g2.deal(100);
  g2.act('double');
  assert.equal(g2.chips, 1200);

  const g3 = game('6s Th 5d 9c', '2s'); // 나 13, 딜러 19
  g3.deal(100);
  g3.act('double');
  assert.equal(g3.chips, 800);
});

test('칩이 모자라면 더블·스플릿 불가, 세 장째에는 더블 불가', () => {
  const g = new BlackjackGame({ shoe: rigged('8s 6h 8d Tc', '2c'), startingChips: 150 });
  g.deal(100);
  assert.deepEqual(g.legalActions(), { hit: true, stand: true, double: false, split: false });
  assert.throws(() => g.act('split'));
  const g2 = game('5s 6h 4d Tc', '2c');
  g2.deal(100);
  assert.ok(g2.legalActions().double);
  g2.act('hit');
  assert.ok(!g2.legalActions().double);
});

test('스플릿: 두 핸드를 따로 진행하고 따로 정산', () => {
  // 나 8 8, 딜러 6 T. 첫 핸드 8+3 → 더블로 T = 21, 둘째 핸드 8+9 = 17 스탠드, 딜러 16+8 = 24 버스트
  const g = game('8s 6h 8d Tc', '3s', 'Th', '9c', '8h');
  g.deal(100);
  assert.ok(g.legalActions().split);
  const splitEvents = g.act('split');
  assert.deepEqual(types(splitEvents), ['action', 'split', 'deal']);
  assert.equal(g.hands.length, 2);
  assert.equal(g.chips, 800);
  assert.deepEqual(splitEvents.at(-1).snap.bets, [100, 100]);
  assert.equal(g.active, 0);
  assert.equal(handValue(g.hands[0].cards).total, 11);

  const doubleEvents = g.act('double'); // 스플릿 후 더블 허용
  assert.equal(g.active, 1);
  assert.equal(g.hands[1].cards.length, 2); // 차례가 오면서 두 번째 카드를 받음
  assert.ok(doubleEvents.some((e) => e.type === 'turn' && e.hand === 1));

  const events = g.act('stand');
  const settle = events.find((e) => e.type === 'settle');
  assert.deepEqual(
    settle.results.map((r) => [r.outcome, r.bet, r.payout]),
    [
      ['win', 200, 400],
      ['win', 100, 200],
    ],
  );
  assert.equal(g.chips, 1300);
});

test('스플릿한 핸드의 A+10 은 블랙잭이 아닌 21', () => {
  // 나 A A, 딜러 T 7. 스플릿하면 각각 K, 6 을 한 장씩만 받고 끝난다
  const g = game('As Th Ad 7c', 'Kh', '6c');
  g.deal(100);
  const events = g.act('split');
  assert.equal(g.phase, 'betting'); // A 스플릿은 자동으로 끝나 딜러 진행까지
  assert.deepEqual(
    events.filter((e) => e.type === 'hand-done').map((e) => e.reason),
    ['split-aces', 'split-aces'],
  );
  const settle = events.find((e) => e.type === 'settle');
  // 21 vs 17 은 1:1 승리, 소프트 17 vs 17 은 푸시
  assert.deepEqual(
    settle.results.map((r) => r.outcome),
    ['win', 'push'],
  );
  assert.equal(g.chips, 1100);
});

test('재스플릿은 핸드 4개까지', () => {
  const g = game('8s 6h 8d Tc', '8h', '8c', '8s');
  g.deal(10);
  g.act('split'); // [8 8] [8]
  assert.equal(g.hands.length, 2);
  g.act('split'); // [8 8] [8] [8]
  g.act('split'); // [8 8] [8] [8] [8]
  assert.equal(g.hands.length, 4);
  assert.ok(isPair(g.hands[0].cards));
  assert.ok(!g.legalActions().split);
  assert.ok(g.legalActions().double);
  assert.equal(g.chips, 960);
});

test('행동할 수 없는 상태에서는 예외', () => {
  const g = game('Ts 6h 9d Kc');
  assert.throws(() => g.act('hit'));
  assert.throws(() => g.insure(true));
  assert.throws(() => g.deal(5)); // 최소 베팅 미만
  assert.throws(() => g.deal(1001)); // 가진 칩 초과
  assert.throws(() => g.deal(10.5));
  g.deal(100);
  assert.throws(() => g.deal(100));
  assert.throws(() => g.act('fold'));
});

test('칩이 최소 베팅보다 적어지면 게임 오버', () => {
  const g = new BlackjackGame({ shoe: rigged('Ts 6h 7d Kc', '5s'), startingChips: 15 });
  g.deal(10);
  const events = g.act('stand');
  assert.equal(events.at(-1).type, 'round-end');
  assert.equal(events.at(-1).gameOver, true);
  assert.equal(g.phase, 'game-over');
  assert.throws(() => g.deal(10));
});

test('기본 전략 비슷하게 끝까지 해도 칩 계산이 맞는다', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const g = new BlackjackGame({ rng: seededRng(seed * 7919) });
    let rounds = 0;
    let shuffles = 0;
    while (g.phase !== 'game-over' && rounds < 400) {
      const before = g.chips;
      const bet = Math.min(g.chips, 10 * (1 + (rounds % 5)));
      let events = g.deal(bet);
      rounds++;
      const all = [...events];
      while (g.phase === 'insurance' || g.phase === 'playing') {
        if (g.phase === 'insurance') {
          events = g.insure(rounds % 3 === 0);
        } else {
          const legal = g.legalActions();
          const hand = g.activeHand;
          const { total } = handValue(hand.cards);
          const up = Math.min(g.dealer[0].rank, 10);
          let action = total < 12 || (total < 17 && up >= 7) ? 'hit' : 'stand';
          if (legal.split && (hand.cards[0].rank < 10 || hand.cards[0].rank === 14)) action = 'split';
          else if (legal.double && (total === 10 || total === 11)) action = 'double';
          events = g.act(action);
        }
        all.push(...events);
      }
      shuffles += all.filter((e) => e.type === 'shuffle').length;
      for (const e of all) {
        const { chips, bets, insurance } = e.snap;
        assert.ok(chips >= 0, `칩이 음수: ${chips}`);
        assert.ok(bets.every((b) => b >= 10));
        assert.ok(insurance >= 0);
      }
      const staked = all.at(-1).snap.bets.reduce((a, b) => a + b, 0);
      const settle = all.find((e) => e.type === 'settle');
      const end = all.at(-1);
      assert.equal(end.type, 'round-end');
      assert.equal(settle.net, g.chips - before);
      assert.ok(g.chips - before >= -staked * 1.5 - 1);
      assert.ok(g.hands.length <= 4);
      // 딜러가 17 미만에서 멈추는 것은 플레이어가 모두 버스트했거나 블랙잭으로 일찍 끝났을 때뿐
      const outcomes = g.hands.map((h) => h.result.outcome);
      assert.ok(
        handValue(g.dealer).total >= 17 || outcomes.every((o) => o === 'bust') || outcomes.includes('blackjack'),
      );
    }
    if (rounds > 80) assert.ok(shuffles > 0, '슈를 한 번은 다시 섞어야 한다');
  }
});
