// 핸드 값 계산, 딜러 진행 규칙, 정산. 렌더링과 무관한 순수 함수들이다.

/** 하우스 룰. game.js 의 기본값이며 README 의 설명과 맞춘다. */
export const RULES = {
  decks: 6,
  penetration: 0.75, // 슈의 75% 가 나가면 다음 라운드 전에 다시 섞는다
  minBet: 10,
  blackjackPays: [3, 2],
  dealerHitsSoft17: false, // 딜러는 소프트 17 에서 스탠드 (S17)
  maxHands: 4, // 스플릿은 최대 3번, 핸드 4개까지
  doubleAfterSplit: true,
};

/** 카드 한 장의 기본 값. A 는 11 로 세고, 넘치면 handValue 에서 1 로 내린다. */
export function cardValue(card) {
  if (card.rank === 14) return 11;
  return Math.min(card.rank, 10);
}

/**
 * 핸드 값. soft 는 A 하나를 11 로 세고 있다는 뜻이다 (카드를 더 받아도 버스트하지 않는 상태).
 * A 가 여러 장이어도 11 로 셀 수 있는 것은 많아야 한 장이다.
 */
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (card.rank === 14) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

/** 처음 받은 두 장으로 21 (내추럴). 스플릿한 핸드는 game.js 에서 따로 제외한다. */
export function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isBust(cards) {
  return handValue(cards).total > 21;
}

/** 같은 랭크 한 쌍이면 스플릿할 수 있다 (K 와 Q 처럼 값만 같은 카드는 안 된다). */
export function isPair(cards) {
  return cards.length === 2 && cards[0].rank === cards[1].rank;
}

/** 딜러가 카드를 더 받아야 하는지. 16 이하는 히트, 17 이상은 스탠드. 소프트 17 은 규칙에 따른다. */
export function dealerShouldHit(cards, { hitSoft17 = RULES.dealerHitsSoft17 } = {}) {
  const { total, soft } = handValue(cards);
  if (total < 17) return true;
  return total === 17 && soft && hitSoft17;
}

/** 블랙잭 지급액 (원금 제외). 칩 단위가 정수이므로 3:2 에서 생기는 끝수는 버린다. */
export function blackjackWin(bet, [num, den] = RULES.blackjackPays) {
  return Math.floor((bet * num) / den);
}

/** 인슈어런스는 원래 베팅의 절반까지, 2:1 지급 */
export function insuranceCost(bet) {
  return Math.floor(bet / 2);
}

/**
 * 핸드 하나를 정산한다. payout 은 원금을 포함해 돌려받는 금액이다.
 * hand: { cards, bet, fromSplit }
 * outcome: 'blackjack' | 'win' | 'push' | 'lose' | 'bust'
 */
export function settleHand(hand, dealerCards, rules = RULES) {
  const { bet } = hand;
  const player = handValue(hand.cards).total;
  const natural = !hand.fromSplit && isBlackjack(hand.cards);
  const dealerNatural = isBlackjack(dealerCards);

  if (player > 21) return { outcome: 'bust', payout: 0 };
  if (natural && dealerNatural) return { outcome: 'push', payout: bet };
  if (natural) return { outcome: 'blackjack', payout: bet + blackjackWin(bet, rules.blackjackPays) };
  if (dealerNatural) return { outcome: 'lose', payout: 0 };

  const dealer = handValue(dealerCards).total;
  if (dealer > 21 || player > dealer) return { outcome: 'win', payout: bet * 2 };
  if (player === dealer) return { outcome: 'push', payout: bet };
  return { outcome: 'lose', payout: 0 };
}

/** 화면에 보여 줄 핸드 값. 예: '소프트 17', '20', '블랙잭', '버스트 24' */
export function describeHand(cards, { fromSplit = false } = {}) {
  if (cards.length === 0) return '';
  const { total, soft } = handValue(cards);
  if (!fromSplit && isBlackjack(cards)) return '블랙잭';
  if (total > 21) return `버스트 ${total}`;
  return soft && total < 21 ? `소프트 ${total}` : String(total);
}
