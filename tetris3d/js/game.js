// 3D 테트리스 규칙. 렌더링과 분리된 순수 로직이다.
// 우물은 가로 width(x) × 세로 depth(y) × 높이 height(z) 칸이고 z = 0 이 바닥이다.
// 조각은 위에서 떨어지고, 한 층(width × depth 칸)이 모두 차면 그 층이 지워지고 위층이 내려온다.
// 새 조각이 나올 자리가 막혀 있으면 게임이 끝난다.
//
// 진행 중에 생긴 일은 events 에 쌓이고, 화면 쪽(main.js)이 꺼내 소리·효과로 보여 준다.

import { PIECE_SETS, rotateCells, bounds, spawnCells } from './pieces.js';

export const LOCK_DELAY = 0.5; // 바닥에 닿은 뒤 굳기까지 시간(초)
export const MAX_LOCK_RESETS = 15; // 바닥에서 움직여 굳는 시간을 늦출 수 있는 횟수
export const CUBES_PER_LEVEL = 125; // 이만큼 칸을 지울 때마다 레벨이 오른다 (5×5 우물이면 5층)
export const MAX_LEVEL = 15;
export const PIT_SIZES = [3, 4, 5];
export const PIT_HEIGHT = 12;
export const BASE_INTERVAL = 1.6; // 레벨 1 에서 한 칸 떨어지는 간격(초)
export const MIN_INTERVAL = 0.2; // 아무리 레벨이 올라도 이보다 빨라지지 않는다

