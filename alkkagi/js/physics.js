// 바둑판 위 바둑돌의 움직임. Three.js 없이 평면(x, z) 위의 원판으로 계산하는 순수 로직이라 node 에서 그대로 테스트한다.
//
// 좌표: 길이 단위는 미터. 원점은 바둑판 한가운데(천원), x 는 오른쪽(+), z 는 흑 쪽(화면 아래, +)이다.
// 규격은 실제 바둑판과 바둑돌을 따른다 (판 42.4×45.5cm, 줄 간격 2.2×2.37cm, 돌 지름 2.2cm).
//
// 돌은 판 위를 미끄러지며 마찰로 일정하게 느려지고(감속도 DECEL), 돌끼리는 같은 무게의 원판으로 보고
// 반발 계수 RESTITUTION 인 충돌을 한다. 돌의 중심이 판 가장자리를 넘으면 기울어 떨어진다(경기에서 빠진다).
// 고정 간격(STEP)으로 계산하므로 같은 수는 언제나 같은 결과다.

export const STONE_RADIUS = 0.011;
export const STONE_HEIGHT = 0.0092; // 돌 두께 (한가운데)
export const HALF_X = 0.212; // 판 가로의 절반
export const HALF_Z = 0.2275; // 판 세로의 절반
export const LINES = 19;
export const GRID_X = 0.022; // 줄 간격
export const GRID_Z = 0.0237;

export const DECEL = 1.25; // 마찰에 의한 감속도 (m/s²). 옻칠한 돌이 매끈한 판 위를 미끄러질 때 마찰 계수 약 0.13
export const RESTITUTION = 0.88;
export const SPEED_MAX = 1.6; // 가장 세게 튕긴 속도 (m/s). 빈 판에서 약 1m 미끄러진다
export const MIN_POWER = 0.04; // 이보다 약하게 당기면 튕기지 않는다
export const STOP_SPEED = 0.004; // 이보다 느려지면 멈춘 것으로 본다
export const STEP = 1 / 600; // 물리 한 걸음 (초)
const SPIN_DECAY = 3; // 보이는 회전이 줄어드는 빠르기 (1/초)

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** 바둑판 줄의 좌표. col·row 는 -9 ~ 9 (0 이 천원), row 는 흑 쪽이 + */
export const gridPoint = (col, row) => ({ x: col * GRID_X, z: row * GRID_Z });

/** 세기(0~1) → 튕기는 속도. 약한 쪽을 섬세하게 고를 수 있도록 미끄러지는 거리가 세기에 비례하게 한다 */
export const speedOfPower = (power) => SPEED_MAX * Math.sqrt(clamp(power, 0, 1));

/** 속도 → 세기 (speedOfPower 의 역) */
export const powerOfSpeed = (speed) => clamp(speed / SPEED_MAX, 0, 1) ** 2;

/** 이 속도로 빈 판을 미끄러지는 거리 */
export const slideDistance = (speed) => (speed * speed) / (2 * DECEL);

/** 방향 각도 → 단위 벡터. 0 이면 백 쪽(-z, 화면 위), + 면 오른쪽으로 돈다 */
export const direction = (angle) => ({ x: Math.sin(angle), z: -Math.cos(angle) });

/** (x, z) 방향 벡터 → 방향 각도 */
export const angleOf = (dx, dz) => Math.atan2(dx, -dz);

/** 판 위에 있는지 (돌 중심이 판 안쪽) */
export const onBoard = (x, z) => Math.abs(x) <= HALF_X && Math.abs(z) <= HALF_Z;

/** 판 가장자리까지 가장 가까운 거리 (판 밖이면 음수) */
export const edgeDistance = (s) => Math.min(HALF_X - Math.abs(s.x), HALF_Z - Math.abs(s.z));

let nextId = 1;

/** 판 위의 돌 하나. team: 0 흑, 1 백 */
export function makeStone(team, x, z) {
  return { id: nextId++, team, x, z, vx: 0, vz: 0, spin: 0, turn: 0, inPlay: true, moving: false };
}

/**
 * 바둑판 하나. stones 에 판 위의 돌(빠진 돌도)이 들어 있다.
 * step(dt) 로 움직이고, 일어난 일은 events 에 쌓는다:
 *   { type: 'flick', stone, speed } 돌을 튕겼다
 *   { type: 'hit', a, b, speed } 돌끼리 부딪쳤다 (speed: 부딪힌 상대 속도)
 *   { type: 'out', stone, x, z, vx, vz } 판 밖으로 떨어졌다 (그 순간의 자리와 속도)
 *   { type: 'stop' } 모든 돌이 멈췄다
 */
export class Board {
  constructor(stones = []) {
    this.stones = stones.map((s) => ({ ...s }));
    this.events = [];
    this.shooter = null;
    this.time = 0;
    this.carry = 0; // advance 에서 STEP 으로 나누고 남은 시간
  }

  /** 판 위에 남은 돌만 복사한 새 판 (컴퓨터가 결과를 미리 따져 볼 때 쓴다) */
  clone() {
    return new Board(this.inPlay);
  }

  get inPlay() {
    return this.stones.filter((s) => s.inPlay);
  }

  /** team 의 판 위에 남은 돌 */
  stonesOf(team) {
    return this.stones.filter((s) => s.inPlay && s.team === team);
  }

  count(team) {
    return this.stonesOf(team).length;
  }

  byId(id) {
    return this.stones.find((s) => s.id === id) ?? null;
  }

  get moving() {
    return this.stones.some((s) => s.inPlay && s.moving);
  }

