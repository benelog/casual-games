// 과일 팡팡 규칙. 렌더링과 분리된 순수 로직이다.
// 판은 가로 6 × 세로 12 칸이고 y = 0 이 바닥이다. 그 위에 화면 밖 숨은 줄이 하나 더 있다(y = 12).
// 과일 두 개가 붙은 짝이 위에서 떨어지고, 놓이면 각자 바닥까지 떨어진다. 같은 과일이 상하좌우로
// 4개 이상 이어지면 터지고, 위의 과일이 내려와 또 터지면 연쇄가 된다. 연쇄로 얻은 점수만큼
// 상대 판에 코코넛(방해 블록)을 보낸다. 짝이 나오는 칸(왼쪽에서 셋째 줄 맨 위)이 막히면 진다.
//
// 진행 중에 생긴 일은 events 에 쌓이고, 화면 쪽(main.js)이 꺼내 소리·효과로 보여 준다.

import { createRng } from '../../shared/util.js';

export { createRng };

export const WIDTH = 6;
export const VISIBLE = 12; // 보이는 줄 수
export const HEIGHT = VISIBLE + 1; // 숨은 줄 포함. 그 위에 놓인 과일은 사라진다
export const SPAWN_X = 2;
export const EMPTY = 0;
export const GARBAGE = 9; // 과일은 1 ~ 5
export const COLOR_COUNTS = [3, 4, 5];

export const LOCK_DELAY = 0.45; // 바닥에 닿은 뒤 굳기까지 시간(초)
export const MAX_LOCK_RESETS = 8; // 바닥에서 움직여 굳는 시간을 늦출 수 있는 횟수
export const SETTLE_TIME = 0.08; // 굳은 뒤 숨 고르는 시간
export const FALL_SPEED = 4; // 과일이 떨어지기 시작하는 속도(칸/초)와
export const FALL_ACCEL = 120; // 가속도(칸/초²). 화면(scene.js)도 같은 값으로 그린다
export const POP_TIME = 0.5; // 터지는 연출 시간
export const TARGET_POINTS = 70; // 코코넛 하나에 드는 점수
export const MAX_GARBAGE_DROP = 30; // 한 번에 떨어지는 코코넛 (5줄)
export const ALL_CLEAR_BONUS = TARGET_POINTS * 18; // 판을 비우면 다음 공격에 덧붙는 점수 (3줄)

// 짝의 방향 rot: 0 은 딸린 과일이 축 위, 1 오른쪽, 2 아래, 3 왼쪽
export const OFFSETS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

const CHAIN_POWER = [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
const COLOR_BONUS = [0, 0, 3, 6, 12, 24];
const GROUP_BONUS = [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 10];
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const at = (x, y) => y * WIDTH + x;
export const isFruit = (v) => v >= 1 && v <= 5;

/** distance 칸을 떨어지는 데 걸리는 시간(초). 다 떨어진 뒤에 다음 일이 일어나게 기다린다 */
export function fallTime(distance) {
  if (distance <= 0) return SETTLE_TIME;
  const t = (-FALL_SPEED + Math.sqrt(FALL_SPEED ** 2 + 2 * FALL_ACCEL * distance)) / FALL_ACCEL;
  return t + SETTLE_TIME;
}

const longestFall = (cells) => cells.reduce((max, cell) => (cell.y === null ? max : Math.max(max, cell.from - cell.y)), 0);

export const createGrid = () => new Uint8Array(WIDTH * HEIGHT);

/** x 줄에 쌓인 높이 (맨 아래 빈칸의 y). 판은 늘 빈틈없이 내려앉아 있다 */
export function columnHeight(grid, x) {
  let y = 0;
  while (y < HEIGHT && grid[at(x, y)] !== EMPTY) y++;
  return y;
}

/** 짝이 차지하는 두 칸 [[축 x, y], [딸린 과일 x, y]] */
export function pairCells({ x, y, rot }) {
  const [dx, dy] = OFFSETS[rot];
  return [
    [x, y],
    [x + dx, y + dy],
  ];
}

/**
 * 과일들을 각자 자기 줄 바닥까지 떨어뜨려 grid 에 놓는다. cells: [{ x, y, color }]
 * 놓인 자리 [{ x, y, from, color }] 를 돌려준다. 숨은 줄 위로 넘치면 사라진다(y 가 null).
 */
export function dropCells(grid, cells) {
  const placed = [];
  for (const cell of [...cells].sort((a, b) => a.y - b.y)) {
    const y = columnHeight(grid, cell.x);
    if (y >= HEIGHT) {
      placed.push({ x: cell.x, y: null, from: cell.y, color: cell.color });
      continue;
    }
    grid[at(cell.x, y)] = cell.color;
    placed.push({ x: cell.x, y, from: cell.y, color: cell.color });
  }
  return placed;
}

/** 보이는 줄에서 같은 과일이 4개 이상 이어진 묶음들. 묶음은 칸 번호 배열 */
export function findGroups(grid) {
  const seen = new Uint8Array(grid.length);
  const groups = [];
  for (let start = 0; start < WIDTH * VISIBLE; start++) {
    const color = grid[start];
    if (!isFruit(color) || seen[start]) continue;
    const group = [start];
    seen[start] = 1;
    for (let i = 0; i < group.length; i++) {
      const x = group[i] % WIDTH;
      const y = (group[i] - x) / WIDTH;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= VISIBLE) continue;
        const next = at(nx, ny);
        if (seen[next] || grid[next] !== color) continue;
        seen[next] = 1;
        group.push(next);
      }
    }
    if (group.length >= 4) groups.push(group);
  }
  return groups;
}

