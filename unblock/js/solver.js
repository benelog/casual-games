// 차 빼기 풀이기. 너비 우선 탐색으로 가장 적은 수의 풀이를 찾는다. 순수 로직이다.
// 게임의 힌트(다음 한 수), 단계 데이터 확인(test/), 단계 생성기(tools/generate.js)와 오늘의 퍼즐(generator.js)이 쓴다.
//
// 상태는 차마다의 자리(0~5)를 3비트씩 이어 붙인 수 하나로 나타낸다. 한 수는 차 하나를 한 방향으로
// 몇 칸이든 미는 것이다. 수는 언제나 되돌릴 수 있으므로(미는 길이 그대로 비어 있다) 상태 사이의 길은 양방향이다.

import { SIZE, GOAL_COL } from './game.js';

const BITS = 3;
const BASE = 1 << BITS;

/** 자리 배열 → 상태 수 */
export function encode(positions) {
  let key = 0;
  for (let i = positions.length - 1; i >= 0; i--) key = key * BASE + positions[i];
  return key;
}

/** 상태 수 → 자리 배열 (out 에 채운다) */
export function decode(key, out) {
  for (let i = 0; i < out.length; i++) {
    const digit = key % BASE;
    out[i] = digit;
    key = (key - digit) / BASE;
  }
  return out;
}

/**
 * 판 모양(차 목록)에 맞춘 이웃 상태 계산기. 상태 수를 받아 한 수로 갈 수 있는 상태마다
 * visit(다음 상태 수, 차 번호, 새 자리) 를 부른다.
 */
function makeNeighbors(pieces) {
  const n = pieces.length;
  const positions = new Int8Array(n);
  const grid = new Int8Array(SIZE * SIZE);
  // 차마다 자리 p 일 때 첫 칸의 번호와 칸 사이 간격
  const origin = pieces.map((piece) => (piece.horizontal ? piece.fixed * SIZE : piece.fixed));
  const stride = pieces.map((piece) => (piece.horizontal ? 1 : SIZE));
  const weight = pieces.map((_, i) => BASE ** i); // 자리 1 칸이 상태 수에서 차지하는 크기

  return (key, visit) => {
    decode(key, positions);
    grid.fill(-1);
    for (let id = 0; id < n; id++) {
      let cell = origin[id] + positions[id] * stride[id];
      for (let k = 0; k < pieces[id].length; k++, cell += stride[id]) grid[cell] = id;
    }
    for (let id = 0; id < n; id++) {
      const pos = positions[id];
      const s = stride[id];
      const o = origin[id];
      for (let p = pos - 1; p >= 0 && grid[o + p * s] === -1; p--) visit(key - (pos - p) * weight[id], id, p);
      const len = pieces[id].length;
      for (let p = pos + 1; p + len - 1 < SIZE && grid[o + (p + len - 1) * s] === -1; p++) {
        visit(key + (p - pos) * weight[id], id, p);
      }
    }
  };
}

/** 상태 수에서 내 차(0번)가 출구에 닿았는지 */
const isGoal = (key) => key % BASE === GOAL_COL;

/**
 * 가장 적은 수의 풀이를 찾는다.
 * @param pieces parseBoard() 의 차 목록
 * @param positions 시작 자리 배열
 * @returns {{ moves: number, path: { id, to }[] } | null} 풀 수 없으면 null
 */
export function solve(pieces, positions, { limit = 2_000_000 } = {}) {
  const start = encode(positions);
  if (isGoal(start)) return { moves: 0, path: [] };
  const neighbors = makeNeighbors(pieces);
  const parent = new Map([[start, -1]]);
  const step = new Map(); // 상태 → 그 상태로 온 수 [차 번호, 자리]
  let frontier = [start];
  let found = -1;
  while (frontier.length && found < 0 && parent.size < limit) {
    const next = [];
    for (const key of frontier) {
      neighbors(key, (to, id, pos) => {
        if (found >= 0 || parent.has(to)) return;
        parent.set(to, key);
        step.set(to, [id, pos]);
        if (isGoal(to)) found = to;
        else next.push(to);
      });
      if (found >= 0) break;
    }
    frontier = next;
  }
  if (found < 0) return null;
  const path = [];
  for (let key = found; key !== start; key = parent.get(key)) {
    const [id, to] = step.get(key);
    path.push({ id, to });
  }
  path.reverse();
  return { moves: path.length, path };
}