  /** 돌 id 를 shot { angle, speed } 로 튕긴다 */
  flick(id, { angle, speed }) {
    const stone = this.byId(id);
    if (!stone || !stone.inPlay) throw new Error(`판 위에 없는 돌입니다: ${id}`);
    const d = direction(angle);
    const v = clamp(speed, 0, SPEED_MAX);
    stone.vx = d.x * v;
    stone.vz = d.z * v;
    stone.moving = v > STOP_SPEED;
    this.shooter = stone;
    this.time = 0;
    this.carry = 0;
    this.events.push({ type: 'flick', stone, speed: v });
    if (!stone.moving) this.settle();
    return stone;
  }

  /** 화면 프레임마다 dt 초만큼. STEP 단위로 나눠 계산해 프레임 길이와 상관없이 같은 결과가 나온다 */
  advance(dt) {
    this.carry += dt;
    while (this.carry >= STEP && this.moving) {
      this.substep(STEP);
      this.carry -= STEP;
    }
    if (!this.moving) this.carry = 0;
    return this.moving;
  }

  substep(h) {
    this.time += h;
    const moving = this.stones.filter((s) => s.inPlay && s.moving);
    for (const s of moving) {
      const speed = Math.hypot(s.vx, s.vz);
      const next = speed - DECEL * h;
      if (next <= STOP_SPEED) {
        s.vx = s.vz = 0;
        s.moving = false;
        continue;
      }
      s.vx *= next / speed;
      s.vz *= next / speed;
      s.x += s.vx * h;
      s.z += s.vz * h;
    }
    // 보이는 회전 (부딪칠 때 생기고 점점 준다)
    for (const s of this.stones) {
      if (!s.inPlay || !s.spin) continue;
      s.turn += s.spin * h;
      s.spin *= 1 - SPIN_DECAY * h;
      if (Math.abs(s.spin) < 0.05) s.spin = 0;
    }
    for (const s of moving) if (s.inPlay) this.collide(s);
    // 부딪쳐 밀려난 돌도 판을 벗어날 수 있으니 판 위의 돌을 모두 본다
    for (const s of this.stones) if (s.inPlay) this.checkOut(s);
    if (!this.moving) this.settle();
  }

  /** s 와 겹친 돌을 서로 밀어내고 속도를 주고받는다 */
  collide(s) {
    const d2min = (2 * STONE_RADIUS) ** 2;
    for (const o of this.stones) {
      if (o === s || !o.inPlay) continue;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= d2min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      // 겹친 만큼 절반씩 떼어 놓는다
      const overlap = 2 * STONE_RADIUS - d;
      s.x -= (nx * overlap) / 2;
      s.z -= (nz * overlap) / 2;
      o.x += (nx * overlap) / 2;
      o.z += (nz * overlap) / 2;
      const rel = (s.vx - o.vx) * nx + (s.vz - o.vz) * nz;
      if (rel <= 0) continue; // 이미 멀어지는 중
      const j = ((1 + RESTITUTION) / 2) * rel;
      s.vx -= j * nx;
      s.vz -= j * nz;
      o.vx += j * nx;
      o.vz += j * nz;
      s.moving = o.moving = true;
      // 비껴 맞으면 서로 반대로 조금 돈다 (보이기만 하는 회전)
      const tangent = (s.vx - o.vx) * -nz + (s.vz - o.vz) * nx;
      s.spin += (tangent / STONE_RADIUS) * 0.15;
      o.spin -= (tangent / STONE_RADIUS) * 0.15;
      this.events.push({ type: 'hit', a: s, b: o, speed: rel });
    }
  }

  checkOut(s) {
    if (onBoard(s.x, s.z)) return;
    const event = { type: 'out', stone: s, x: s.x, z: s.z, vx: s.vx, vz: s.vz };
    s.inPlay = false;
    s.moving = false;
    s.vx = s.vz = 0;
    this.events.push(event);
  }

  settle() {
    this.events.push({ type: 'stop' });
  }

  /** 쌓인 사건을 꺼내고 비운다 */
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** 모두 멈출 때까지 돌린다 (컴퓨터의 수 읽기·테스트용). step 을 키우면 빠르지만 덜 정확하다 */
  run({ limit = 20, step = STEP } = {}) {
    while (this.moving && this.time < limit) this.substep(step);
    return this;
  }
}

/**
 * 원 from 에서 방향 angle 로 곧게 갈 때 처음 닿는 돌. 조준선과 컴퓨터가 쓴다.
 * { stone, distance: 닿을 때까지 중심이 가는 거리, x, z: 닿는 순간 중심 } 또는 null
 */
export function firstContact(from, angle, stones) {
  const d = direction(angle);
  let best = null;
  for (const o of stones) {
    if (o === from || o.id === from.id || o.inPlay === false) continue;
    const ox = o.x - from.x;
    const oz = o.z - from.z;
    const along = ox * d.x + oz * d.z;
    if (along <= 0) continue;
    const across2 = ox * ox + oz * oz - along * along;
    const reach2 = (2 * STONE_RADIUS) ** 2;
    if (across2 >= reach2) continue;
    const distance = along - Math.sqrt(reach2 - across2);
    if (distance < 0 || (best && distance >= best.distance)) continue;
    best = { stone: o, distance, x: from.x + d.x * distance, z: from.z + d.z * distance };
  }
  return best;
}

/** 점 (x, z) 에서 방향 angle 로 곧게 가면 판 가장자리까지의 거리 */
export function distanceToEdge(x, z, angle) {
  const d = direction(angle);
  const tx = d.x > 0 ? (HALF_X - x) / d.x : d.x < 0 ? (-HALF_X - x) / d.x : Infinity;
  const tz = d.z > 0 ? (HALF_Z - z) / d.z : d.z < 0 ? (-HALF_Z - z) / d.z : Infinity;
  return Math.max(0, Math.min(tx, tz));
}
