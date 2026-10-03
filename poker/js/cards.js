// 카드: { rank: 2..14 (14 = A), suit: 0..3 (♠ ♥ ♦ ♣) }

// U+FE0E: 이모지가 아닌 텍스트 글리프로 그리도록 강제
export const SUITS = ['♠︎', '♥︎', '♦︎', '♣︎'];

const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankLabel(rank) {
  return RANK_LABELS[rank] ?? String(rank);
}

export function isRed(card) {
  return card.suit === 1 || card.suit === 2;
}

export function cardId(card) {
  return `${card.rank}-${card.suit}`;
}

export function createDeck() {
  const deck = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit });
  }
  return deck;
}

export function shuffle(cards, rng = Math.random) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
