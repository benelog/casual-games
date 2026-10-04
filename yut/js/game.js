// 윷놀이 규칙. 화면·소리와 분리된 순수 로직이라 node 에서 그대로 테스트한다.
//
// 윷판의 자리(29곳)는 번호로 가리킨다. 출발점(참먹이)이 0 이고 판 바깥을 시계 반대 방향으로 돈다.
//
//   10 ─ 9 ─ 8 ─ 7 ─ 6 ─ 5        5·10·15 는 모서리(모·뒷모·찌모), 22 는 가운데(방)
//   │ 25                 20 │       5 → 20 → 21 → 22 → 23 → 24 → 15  (오른쪽 위 → 왼쪽 아래 대각선)
//  11    26         21     4       10 → 25 → 26 → 22 → 27 → 28 → 0  (왼쪽 위 → 출발점 대각선)
//  12         22           3
//  13    23         27     2       모서리(5, 10)에 딱 멈추면 다음 이동은 대각선으로 들어가고,
//   │ 24                 28 │       가운데(22)에 딱 멈추면 다음 이동은 출발점 쪽(27)으로 꺾는다.
//  15 ─16 ─17 ─18 ─19 ─ 0         지나가기만 하면 가던 길을 그대로 간다.
//
// 말은 출발점을 지나야 난다(골인). 출발점에 딱 멈추면 판 위에 남아 있다가 다음 이동에서 무엇이 나오든 난다.
// 일어난 일은 사건으로 쌓아 두고 drain() 으로 꺼내 화면과 소리에 옮긴다.

export const STATION_COUNT = 29;
export const WAIT = -1; // 아직 판에 오르지 않은 말
export const HOME = 99; // 판을 다 돌아 난 말
export const START = 0; // 출발점(참먹이)
export const CENTER = 22; // 가운데(방)
export const CORNERS = [5, 10, 15]; // 모서리(모·뒷모·찌모)
export const PIECES_PER_TEAM = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** 윷 결과. steps 는 움직이는 칸 수(빽도는 한 칸 뒤로), bonus 는 한 번 더 던지는 결과 */
export const RESULTS = {
  backdo: { steps: -1, bonus: false },
  do: { steps: 1, bonus: false },
  gae: { steps: 2, bonus: false },
  geol: { steps: 3, bonus: false },
  yut: { steps: 4, bonus: true },
  mo: { steps: 5, bonus: true },
};
export const RESULT_IDS = Object.keys(RESULTS);

export const STICK_COUNT = 4;
export const MARKED_STICK = 0; // 평평한 면(배)에 빽도 표시가 있는 가락
export const FLAT_CHANCE = 0.6; // 가락 하나가 평평한 면이 위로 오며 떨어질 확률

const OUTER_LAST = 19;

/**
 * 한 칸 앞. cur 에서 prev 를 거쳐 왔고, first 면 이번 이동의 첫 걸음이다.
 * 모서리·가운데의 지름길은 그 자리에서 이동을 시작할 때만 탄다.
 */
export function nextStation(cur, prev, first) {
  if (cur === WAIT) return 1;
  if (cur === START) return HOME;
  if (first) {
    if (cur === 5) return 20;
    if (cur === 10) return 25;
    if (cur === CENTER) return 27;
  }
  if (cur >= 1 && cur < OUTER_LAST) return cur + 1;
  switch (cur) {
    case OUTER_LAST:
      return START;
    case 20:
      return 21;
    case 21:
      return CENTER;
    case CENTER:
      return prev === 26 ? 27 : 23; // 지나가기만 하면 들어온 대각선을 그대로 간다
    case 23:
      return 24;
    case 24:
      return 15;
    case 25:
      return 26;
    case 26:
      return CENTER;
    case 27:
      return 28;
    case 28:
      return START;
  }
  throw new Error(`없는 자리: ${cur}`);
}

/** pos 에서 steps 칸 앞으로 갈 때 밟는 자리들(마지막이 도착). 나면 마지막이 HOME 이고 거기서 멈춘다 */
export function forwardPath(pos, steps) {
  const path = [];
  let cur = pos;
  let prev = null;
  for (let i = 0; i < steps; i++) {
    const next = nextStation(cur, prev, i === 0);
    path.push(next);
    if (next === HOME) break;
    prev = cur;
    cur = next;
  }
  return path;
}

/** 자리마다 한 칸 뒤의 후보. 둘인 곳(가운데·찌모·출발점)은 앞 것이 기본 */
const PREDECESSORS = (() => {
  const map = {};
  for (let s = 1; s <= OUTER_LAST; s++) map[s] = [s - 1];
  map[START] = [OUTER_LAST, 28];
  map[15] = [14, 24];
  map[20] = [5];
  map[21] = [20];
  map[CENTER] = [21, 26];
  map[23] = [CENTER];
  map[24] = [23];
  map[25] = [10];
  map[26] = [25];
  map[27] = [CENTER];
  map[28] = [27];
  return map;
})();

