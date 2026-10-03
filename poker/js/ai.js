// 컴퓨터 플레이어: 몬테카를로로 승률을 추정하고 팟 오즈와 비교해 행동을 고른다.
// 자신의 카드와 상대의 공개된 카드만 본다.

import { createDeck, cardId } from './cards.js';
import { evaluateBest } from './hand.js';

/** 보이지 않는 카드를 무작위로 채웠을 때 me 번 플레이어의 승률 (0..1, 무승부는 0.5) */
export function estimateEquity(game, me, iterations = 400, rng = Math.random) {
  const { variant, board } = game;
  const mine = game.players[me].hole;
  const opponent = game.players[1 - me];
  const theirsKnown = opponent.hole.filter((_, i) => opponent.up[i]);

  const known = new Set([...mine, ...theirsKnown, ...board].map(cardId));
  const deck = createDeck().filter((c) => !known.has(cardId(c)));
  const myNeed = variant.totalHole - mine.length;
  const theirNeed = variant.totalHole - theirsKnown.length;
  const boardNeed = variant.hasBoard ? 5 - board.length : 0;
  const need = myNeed + theirNeed + boardNeed;

  let wins = 0;
  for (let n = 0; n < iterations; n++) {
    // 앞쪽 need 장만 섞는 부분 셔플
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const fullBoard = [...board, ...deck.slice(myNeed + theirNeed, need)];
    const myScore = variant.evaluate([...mine, ...deck.slice(0, myNeed)], fullBoard).score;
    const theirScore = variant.evaluate([...theirsKnown, ...deck.slice(myNeed, myNeed + theirNeed)], fullBoard).score;
    if (myScore > theirScore) wins += 1;
    else if (myScore === theirScore) wins += 0.5;
  }
  return wins / iterations;
}

/** 현재 차례인 플레이어의 베팅 행동을 결정한다. */
export function decideAction(game, rng = Math.random, iterations = game.variant.id === 'omaha' ? 200 : 400) {
  const legal = game.legalActions();
  const me = game.players[game.toAct];
  const pot = game.pot;
  const toCall = legal.callAmount;
  const equity = estimateEquity(game, game.toAct, iterations, rng);
  const roll = rng();

  // 콜한 뒤의 팟 대비 fraction 만큼 올린다
  const raise = (fraction) => {
    const size = Math.round(((pot + toCall) * fraction) / 10) * 10;
    const amount = Math.min(Math.max(game.currentBet + size, legal.minRaiseTo), legal.maxRaiseTo);
    return { type: 'raise', amount };
  };

  if (toCall === 0) {
    if (legal.canRaise) {
      if (equity > 0.7 && roll < 0.85) return raise(0.75);
      if (equity > 0.55 && roll < 0.5) return raise(0.5);
      if (equity < 0.4 && roll < 0.12) return raise(0.6); // 블러프
    }
    return { type: 'check' };
  }

  if (legal.canRaise) {
    if (equity > 0.8 && roll < 0.7) return raise(1);
    if (equity > 0.65 && roll < 0.3) return raise(0.75);
    if (equity < 0.35 && roll < 0.04) return raise(1); // 블러프
  }

  // 큰 베팅일수록 상대 패가 강하다고 보고 승률을 깎는다
  const pressure = Math.min(1, toCall / Math.max(1, pot - toCall));
  const potOdds = toCall / (pot + toCall);
  const commitment = toCall / me.chips;
  const required = potOdds + 0.04 + (commitment > 0.4 ? 0.1 : 0);
  if (equity - 0.12 * pressure >= required) return { type: 'call' };
  return { type: 'fold' };
}

/** 드로우 포커에서 버릴 카드의 인덱스를 고른다. */
export function decideDraw(hole) {
  if (evaluateBest(hole).category >= 4) return []; // 스트레이트 이상은 그대로

  const indices = hole.map((_, i) => i);
  const discardExcept = (keep) => indices.filter((i) => !keep.includes(i));

  // 페어 이상은 짝이 맞는 카드만 남긴다
  const paired = indices.filter((i) => hole.some((c, j) => j !== i && c.rank === hole[i].rank));
  if (paired.length) return discardExcept(paired);

  // 플러시·스트레이트까지 한 장 남았으면 그 한 장만 바꾼다
  for (const drop of indices) {
    const rest = indices.filter((i) => i !== drop);
    const ranks = rest.map((i) => hole[i].rank);
    const sameSuit = rest.every((i) => hole[i].suit === hole[rest[0]].suit);
    if (sameSuit || Math.max(...ranks) - Math.min(...ranks) <= 4) return [drop];
  }

  // 그 밖에는 J 이상을 최대 2장, 없으면 가장 높은 한 장만 남긴다
  const byRank = [...indices].sort((a, b) => hole[b].rank - hole[a].rank);
  const high = byRank.filter((i) => hole[i].rank >= 11).slice(0, 2);
  return discardExcept(high.length ? high : byRank.slice(0, 1));
}