// 회전했는데 막히면 이 순서로 옮겨 보며 들어갈 자리를 찾는다
const KICKS = [
  [0, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [2, 0, 0],
  [-2, 0, 0],
  [0, 2, 0],
  [0, -2, 0],
  [0, 0, 1],
];

/** 레벨별 한 칸 떨어지는 간격(초) */
export function gravityInterval(level) {
  return Math.max(MIN_INTERVAL, BASE_INTERVAL * 0.87 ** (level - 1));
}

/** 한 번에 layers 층을 지웠을 때 점수. 넓은 우물일수록 한 층이 어려우니 넓이에 비례한다 */
export function clearScore(layers, level, area = 25) {
  return Math.round((50 * layers * (layers + 1) * level * area) / 25);
}

/** 우물이 완전히 비었을 때 덧붙는 점수 */
export function perfectBonus(level, area = 25) {
  return Math.round((1000 * level * area) / 25);
}

/** 시드를 받는 난수 (mulberry32). 테스트에서 같은 조각 순서를 재현할 때 쓴다 */
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Tetris3D {
  constructor({ width = 5, depth = width, height = PIT_HEIGHT, set = 'basic', rng = Math.random } = {}) {
    if (!PIECE_SETS[set]) throw new Error(`알 수 없는 조각 묶음: ${set}`);
    this.width = width;
    this.depth = depth;
    this.height = height;
    this.area = width * depth;
    this.set = set;
    this.kinds = PIECE_SETS[set].kinds.filter((kind) => spawnCells(kind, width, depth));
    this.rng = rng;
    this.grid = new Uint8Array(width * depth * height); // 0 은 빈칸, 아니면 굳은 칸
    this.score = 0;
    this.layers = 0; // 지운 층 수
    this.cleared = 0; // 지운 칸 수 (레벨 계산용)
    this.pieces = 0; // 굳힌 조각 수
    this.level = 1;
    this.over = false;
    this.events = [];
    this.bag = [];
    this.piece = null;
    this.spawned = 0; // 나온 조각 수. 조각마다 id 를 붙인다
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowest = Infinity;
    this.next = this.draw();
    this.spawn();
  }

  /** 모든 조각이 한 번씩 나온 뒤에야 같은 조각이 다시 나온다 */
  draw() {
    if (this.bag.length === 0) {
      this.bag = [...this.kinds];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }

  index(x, y, z) {
    return (z * this.depth + y) * this.width + x;
  }

  /** 우물 안이고 비어 있으면 true */
  isFree(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.width || y >= this.depth || z >= this.height) return false;
    return this.grid[this.index(x, y, z)] === 0;
  }

  filled(x, y, z) {
    return this.grid[this.index(x, y, z)] !== 0;
  }

  fits(cells, [px, py, pz]) {
    return cells.every(([x, y, z]) => this.isFree(px + x, py + y, pz + z));
  }

  /** 지금 조각이 차지한 칸들의 절대 좌표 */
  pieceCells(piece = this.piece, pos = piece?.pos) {
    if (!piece) return [];
    return piece.cells.map(([x, y, z]) => [pos[0] + x, pos[1] + y, pos[2] + z]);
  }

  /** 바로 떨어뜨렸을 때 놓일 위치 */
  landing() {
    if (!this.piece) return null;
    const [x, y] = this.piece.pos;
    let z = this.piece.pos[2];
    while (this.fits(this.piece.cells, [x, y, z - 1])) z--;
    return [x, y, z];
  }

  spawn() {
    const kind = this.next;
    this.next = this.draw();
    const cells = spawnCells(kind, this.width, this.depth);
    const { min, max, size } = bounds(cells);
    const pos = [
      Math.floor((this.width - size[0]) / 2) - min[0],
      Math.floor((this.depth - size[1]) / 2) - min[1],
      this.height - 1 - max[2],
    ];
    this.piece = { id: ++this.spawned, kind, cells, pos };
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowest = pos[2];
    if (!this.fits(cells, pos)) {
      this.over = true;
      this.events.push({ type: 'over' });
      return false;
    }
    this.events.push({ type: 'spawn', kind });
    return true;
  }

  grounded() {
    const [x, y, z] = this.piece.pos;
    return !this.fits(this.piece.cells, [x, y, z - 1]);
  }

  /** 바닥에 닿은 채 움직이면 굳는 시간을 처음부터 다시 잰다 (횟수 제한 있음) */
  touched() {
    if (this.lockResets < MAX_LOCK_RESETS && this.grounded()) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  /** 가로(dx)·세로(dy)로 한 칸 옮긴다. 옮겼으면 true */
  move(dx, dy) {
    if (this.over || !this.piece) return false;
    const [x, y, z] = this.piece.pos;
    const pos = [x + dx, y + dy, z];
    if (!this.fits(this.piece.cells, pos)) return false;
    this.piece.pos = pos;
    this.touched();
    this.events.push({ type: 'move' });
    return true;
  }

  /** axis('x'|'y'|'z') 축으로 dir(±1) × 90° 돌린다. 막히면 근처로 옮겨 보고, 끝내 안 되면 false */
  rotate(axis, dir) {
    if (this.over || !this.piece) return false;
    const cells = rotateCells(this.piece.cells, axis, dir);
    const [x, y, z] = this.piece.pos;
    for (const [kx, ky, kz] of KICKS) {
      const pos = [x + kx, y + ky, z + kz];
      if (!this.fits(cells, pos)) continue;
      this.piece.cells = cells;
      this.piece.pos = pos;
      this.touched();
      this.events.push({ type: 'rotate', axis, dir });
      return true;
    }
    return false;
  }

  /** 한 칸 내린다. 이미 바닥이면 바로 굳힌다 */
  softDrop() {
    if (this.over || !this.piece) return false;
    if (this.stepDown()) {
      this.score += 1;
      this.fallTimer = 0;
      return true;
    }
    this.lock();
    return false;
  }

  /** 끝까지 떨어뜨려 바로 굳힌다 */
  hardDrop() {
    if (this.over || !this.piece) return 0;
    const from = this.piece.pos[2];
    this.piece.pos = this.landing();
    const distance = from - this.piece.pos[2];
    this.score += distance * 2;
    this.events.push({ type: 'drop', distance });
    this.lock();
    return distance;
  }

  stepDown() {
    const [x, y, z] = this.piece.pos;
    const pos = [x, y, z - 1];
    if (!this.fits(this.piece.cells, pos)) return false;
    this.piece.pos = pos;
    if (pos[2] < this.lowest) {
      // 새로 더 내려가면 굳는 시간 연장 횟수를 되돌려 준다
      this.lowest = pos[2];
      this.lockResets = 0;
    }
    this.lockTimer = 0;
    return true;
  }

  /** 시간을 dt 초 흘린다: 중력으로 떨어지고, 바닥에 오래 있으면 굳는다 */
  update(dt) {
    if (this.over || !this.piece) return;
    if (this.grounded()) {
      this.fallTimer = 0;
      this.lockTimer += dt;
    } else {
      this.fallTimer += dt;
      const interval = gravityInterval(this.level);
      while (this.fallTimer >= interval) {
        this.fallTimer -= interval;
        this.stepDown();
        if (this.grounded()) {
          // 닿은 뒤 남은 시간부터 굳는 시간을 잰다
          this.lockTimer = this.fallTimer;
          this.fallTimer = 0;
          break;
        }
      }
    }
    if (this.lockTimer >= LOCK_DELAY) this.lock();
  }

  /** 조각을 우물에 굳히고, 찬 층을 지우고, 다음 조각을 꺼낸다 */
  lock() {
    const cells = this.pieceCells();
    for (const [x, y, z] of cells) this.grid[this.index(x, y, z)] = 1;
    this.pieces++;
    this.events.push({ type: 'lock', kind: this.piece.kind, cells });
    this.piece = null;

    const full = [];
    for (let z = 0; z < this.height; z++) if (this.layerCount(z) === this.area) full.push(z);
    if (full.length > 0) this.clearLayers(full);
    this.spawn();
  }

  layerCount(z) {
    let n = 0;
    const start = z * this.area;
    for (let i = start; i < start + this.area; i++) if (this.grid[i]) n++;
    return n;
  }

  clearLayers(full) {
    const kept = [];
    for (let z = 0; z < this.height; z++) {
      if (!full.includes(z)) kept.push(this.grid.slice(z * this.area, (z + 1) * this.area));
    }
    this.grid.fill(0);
    kept.forEach((layer, z) => this.grid.set(layer, z * this.area));

    const before = this.level;
    let gained = clearScore(full.length, this.level, this.area);
    const perfect = this.grid.every((v) => v === 0);
    if (perfect) gained += perfectBonus(this.level, this.area);
    this.score += gained;
    this.layers += full.length;
    this.cleared += full.length * this.area;
    this.level = Math.min(MAX_LEVEL, 1 + Math.floor(this.cleared / CUBES_PER_LEVEL));
    this.events.push({ type: 'clear', layers: full, score: gained, perfect });
    if (this.level > before) this.events.push({ type: 'level', level: this.level });
  }

  /** 가장 높이 쌓인 층 + 1 (비었으면 0) */
  stackHeight() {
    for (let z = this.height - 1; z >= 0; z--) if (this.layerCount(z) > 0) return z + 1;
    return 0;
  }

  /** 지금까지 쌓인 events 를 꺼낸다 */
  drain() {
    return this.events.splice(0);
  }
}