/**
 * 빽도로 한 칸 물러날 자리. 앞 칸이 둘인 곳에서는 실제로 지나온 칸(prev)으로 돌아간다.
 * 판에 없는 말은 물러날 수 없다(null).
 */
export function backStation(pos, prev) {
  const candidates = PREDECESSORS[pos];
  if (!candidates) return null;
  return candidates.includes(prev) ? prev : candidates[0];
}

/** from 에서 빽도로 to 로 물러난 뒤, 다시 빽도가 나오면 물러날 칸을 정하는 '지나온 칸' */
function prevAfterBack(from, to) {
  if (to === CENTER) return from === 27 ? 26 : 21;
  return PREDECESSORS[to]?.[0] ?? null;
}

/** 네 가락이 떨어진 모양 → 결과. sticks[i] 가 true 면 평평한 면(배)이 위 */
export function resultOf(sticks, backdo = true) {
  const flat = sticks.filter(Boolean).length;
  if (flat === 0) return 'mo';
  if (flat === 1) return backdo && sticks[MARKED_STICK] ? 'backdo' : 'do';
  return ['do', 'gae', 'geol', 'yut'][flat - 1];
}

export function rollSticks(rng = Math.random) {
  return Array.from({ length: STICK_COUNT }, () => rng() < FLAT_CHANCE);
}

/** 결과마다 나올 확률 */
export function resultChances(backdo = true, p = FLAT_CHANCE) {
  const chances = Object.fromEntries(RESULT_IDS.map((id) => [id, 0]));
  for (let mask = 0; mask < 1 << STICK_COUNT; mask++) {
    const sticks = Array.from({ length: STICK_COUNT }, (_, i) => !!(mask & (1 << i)));
    const flat = sticks.filter(Boolean).length;
    chances[resultOf(sticks, backdo)] += p ** flat * (1 - p) ** (STICK_COUNT - flat);
  }
  return chances;
}

export const onBoard = (pos) => pos !== WAIT && pos !== HOME;

/**
 * team 의 말을 result 로 움직이는 방법들. 같은 자리에 업힌 말은 함께 움직이고,
 * 기다리는 말은 한 마리만 새로 올린다. 판에 말이 없으면 빽도로는 움직일 수 없다.
 * 각 방법: { team, from, pieces(번호들), path, to, home, capture(잡히는 말 번호들), stack(업게 되는 말 번호들) }
 */
export function optionsFor(pieces, team, result) {
  const { steps } = RESULTS[result];
  const options = [];
  const seen = new Set();
  for (const piece of pieces) {
    if (piece.team !== team || piece.pos === HOME || seen.has(piece.pos)) continue;
    if (steps < 0 && piece.pos === WAIT) continue;
    seen.add(piece.pos);
    const group = piece.pos === WAIT ? [piece] : pieces.filter((p) => p.team === team && p.pos === piece.pos);
    const path = steps < 0 ? [backStation(piece.pos, piece.prev)] : forwardPath(piece.pos, steps);
    const to = path[path.length - 1];
    const ids = group.map((p) => p.id);
    const others = to === HOME ? [] : pieces.filter((p) => p.pos === to && !ids.includes(p.id));
    options.push({
      team,
      result,
      from: piece.pos,
      pieces: ids,
      path,
      to,
      home: to === HOME,
      capture: others.filter((p) => p.team !== team).map((p) => p.id),
      stack: others.filter((p) => p.team === team).map((p) => p.id),
    });
  }
  return options;
}

/** 방법 하나를 적용한 새 말 배열(원래 배열은 그대로) */
export function applyOption(pieces, option) {
  const moving = new Set(option.pieces);
  const captured = new Set(option.capture);
  const { path, to, from } = option;
  const back = RESULTS[option.result].steps < 0;
  const prev = back ? prevAfterBack(from, to) : path.length > 1 ? path[path.length - 2] : from;
  return pieces.map((p) => {
    if (moving.has(p.id)) return { ...p, pos: to, prev: to === HOME ? null : prev };
    if (captured.has(p.id)) return { ...p, pos: WAIT, prev: null };
    return p;
  });
}

export function createPieces(players) {
  const pieces = [];
  for (let team = 0; team < players; team++) {
    for (let index = 0; index < PIECES_PER_TEAM; index++) {
      pieces.push({ id: pieces.length, team, index, pos: WAIT, prev: null });
    }
  }
  return pieces;
}

