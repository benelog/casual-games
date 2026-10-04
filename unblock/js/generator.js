// 퍼즐 만들기. 무작위로 차를 놓은 뒤, 그 배치에서 닿는 모든 상태 가운데 출구에서 가장 먼 상태를
// 문제로 삼는다(solver.js 의 hardestInCluster). 그래서 언제나 풀 수 있고, 최소 수도 함께 안다.
// 차를 하나 빼거나 더하거나 옮겨 보며 더 어려워지면 받아들이는 언덕 오르기로 어려운 퍼즐을 찾는다.
//
// 단계 목록(levels.js)은 tools/generate.js 가 이것으로 미리 만들어 두고,
// 오늘의 퍼즐은 날짜로 정한 시드로 게임이 그 자리에서 만든다. 같은 날짜면 누구에게나 같은 퍼즐이다.
// 순수 로직이다.

import { SIZE, EXIT_ROW, RED, MAX_PIECES, parseBoard, boardString } from './game.js';
import { hardestInCluster } from './solver.js';
import { createRng } from '../../shared/util.js';

export { createRng };

const LETTERS = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
const TRUCK_CHANCE = 0.3; // 새 차가 길이 3(트럭·버스)일 확률

const pick = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));

/** 비어 있는 자리에 차 하나를 무작위로 놓아 본다. 놓았으면 true */
function addRandomPiece(spec, rng) {
  if (spec.length >= MAX_PIECES) return false;
  const grid = specGrid(spec);
  const length = rng() < TRUCK_CHANCE ? 3 : 2;
  const horizontal = rng() < 0.5;
  const fixed = pick(rng, SIZE);
  const pos = pick(rng, SIZE - length + 1);
  // 내 차 오른쪽 같은 줄의 가로 차는 영영 비키지 못한다
  if (horizontal && fixed === EXIT_ROW) return false;
  const piece = { horizontal, length, fixed, pos };
  for (const cell of specCells(piece)) if (grid[cell] !== -1) return false;
  spec.push(piece);
  return true;
}

/** 차 목록(spec: { horizontal, length, fixed, pos }[], 0번이 내 차)이 차지한 칸 */
function specGrid(spec) {
  const grid = new Int8Array(SIZE * SIZE).fill(-1);
  spec.forEach((piece, id) => {
    for (const cell of specCells(piece)) grid[cell] = id;
  });
  return grid;
}

function specCells({ horizontal, length, fixed, pos }) {
  const cells = [];
  for (let k = 0; k < length; k++) cells.push(horizontal ? fixed * SIZE + pos + k : (pos + k) * SIZE + fixed);
  return cells;
}

/** spec → 36글자 판 (내 차는 A, 나머지는 놓인 순서대로 B, C, …) */
export function specBoard(spec) {
  const grid = specGrid(spec);
  let text = '';
  for (const id of grid) text += id < 0 ? '.' : id === 0 ? RED : LETTERS[id - 1];
  return text;
}

/** 내 차와 count 대의 다른 차를 무작위로 놓는다 */
export function randomSpec(rng, count) {
  const spec = [{ horizontal: true, length: 2, fixed: EXIT_ROW, pos: pick(rng, 3) }];
  for (let tries = 0; spec.length <= count && tries < 400; tries++) addRandomPiece(spec, rng);
  return spec;
}

/**
 * 배치를 평가한다: 그 배치의 무리에서 가장 어려운 퍼즐.
 * @returns {{ board, moves, states } | null} 풀 수 없는 배치면 null
 */
export function evaluate(spec) {
  const { pieces } = parseBoard(specBoard(spec));
  const positions = pieces.map((piece) => piece.start);
  const hardest = hardestInCluster(pieces, positions);
  if (!hardest) return null;
  return { board: normalize(boardString(pieces, hardest.positions)), moves: hardest.moves, states: hardest.states };
}

/**
 * 같은 퍼즐을 같은 글자로 적도록 차 글자를 다시 매긴다. 내 차는 A, 나머지는 판에서 처음 나오는 순서대로 B, C, …
 * 중복을 가려낼 때 이 모양으로 비교한다.
 */
export function normalize(board) {
  const rename = new Map([[RED, RED]]);
  let text = '';
  for (const ch of board) {
    if (ch === '.') {
      text += ch;
      continue;
    }
    if (!rename.has(ch)) rename.set(ch, LETTERS[rename.size - 1]);
    text += rename.get(ch);
  }
  return text;
}

/** spec 을 조금 바꾼 새 spec: 차 하나 빼기, 더하기, 또는 빼고 더하기 */
function mutate(spec, rng) {
  const next = spec.map((piece) => ({ ...piece }));
  const roll = rng();
  if ((roll < 0.35 || roll >= 0.7) && next.length > 2) next.splice(1 + pick(rng, next.length - 1), 1);
  if (roll >= 0.35) {
    for (let tries = 0; tries < 60; tries++) if (addRandomPiece(next, rng)) break;
  }
  return next;
}

/**
 * 언덕 오르기로 어려운 퍼즐을 찾는다.
 * @param options.count 처음 놓을 다른 차 수
 * @param options.steps 바꿔 볼 횟수
 * @param options.target 이만큼 어려우면 그만 찾는다
 * @param options.onResult 평가한 퍼즐마다 불린다. 생성기가 지나가며 만난 퍼즐도 모아 쓴다
 * @returns {{ board, moves, states } | null} 가장 어려웠던 것 (끝내 못 찾으면 moves 가 작을 수 있다)
 */
export function climb(rng, { count = 10, steps = 200, target = Infinity, onResult = null } = {}) {
  let spec = null;
  let best = null;
  for (let tries = 0; !best && tries < 50; tries++) {
    spec = randomSpec(rng, count);
    best = evaluate(spec);
  }
  if (!best) return null;
  onResult?.(best);
  for (let i = 0; i < steps && best.moves < target; i++) {
    const candidate = mutate(spec, rng);
    const result = evaluate(candidate);
    if (result) onResult?.(result);
    if (result && result.moves >= best.moves) {
      spec = candidate;
      best = result;
    }
  }
  return best;
}

// ---------- 오늘의 퍼즐 ----------

/** 오늘의 퍼즐의 최소 수 범위. 중급쯤 되는 퍼즐을 고른다 */
export const DAILY_RANGE = { min: 14, max: 26 };

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

export function dailySeed(day) {
  return hashSeed(`unblock:${day}`);
}

/**
 * 그날의 퍼즐. 시드가 같으면 언제나 같은 퍼즐이 나온다(그 자리에서 만드는 데 0.5초쯤 걸린다).
 * 범위 안에서 날마다 다른 목표 수를 정하고, 범위 안의 퍼즐이 나올 때까지 언덕 오르기를 되풀이한다.
 * 끝내 못 찾으면 그때까지 가장 어려웠던 것을 쓴다.
 * @returns {{ board, moves }}
 */
export function dailyPuzzle(day) {
  const rng = createRng(dailySeed(day));
  const target = DAILY_RANGE.min + pick(rng, DAILY_RANGE.max - DAILY_RANGE.min + 1);
  let fallback = null;
  for (let round = 0; round < 40; round++) {
    const found = climb(rng, { count: 9 + pick(rng, 4), steps: 80, target });
    if (!found) continue;
    if (found.moves >= DAILY_RANGE.min && found.moves <= DAILY_RANGE.max) return { board: found.board, moves: found.moves };
    if (found.moves <= DAILY_RANGE.max && (!fallback || found.moves > fallback.moves)) fallback = found;
  }
  return { board: fallback.board, moves: fallback.moves };
}
