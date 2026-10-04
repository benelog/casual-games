// 컴퓨터: 실력마다 다른 방법으로 둘 칸을 고른다. 화면과 상관없는 순수 로직이라 node 에서도, 웹 워커에서도 돈다.
//
// - 쉬움: 가끔 아무 데나 두고, 아니면 가장 많이 뒤집는 칸(욕심쟁이). 모서리의 가치를 모른다.
// - 보통: 2수 앞까지 알파-베타로 읽고, 칸마다 매긴 위치 가중치로 판을 평가한다. 비슷한 수 중에서는 조금 흔들어 고른다.
// - 어려움: 위치 가중치 + 기동력(둘 수 있는 칸 수의 차)으로 평가하는 알파-베타 탐색을 시간 안에서 한 수씩 깊게 반복한다
//   (반복 심화). 빈칸이 적게 남으면 끝까지 읽어 돌 수 차이로 정확히 고른다.
//   시간을 넘기면 마지막으로 끝까지 읽은 깊이의 수를 쓴다. main.js 는 이 계산을 웹 워커(ai-worker.js)에서 돌려 화면을 막지 않는다.
//
// 탐색은 테두리를 두른 10×10 판(벽 칸 덕분에 줄 끝 검사가 필요 없다)에서 두고 되돌리며 한다.

import { CELLS, EMPTY, SIZE, legalMoves, flipsFor } from './game.js';

/**
 * 실력. random: 아무 데나 둘 확률, depth: 읽는 깊이(반복 심화의 최대), time: 생각할 시간 (밀리초),
 * mobility: 기동력 가중치, noise: 비슷한 수 중에서 고르도록 루트 점수에 더하는 흔들림, endgame: 이만큼 빈칸이 남으면 끝까지 읽는다
 */
export const LEVELS = {
  easy: { greedy: true, random: 0.4 },
  normal: { depth: 2, time: 400, mobility: 0, noise: 6, endgame: 0 },
  hard: { depth: 12, time: 900, mobility: 12, noise: 0, endgame: 12 },
};
export const LEVEL_IDS = Object.keys(LEVELS);

/** 칸마다의 위치 가중치. 모서리는 크게, 모서리 옆(C)·대각선 옆(X) 칸은 상대에게 모서리를 내주기 쉬워 깎는다 */
// prettier-ignore
export const WEIGHTS = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];

const W = SIZE + 2; // 테두리를 두른 판의 한 줄
const WALL = 2;
const DIRS = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
const TO_PAD = new Int16Array(CELLS);
const TO_CELL = new Int16Array(W * W).fill(-1);
for (let i = 0; i < CELLS; i++) {
  const pad = (Math.floor(i / SIZE) + 1) * W + (i % SIZE) + 1;
  TO_PAD[i] = pad;
  TO_CELL[pad] = i;
}
const PAD_WEIGHTS = new Int16Array(W * W);
for (let i = 0; i < CELLS; i++) PAD_WEIGHTS[TO_PAD[i]] = WEIGHTS[i];
// 모서리와 그 옆 세 칸. 모서리가 차면 옆 칸은 더 이상 위험하지 않다
const CORNERS = [
  [0, 1, 8, 9],
  [7, 6, 15, 14],
  [56, 57, 48, 49],
  [63, 62, 55, 54],
].map((cells) => cells.map((i) => TO_PAD[i]));

const DISC_SCORE = 1000; // 끝난 판의 돌 한 개 차이. 평가 점수보다 늘 크다
const TIMEOUT = Symbol('timeout');
const now = () => globalThis.performance?.now() ?? Date.now();

/** 탐색용 판. cells 는 10×10 (EMPTY·0·1·WALL) */
export class SearchBoard {
  constructor(board) {
    this.cells = new Int8Array(W * W).fill(WALL);
    this.empties = 0;
    for (let i = 0; i < CELLS; i++) {
      this.cells[TO_PAD[i]] = board[i];
      if (board[i] === EMPTY) this.empties++;
    }
    this.flips = new Int16Array(CELLS * 24); // 두고 되돌리기용 뒤집은 칸 더미
    this.top = 0;
  }

  /** player 가 pad 칸에 둘 수 있는지 */
  canPlay(pad, player) {
    const cells = this.cells;
    if (cells[pad] !== EMPTY) return false;
    const other = 1 - player;
    for (const d of DIRS) {
      let p = pad + d;
      if (cells[p] !== other) continue;
      p += d;
      while (cells[p] === other) p += d;
      if (cells[p] === player) return true;
    }
    return false;
  }

