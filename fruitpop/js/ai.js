// 컴퓨터 상대. 놓을 수 있는 자리를 모두 놓아 보고(game.js 의 순수 함수로) 점수를 매겨 고른 뒤,
// 사람처럼 한 번에 한 동작씩 옮겨 놓는다. 규칙은 건드리지 않고 Board 의 조작 메서드만 쓴다.

import {
  WIDTH,
  VISIBLE,
  HEIGHT,
  SPAWN_X,
  EMPTY,
  GARBAGE,
  OFFSETS,
  at,
  isFruit,
  columnHeight,
  dropCells,
  resolveAll,
} from './game.js';

// think: 새 짝을 보고 움직이기 시작할 때까지(초), step: 한 동작 간격(초), fall: 내리는 간격(초, 0 이면 바로 떨어뜨림)
// noise: 판단에 섞이는 잡음, depth: 몇 수 앞까지 보는가, potential: 다음에 터뜨릴 수 있는 연쇄를 얼마나 쳐 주는가
// fire: 이 점수 이상의 연쇄만 일부러 터뜨린다 (위험하면 무엇이든 터뜨린다)
export const LEVELS = {
  easy: { think: 0.6, step: 0.36, fall: 0.18, noise: 260, depth: 1, potential: 0, fire: 0 },
  normal: { think: 0.4, step: 0.2, fall: 0.08, noise: 40, depth: 1, potential: 0.5, fire: 300 },
  hard: { think: 0.25, step: 0.12, fall: 0.035, noise: 0, depth: 2, potential: 0.7, fire: 900 },
};
export const LEVEL_IDS = Object.keys(LEVELS);

/** 짝을 놓을 수 있는 자리 [{ x, rot }]. 축이 x 줄, 딸린 과일이 rot 방향 */
export function placements(grid, colors) {
  const heights = Array.from({ length: WIDTH }, (_, x) => columnHeight(grid, x));
  // 꼭대기까지 찬 줄은 넘어갈 수 없다
  let left = SPAWN_X;
  while (left > 0 && heights[left - 1] < VISIBLE) left--;
  let right = SPAWN_X;
  while (right < WIDTH - 1 && heights[right + 1] < VISIBLE) right++;
  const same = colors[0] === colors[1];
  const result = [];
  for (let rot = 0; rot < (same ? 2 : 4); rot++) {
    const [dx] = OFFSETS[rot];
    for (let x = left; x <= right; x++) {
      const sx = x + dx;
      if (sx < left || sx > right) continue;
      result.push({ x, rot });
    }
  }
  return result;
}

/** 짝을 그 자리에 떨어뜨리고 연쇄를 끝까지 푼 결과. grid 는 바꾸지 않는다 */
export function simulate(grid, colors, { x, rot }) {
  const next = grid.slice();
  const [dx, dy] = OFFSETS[rot];
  dropCells(next, [
    { x, y: HEIGHT, color: colors[0] },
    { x: x + dx, y: HEIGHT + dy, color: colors[1] },
  ]);
  const result = resolveAll(next);
  return { grid: next, ...result, dead: next[at(SPAWN_X, VISIBLE - 1)] !== EMPTY };
}

/** 과일 하나를 더 놓아 터뜨릴 수 있는 가장 큰 연쇄의 점수 */
export function potential(grid, colorCount) {
  let best = 0;
  for (let x = 0; x < WIDTH; x++) {
    const y = columnHeight(grid, x);
    if (y >= VISIBLE - 1) continue;
    // 옆이나 아래에 있는 과일과 같은 것만 놓아 본다
    const candidates = new Set();
    if (y > 0) candidates.add(grid[at(x, y - 1)]);
    if (x > 0) candidates.add(grid[at(x - 1, y)]);
    if (x < WIDTH - 1) candidates.add(grid[at(x + 1, y)]);
    for (const color of candidates) {
      if (!isFruit(color) || color > colorCount) continue;
      const next = grid.slice();
      next[at(x, y)] = color;
      const { score } = resolveAll(next);
      if (score > best) best = score;
    }
  }
  return best;
}

/** 판 모양 점수: 낮고 고르게, 같은 과일끼리 붙여 쌓을수록 좋다 */
export function shapeScore(grid) {
  let score = 0;
  let previous = null;
  for (let x = 0; x < WIDTH; x++) {
    const height = columnHeight(grid, x);
    score -= height * height * 0.6;
    if (previous !== null) score -= Math.abs(height - previous) * 2;
    previous = height;
    for (let y = 0; y < Math.min(height, VISIBLE); y++) {
      const color = grid[at(x, y)];
      if (color === GARBAGE) {
        score -= 4;
        continue;
      }
      if (x < WIDTH - 1 && grid[at(x + 1, y)] === color) score += 6;
      if (y < VISIBLE - 1 && grid[at(x, y + 1)] === color) score += 6;
    }
  }
  // 짝이 나오는 줄이 높으면 위험하다
  const spawnHeight = columnHeight(grid, SPAWN_X);
  if (spawnHeight >= VISIBLE - 3) score -= (spawnHeight - (VISIBLE - 4)) * 120;
  return score;
}

