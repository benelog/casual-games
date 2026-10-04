// 컴퓨터 편. 쌓인 결과와 말마다 옮길 수 있는 방법을 모두 놓아 보고(game.js 의 순수 함수로) 점수를 매겨 고른다.
//
// 점수의 바탕은 '이 자리에서 나기까지 평균 몇 번 더 옮겨야 하나'(expectedMoves)다. 모서리·가운데처럼
// 지름길이 열린 자리는 값이 작아서 따로 쳐 주지 않아도 그쪽을 고르게 된다. 여기에
// 상대 말 잡기(한 번 더 던진다), 업기, 다음 상대 차례에 잡힐 위험을 더하고 뺀다.
// 실력이 낮을수록 위험을 덜 보고 판단에 잡음이 섞인다. 어려움은 쌓인 결과를 쓰는 순서까지 읽는다.

import {
  WAIT,
  HOME,
  START,
  STATION_COUNT,
  RESULTS,
  RESULT_IDS,
  resultChances,
  forwardPath,
  backStation,
  optionsFor,
  applyOption,
  onBoard,
} from './game.js';

// think: 던지거나 옮기기 전에 뜸 들이는 시간(초), noise: 판단에 섞이는 잡음,
// danger: 잡힐 위험을 얼마나 무겁게 보나, greed: 잡기를 얼마나 노리나, depth: 쌓인 결과를 몇 개까지 순서를 바꿔 읽나
export const LEVELS = {
  easy: { think: 0.8, noise: 2.2, danger: 0.25, greed: 0.6, depth: 1 },
  normal: { think: 0.6, noise: 0.35, danger: 0.9, greed: 1, depth: 1 },
  hard: { think: 0.45, noise: 0, danger: 1.15, greed: 1.2, depth: 3 },
};
export const LEVEL_IDS = Object.keys(LEVELS);

const CAPTURE_BONUS = 1.1; // 잡으면 한 번 더 던지는 값(옮기기 한 번쯤)

/** 자리 → 평균 남은 옮기기 횟수. 결과 하나를 한 번의 옮기기로 센다 (값 반복으로 푼다) */
export function expectedMoves(backdo = true) {
  const chances = Object.entries(resultChances(backdo)).filter(([, p]) => p > 0);
  const positions = [WAIT, ...Array.from({ length: STATION_COUNT }, (_, i) => i)];
  const value = new Map(positions.map((pos) => [pos, 10]));
  value.set(HOME, 0);
  const land = (pos, result) => {
    const { steps } = RESULTS[result];
    if (steps < 0) return pos === WAIT ? WAIT : backStation(pos, null);
    const path = forwardPath(pos, steps);
    return path[path.length - 1];
  };
  for (let round = 0; round < 300; round++) {
    for (const pos of positions) {
      let sum = 1;
      for (const [result, p] of chances) sum += p * value.get(land(pos, result));
      value.set(pos, sum);
    }
  }
  return value;
}

const tables = new Map();
function table(backdo) {
  if (!tables.has(backdo)) tables.set(backdo, expectedMoves(backdo));
  return tables.get(backdo);
}

/** 말 하나가 나아간 정도(0 = 기다림, 클수록 나기 가까움) */
const progress = (moves, pos) => moves.get(WAIT) - moves.get(pos);

/**
 * station 에 선 말이 다음 상대 차례(들)에 잡힐 확률을 어림한다.
 * 상대마다 어느 결과가 나오면 그 자리에 닿는지 보고, 윷·모로 더 던지는 몫을 조금 얹는다.
 */
export function dangerAt(pieces, team, station, chances) {
  if (!onBoard(station) || station === undefined) return 0;
  let safe = 1;
  const teams = new Set(pieces.filter((p) => p.team !== team && p.pos !== HOME).map((p) => p.team));
  for (const other of teams) {
    let hit = 0;
    for (const result of RESULT_IDS) {
      if (!chances[result]) continue;
      if (optionsFor(pieces, other, result).some((o) => o.to === station)) hit += chances[result];
    }
    safe *= 1 - Math.min(0.95, hit * 1.15);
  }
  return 1 - safe;
}