  /** player 가 둘 수 있는 칸들 (10×10 번호) */
  moves(player) {
    const list = [];
    for (let i = 0; i < CELLS; i++) {
      const pad = TO_PAD[i];
      if (this.canPlay(pad, player)) list.push(pad);
    }
    return list;
  }

  /** 둘 수 있는 칸 수 */
  mobility(player) {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (this.canPlay(TO_PAD[i], player)) n++;
    return n;
  }

  /** 둔다. 뒤집은 수를 돌려준다 (되돌릴 때 필요) */
  play(pad, player) {
    const cells = this.cells;
    const other = 1 - player;
    const start = this.top;
    for (const d of DIRS) {
      let p = pad + d;
      let n = 0;
      while (cells[p] === other) {
        p += d;
        n++;
      }
      if (n && cells[p] === player) {
        for (let q = pad + d; q !== p; q += d) {
          cells[q] = player;
          this.flips[this.top++] = q;
        }
      }
    }
    cells[pad] = player;
    this.empties--;
    return this.top - start;
  }

  undo(pad, player, count) {
    const other = 1 - player;
    for (let k = 0; k < count; k++) this.cells[this.flips[--this.top]] = other;
    this.cells[pad] = EMPTY;
    this.empties++;
  }

  /** player 쪽에서 본 돌 수 차이 */
  discDiff(player) {
    let diff = 0;
    for (let i = 0; i < CELLS; i++) {
      const v = this.cells[TO_PAD[i]];
      if (v === player) diff++;
      else if (v !== EMPTY) diff--;
    }
    return diff;
  }
}

/** player 쪽에서 본 판의 점수: 위치 가중치 (+ 기동력) */
export function evaluate(sb, player, mobilityWeight = 0) {
  const cells = sb.cells;
  let score = 0;
  for (let i = 0; i < CELLS; i++) {
    const pad = TO_PAD[i];
    const v = cells[pad];
    if (v === player) score += PAD_WEIGHTS[pad];
    else if (v !== EMPTY) score -= PAD_WEIGHTS[pad];
  }
  // 모서리가 이미 찼으면 그 옆 칸의 감점을 거둔다
  for (const [corner, ...near] of CORNERS) {
    if (cells[corner] === EMPTY) continue;
    for (const pad of near) {
      const v = cells[pad];
      if (v === player) score -= PAD_WEIGHTS[pad];
      else if (v !== EMPTY) score += PAD_WEIGHTS[pad];
    }
  }
  if (mobilityWeight) {
    const mine = sb.mobility(player);
    const theirs = sb.mobility(1 - player);
    if (mine + theirs) score += Math.round((mobilityWeight * 10 * (mine - theirs)) / (mine + theirs + 2));
  }
  return score;
}

/** 위치 가중치가 높은 칸부터 (모서리 먼저 읽으면 잘리는 가지가 많다) */
function ordered(moves, first = -1) {
  moves.sort((a, b) => PAD_WEIGHTS[b] - PAD_WEIGHTS[a]);
  if (first >= 0) {
    const k = moves.indexOf(first);
    if (k > 0) {
      moves.splice(k, 1);
      moves.unshift(first);
    }
  }
  return moves;
}

class Searcher {
  constructor(sb, { mobility = 0, deadline = Infinity } = {}) {
    this.sb = sb;
    this.mobility = mobility;
    this.deadline = deadline;
    this.nodes = 0;
  }

  tick() {
    if ((++this.nodes & 1023) === 0 && now() > this.deadline) throw TIMEOUT;
  }

  /** 끝난 판의 점수: 돌 수 차이 (빈칸은 이긴 쪽 몫으로 친다) */
  final(player) {
    const diff = this.sb.discDiff(player);
    const bonus = diff > 0 ? this.sb.empties : diff < 0 ? -this.sb.empties : 0;
    return (diff + bonus) * DISC_SCORE;
  }

