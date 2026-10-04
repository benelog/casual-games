// 차 빼기 퍼즐 규칙. DOM·Three.js 에 의존하지 않는 순수 로직이라 node 에서 그대로 테스트한다.
//
// 판은 6×6 주차장이고 칸 (col, row) 는 col 이 오른쪽, row 가 아래쪽이다. 칸 번호는 row * SIZE + col.
// 차는 놓인 방향(가로/세로)으로만 미끄러진다. 빨간 내 차(A)는 EXIT_ROW 줄에 가로로 놓이고,
// 오른쪽 끝(GOAL_COL)까지 가면 출구로 빠져나가 클리어다.
//
// 판은 36글자 문자열로 적는다. 줄 순서대로 '.' 은 빈칸, 'A' 는 내 차, 'B'~'Z' 는 다른 차(같은 글자가 한 대).
// 차의 자리(pos)는 가로 차면 가장 왼쪽 칸의 col, 세로 차면 가장 위 칸의 row 이다.
// 이동 수는 한 차를 한 번 미는 것을 1수로 센다(몇 칸을 가든). 같은 차를 잇달아 밀면 한 수로 친다.
// 화면 쪽(scene.js, main.js)은 drain() 으로 사건을 받아 그리고 소리를 낸다.

export const SIZE = 6;
export const EXIT_ROW = 2;
export const RED = 'A';
export const GOAL_COL = SIZE - 2; // 내 차(길이 2)가 이 자리에 닿으면 출구에 붙은 것이다
export const MAX_PIECES = 16; // 상태를 수 하나로 묶을 때 넘지 않는 차 수 (3비트 × 16 = 48비트)

/**
 * 36글자 판을 읽는다. 잘못된 판은 예외를 던진다.
 * @returns {{ board: string, pieces: { letter, horizontal, length, fixed, start }[] }}
 *   pieces[0] 은 언제나 내 차(A)고, 나머지는 글자 순이다. fixed 는 움직이지 않는 좌표(가로 차의 row, 세로 차의 col).
 */
export function parseBoard(board) {
  if (typeof board !== 'string' || board.length !== SIZE * SIZE) {
    throw new Error(`판은 ${SIZE * SIZE}글자여야 한다`);
  }
  const cells = new Map(); // 글자 → 칸 번호들
  for (let i = 0; i < board.length; i++) {
    const ch = board[i];
    if (ch === '.') continue;
    if (!/^[A-Z]$/.test(ch)) throw new Error(`알 수 없는 기호 '${ch}' (${i % SIZE}, ${Math.floor(i / SIZE)})`);
    if (!cells.has(ch)) cells.set(ch, []);
    cells.get(ch).push(i);
  }
  if (!cells.has(RED)) throw new Error('내 차(A)가 없다');
  if (cells.size > MAX_PIECES) throw new Error(`차가 너무 많다 (${cells.size})`);
  const letters = [...cells.keys()].sort();
  const pieces = letters.map((letter) => {
    const list = cells.get(letter);
    const length = list.length;
    if (length < 2 || length > 3) throw new Error(`차 ${letter} 의 길이(${length})는 2 나 3 이어야 한다`);
    const rows = list.map((i) => Math.floor(i / SIZE));
    const cols = list.map((i) => i % SIZE);
    const horizontal = rows.every((r) => r === rows[0]);
    const vertical = cols.every((c) => c === cols[0]);
    // 칸 번호는 커지는 순서라 가로면 col, 세로면 row 가 1씩 늘어야 한 줄로 붙어 있는 것이다
    const line = horizontal ? cols : rows;
    if ((!horizontal && !vertical) || line.some((v, k) => v !== line[0] + k)) {
      throw new Error(`차 ${letter} 가 한 줄로 붙어 있지 않다`);
    }
    return { letter, horizontal, length, fixed: horizontal ? rows[0] : cols[0], start: line[0] };
  });
  const red = pieces[0];
  if (!red.horizontal || red.length !== 2 || red.fixed !== EXIT_ROW) {
    throw new Error(`내 차(A)는 ${EXIT_ROW}번 줄에 가로로 놓인 길이 2 차여야 한다`);
  }
  return { board, pieces };
}

/** 차가 pos 자리에 있을 때 차지하는 칸 번호들 */
export function pieceCells(piece, pos) {
  const out = [];
  for (let k = 0; k < piece.length; k++) {
    out.push(piece.horizontal ? piece.fixed * SIZE + pos + k : (pos + k) * SIZE + piece.fixed);
  }
  return out;
}

