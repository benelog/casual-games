// 파이프 연결 퍼즐의 규칙. DOM 이나 Three.js 에 의존하지 않는 순수 로직이다.
//
// 판은 size×size 격자고 칸 번호는 index = y * size + x (y 는 위에서 아래로).
// 칸마다 파이프 조각이 하나 있고, 조각은 열린 방향의 비트 묶음(mask)으로 나타낸다.
// 조각을 90° 씩 돌려 수원에서 모든 칸으로 물길이 이어지고 열린 끝이 하나도 없게 만들면 풀린다.
//
// 퍼즐은 격자 위에 무작위 신장 트리를 만들어 정답 모양을 정한 뒤 조각마다 무작위로 돌려 만든다.
// 그래서 항상 풀 수 있다. 조각은 돌려도 열린 방향의 개수가 그대로라, 모든 칸이 이어지고
// 열린 끝이 없으면 저절로 고리 없는 트리가 된다(연결 수가 칸 수 - 1 로 고정).

import { createRng, formatTime } from '../../shared/util.js';

export { createRng, formatTime };

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

/** 시계 방향 순서. opposite 는 맞은편 칸에서 이쪽을 향하는 비트 */
export const DIRS = [
  { bit: N, dx: 0, dy: -1, opposite: S },
  { bit: E, dx: 1, dy: 0, opposite: W },
  { bit: S, dx: 0, dy: 1, opposite: N },
  { bit: W, dx: -1, dy: 0, opposite: E },
];

/** 난이도 = 격자 크기 */
export const SIZES = [5, 7, 9, 11];

/** 조각 모양별 기준 방향(회전 0). 씬이 이 모양으로 도형을 만든다 */
export const SHAPES = {
  end: N,
  straight: N | S,
  elbow: N | E,
  tee: N | E | S,
  cross: N | E | S | W,
};

/** mask 를 시계 방향으로 turns 번(음수면 반시계) 90° 돌린다 */
export function rotateMask(mask, turns = 1) {
  const k = ((turns % 4) + 4) % 4;
  return ((mask << k) | (mask >> (4 - k))) & 15;
}

export function openCount(mask) {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
}

/** 'end' | 'straight' | 'elbow' | 'tee' | 'cross' */
export function shapeOf(mask) {
  switch (openCount(mask)) {
    case 1:
      return 'end';
    case 2:
      return mask === (N | S) || mask === (E | W) ? 'straight' : 'elbow';
    case 3:
      return 'tee';
    case 4:
      return 'cross';
    default:
      throw new Error(`빈 조각은 없다: ${mask}`);
  }
}

/** 기준 모양을 시계 방향으로 몇 번 돌리면 이 mask 가 되는지 (대칭이면 가장 작은 값) */
export function turnsOf(mask) {
  const base = SHAPES[shapeOf(mask)];
  for (let k = 0; k < 4; k++) if (rotateMask(base, k) === mask) return k;
  return 0;
}

/** 문자열 → 32비트 시드 (FNV-1a) */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 기기 시간대 기준 'YYYY-MM-DD' */
export function dateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 오늘의 퍼즐 시드. 같은 날짜·같은 크기면 누구에게나 같은 퍼즐이 나온다 */
export function dailySeed(day, size) {
  return hashSeed(`pipes:${day}:${size}`);
}

const pick = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));

/** 판 한가운데 칸. 수원이 놓인다 */
export function centerIndex(size) {
  const c = Math.floor(size / 2);
  return c * size + c;
}

/**
 * 무작위 신장 트리로 정답 모양을 만든다. 수원에서 자라는 트리에 칸을 하나씩 붙이는데,
 * 가장 최근 칸에서 이어 가거나(긴 길) 아무 칸에서나 가지를 친다(갈림길).
 * 십자 조각은 돌려도 그대로라 재미가 없으므로 한 칸에 길이 넷 모이지 않게 한다.
 */
export function generateSolution(size, rng = Math.random) {
  const count = size * size;
  const masks = new Uint8Array(count);
  const visited = new Uint8Array(count);
  const source = centerIndex(size);
  visited[source] = 1;
  let remaining = count - 1;
  const active = [source];

  /** 아직 트리에 없는 이웃 방향들 */
  const freeDirs = (index) => {
    const x = index % size;
    const y = (index - x) / size;
    return DIRS.filter(({ dx, dy }) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < size && ny < size && !visited[ny * size + nx];
    });
  };
  const link = (index, dir) => {
    const next = index + dir.dy * size + dir.dx;
    masks[index] |= dir.bit;
    masks[next] |= dir.opposite;
    visited[next] = 1;
    remaining--;
    return next;
  };

  while (remaining > 0 && active.length) {
    const at = rng() < 0.6 ? active.length - 1 : pick(rng, active.length);
    const index = active[at];
    const dirs = openCount(masks[index]) < 3 ? freeDirs(index) : [];
    if (!dirs.length) {
      active.splice(at, 1);
      continue;
    }
    active.push(link(index, dirs[pick(rng, dirs.length)]));
  }

  // 세 갈래 제한 때문에 닿지 못한 칸이 드물게 남는다. 그때만 제한을 풀고 잇는다
  while (remaining > 0) {
    for (let index = 0; index < count && remaining > 0; index++) {
      if (!visited[index]) continue;
      const dirs = freeDirs(index);
      if (dirs.length) link(index, dirs[pick(rng, dirs.length)]);
    }
  }
  return { size, source, masks };
}

