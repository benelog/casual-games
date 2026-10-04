// 오델로 규칙: 처음 배치, 둘 수 있는 칸, 뒤집기, 패스, 끝과 승패, 무르기. 화면과 상관없는 순수 로직이다.
//
// - 8×8 판의 칸 번호는 row * 8 + col 이다. row 0 이 먼 쪽(1줄), col 0 이 왼쪽(a열).
// - 흑(0)이 먼저 둔다. 처음에는 가운데 네 칸에 d4·e5 백, e4·d5 흑을 놓는다.
// - 상대 돌을 내 돌 사이에 한 줄(가로·세로·대각선)로 끼울 수 있는 빈칸에만 둘 수 있고, 낀 돌은 모두 뒤집힌다.
// - 둘 곳이 없으면 차례를 넘긴다(패스). 양쪽 다 둘 곳이 없으면 끝나고, 돌이 많은 쪽이 이긴다.

export const SIZE = 8;
export const CELLS = SIZE * SIZE;
export const EMPTY = -1;
export const BLACK = 0;
export const WHITE = 1;
export const PLAYERS = [BLACK, WHITE];

const DIRECTIONS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export const indexOf = (row, col) => row * SIZE + col;
export const rowOf = (index) => Math.floor(index / SIZE);
export const colOf = (index) => index % SIZE;

/** 칸 번호 → 'd3' 같은 기보 표기 */
export function notation(index) {
  return `${'abcdefgh'[colOf(index)]}${rowOf(index) + 1}`;
}

/** 'd3' → 칸 번호. 잘못된 표기면 -1 */
export function parseNotation(text) {
  const m = /^([a-h])([1-8])$/i.exec(String(text).trim());
  if (!m) return -1;
  return indexOf(Number(m[2]) - 1, m[1].toLowerCase().charCodeAt(0) - 97);
}

/** 처음 배치한 판 (Int8Array, 칸마다 EMPTY·BLACK·WHITE) */
export function initialBoard() {
  const board = new Int8Array(CELLS).fill(EMPTY);
  board[indexOf(3, 3)] = WHITE;
  board[indexOf(4, 4)] = WHITE;
  board[indexOf(3, 4)] = BLACK;
  board[indexOf(4, 3)] = BLACK;
  return board;
}

/** '........' 같은 8줄 문자열(B 흑, W 백, 나머지 빈칸)로 판을 만든다. 테스트·디버그용 */
export function boardFromText(text) {
  const rows = String(text)
    .trim()
    .split(/\s+/)
    .filter((line) => line.length);
  if (rows.length !== SIZE || rows.some((line) => line.length !== SIZE)) throw new Error('판은 8칸씩 8줄이어야 합니다');
  const board = new Int8Array(CELLS).fill(EMPTY);
  rows.forEach((line, row) => {
    for (let col = 0; col < SIZE; col++) {
      const ch = line[col].toUpperCase();
      if (ch === 'B' || ch === 'X') board[indexOf(row, col)] = BLACK;
      if (ch === 'W' || ch === 'O') board[indexOf(row, col)] = WHITE;
    }
  });
  return board;
}