/** 지금 상태에서 가장 빨리 푸는 다음 한 수 { id, to, moves(남은 수) }. 풀 수 없거나 이미 풀렸으면 null */
export function nextMove(pieces, positions) {
  const result = solve(pieces, positions);
  if (!result || result.moves === 0) return null;
  return { ...result.path[0], moves: result.moves };
}

/**
 * 상태 수 → 번호 표. Map 보다 몇 배 빠른 열린 주소 해시표로, 단계 생성처럼 수만 개 상태를 수천 번 훑을 때 쓴다.
 * 상태 수는 48비트까지라 Float64Array 에 그대로 담는다.
 */
class StateTable {
  constructor(capacity) {
    let size = 1024;
    while (size < capacity * 2) size *= 2;
    this.mask = size - 1;
    this.keys = new Float64Array(size).fill(-1);
    this.values = new Int32Array(size);
  }

  slot(key) {
    const lo = key >>> 0;
    const hi = (key - lo) / 4294967296;
    let h = Math.imul(lo ^ Math.imul(hi, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 15;
    let i = h & this.mask;
    while (this.keys[i] !== -1 && this.keys[i] !== key) i = (i + 1) & this.mask;
    return i;
  }

  /** 없으면 -1 */
  get(key) {
    const i = this.slot(key);
    return this.keys[i] === key ? this.values[i] : -1;
  }

  set(key, value) {
    const i = this.slot(key);
    this.keys[i] = key;
    this.values[i] = value;
  }
}

/**
 * 시작 상태에서 닿는 모든 상태(한 무리)를 훑어 출구까지 가장 먼 상태를 찾는다. 단계 생성에 쓴다.
 * 무리 안에 풀린 상태가 없거나(풀 수 없는 배치) 무리가 limit 보다 크면 null.
 * 빈칸이 많아 무리가 큰 배치는 대개 쉬워서, 생성기는 버리고 다른 배치를 시도한다.
 * @returns {{ positions: number[], moves: number, states: number }} moves 는 그 상태의 최소 수, states 는 무리의 크기
 */
export function hardestInCluster(pieces, positions, { limit = 20_000 } = {}) {
  const neighbors = makeNeighbors(pieces);
  const table = new StateTable(limit + 1);
  const keys = new Float64Array(limit + 1);
  // 이웃 목록: 상태 i 의 이웃 번호는 edges[first[i] .. first[i + 1]) 에 있다
  let edges = new Int32Array(limit * 8);
  const first = new Int32Array(limit + 2);
  let count = 1;
  let edgeCount = 0;
  let overflow = false;
  keys[0] = encode(positions);
  table.set(keys[0], 0);

  // 1) 닿는 상태를 모두 모으며 이웃 목록을 만든다
  for (let head = 0; head < count && !overflow; head++) {
    first[head] = edgeCount;
    neighbors(keys[head], (to) => {
      let j = table.get(to);
      if (j < 0) {
        if (count > limit) {
          overflow = true;
          return;
        }
        j = count++;
        keys[j] = to;
        table.set(to, j);
      }
      if (edgeCount === edges.length) {
        const grown = new Int32Array(edges.length * 2);
        grown.set(edges);
        edges = grown;
      }
      edges[edgeCount++] = j;
    });
  }
  if (overflow) return null;
  first[count] = edgeCount;

  // 2) 풀린 상태들에서 거꾸로 너비 우선 탐색 (길이 양방향이라 이웃 목록을 그대로 쓴다)
  const distance = new Int32Array(count).fill(-1);
  let frontier = [];
  for (let i = 0; i < count; i++) {
    if (isGoal(keys[i])) {
      distance[i] = 0;
      frontier.push(i);
    }
  }
  if (frontier.length === 0) return null;
  let far = frontier[0];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    for (const i of frontier) {
      for (let e = first[i]; e < first[i + 1]; e++) {
        const j = edges[e];
        if (distance[j] >= 0) continue;
        distance[j] = depth + 1;
        next.push(j);
      }
    }
    if (next.length === 0) break;
    depth++;
    // 같은 거리 가운데서는 상태 수가 가장 작은 것을 골라 결과가 탐색 순서에 흔들리지 않게 한다
    far = next.reduce((a, b) => (keys[b] < keys[a] ? b : a));
    frontier = next;
  }
  return { positions: decode(keys[far], new Array(pieces.length)), moves: depth, states: count };
}