/**
 * 수원에서 물이 닿는 칸을 구한다. 이웃한 두 칸이 서로를 향해 열려 있어야 이어진다.
 * depth 는 수원에서 몇 칸 떨어졌는지(닿지 않으면 -1), count 는 물이 찬 칸 수.
 */
export function flood(size, masks, source) {
  const depth = new Int16Array(size * size).fill(-1);
  depth[source] = 0;
  const queue = [source];
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const x = index % size;
    const y = (index - x) / size;
    for (const { bit, dx, dy, opposite } of DIRS) {
      if (!(masks[index] & bit)) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      if (depth[next] >= 0 || !(masks[next] & opposite)) continue;
      depth[next] = depth[index] + 1;
      queue.push(next);
    }
  }
  return { depth, count: queue.length };
}

/** 열린 끝(맞은편이 막혔거나 판 밖을 향한 구멍)의 개수 */
export function looseEnds(size, masks) {
  let loose = 0;
  for (let index = 0; index < masks.length; index++) {
    const x = index % size;
    const y = (index - x) / size;
    for (const { bit, dx, dy, opposite } of DIRS) {
      if (!(masks[index] & bit)) continue;
      const nx = x + dx;
      const ny = y + dy;
      const inside = nx >= 0 && ny >= 0 && nx < size && ny < size;
      if (!inside || !(masks[ny * size + nx] & opposite)) loose++;
    }
  }
  return loose;
}

/** 모든 칸에 물이 닿고 열린 끝이 없으면 풀린 것 */
export function isSolved(size, masks, source) {
  return flood(size, masks, source).count === masks.length && looseEnds(size, masks) === 0;
}

/** 조각마다 무작위로 돌린다. 우연히 풀린 상태가 나오면 다시 섞는다 */
export function scramble(size, solution, source, rng = Math.random) {
  for (;;) {
    const masks = Uint8Array.from(solution, (mask) => rotateMask(mask, pick(rng, 4)));
    if (!isSolved(size, masks, source)) return masks;
  }
}

export class PipesGame {
  /**
   * @param {object} options
   * @param {number} options.size 격자 한 변의 칸 수
   * @param {() => number} options.rng 퍼즐 생성과 섞기에 쓰는 난수 (테스트·오늘의 퍼즐은 시드 난수)
   * @param {string|null} options.daily 오늘의 퍼즐이면 날짜 키, 아니면 null
   */
  constructor({ size = 7, rng = Math.random, daily = null } = {}) {
    if (!Number.isInteger(size) || size < 2) throw new Error(`잘못된 격자 크기: ${size}`);
    this.size = size;
    this.daily = daily;
    const { source, masks } = generateSolution(size, rng);
    this.source = source;
    this.solution = masks;
    this.initial = scramble(size, masks, source, rng);
    this.events = [];
    this.reset();
  }

  get count() {
    return this.size * this.size;
  }

  /** 처음 섞인 상태로 되돌린다 */
  reset() {
    this.start(this.initial);
  }

  /** 같은 퍼즐을 새로 섞는다 */
  reshuffle(rng = Math.random) {
    this.initial = scramble(this.size, this.solution, this.source, rng);
    this.start(this.initial);
  }

  start(masks) {
    this.masks = Uint8Array.from(masks);
    this.moves = 0;
    this.elapsed = 0;
    this.started = false; // 처음 돌릴 때부터 시간을 잰다
    this.solved = false;
    this.refresh();
    this.events.push({ type: 'start' });
  }

  refresh() {
    const { depth, count } = flood(this.size, this.masks, this.source);
    this.depth = depth;
    this.filled = count;
  }

  isFilled(index) {
    return this.depth[index] >= 0;
  }

  /** 조각을 돌린다. dir 은 1 이면 시계 방향, -1 이면 반시계 방향. 돌렸으면 true */
  rotate(index, dir = 1) {
    if (this.solved || !Number.isInteger(index) || index < 0 || index >= this.count) return false;
    const turn = dir < 0 ? -1 : 1;
    const before = this.filled;
    this.masks[index] = rotateMask(this.masks[index], turn);
    this.moves++;
    this.started = true;
    this.refresh();
    this.events.push({ type: 'rotate', index, dir: turn });
    if (this.filled !== before) this.events.push({ type: 'fill', filled: this.filled, before });
    if (this.filled === this.count && looseEnds(this.size, this.masks) === 0) {
      this.solved = true;
      this.events.push({ type: 'solved', moves: this.moves, time: this.elapsed });
    }
    return true;
  }

  /** 시간을 흘린다. 첫 회전 전과 푼 뒤에는 멈춰 있다 */
  update(dt) {
    if (this.started && !this.solved) this.elapsed += dt;
  }

  /** 쌓인 사건을 꺼낸다 */
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }
}