function maxHeight(grid) {
  let max = 0;
  for (let x = 0; x < WIDTH; x++) max = Math.max(max, columnHeight(grid, x));
  return max;
}

/** 터뜨린 점수를 얼마나 쳐 줄 것인가: 큰 연쇄이거나 급할 때는 그대로, 아니면 아껴 둔다 */
function fireValue(score, level, urgent) {
  if (score === 0) return 0;
  if (urgent || score >= level.fire) return score * 1.2 + 200;
  return score * 0.2 - 60; // 작은 연쇄는 쌓아 둔 것을 허무는 셈이다
}

/**
 * 가장 좋은 자리를 고른다. 오래 걸릴 수 있어 한 자리씩 살펴볼 때마다 양보하는 제너레이터다.
 * 끝나면 { x, rot } 를 돌려준다. state: { grid, colors(지금 짝), next(다음 짝), incoming, colorCount }
 */
export function* think(state, level, rng = Math.random) {
  const { grid, colors, next, incoming = 0, colorCount = 5 } = state;
  const urgent = incoming > 0 || maxHeight(grid) >= VISIBLE - 3;
  let best = null;
  let bestValue = -Infinity;
  for (const place of placements(grid, colors)) {
    const first = simulate(grid, colors, place);
    let value;
    if (first.dead) {
      value = -1e9;
    } else {
      value = fireValue(first.score, level, urgent) + shapeScore(first.grid);
      if (level.potential) value += potential(first.grid, colorCount) * level.potential;
      if (level.depth > 1 && next) {
        let follow = -Infinity;
        for (const second of placements(first.grid, next)) {
          const result = simulate(first.grid, next, second);
          if (result.dead) continue;
          const v = fireValue(result.score, level, urgent) * 0.9 + shapeScore(result.grid) * 0.5;
          if (v > follow) follow = v;
        }
        value += follow === -Infinity ? -1e6 : follow;
      }
      if (level.noise) value += (rng() - 0.5) * 2 * level.noise;
    }
    if (value > bestValue) {
      bestValue = value;
      best = place;
    }
    yield;
  }
  return best ?? { x: SPAWN_X, rot: 0 };
}

/** think 를 끝까지 돌려 바로 답을 얻는다 (테스트용) */
export function choose(state, level, rng) {
  const thinking = think(state, level, rng);
  for (;;) {
    const { done, value } = thinking.next();
    if (done) return value;
  }
}

/** 판 하나를 맡아 조작하는 컴퓨터 */
export class AiPlayer {
  constructor(levelId = 'normal', rng = Math.random) {
    if (!LEVELS[levelId]) throw new Error(`알 수 없는 실력: ${levelId}`);
    this.level = LEVELS[levelId];
    this.rng = rng;
    this.pairId = null;
    this.thinking = null;
    this.plan = null;
    this.delay = 0;
    this.timer = 0;
  }

  update(dt, board, colorCount) {
    const pair = board.pair;
    if (board.phase !== 'control' || !pair) return;
    if (pair.id !== this.pairId) {
      this.pairId = pair.id;
      this.plan = null;
      this.delay = this.level.think;
      this.timer = 0;
      this.thinking = think(
        { grid: board.grid, colors: pair.colors, next: board.preview(1)[0], incoming: board.incoming, colorCount },
        this.level,
        this.rng,
      );
    }
    this.delay -= dt;
    if (this.thinking) {
      // 한 프레임에 몇 자리씩만 살펴 화면이 끊기지 않게 한다
      for (let i = 0; i < 4 && this.thinking; i++) {
        const { done, value } = this.thinking.next();
        if (done) {
          this.plan = value;
          this.thinking = null;
        }
      }
    }
    if (!this.plan || this.delay > 0) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const { x, rot } = this.plan;
    if (pair.rot !== rot) {
      this.timer = this.level.step;
      const dir = (rot - pair.rot + 4) % 4 === 3 ? -1 : 1;
      const from = pair.rot;
      board.rotate(dir);
      if (pair.rot === from) this.plan = { x: pair.x, rot: pair.rot }; // 돌릴 수 없으면 그대로 놓는다
    } else if (pair.x !== x) {
      this.timer = this.level.step;
      if (!board.move(Math.sign(x - pair.x))) this.plan = { x: pair.x, rot: pair.rot }; // 막혔으면 여기 놓는다
    } else if (this.level.fall === 0) {
      board.hardDrop();
    } else {
      this.timer = this.level.fall;
      board.softDrop();
    }
  }
}