/** 터지는 묶음 옆에 붙은 코코넛 칸 번호들 */
export function garbageBeside(grid, groups) {
  const found = new Set();
  for (const group of groups) {
    for (const index of group) {
      const x = index % WIDTH;
      const y = (index - x) / WIDTH;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= VISIBLE) continue;
        if (grid[at(nx, ny)] === GARBAGE) found.add(at(nx, ny));
      }
    }
  }
  return [...found];
}

/** chain 번째 연쇄에서 groups 가 터질 때 얻는 점수 */
export function popScore(grid, groups, chain) {
  const colors = new Set();
  let count = 0;
  let bonus = CHAIN_POWER[Math.min(chain, CHAIN_POWER.length) - 1];
  for (const group of groups) {
    colors.add(grid[group[0]]);
    count += group.length;
    bonus += GROUP_BONUS[Math.min(group.length, GROUP_BONUS.length - 1)];
  }
  bonus += COLOR_BONUS[colors.size];
  return 10 * count * Math.min(999, Math.max(1, bonus));
}

/** 빈칸 위에 뜬 과일을 내려 앉힌다. 움직인 것 [{ x, y, from, color }] 을 돌려준다 */
export function collapse(grid) {
  const moved = [];
  for (let x = 0; x < WIDTH; x++) {
    let to = 0;
    for (let y = 0; y < HEIGHT; y++) {
      const color = grid[at(x, y)];
      if (color === EMPTY) continue;
      if (y !== to) {
        grid[at(x, to)] = color;
        grid[at(x, y)] = EMPTY;
        moved.push({ x, y: to, from: y, color });
      }
      to++;
    }
  }
  return moved;
}

/** 더 터질 것이 없을 때까지 한꺼번에 풀어 본다 (컴퓨터의 수읽기용). grid 를 바꾼다 */
export function resolveAll(grid) {
  let chain = 0;
  let score = 0;
  let popped = 0;
  for (;;) {
    const groups = findGroups(grid);
    if (!groups.length) break;
    chain++;
    score += popScore(grid, groups, chain);
    for (const index of garbageBeside(grid, groups)) grid[index] = EMPTY;
    for (const group of groups) {
      popped += group.length;
      for (const index of group) grid[index] = EMPTY;
    }
    collapse(grid);
  }
  return { chain, score, popped };
}

