import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBest, evaluateOmaha } from '../js/hand.js';
import { PokerGame } from '../js/game.js';
import { decideAction, decideDraw } from '../js/ai.js';

const SUIT = { s: 0, h: 1, d: 2, c: 3 };
const RANK = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
const hand = (text) =>
  text.split(' ').map((t) => ({ rank: RANK[t[0]] ?? Number(t[0]), suit: SUIT[t[1]] }));
const name = (text) => evaluateBest(hand(text)).name;
const score = (text) => evaluateBest(hand(text)).score;

function seededRng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('족보 이름', () => {
  assert.equal(name('As Ks Qs Js Ts'), '로열 플러시');
  assert.equal(name('9s 8s 7s 6s 5s'), '스트레이트 플러시');
  assert.equal(name('9s 9h 9d 9c 5s'), '포 카드');
  assert.equal(name('9s 9h 9d 5c 5s'), '풀 하우스');
  assert.equal(name('As 9s 7s 6s 2s'), '플러시');
  assert.equal(name('9s 8h 7s 6d 5s'), '스트레이트');
  assert.equal(name('As 2h 3s 4d 5s'), '스트레이트');
  assert.equal(name('9s 9h 9d 6c 5s'), '트리플');
  assert.equal(name('9s 9h 6d 6c 5s'), '투 페어');
  assert.equal(name('9s 9h 7d 6c 5s'), '원 페어');
  assert.equal(name('Ks 9h 7d 6c 5s'), '하이 카드');
});

test('족보 비교', () => {
  assert.ok(score('2s 2h 2d 3c 3s') > score('As Ks Qs Js 9s')); // 풀 하우스 > 플러시
  assert.ok(score('6s 5h 4d 3c 2s') > score('As 2h 3s 4d 5s')); // 6 스트레이트 > 휠
  assert.ok(score('As Ah 7d 6c 5s') > score('Ks Kh Qd Jc Ts')); // 높은 페어
  assert.ok(score('As Ah Kd 6c 5s') > score('Ad Ac Qd Jc Ts')); // 키커
  assert.ok(score('9s 9h 6d 6c As') > score('9d 9c 6s 6h Ks')); // 투 페어 키커
  assert.equal(score('As Kh 7d 6c 5s'), score('Ad Kc 7s 6h 5d'));
});

test('7장 중 최고 5장', () => {
  const best = evaluateBest(hand('As Ah Kd Kc Ks 2d 3c'));
  assert.equal(best.name, '풀 하우스');
  assert.equal(best.cards.length, 5);
  assert.equal(name('2s 5s 9s Js Ks Ah Ad'), '플러시');
});

test('블라인드와 폴드', () => {
  const game = new PokerGame({ rng: seededRng(1) });
  game.startHand();
  assert.equal(game.dealer, 0);
  assert.deepEqual(game.snapshot().bets, [10, 20]);
  assert.equal(game.toAct, 0);
  game.act({ type: 'fold' });
  assert.equal(game.phase, 'hand-over');
  assert.deepEqual(game.snapshot().chips, [990, 1010]);
});

test('빅 블라인드 옵션과 스트리트 진행', () => {
  const game = new PokerGame({ rng: seededRng(2) });
  game.startHand();
  game.act({ type: 'call' });
  assert.equal(game.streetIndex, 0); // 빅 블라인드가 아직 행동하지 않음
  assert.equal(game.toAct, 1);
  game.act({ type: 'check' });
  assert.equal(game.streetIndex, 1);
  assert.equal(game.board.length, 3);
  assert.equal(game.toAct, 1); // 플랍 이후에는 빅 블라인드가 먼저
  assert.throws(() => game.act({ type: 'raise', amount: 20 }) && game.act({ type: 'check' }));
});

test('올인 콜이면 쇼다운까지 진행', () => {
  const game = new PokerGame({ rng: seededRng(3) });
  game.startHand();
  game.act({ type: 'raise', amount: 1000 });
  const events = game.act({ type: 'call' });
  assert.equal(game.board.length, 5);
  assert.ok(events.some((e) => e.type === 'showdown'));
  const chips = game.snapshot().chips;
  assert.equal(chips[0] + chips[1], 2000);
});

test('5장 미만은 가진 카드만으로 평가', () => {
  assert.equal(name('9s 9h'), '원 페어');
  assert.equal(name('9s 8s 7s 6s'), '하이 카드');
  assert.ok(score('As') > score('Ks'));
  assert.ok(score('2s 2h') > score('As Kh'));
});

