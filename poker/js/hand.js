// 족보 평가. score 가 클수록 강한 패.

export const CATEGORY_NAMES = [
  '하이 카드',
  '원 페어',
  '투 페어',
  '트리플',
  '스트레이트',
  '플러시',
  '풀 하우스',
  '포 카드',
  '스트레이트 플러시',
];

/** 1~5장을 그대로 평가한다. 5장 미만이면 스트레이트·플러시는 없다. */
function evaluateExact(cards) {
  const complete = cards.length === 5;
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const flush = complete && cards.every((c) => c.suit === cards[0].suit);

  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // [rank, count] 를 장수 우선, 그다음 높은 숫자 순으로
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const first = groups[0][1];
  const second = groups[1]?.[1] ?? 0;

  let straightHigh = 0;
  if (complete && groups.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // A-2-3-4-5
  }

  const groupRanks = groups.map((g) => g[0]);
  let category;
  let kickers;
  if (straightHigh && flush) [category, kickers] = [8, [straightHigh]];
  else if (first === 4) [category, kickers] = [7, groupRanks];
  else if (first === 3 && second === 2) [category, kickers] = [6, groupRanks];
  else if (flush) [category, kickers] = [5, ranks];
  else if (straightHigh) [category, kickers] = [4, [straightHigh]];
  else if (first === 3) [category, kickers] = [3, groupRanks];
  else if (first === 2 && second === 2) [category, kickers] = [2, groupRanks];
  else if (first === 2) [category, kickers] = [1, groupRanks];
  else [category, kickers] = [0, ranks];

  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] ?? 0);
  return { score, category, straightHigh };
}

function describe(result, cards) {
  const royal = result.category === 8 && result.straightHigh === 14;
  return {
    score: result.score,
    category: result.category,
    name: royal ? '로열 플러시' : CATEGORY_NAMES[result.category],
    cards,
  };
}

/** 가장 강한 5장 조합을 찾는다. 5장 미만이면 가진 카드만으로 평가한다. */
export function evaluateBest(cards) {
  const n = cards.length;
  if (n < 5) return describe(evaluateExact(cards), cards);
  let best = null;
  let bestCards = null;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const result = evaluateExact(five);
            if (!best || result.score > best.score) {
              best = result;
              bestCards = five;
            }
          }
  return describe(best, bestCards);
}

/** 오마하: 내 카드 중 정확히 2장 + 공용 카드 중 정확히 3장. 공용 카드가 3장 이상이어야 한다. */
export function evaluateOmaha(hole, board) {
  let best = null;
  let bestCards = null;
  for (let a = 0; a < hole.length - 1; a++)
    for (let b = a + 1; b < hole.length; b++)
      for (let c = 0; c < board.length - 2; c++)
        for (let d = c + 1; d < board.length - 1; d++)
          for (let e = d + 1; e < board.length; e++) {
            const five = [hole[a], hole[b], board[c], board[d], board[e]];
            const result = evaluateExact(five);
            if (!best || result.score > best.score) {
              best = result;
              bestCards = five;
            }
          }
  return describe(best, bestCards);
}
