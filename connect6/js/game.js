// 육목(Connect6) 규칙: 19줄 바둑판 위의 돌, 차례마다 두는 돌 수, 6목 판정, 무르기. 화면과 상관없는 순수 로직이다.
//
// - 흑(0)이 먼저 한 개를 두고, 그 뒤로는 백(1)·흑이 번갈아 한 차례에 두 개씩 둔다.
// - 가로·세로·대각선으로 같은 색이 6개 이상 이어지면 이긴다. 7개 이상(장목)도 이긴다.
// - 판이 다 차면 무승부다. 흑 181개, 백 180개로 마지막 차례가 끝날 때 꼭 찬다.
// - 무르기는 차례 단위다. 차례 중간(두 개 중 하나만 둔 때)이면 그 차례에 둔 돌을 거둔다.
//
// 칸 번호는 row * SIZE + col. row 0 이 화면 위쪽(백 쪽), col 0 이 왼쪽이다.

export const SIZE = 19;
export const CELLS = SIZE * SIZE;
export const WIN_LENGTH = 6;
export const EMPTY = -1;
export const TEAMS = [0, 1]; // 0 흑, 1 백

/** 줄을 따라가는 네 방향 [drow, dcol]: 가로, 세로, ↘ 대각선, ↙ 대각선 */
export const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export const indexOf = (row, col) => row * SIZE + col;
export const rowOf = (index) => Math.floor(index / SIZE);
export const colOf = (index) => index % SIZE;
export const inside = (row, col) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;

/** 첫 차례(흑의 첫 수)만 한 개, 나머지는 두 개 */
export const stonesForTurn = (turnNumber) => (turnNumber === 0 ? 1 : 2);

/**
 * index 에 놓인 돌을 지나는 가장 긴 같은 색 줄. { length, cells, direction } (cells 는 한쪽 끝부터 차례로).
 * 돌이 없으면 length 0.
 */
export function longestLine(cells, index) {
  const team = cells[index];
  if (team === EMPTY) return { length: 0, cells: [], direction: null };
  const row = rowOf(index);
  const col = colOf(index);
  let best = { length: 0, cells: [], direction: null };
  for (const [dr, dc] of DIRECTIONS) {
    // 한쪽 끝까지 거슬러 간 뒤 반대쪽으로 센다
    let r = row;
    let c = col;
    while (inside(r - dr, c - dc) && cells[indexOf(r - dr, c - dc)] === team) {
      r -= dr;
      c -= dc;
    }
    const line = [];
    while (inside(r, c) && cells[indexOf(r, c)] === team) {
      line.push(indexOf(r, c));
      r += dr;
      c += dc;
    }
    if (line.length > best.length) best = { length: line.length, cells: line, direction: [dr, dc] };
  }
  return best;
}

/** 한 판. mode: 'computer' (human 편이 사람, 다른 편이 컴퓨터) 또는 'versus' (2인) */
export class Connect6Game {
  constructor({ mode = 'computer', human = 0 } = {}) {
    this.mode = mode;
    this.human = human;
    this.cells = new Int8Array(CELLS).fill(EMPTY);
    this.turns = []; // 끝난 차례 [{ team, moves: [칸…] }]
    this.current = 0; // 지금 두는 편
    this.placed = []; // 이번 차례에 이미 둔 칸
    this.stones = 0; // 판 위의 돌 수
    this.over = false;
    this.winner = null; // 0 · 1, 무승부면 null
    this.line = null; // 이긴 줄의 칸들
    this.reason = null; // 'six' 6목, 'long' 장목(7개 이상), 'full' 판이 다 참
  }

  isHuman(team) {
    return this.mode === 'versus' || team === this.human;
  }

  /** 이번 차례에 둘 돌 수 (1 또는 2) */
  get perTurn() {
    return stonesForTurn(this.turns.length);
  }

  /** 이번 차례에 더 둘 수 있는 돌 수 */
  get remaining() {
    return this.over ? 0 : this.perTurn - this.placed.length;
  }

  /** 지금까지 둔 수 (돌 하나가 한 수) */
  get moveCount() {
    return this.stones;
  }

  at(row, col) {
    return this.cells[indexOf(row, col)];
  }

  canPlace(index) {
    return !this.over && Number.isInteger(index) && index >= 0 && index < CELLS && this.cells[index] === EMPTY;
  }

  /**
   * 지금 편의 돌을 index 에 둔다.
   * { team, index, win, draw, turnEnded, next } 를 돌려준다. 둘 수 없는 자리면 예외를 던진다.
   */
  place(index) {
    if (!this.canPlace(index)) throw new Error(`둘 수 없는 자리입니다: ${index}`);
    const team = this.current;
    this.cells[index] = team;
    this.placed.push(index);
    this.stones++;
    const line = longestLine(this.cells, index);
    let turnEnded = false;
    if (line.length >= WIN_LENGTH) {
      this.over = true;
      this.winner = team;
      this.line = line.cells;
      this.reason = line.length > WIN_LENGTH ? 'long' : 'six';
      this.endTurn();
      turnEnded = true;
    } else if (this.stones === CELLS) {
      this.over = true;
      this.reason = 'full';
      this.endTurn();
      turnEnded = true;
    } else if (this.placed.length >= this.perTurn) {
      this.endTurn();
      this.current = 1 - team;
      turnEnded = true;
    }
    return { team, index, win: this.winner === team, draw: this.over && this.winner === null, turnEnded, next: this.current };
  }

  endTurn() {
    this.turns.push({ team: this.current, moves: this.placed });
    this.placed = [];
  }

  /** 무를 것이 있는지 */
  get canUndo() {
    return this.placed.length > 0 || this.turns.length > 0;
  }

  /**
   * 한 차례를 무른다. 차례 중간이면 이번 차례에 둔 돌을, 아니면 바로 앞 차례 전체를 거둔다.
   * 거둔 { team, moves } 를 돌려주고, 무를 것이 없으면 null.
   */
  undo() {
    let undone;
    if (this.placed.length > 0) {
      undone = { team: this.current, moves: this.placed };
      this.placed = [];
    } else if (this.turns.length > 0) {
      undone = this.turns.pop();
    } else {
      return null;
    }
    for (const index of undone.moves) this.cells[index] = EMPTY;
    this.stones -= undone.moves.length;
    this.current = undone.team;
    this.over = false;
    this.winner = null;
    this.line = null;
    this.reason = null;
    return undone;
  }

  /** 바로 앞에 끝난 차례 (없으면 null) */
  get lastTurn() {
    return this.turns.at(-1) ?? null;
  }

  /** team 의 돌 수 */
  count(team) {
    let n = 0;
    for (const cell of this.cells) if (cell === team) n++;
    return n;
  }
}