test('오마하는 내 카드 2장과 공용 카드 3장만 쓴다', () => {
  const board = hand('As Ks Qs Js 2d');
  // 스페이드가 한 장뿐이면 플러시가 되지 않는다
  assert.equal(evaluateOmaha(hand('Ts 3h 4d 5c'), board).name, '하이 카드');
  assert.equal(evaluateOmaha(hand('Ts 3s 4d 5c'), board).name, '플러시');
  assert.equal(evaluateOmaha(hand('Ah Ad Kh Kd'), board).name, '트리플');
});

test('오마하는 팟 리밋', () => {
  const game = new PokerGame({ variant: 'omaha', rng: seededRng(4) });
  game.startHand();
  assert.equal(game.players[0].hole.length, 4);
  const legal = game.legalActions();
  assert.equal(legal.maxRaiseTo, 60); // 콜 10 뒤의 팟 40 만큼 더: 20 + 40
  assert.equal(legal.allInTo, 1000);
});

test('파이브 카드 드로우: 교환 후 두 번째 베팅', () => {
  const game = new PokerGame({ variant: 'draw', rng: seededRng(5) });
  game.startHand();
  assert.equal(game.players[0].hole.length, 5);
  game.act({ type: 'call' });
  game.act({ type: 'check' });
  assert.equal(game.phase, 'drawing');
  assert.equal(game.toAct, 1); // 딜러 반대편이 먼저 교환
  const before = [...game.players[1].hole];
  const events = game.draw([0, 2]);
  assert.deepEqual(events[0].indices, [0, 2]);
  assert.notDeepEqual(game.players[1].hole[0], before[0]);
  assert.deepEqual(game.players[1].hole[1], before[1]);
  assert.throws(() => game.draw([7]));
  game.draw([]);
  assert.equal(game.phase, 'betting');
  game.act({ type: 'check' });
  game.act({ type: 'check' });
  assert.equal(game.phase, 'hand-over');
});

test('드로우 판단', () => {
  assert.deepEqual(decideDraw(hand('9s 8h 7s 6d 5s')), []);
  assert.deepEqual(decideDraw(hand('9s 9h 7s 6d 2s')), [2, 3, 4]);
  assert.deepEqual(decideDraw(hand('9s 9h 7s 7d 2s')), [4]);
  assert.deepEqual(decideDraw(hand('As 9s 7s 6s 2h')), [4]);
  assert.deepEqual(decideDraw(hand('Ks 9h 7d 4c 2s')), [1, 2, 3, 4]);
});

test('세븐 카드 스터드: 앤티, 공개 카드, 7장', () => {
  const game = new PokerGame({ variant: 'stud', rng: seededRng(6) });
  game.startHand();
  assert.deepEqual(game.snapshot(), { chips: [990, 990], bets: [0, 0], pot: 20, total: 20 });
  assert.deepEqual(game.players[0].up, [false, false, true]);
  const showing = game.players.map((p) => p.hole[2].rank);
  if (showing[0] !== showing[1]) assert.equal(game.toAct, showing[0] > showing[1] ? 0 : 1);
  while (game.phase === 'betting') game.act({ type: 'check' });
  assert.equal(game.phase, 'hand-over');
  assert.equal(game.players[0].hole.length, 7);
  assert.deepEqual(game.players[1].up, [false, false, true, true, true, true, false]);
});

test('컴퓨터끼리 끝까지 대결해도 칩 총량이 보존된다', () => {
  for (const variant of ['holdem', 'omaha', 'draw', 'stud']) {
    for (let seed = 1; seed <= 3; seed++) {
      const rng = seededRng(seed * 7919);
      const game = new PokerGame({ variant, rng });
      let hands = 0;
      while (game.phase !== 'game-over' && hands < 150) {
        game.startHand();
        hands++;
        while (game.phase === 'betting' || game.phase === 'drawing') {
          let events;
          if (game.phase === 'drawing') {
            events = game.draw(decideDraw(game.players[game.toAct].hole));
          } else {
            const legal = game.legalActions();
            assert.ok(legal.minRaiseTo <= legal.maxRaiseTo);
            events = game.act(decideAction(game, rng, 40));
          }
          for (const event of events) {
            const { chips, bets, pot } = event.snap;
            assert.equal(chips[0] + chips[1] + bets[0] + bets[1] + pot, 2000, variant);
            assert.ok(chips[0] >= 0 && chips[1] >= 0);
          }
        }
      }
    }
  }
});
