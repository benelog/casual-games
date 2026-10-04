// 소코반 규칙. DOM·Three.js 에 의존하지 않는 순수 로직이라 node 에서 그대로 테스트한다.
// 좌표는 (x, y) 로 x 는 오른쪽, y 는 아래쪽(지도의 줄 순서)이다. 칸은 번호 y * width + x 로도 쓴다.
// 화면 쪽(scene.js, main.js)은 drain() 으로 사건을 받아 그리고 소리를 낸다.

export const DIRS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const DIR_NAMES = Object.keys(DIRS);

// 지도 기호 (널리 쓰이는 XSB 표기)
//   # 벽, 빈칸 바닥, . 목표, $ 상자, * 목표 위 상자, @ 캐릭터, + 목표 위 캐릭터
const SYMBOLS = new Set(['#', ' ', '.', '$', '*', '@', '+']);

/**
 * 줄 배열로 된 지도를 읽는다. 잘못된 지도는 예외를 던진다.
 * @returns {{ width, height, walls: Uint8Array, floor: Uint8Array, goals: number[], boxes: number[], player: number }}
 *   floor 는 캐릭터가 닿을 수 있는(벽으로 둘러싸인 안쪽) 칸이다.
 */
export function parseLevel(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('지도가 비어 있다');
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  const walls = new Uint8Array(width * height);
  const goals = [];
  const boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ' ';
      if (!SYMBOLS.has(ch)) throw new Error(`알 수 없는 기호 '${ch}' (${x}, ${y})`);
      const i = y * width + x;
      if (ch === '#') walls[i] = 1;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') {
        if (player >= 0) throw new Error('캐릭터가 둘 이상이다');
        player = i;
      }
    }
  });
  if (player < 0) throw new Error('캐릭터가 없다');
  if (boxes.length === 0) throw new Error('상자가 없다');
  if (boxes.length !== goals.length) throw new Error(`상자(${boxes.length})와 목표(${goals.length}) 수가 다르다`);

  // 캐릭터 자리에서 벽을 넘지 않고 닿는 칸. 지도 가장자리에 닿으면 벽이 뚫린 것이다
  const floor = new Uint8Array(width * height);
  const stack = [player];
  floor[player] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % width;
    const y = (i - x) / width;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) throw new Error('벽이 뚫려 있다');
    for (const [dx, dy] of Object.values(DIRS)) {
      const j = (y + dy) * width + (x + dx);
      if (!walls[j] && !floor[j]) {
        floor[j] = 1;
        stack.push(j);
      }
    }
  }
  for (const i of [...boxes, ...goals]) {
    if (!floor[i]) throw new Error('닿을 수 없는 곳에 상자나 목표가 있다');
  }
  return { width, height, walls, floor, goals, boxes, player };
}

export class Sokoban {
  /** @param level parseLevel() 의 결과 */
  constructor(level) {
    this.level = level;
    this.width = level.width;
    this.height = level.height;
    this.goalSet = new Set(level.goals);
    this.events = [];
    this.reset();
  }

  reset() {
    this.player = this.level.player;
    this.boxes = [...this.level.boxes]; // 상자 번호(배열 위치) → 칸. 번호는 판이 끝날 때까지 그대로다
    this.boxAt = new Map(this.boxes.map((cell, id) => [cell, id]));
    this.history = []; // { dir, box } box 는 민 상자 번호 또는 -1
    this.moves = 0;
    this.pushes = 0;
    this.facing = 'down';
  }

  xy(cell) {
    const x = cell % this.width;
    return [x, (cell - x) / this.width];
  }

  isWall(cell) {
    return this.level.walls[cell] === 1;
  }

  isGoal(cell) {
    return this.goalSet.has(cell);
  }

  /** 목표 위에 놓인 상자 수 */
  get placed() {
    let n = 0;
    for (const cell of this.boxes) if (this.goalSet.has(cell)) n++;
    return n;
  }

  get solved() {
    return this.placed === this.boxes.length;
  }

  step(cell, dir) {
    const [dx, dy] = DIRS[dir];
    return cell + dy * this.width + dx;
  }

  /** 그 방향으로 한 칸 갈 수 있는지 (상자를 밀어야 하면 밀 수 있는지) */
  canMove(dir) {
    const to = this.step(this.player, dir);
    if (this.isWall(to)) return false;
    if (!this.boxAt.has(to)) return true;
    const beyond = this.step(to, dir);
    return !this.isWall(beyond) && !this.boxAt.has(beyond);
  }

  /**
   * 한 칸 움직인다. 앞에 상자가 있으면 민다. 다 풀린 뒤에는 움직이지 않는다.
   * @returns 움직였으면 true
   */
  move(dir) {
    if (!DIRS[dir] || this.solved) return false;
    this.facing = dir;
    if (!this.canMove(dir)) {
      this.events.push({ type: 'blocked', dir });
      return false;
    }
    const from = this.player;
    const to = this.step(from, dir);
    const box = this.boxAt.get(to) ?? -1;
    let pushed = null;
    if (box >= 0) {
      const beyond = this.step(to, dir);
      this.boxAt.delete(to);
      this.boxAt.set(beyond, box);
      this.boxes[box] = beyond;
      this.pushes++;
      pushed = { box, from: to, to: beyond, onGoal: this.isGoal(beyond), wasOnGoal: this.isGoal(to) };
    }
    this.player = to;
    this.moves++;
    this.history.push({ dir, box });
    this.events.push({ type: 'move', dir, from, to, pushed });
    if (pushed && this.solved) this.events.push({ type: 'solved', moves: this.moves, pushes: this.pushes });
    return true;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  /** 마지막 한 걸음을 되돌린다. 밀었던 상자도 제자리로 간다 */
  undo() {
    const last = this.history.pop();
    if (!last) return false;
    const back = { up: 'down', down: 'up', left: 'right', right: 'left' }[last.dir];
    const from = this.player;
    const to = this.step(from, back);
    let pulled = null;
    if (last.box >= 0) {
      const boxFrom = this.boxes[last.box];
      this.boxAt.delete(boxFrom);
      this.boxAt.set(from, last.box);
      this.boxes[last.box] = from;
      this.pushes--;
      pulled = { box: last.box, from: boxFrom, to: from, onGoal: this.isGoal(from), wasOnGoal: this.isGoal(boxFrom) };
    }
    this.player = to;
    this.moves--;
    this.facing = last.dir;
    this.events.push({ type: 'undo', dir: last.dir, from, to, pulled });
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