export const teamDone = (pieces, team) => pieces.every((p) => p.team !== team || p.pos === HOME);

export class YutGame {
  /**
   * players: 편 수(2~4), backdo: 빽도 규칙을 쓸지, first: 먼저 던지는 편, rng: 윷 던지기에 쓰는 난수
   */
  constructor({ players = 2, backdo = true, first = 0, rng = Math.random } = {}) {
    if (!Number.isInteger(players) || players < MIN_PLAYERS || players > MAX_PLAYERS) {
      throw new Error(`편 수는 ${MIN_PLAYERS}~${MAX_PLAYERS}: ${players}`);
    }
    this.players = players;
    this.backdo = backdo;
    this.rng = rng;
    this.pieces = createPieces(players);
    this.current = first % players;
    this.phase = 'throw'; // throw: 던질 차례 | move: 나온 결과로 말을 옮길 차례 | done
    this.throws = 1; // 이번 차례에 더 던질 수 있는 횟수
    this.pending = []; // 아직 쓰지 않은 결과
    this.winner = -1;
    this.turns = 0; // 차례가 넘어간 횟수
    this.events = [];
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  /** 쌓인 사건을 꺼낸다 */
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** 아직 쓰지 않은 result 로 지금 움직일 수 있는 방법들 */
  options(result) {
    if (this.phase !== 'move' || !this.pending.includes(result)) return [];
    return optionsFor(this.pieces, this.current, result);
  }

  /** 쓸 수 있는 결과가 하나라도 있나 */
  canUse(result) {
    return optionsFor(this.pieces, this.current, result).length > 0;
  }

  /**
   * 윷을 던진다. sticks(네 가락의 모양)를 주면 그대로 쓴다(테스트·컴퓨터 재현용).
   * 윷·모가 나오면 한 번 더 던진다. 나온 결과는 쌓였다가 던지기가 끝나면 원하는 순서로 쓴다.
   */
  throw(sticks = rollSticks(this.rng)) {
    if (this.phase !== 'throw') return null;
    const result = resultOf(sticks, this.backdo);
    const { bonus } = RESULTS[result];
    this.pending.push(result);
    this.throws += bonus ? 0 : -1;
    this.emit('throw', { team: this.current, sticks: [...sticks], result, bonus });
    if (this.throws <= 0) this.startMoving();
    return result;
  }

  /** 던지기가 끝났다. 쓸 수 있는 결과가 하나도 없으면 모두 버리고 차례를 넘긴다 */
  startMoving() {
    this.phase = 'move';
    if (this.pending.some((result) => this.canUse(result))) return;
    this.emit('discard', { team: this.current, results: [...this.pending] });
    this.pending = [];
    this.nextTurn();
  }

  /**
   * result 로 from 자리(기다리는 말이면 WAIT)의 말을 옮긴다. 옮겼으면 그 방법을, 못 옮기면 null 을 돌려준다.
   * 상대 말을 잡으면 한 번 더 던진다. 모든 말이 나면 이긴다.
   */
  move(result, from) {
    if (this.phase !== 'move') return null;
    const option = this.options(result).find((o) => o.from === from);
    if (!option) return null;
    this.pending.splice(this.pending.indexOf(result), 1);
    this.pieces = applyOption(this.pieces, option);
    this.emit('move', { ...option });

    if (teamDone(this.pieces, this.current)) {
      this.phase = 'done';
      this.winner = this.current;
      this.pending = [];
      this.emit('win', { team: this.current });
      return option;
    }
    if (option.capture.length) {
      this.throws = 1;
      this.phase = 'throw';
      this.emit('again', { team: this.current, reason: 'capture' });
    } else if (this.pending.length) {
      this.startMoving();
    } else {
      this.nextTurn();
    }
    return option;
  }

  nextTurn() {
    this.current = (this.current + 1) % this.players;
    this.phase = 'throw';
    this.throws = 1;
    this.pending = [];
    this.turns++;
    this.emit('turn', { team: this.current });
  }

  /** 편마다 { wait, board, home } 말 수 */
  counts(team) {
    const mine = this.pieces.filter((p) => p.team === team);
    return {
      wait: mine.filter((p) => p.pos === WAIT).length,
      home: mine.filter((p) => p.pos === HOME).length,
      board: mine.filter((p) => onBoard(p.pos)).length,
    };
  }

  /** 컴퓨터가 수를 읽을 때 쓰는 복사본(사건은 빼고) */
  clone() {
    const copy = Object.create(YutGame.prototype);
    Object.assign(copy, this, { pieces: this.pieces.map((p) => ({ ...p })), pending: [...this.pending], events: [] });
    return copy;
  }
}