  /** 네가맥스 알파-베타. exact 면 끝까지 읽어 돌 수 차이만 본다 */
  negamax(player, depth, alpha, beta, passed, exact) {
    this.tick();
    const sb = this.sb;
    if (!exact && depth <= 0) return evaluate(sb, player, this.mobility);
    const moves = sb.moves(player);
    if (!moves.length) {
      if (passed) return this.final(player);
      return -this.negamax(1 - player, depth, -beta, -alpha, true, exact);
    }
    if (!exact || sb.empties > 6) ordered(moves);
    let best = -Infinity;
    for (const pad of moves) {
      const n = sb.play(pad, player);
      let score;
      try {
        score = -this.negamax(1 - player, depth - 1, -beta, -alpha, false, exact);
      } finally {
        sb.undo(pad, player, n);
      }
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  /**
   * 루트에서 수마다 점수를 매긴다. [{ pad, score }] (좋은 순).
   * full 이면 모든 수를 정확한 점수로 읽고, 아니면 지금까지의 최선보다 못한 수는 '그보다 못하다'까지만 읽는다
   */
  root(player, depth, exact, { first = -1, full = false } = {}) {
    const sb = this.sb;
    const moves = ordered(sb.moves(player), first);
    const scored = [];
    let alpha = -Infinity;
    for (const pad of moves) {
      const n = sb.play(pad, player);
      let score;
      try {
        score = -this.negamax(1 - player, depth - 1, -Infinity, full ? Infinity : -alpha, false, exact);
      } finally {
        sb.undo(pad, player, n);
      }
      scored.push({ pad, score });
      if (score > alpha) alpha = score;
    }
    // 점수가 같으면 먼저 읽은(가중치가 높은) 수가 앞에 남는다
    return scored.sort((a, b) => b.score - a.score);
  }
}

/**
 * 알파-베타 탐색. 반복 심화로 depth 까지(시간이 남는 동안) 읽고, 빈칸이 endgame 이하면 끝까지 읽는다.
 * 결과: { move(64칸 번호, 없으면 -1), score, depth(끝까지 읽은 깊이), exact, nodes, scores: [{ move, score }] }
 */
export function search(board, player, { depth = 4, time = Infinity, mobility = 0, endgame = 0, full = false, start = now() } = {}) {
  const sb = new SearchBoard(board);
  const searcher = new Searcher(sb, { mobility, deadline: start + time });
  const result = { move: -1, score: 0, depth: 0, exact: false, nodes: 0, scores: [] };
  const take = (scored, d, exact) => {
    result.move = TO_CELL[scored[0].pad];
    result.score = scored[0].score;
    result.depth = d;
    result.exact = exact;
    result.scores = scored.map(({ pad, score }) => ({ move: TO_CELL[pad], score }));
  };
  const moves = sb.moves(player);
  if (!moves.length) return result;
  // 시간이 모자라도 둘 수는 있게 가장 가중치가 높은 칸을 먼저 잡아 둔다
  take(ordered(moves.slice()).map((pad) => ({ pad, score: 0 })), 0, false);
  if (endgame && sb.empties <= endgame) {
    // 끝까지 읽기에는 시간의 60% 만 쓰고, 넘기면 남은 시간에 보통 탐색을 한다
    searcher.deadline = start + time * 0.6;
    try {
      take(searcher.root(player, sb.empties, true), sb.empties, true);
      result.nodes = searcher.nodes;
      return result;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
    }
    searcher.deadline = start + time;
  }
  for (let d = 1; d <= Math.min(depth, sb.empties); d++) {
    try {
      take(searcher.root(player, d, false, { first: TO_PAD[result.move], full }), d, false);
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  result.nodes = searcher.nodes;
  return result;
}

/** 욕심쟁이: 가장 많이 뒤집는 칸 (같으면 아무거나) */
function greedyMove(board, player, moves, rng) {
  let best = [];
  let most = -1;
  for (const m of moves) {
    const n = flipsFor(board, player, m).length;
    if (n > most) {
      most = n;
      best = [m];
    } else if (n === most) best.push(m);
  }
  return best[Math.floor(rng() * best.length)];
}

/**
 * level 실력의 컴퓨터가 player 로 둘 칸 (64칸 번호). 둘 곳이 없으면 -1.
 * options.time 으로 생각할 시간을 바꿀 수 있다 (테스트·워커 없이 돌 때)
 */
export function chooseMove(board, player, level = 'normal', { rng = Math.random, time } = {}) {
  const config = LEVELS[level] ?? LEVELS.normal;
  const moves = legalMoves(board, player);
  if (!moves.length) return -1;
  if (moves.length === 1) return moves[0];
  if (config.greedy) {
    if (rng() < config.random) return moves[Math.floor(rng() * moves.length)];
    return greedyMove(board, player, moves, rng);
  }
  const result = search(board, player, {
    depth: config.depth,
    time: time ?? config.time,
    mobility: config.mobility,
    endgame: config.endgame,
    full: config.noise > 0, // 흔들어 고르려면 모든 수의 점수가 정확해야 한다
  });
  if (!config.noise || result.exact || result.move < 0) return result.move;
  // 점수가 비슷한 수 사이에서는 흔들어 매번 같은 판이 되지 않게 한다
  let best = result.move;
  let bestScore = -Infinity;
  for (const { move, score } of result.scores) {
    const noisy = score + (rng() * 2 - 1) * config.noise;
    if (noisy > bestScore) {
      bestScore = noisy;
      best = move;
    }
  }
  return best;
}