/** 판 → 8줄 문자열 */
export function boardToText(board) {
  const lines = [];
  for (let row = 0; row < SIZE; row++) {
    let line = '';
    for (let col = 0; col < SIZE; col++) {
      const v = board[indexOf(row, col)];
      line += v === BLACK ? 'B' : v === WHITE ? 'W' : '.';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** player 가 index 에 두면 뒤집히는 칸들 (둘 수 없으면 빈 배열). 가까운 돌부터 방향마다 차례로 */
export function flipsFor(board, player, index) {
  if (board[index] !== EMPTY) return [];
  const row = rowOf(index);
  const col = colOf(index);
  const other = 1 - player;
  const flips = [];
  for (const [dr, dc] of DIRECTIONS) {
    let r = row + dr;
    let c = col + dc;
    const line = [];
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[indexOf(r, c)] === other) {
      line.push(indexOf(r, c));
      r += dr;
      c += dc;
    }
    if (line.length && r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[indexOf(r, c)] === player) flips.push(...line);
  }
  return flips;
}

export const isLegal = (board, player, index) => flipsFor(board, player, index).length > 0;

/** player 가 둘 수 있는 칸들 (칸 번호 순) */
export function legalMoves(board, player) {
  const moves = [];
  for (let i = 0; i < CELLS; i++) if (board[i] === EMPTY && flipsFor(board, player, i).length) moves.push(i);
  return moves;
}

/** 판에 둔다 (board 를 바꾼다). 뒤집힌 칸들을 돌려주고, 둘 수 없는 칸이면 null */
export function applyMove(board, player, index) {
  const flips = flipsFor(board, player, index);
  if (!flips.length) return null;
  board[index] = player;
  for (const i of flips) board[i] = player;
  return flips;
}

/** [흑 돌 수, 백 돌 수] */
export function countDiscs(board) {
  const counts = [0, 0];
  for (const v of board) if (v !== EMPTY) counts[v]++;
  return counts;
}

/**
 * 한 판. mode: 'computer' (human 이 사람, 다른 쪽이 컴퓨터) 또는 'versus' (2인).
 * board 를 주면 그 판에서 current 차례로 시작한다 (테스트용).
 */
export class OthelloMatch {
  constructor({ mode = 'computer', human = BLACK, board = null, current = BLACK } = {}) {
    this.mode = mode;
    this.human = human;
    this.board = board ? Int8Array.from(board) : initialBoard();
    this.current = current;
    this.lastMove = -1;
    this.history = []; // 둔 수마다 그 전의 { board, current, lastMove, player, index }
    this.over = false;
    this.winner = null; // 끝났을 때 BLACK·WHITE, 무승부면 -1
    this.moves = 0; // 둔 수 (패스는 세지 않는다)
    // 처음부터 둘 곳이 없는 판이면 넘기거나 끝낸다
    this.settle();
  }

  isHuman(player) {
    return this.mode === 'versus' || player === this.human;
  }

  get counts() {
    return countDiscs(this.board);
  }

  count(player) {
    return this.counts[player];
  }

  legalMoves(player = this.current) {
    return this.over ? [] : legalMoves(this.board, player);
  }

  canPlay(index) {
    return !this.over && isLegal(this.board, this.current, index);
  }

  /**
   * 지금 차례가 index 에 둔다. 둘 수 없으면 null.
   * 결과: { player, index, flips, passed(둘 곳이 없어 넘긴 사람, 없으면 null), over }
   */
  play(index) {
    if (!this.canPlay(index)) return null;
    const player = this.current;
    this.history.push({ board: Int8Array.from(this.board), current: player, lastMove: this.lastMove, moves: this.moves, player, index });
    const flips = applyMove(this.board, player, index);
    this.lastMove = index;
    this.moves++;
    this.current = 1 - player;
    const passed = this.settle();
    return { player, index, flips, passed, over: this.over };
  }

  /** 지금 차례가 둘 곳이 없으면 넘기고, 양쪽 다 없으면 끝낸다. 넘긴 사람을 돌려준다 (없으면 null) */
  settle() {
    if (legalMoves(this.board, this.current).length) return null;
    const passer = this.current;
    if (legalMoves(this.board, 1 - passer).length) {
      this.current = 1 - passer;
      return passer;
    }
    this.finish();
    return null;
  }

  finish() {
    this.over = true;
    const [black, white] = this.counts;
    this.winner = black > white ? BLACK : white > black ? WHITE : -1;
  }

  /** 무를 수 있는지. 컴퓨터 대전에서는 사람이 둔 수가 있어야 한다 */
  canUndo() {
    if (this.mode === 'versus') return this.history.length > 0;
    return this.history.some((h) => h.player === this.human);
  }

  /**
   * 한 수 무른다. 컴퓨터 대전에서는 사람이 마지막으로 둔 수(와 그 뒤 컴퓨터의 수)까지 무른다.
   * 무른 수의 수를 돌려준다 (못 무르면 0)
   */
  undo() {
    if (!this.canUndo()) return 0;
    let undone = 0;
    while (this.history.length) {
      const h = this.history.pop();
      this.board = h.board;
      this.current = h.current;
      this.lastMove = h.lastMove;
      this.moves = h.moves;
      undone++;
      if (this.mode === 'versus' || h.player === this.human) break;
    }
    this.over = false;
    this.winner = null;
    return undone;
  }
}