/** 자리 배열 → 칸마다 차 번호 (빈칸은 -1) */
export function occupancy(pieces, positions, out = new Int8Array(SIZE * SIZE)) {
  out.fill(-1);
  pieces.forEach((piece, id) => {
    const pos = positions[id];
    const step = piece.horizontal ? 1 : SIZE;
    let cell = piece.horizontal ? piece.fixed * SIZE + pos : pos * SIZE + piece.fixed;
    for (let k = 0; k < piece.length; k++, cell += step) out[cell] = id;
  });
  return out;
}

/** 다른 차에 막히기 전까지 id 차가 갈 수 있는 자리의 범위 { min, max } */
export function slideRange(pieces, positions, id, grid = occupancy(pieces, positions)) {
  const piece = pieces[id];
  const pos = positions[id];
  const at = (p) => (piece.horizontal ? piece.fixed * SIZE + p : p * SIZE + piece.fixed);
  let min = pos;
  while (min > 0 && grid[at(min - 1)] === -1) min--;
  let max = pos;
  while (max + piece.length < SIZE && grid[at(max + piece.length)] === -1) max++;
  return { min, max };
}

/** 자리 배열 → 36글자 판 */
export function boardString(pieces, positions) {
  const grid = occupancy(pieces, positions);
  let text = '';
  for (const id of grid) text += id < 0 ? '.' : pieces[id].letter;
  return text;
}

export class UnblockGame {
  /** @param puzzle parseBoard() 의 결과 */
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.pieces = puzzle.pieces;
    this.events = [];
    this.reset();
  }

  reset() {
    this.positions = this.pieces.map((piece) => piece.start);
    this.history = []; // { id, from, to }. 같은 차를 잇달아 밀면 마지막 항목의 to 만 바꾼다
  }

  /** 지금까지 쓴 수 */
  get moves() {
    return this.history.length;
  }

  get solved() {
    return this.positions[0] === GOAL_COL;
  }

  get board() {
    return boardString(this.pieces, this.positions);
  }

  grid() {
    return occupancy(this.pieces, this.positions);
  }

  /** id 차가 갈 수 있는 자리 범위 */
  range(id) {
    return slideRange(this.pieces, this.positions, id);
  }

  /** 칸 (col, row) 에 있는 차 번호. 없으면 -1 */
  pieceAt(col, row) {
    if (col < 0 || row < 0 || col >= SIZE || row >= SIZE) return -1;
    return this.grid()[row * SIZE + col];
  }

  /**
   * id 차를 to 자리로 민다. 막혀 있으면 그 앞까지만 간다(범위로 자른다). 다 풀린 뒤에는 움직이지 않는다.
   * @returns 움직였으면 true
   */
  move(id, to) {
    if (this.solved || !this.pieces[id] || !Number.isInteger(to)) return false;
    const { min, max } = this.range(id);
    const from = this.positions[id];
    const target = Math.min(max, Math.max(min, to));
    if (target !== to) this.events.push({ type: 'blocked', id, at: target, dir: Math.sign(to - target) });
    if (target === from) return false;
    this.positions[id] = target;
    const last = this.history.at(-1);
    let merged = false;
    if (last && last.id === id) {
      // 같은 차를 잇달아 밀었다: 한 수로 친다. 제자리로 돌아왔으면 그 수는 없던 것이 된다
      merged = true;
      last.to = target;
      if (last.to === last.from) this.history.pop();
    } else {
      this.history.push({ id, from, to: target });
    }
    this.events.push({ type: 'move', id, from, to: target, merged });
    if (this.solved) this.events.push({ type: 'solved', moves: this.moves });
    return true;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  /** 마지막 한 수를 되돌린다 */
  undo() {
    const last = this.history.pop();
    if (!last) return false;
    this.positions[last.id] = last.from;
    this.events.push({ type: 'undo', id: last.id, from: last.to, to: last.from });
    return true;
  }

  /** 처음 상태로. 이미 처음이면 아무 일도 없다 */
  restart() {
    if (this.history.length === 0) return false;
    this.reset();
    this.events.push({ type: 'restart' });
    return true;
  }

  /** 쌓인 사건을 꺼낸다 */
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }
}

// ---------- 난이도 ----------

/** 난이도마다 최소 수의 범위. 단계 목록(levels.js)은 이 순서로 놓인다 */
export const TIERS = [
  { id: 'intro', min: 2, max: 7 },
  { id: 'easy', min: 8, max: 13 },
  { id: 'medium', min: 14, max: 21 },
  { id: 'hard', min: 22, max: 30 },
  { id: 'expert', min: 31, max: 99 },
];

/**
 * 별 1~3개. 최소 수 그대로면 3개, 최소 수의 1.5배(올림) 안이면 2개, 그 밖은 1개.
 * @param moves 쓴 수, @param best 최소 수
 */
export function starsFor(moves, best) {
  if (moves <= best) return 3;
  if (moves <= Math.ceil(best * 1.5)) return 2;
  return 1;
}