/** 한 사람의 판 */
export class Board {
  /**
   * source.pairAt(n) 이 n 번째 짝 [축 과일, 딸린 과일] 을 준다 (두 판이 같은 순서를 받는다).
   * link.send(n) 은 상대에게 코코넛을 보내고, link.chainEnd() 는 연쇄가 끝났음을 알린다.
   */
  constructor({ source, rng = Math.random, link = null } = {}) {
    this.source = source;
    this.rng = rng;
    this.link = link;
    this.grid = createGrid();
    this.pair = null; // 조작 중인 짝 { id, colors, x, y, rot }
    this.count = 0; // 지금까지 나온 짝 수
    this.phase = 'idle'; // idle | control | wait | over
    this.after = null; // wait 가 끝난 뒤 할 일: resolve | remove | spawn
    this.timer = 0;
    this.fallInterval = 0.8; // 한 칸 떨어지는 간격(초). Match 가 시간에 따라 줄인다
    this.targetPoints = TARGET_POINTS;
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.chain = 0; // 이번 차례의 연쇄 수
    this.popping = []; // 터지는 중인 칸 번호
    this.pending = 0; // 다음에 떨어질 코코넛
    this.queued = 0; // 상대 연쇄가 끝나야 떨어질 수 있는 코코넛
    this.leftover = 0; // 코코넛으로 바꾸고 남은 점수
    this.bonus = 0; // 판을 비워 얻은 덤 점수 (다음 공격에 붙는다)
    this.score = 0;
    this.maxChain = 0;
    this.sent = 0; // 상대에게 보낸 코코넛 수
    this.over = false;
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

  get(x, y) {
    return this.grid[at(x, y)];
  }

  /** 곧 받을 코코넛 수 (화면 표시용) */
  get incoming() {
    return this.pending + this.queued;
  }

  /** 첫 짝을 내보낸다 */
  start() {
    if (this.phase === 'idle') this.spawn();
  }

  // ---------- 짝 조작 ----------

  /** (x, y) 에 과일이 들어갈 수 있는가. 숨은 줄 위는 비어 있다고 본다 */
  free(x, y) {
    if (x < 0 || x >= WIDTH || y < 0) return false;
    return y >= HEIGHT || this.grid[at(x, y)] === EMPTY;
  }

  fits(x, y, rot) {
    const [dx, dy] = OFFSETS[rot];
    return this.free(x, y) && this.free(x + dx, y + dy);
  }

  get grounded() {
    const pair = this.pair;
    return !!pair && !this.fits(pair.x, pair.y - 1, pair.rot);
  }

  /** 바닥에 닿은 채로 움직이면 굳는 시간을 다시 센다 (횟수 제한) */
  touch() {
    if (this.grounded && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  move(dx) {
    const pair = this.pair;
    if (this.phase !== 'control' || !this.fits(pair.x + dx, pair.y, pair.rot)) return false;
    pair.x += dx;
    this.touch();
    this.emit('move');
    return true;
  }

  /** dir 이 +1 이면 시계 방향. 막히면 축을 밀어 보고, 그래도 안 되면 위아래를 뒤집는다 */
  rotate(dir) {
    const pair = this.pair;
    if (this.phase !== 'control') return false;
    const tryRot = (rot) => {
      const [dx, dy] = OFFSETS[rot];
      for (const [kx, ky] of [
        [0, 0],
        [-dx, -dy],
      ]) {
        if (this.fits(pair.x + kx, pair.y + ky, rot)) {
          pair.x += kx;
          pair.y += ky;
          pair.rot = rot;
          return true;
        }
      }
      return false;
    };
    const rot = (pair.rot + dir + 4) % 4;
    // 양옆이 모두 막힌 좁은 틈에서는 반 바퀴 돌려 위아래를 바꾼다
    if (!tryRot(rot) && !tryRot((pair.rot + 2) % 4)) return false;
    this.touch();
    this.emit('rotate', { dir });
    return true;
  }

  /** 한 칸 내린다. 더 내려갈 수 없으면 바로 굳힌다 */
  softDrop() {
    const pair = this.pair;
    if (this.phase !== 'control') return false;
    if (this.fits(pair.x, pair.y - 1, pair.rot)) {
      pair.y--;
      this.fallTimer = 0;
      this.score += 1;
    } else {
      this.lock();
    }
    return true;
  }

  /** 바닥까지 한 번에 떨어뜨려 굳힌다 */
  hardDrop() {
    const pair = this.pair;
    if (this.phase !== 'control') return false;
    let distance = 0;
    while (this.fits(pair.x, pair.y - 1, pair.rot)) {
      pair.y--;
      distance++;
    }
    this.score += distance * 2;
    this.emit('drop', { distance });
    this.lock();
    return true;
  }

  /** 지금 놓으면 두 과일이 내려앉을 자리 [{ x, y, color }] (넘쳐 사라지는 것은 뺀다) */
  landing() {
    if (!this.pair) return [];
    const heights = new Map();
    const cells = pairCells(this.pair).map(([x, y], i) => ({ x, y, color: this.pair.colors[i] }));
    const result = [];
    for (const cell of cells.sort((a, b) => a.y - b.y)) {
      const y = heights.get(cell.x) ?? columnHeight(this.grid, cell.x);
      heights.set(cell.x, y + 1);
      if (y < HEIGHT) result.push({ x: cell.x, y, color: cell.color });
    }
    return result;
  }

  lock() {
    const pair = this.pair;
    const cells = pairCells(pair).map(([x, y], i) => ({ x, y, color: pair.colors[i] }));
    const placed = dropCells(this.grid, cells);
    this.pair = null;
    this.chain = 0;
    this.emit('lock', { cells: placed });
    this.wait(fallTime(longestFall(placed)), 'resolve');
  }

  // ---------- 터뜨리기 ----------

  wait(time, after) {
    this.phase = 'wait';
    this.timer = time;
    this.after = after;
  }

  /** 터질 묶음이 있으면 터뜨리기 시작하고, 없으면 차례를 마친다 */
  resolve() {
    const groups = findGroups(this.grid);
    if (!groups.length) {
      this.endTurn();
      return;
    }
    this.chain++;
    this.maxChain = Math.max(this.maxChain, this.chain);
    const score = popScore(this.grid, groups, this.chain);
    const garbage = garbageBeside(this.grid, groups);
    const cells = groups.flat();
    this.popping = [...cells, ...garbage];
    this.score += score;
    const sent = this.attack(score);
    this.emit('pop', {
      chain: this.chain,
      score,
      cells: cells.map((index) => ({ x: index % WIDTH, y: Math.floor(index / WIDTH), color: this.grid[index] })),
      garbage: garbage.map((index) => ({ x: index % WIDTH, y: Math.floor(index / WIDTH) })),
      ...sent,
    });
    this.wait(POP_TIME, 'remove');
  }

  /** 점수를 코코넛으로 바꿔, 내가 받을 것을 먼저 지우고 남으면 상대에게 보낸다 */
  attack(score) {
    const points = score + this.leftover + this.bonus;
    this.bonus = 0;
    let amount = Math.floor(points / this.targetPoints);
    this.leftover = points % this.targetPoints;
    const total = amount;
    const fromPending = Math.min(this.pending, amount);
    this.pending -= fromPending;
    amount -= fromPending;
    const fromQueued = Math.min(this.queued, amount);
    this.queued -= fromQueued;
    amount -= fromQueued;
    if (amount > 0) {
      this.sent += amount;
      this.link?.send(amount);
    }
    return { garbageMade: total, offset: fromPending + fromQueued, sent: amount };
  }

  /** 상대가 보낸 코코넛. 상대의 연쇄가 끝나야(activate) 떨어진다 */
  receive(amount) {
    this.queued += amount;
  }

  activate() {
    this.pending += this.queued;
    this.queued = 0;
  }

  removePopped() {
    for (const index of this.popping) this.grid[index] = EMPTY;
    this.popping = [];
    const moved = collapse(this.grid);
    this.emit('land', { cells: moved });
    this.wait(fallTime(longestFall(moved)), 'resolve');
  }

  endTurn() {
    if (this.chain > 0) {
      const allClear = this.grid.every((v) => v === EMPTY);
      if (allClear) this.bonus += ALL_CLEAR_BONUS;
      this.emit('chainEnd', { chain: this.chain, allClear });
      this.link?.chainEnd();
      this.chain = 0;
      this.spawn(); // 터뜨린 차례에는 코코넛이 떨어지지 않는다
      return;
    }
    if (this.pending > 0) {
      this.dropGarbage();
      return;
    }
    this.spawn();
  }

  /** 받을 코코넛을 (한 번에 30개까지) 떨어뜨린다. 한 줄씩 채우고 나머지는 아무 줄에나 */
  dropGarbage() {
    const amount = Math.min(this.pending, MAX_GARBAGE_DROP);
    this.pending -= amount;
    const perColumn = new Array(WIDTH).fill(Math.floor(amount / WIDTH));
    const columns = [...perColumn.keys()];
    for (let i = 0; i < amount % WIDTH; i++) {
      const pick = Math.floor(this.rng() * columns.length);
      perColumn[columns.splice(pick, 1)[0]]++;
    }
    const cells = [];
    for (let x = 0; x < WIDTH; x++) {
      for (let i = 0; i < perColumn[x]; i++) {
        const y = columnHeight(this.grid, x);
        if (y >= HEIGHT) break; // 넘치는 것은 사라진다
        this.grid[at(x, y)] = GARBAGE;
        cells.push({ x, y, from: HEIGHT + 1 + i, color: GARBAGE });
      }
    }
    this.emit('garbage', { amount, cells });
    this.wait(fallTime(longestFall(cells)), 'spawn');
  }

  spawn() {
    if (this.grid[at(SPAWN_X, VISIBLE - 1)] !== EMPTY) {
      this.pair = null;
      this.phase = 'over';
      this.over = true;
      this.emit('over');
      return;
    }
    const colors = this.source.pairAt(this.count);
    this.count++;
    this.pair = { id: this.count, colors: [...colors], x: SPAWN_X, y: VISIBLE - 1, rot: 0 };
    this.phase = 'control';
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.emit('spawn');
  }

  /** 다음, 그다음 짝 */
  preview(n = 2) {
    return Array.from({ length: n }, (_, i) => this.source.pairAt(this.count + i));
  }

  update(dt) {
    if (this.phase === 'control') {
      if (this.grounded) {
        this.lockTimer += dt;
        if (this.lockTimer >= LOCK_DELAY) this.lock();
        return;
      }
      this.fallTimer += dt;
      while (this.fallTimer >= this.fallInterval && !this.grounded) {
        this.fallTimer -= this.fallInterval;
        this.pair.y--;
      }
      if (this.grounded) this.fallTimer = 0;
    } else if (this.phase === 'wait') {
      this.timer -= dt;
      if (this.timer > 0) return;
      const after = this.after;
      this.after = null;
      if (after === 'resolve') this.resolve();
      else if (after === 'remove') this.removePopped();
      else this.spawn();
    }
  }
}

/** 시간이 갈수록 빨리 떨어진다 */
export function fallIntervalAt(time) {
  return Math.max(0.22, 0.8 - (time / 180) * 0.58);
}

/** 90초가 지나면 20초마다 코코넛 값이 싸져서 승부가 빨리 난다 */
export function targetPointsAt(time) {
  if (time < 90) return TARGET_POINTS;
  const steps = Math.floor((time - 90) / 20) + 1;
  return Math.max(14, Math.round(TARGET_POINTS * 0.75 ** steps));
}

/** 두 판의 대전. 같은 순서의 짝을 나눠 주고 코코넛을 주고받게 한다 */
export class Match {
  constructor({ colors = 4, rng = Math.random } = {}) {
    if (!COLOR_COUNTS.includes(colors)) throw new Error(`과일 종류는 ${COLOR_COUNTS.join(', ')} 중 하나: ${colors}`);
    this.colors = colors;
    this.rng = rng;
    this.sequence = [];
    this.time = 0;
    this.winner = null; // 끝나면 0, 1 또는 'draw'
    this.boards = [0, 1].map(
      (i) =>
        new Board({
          source: this,
          rng,
          link: {
            send: (amount) => this.boards[1 - i].receive(amount),
            chainEnd: () => this.boards[1 - i].activate(),
          },
        }),
    );
  }

  get over() {
    return this.winner !== null;
  }

  pairAt(n) {
    while (this.sequence.length <= n) {
      this.sequence.push([1 + Math.floor(this.rng() * this.colors), 1 + Math.floor(this.rng() * this.colors)]);
    }
    return this.sequence[n];
  }

  start() {
    for (const board of this.boards) board.start();
  }

  update(dt) {
    if (this.over) return;
    this.time += dt;
    const interval = fallIntervalAt(this.time);
    const target = targetPointsAt(this.time);
    for (const board of this.boards) {
      board.fallInterval = interval;
      board.targetPoints = target;
      board.update(dt);
    }
    const [a, b] = this.boards;
    if (a.over && b.over) this.winner = 'draw';
    else if (a.over) this.winner = 1;
    else if (b.over) this.winner = 0;
  }

  /** 두 판의 사건을 player 번호를 붙여 꺼낸다 */
  drain() {
    return this.boards.flatMap((board, player) => board.drain().map((event) => ({ ...event, player })));
  }
}