/** team 의 처지 점수. 내 말이 앞설수록, 상대 말이 뒤처질수록, 내 말이 덜 위험할수록 크다 */
export function evaluate(pieces, team, { backdo = true, danger = 1 } = {}) {
  const moves = table(backdo);
  const chances = resultChances(backdo);
  const opponents = new Set(pieces.filter((p) => p.team !== team).map((p) => p.team)).size || 1;
  let score = 0;
  const groups = new Map();
  for (const p of pieces) {
    const value = progress(moves, p.pos) + (p.pos === HOME ? 0.4 : 0);
    if (p.team === team) {
      score += value;
      if (onBoard(p.pos)) groups.set(p.pos, (groups.get(p.pos) ?? 0) + value);
    } else {
      score -= value / opponents;
    }
  }
  if (danger > 0) {
    for (const [station, value] of groups) score -= danger * dangerAt(pieces, team, station, chances) * value;
  }
  return score;
}

/** 방법 하나를 고른 직후의 덤 점수(잡기·업기) */
function moveBonus(option, pieces, moves, greed) {
  let bonus = 0;
  if (option.capture.length) {
    // 잡힌 말이 쌓아 둔 거리는 evaluate 가 이미 센다. 한 번 더 던지는 몫을 더한다
    bonus += CAPTURE_BONUS * greed;
  }
  if (option.stack.length) bonus += 0.15; // 업으면 한 번에 여럿이 움직인다
  if (option.home) bonus += 0.05;
  // 기다리는 말을 굳이 출발점 바로 앞에 세워 두는 것보다 판의 말을 키우는 편을 조금 낫게 본다
  if (option.from === WAIT && option.to === START) bonus -= 0.1;
  return bonus;
}

/** 쌓인 결과(pending)로 둘 수 있는 모든 (결과, 방법). 같은 결과는 한 번만 본다 */
function candidates(pieces, team, pending) {
  const list = [];
  for (const result of new Set(pending)) {
    for (const option of optionsFor(pieces, team, result)) list.push({ result, option });
  }
  return list;
}

/** depth 개까지의 결과를 차례로 쓰는 가장 좋은 점수(어려움). 다 못 쓰면 지금 판으로 매긴다 */
function search(pieces, team, pending, depth, settings) {
  const list = depth > 0 ? candidates(pieces, team, pending) : [];
  if (!list.length) return evaluate(pieces, team, settings);
  const moves = table(settings.backdo);
  let best = -Infinity;
  for (const { result, option } of list) {
    const rest = [...pending];
    rest.splice(rest.indexOf(result), 1);
    const next = applyOption(pieces, option);
    const score = moveBonus(option, pieces, moves, settings.greed) + search(next, team, rest, depth - 1, settings);
    if (score > best) best = score;
  }
  return best;
}

/**
 * 지금 차례(game.current)에 쓸 결과와 옮길 말을 고른다. { result, from } 또는 둘 데가 없으면 null.
 * level: LEVELS 의 키, rng: 잡음에 쓰는 난수
 */
export function chooseMove(game, level = 'normal', rng = Math.random) {
  const config = LEVELS[level] ?? LEVELS.normal;
  const team = game.current;
  const list = candidates(game.pieces, team, game.pending);
  if (!list.length) return null;
  const settings = { backdo: game.backdo, danger: config.danger, greed: config.greed };
  const moves = table(game.backdo);
  let best = null;
  for (const { result, option } of list) {
    const rest = [...game.pending];
    rest.splice(rest.indexOf(result), 1);
    const next = applyOption(game.pieces, option);
    let score = moveBonus(option, game.pieces, moves, config.greed);
    score +=
      config.depth > 1
        ? search(next, team, rest, Math.min(config.depth, rest.length + 1) - 1, settings)
        : evaluate(next, team, settings);
    score += (rng() - 0.5) * config.noise;
    if (!best || score > best.score) best = { result, from: option.from, score };
  }
  return { result: best.result, from: best.from };
}
