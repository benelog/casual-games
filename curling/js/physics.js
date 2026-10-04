// 컬링 시트 위의 스톤 움직임. Three.js 없이 평면(x, z) 위의 원판으로 계산하는 순수 로직이라 node 에서 그대로 테스트한다.
//
// 좌표: 길이 단위는 미터. 원점은 과녁(하우스) 한가운데 버튼, x 는 던지는 사람이 보기에 오른쪽(+),
// z 는 던지는 사람 쪽(+)이다. 스톤은 z 가 큰 곳에서 출발해 z 가 줄어드는 쪽으로 미끄러진다.
// 규격은 세계컬링연맹 시트를 따른다 (하우스 반지름 1.829m, 티 라인에서 호그 라인까지 6.40m 등).
//
// 움직임은 실제 시간 기준이다. 얼음 위 스톤은 마찰로 일정하게 느려지고(감속도 DECEL),
// 회전 방향으로 휘는 힘은 느려질수록 커진다(그래서 끝에서 크게 휜다). 스위핑하면 덜 느려지고 덜 휜다.
// 스톤끼리는 같은 무게의 원판으로 보고 반발 계수 RESTITUTION 인 충돌을 한다.

export const STONE_RADIUS = 0.145;
export const HOUSE_RADIUS = 1.829; // 12피트 원
export const RING_RADII = [1.829, 1.219, 0.61, 0.152]; // 12·8·4피트 원, 버튼
export const HALF_WIDTH = 2.375; // 시트 폭 4.75m 의 절반. 사이드 라인(보드)에 닿으면 아웃
export const HOG_Z = 6.4; // 먼 쪽 호그 라인. 이 선을 완전히 넘지 못한 스톤은 빠진다
export const BACK_Z = -1.829; // 백 라인. 완전히 넘어가면 빠진다
export const HACK_Z = -3.658; // 먼 쪽 핵(발판) 라인 = 하우스 뒤 끝
export const NEAR_HOG_Z = HOG_Z + 21.945; // 던지는 쪽 호그 라인
export const NEAR_TEE_Z = 34.747; // 던지는 쪽 티 라인
export const RELEASE_Z = 30.2; // 스톤을 놓는 자리 (던지는 쪽 호그 라인 조금 앞)
export const END_Z = NEAR_TEE_Z + 3.658 + 1.2; // 시트가 끝나는 곳 (던지는 쪽 핵 뒤)

export const DECEL = 0.074; // 마찰에 의한 감속도 (m/s²). 얼음의 마찰 계수 약 0.0075
export const SWEEP_DECEL = 0.9; // 스위핑하는 동안 감속도 배율
export const CURL_K = 0.0082; // 휘는 힘의 세기
export const CURL_B = 0.22; // 느릴 때 휘는 힘이 끝없이 커지지 않게 더하는 속도 (m/s)
export const SWEEP_CURL = 0.55; // 스위핑하는 동안 휘는 힘의 배율
export const RESTITUTION = 0.86;
export const STOP_SPEED = 0.008; // 이보다 느려지면 멈춘 것으로 본다
export const STEP = 1 / 240; // 물리 한 걸음 (초)

export const SPEED_MAX = 3.6; // 가장 센 테이크아웃 (놓는 순간의 속도, m/s)
export const ANGLE_LIMIT = 0.085; // 조준 각도 한계 (라디안). 하우스에서 약 ±2.6m

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** 버튼 중심에서 스톤 중심까지의 거리 */
export const distanceToButton = (stone) => Math.hypot(stone.x, stone.z);

/** 하우스에 걸쳐 있는지 (스톤 가장자리가 12피트 원에 닿기만 해도 하우스 안이다) */
export const inHouse = (stone) => distanceToButton(stone) <= HOUSE_RADIUS + STONE_RADIUS;

/** 놓는 자리에서 (x, z) 를 향하는 조준 각도. +면 오른쪽 */
export function angleToward(x, z) {
  return Math.atan2(x, RELEASE_Z - z);
}

/** 조준 각도로 곧게 갔을 때 티 라인(z=0)에서의 x. 스킵이 브룸을 대는 자리 */
export function broomX(angle) {
  return Math.tan(angle) * RELEASE_Z;
}

let nextId = 1;

/** 시트 위의 스톤 하나. spin: +1 시계 방향(오른쪽으로 휜다), -1 반시계 방향, 0 회전 없음 */
export function makeStone(team, x, z, { vx = 0, vz = 0, spin = 0 } = {}) {
  return { id: nextId++, team, x, z, vx, vz, spin, angle: 0, inPlay: true, moving: vx !== 0 || vz !== 0, hit: false, delivered: false };
}

/**
 * 시트 하나. stones 에 하우스 쪽에 놓인 스톤과 지금 던진 스톤이 들어 있다.
 * step(dt) 로 움직이고, 일어난 일은 events 에 쌓는다:
 *   { type: 'hit', a, b, speed } 스톤끼리 부딪쳤다 (speed: 부딪힌 상대 속도)
 *   { type: 'out', stone, reason } 경기에서 빠졌다 (reason: 'back' 백 라인, 'side' 사이드 라인, 'hog' 호그 라인)
 *   { type: 'stop' } 모든 스톤이 멈췄다
 */
export class Sheet {
  constructor(stones = []) {
    this.stones = stones.map((s) => ({ ...s }));
    this.events = [];
    this.sweeping = 0; // 지금 던진 스톤을 쓰는 세기 (0 ~ 1)
    this.shooter = null;
    this.time = 0;
  }

  /** 놓여 있는 스톤만 복사한 새 시트 (컴퓨터가 결과를 미리 따져 볼 때 쓴다) */
  clone() {
    return new Sheet(this.stones.filter((s) => s.inPlay));
  }

  /** 놓여 있는 스톤 */
  get inPlay() {
    return this.stones.filter((s) => s.inPlay);
  }

  /** 움직이는 스톤이 하나라도 있는지 */
  get moving() {
    return this.stones.some((s) => s.inPlay && s.moving);
  }

  /** team 의 스톤을 shot { angle, speed, spin } 으로 던진다 */
  deliver(team, { angle, speed, spin }) {
    const stone = makeStone(team, 0, RELEASE_Z, {
      vx: Math.sin(angle) * speed,
      vz: -Math.cos(angle) * speed,
      spin: Math.sign(spin),
    });
    stone.delivered = true;
    this.stones.push(stone);
    this.shooter = stone;
    this.sweeping = 0;
    this.time = 0;
    return stone;
  }

  /** 실제 시간 dt 초만큼 움직인다. 모두 멈추면 false */
  step(dt) {
    let left = dt;
    while (left > 1e-9 && this.moving) {
      const h = Math.min(STEP, left);
      this.substep(h);
      left -= h;
    }
    return this.moving;
  }

  substep(h) {
    this.time += h;
    const moving = this.stones.filter((s) => s.inPlay && s.moving);
    for (const s of moving) {
      const speed = Math.hypot(s.vx, s.vz);
      const swept = s === this.shooter ? this.sweeping : 0;
      // 마찰: 진행 방향 반대로 일정하게 느려진다
      const decel = DECEL * (1 - (1 - SWEEP_DECEL) * swept);
      const next = speed - decel * h;
      if (next <= STOP_SPEED) {
        s.vx = s.vz = 0;
        s.moving = false;
        continue;
      }
      let vx = (s.vx / speed) * next;
      let vz = (s.vz / speed) * next;
      // 컬: 진행 방향의 오른쪽(시계 방향일 때)으로 미는 힘. 느릴수록 세다
      if (s.spin) {
        const curl = (s.spin * CURL_K * (1 - (1 - SWEEP_CURL) * swept)) / (next + CURL_B);
        const rx = -s.vz / speed;
        const rz = s.vx / speed;
        vx += rx * curl * h;
        vz += rz * curl * h;
        const scale = next / Math.hypot(vx, vz);
        vx *= scale;
        vz *= scale;
      }
      s.vx = vx;
      s.vz = vz;
      s.x += vx * h;
      s.z += vz * h;
      // 보이는 회전: 빠를 때 천천히, 끝까지 돈다 (한 번 미끄러지는 동안 3~4바퀴)
      s.angle -= s.spin * (0.9 + 0.6 * next) * h;
    }
    for (const s of moving) if (s.inPlay) this.collide(s);
    for (const s of moving) if (s.inPlay) this.checkOut(s);
    if (!this.moving) this.settle();
  }

  /** s 와 겹친 스톤을 서로 밀어내고 속도를 주고받는다 */
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
      s.hit = o.hit = true;
      // 부딪치면 회전이 대부분 사라진다. 맞은 스톤은 거의 곧게 간다
      s.spin *= 0.5;
      o.spin = 0;
      this.events.push({ type: 'hit', a: s, b: o, speed: rel });
    }
  }

  checkOut(s) {
    if (Math.abs(s.x) > HALF_WIDTH - STONE_RADIUS) this.remove(s, 'side');
    else if (s.z < BACK_Z - STONE_RADIUS) this.remove(s, 'back');
    else if (s.z > END_Z) this.remove(s, 'back'); // 되튕겨 시트 끝까지 간 스톤
  }

  remove(s, reason) {
    s.inPlay = false;
    s.moving = false;
    s.vx = s.vz = 0;
    this.events.push({ type: 'out', stone: s, reason });
  }

  /** 모두 멈춘 뒤: 던진 스톤이 다른 스톤을 맞히지 못하고 호그 라인을 완전히 넘지 못했으면 뺀다 */
  settle() {
    const s = this.shooter;
    if (s && s.inPlay && !s.hit && s.z > HOG_Z - STONE_RADIUS) this.remove(s, 'hog');
    this.sweeping = 0;
    this.events.push({ type: 'stop' });
  }

  /** 쌓인 사건을 꺼내고 비운다 */
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** 모두 멈출 때까지 돌린다 (컴퓨터의 수 읽기·테스트용). sweep(sheet) 이 쓸 세기를 돌려줄 수 있다 */
  run({ sweep = null, limit = 90, step = STEP * 2 } = {}) {
    while (this.moving && this.time < limit) {
      if (sweep) this.sweeping = sweep(this);
      let left = step;
      while (left > 1e-9 && this.moving) {
        const h = Math.min(STEP * 2, left);
        this.substep(h);
        left -= h;
      }
    }
    return this;
  }
}

/** 빈 시트에서 shot 을 던졌을 때 멈추는 자리 { x, z } (빠지면 inPlay: false) */
export function restingPoint(shot, { sweep = 0 } = {}) {
  const sheet = new Sheet();
  const stone = sheet.deliver(0, shot);
  sheet.run({ sweep: sweep ? () => sweep : null });
  return { x: stone.x, z: stone.z, inPlay: stone.inPlay };
}

/** 곧게 갈 때(휘지 않을 때) 이 속도로 미끄러지는 거리 */
export const slideDistance = (speed, decel = DECEL) => (speed * speed) / (2 * decel);

/** 놓는 자리에서 거리 d 만큼 가서 멈추는 속도 (휘면서 길이 조금 길어지는 것은 빼고) */
export const speedForDistance = (d, decel = DECEL) => Math.sqrt(2 * decel * Math.max(0, d));

/**
 * 세기 게이지(0~1)를 놓는 속도로 바꾼다. 하우스에 멈추는 드로 구간이 게이지의 넓은 자리를 차지하도록
 * 구간마다 따로 늘린다: 호그 라인에 못 미침 · 가드(호그~하우스 앞) · 드로(하우스 안) · 테이크아웃.
 */
export const WEIGHT_KNOTS = [
  [0, speedForDistance(RELEASE_Z - HOG_Z - 1.5)],
  [0.1, speedForDistance(RELEASE_Z - HOG_Z + STONE_RADIUS)],
  [0.36, speedForDistance(RELEASE_Z - HOUSE_RADIUS)],
  [0.62, speedForDistance(RELEASE_Z - BACK_Z)],
  [1, SPEED_MAX],
];

export function speedOfPower(p) {
  const k = WEIGHT_KNOTS;
  p = clamp(p, 0, 1);
  for (let i = 1; i < k.length; i++) {
    if (p <= k[i][0]) return k[i - 1][1] + ((p - k[i - 1][0]) / (k[i][0] - k[i - 1][0])) * (k[i][1] - k[i - 1][1]);
  }
  return SPEED_MAX;
}

export function powerOfSpeed(speed) {
  const k = WEIGHT_KNOTS;
  speed = clamp(speed, k[0][1], SPEED_MAX);
  for (let i = 1; i < k.length; i++) {
    if (speed <= k[i][1]) return k[i - 1][0] + ((speed - k[i - 1][1]) / (k[i][1] - k[i - 1][1])) * (k[i][0] - k[i - 1][0]);
  }
  return 1;
}

/**
 * 빈 시트에서 (x, z) 에 멈추도록 하는 shot { angle, speed, spin } 을 찾는다.
 * 거리로 속도를 어림잡고, 몇 번 던져 보며 빗나간 만큼 각도와 속도를 고친다.
 */
export function solveDraw(x, z, spin) {
  let speed = speedForDistance(RELEASE_Z - z);
  let angle = angleToward(x, z);
  for (let i = 0; i < 6; i++) {
    const end = restingPoint({ angle, speed, spin });
    const ex = x - end.x;
    if (Math.abs(ex) < 0.005 && Math.abs(end.z - z) < 0.01) break;
    angle += ex / (RELEASE_Z - z);
    // 미끄러지는 거리는 속도의 제곱에 비례한다
    speed *= Math.sqrt((RELEASE_Z - z) / Math.max(1, RELEASE_Z - end.z));
  }
  return { angle: clamp(angle, -ANGLE_LIMIT, ANGLE_LIMIT), speed, spin };
}

/**
 * 빈 시트에서 speed 로 던져 (x, z) 를 지나가게 하는 각도를 찾는다 (테이크아웃·히트용).
 * 지나가지 못하면(그 전에 멈추면) 가장 가까이 간 곳 기준으로 고친다.
 */
export function solveHit(x, z, spin, speed) {
  let angle = angleToward(x, z);
  for (let i = 0; i < 6; i++) {
    const px = pathXAt({ angle, speed, spin }, z);
    if (px === null) break;
    const ex = x - px;
    if (Math.abs(ex) < 0.004) break;
    angle += ex / (RELEASE_Z - z);
  }
  return { angle: clamp(angle, -ANGLE_LIMIT, ANGLE_LIMIT), speed, spin };
}

/** 빈 시트에서 shot 이 z 를 지날 때의 x. z 까지 못 가면 null */
export function pathXAt(shot, z) {
  const sheet = new Sheet();
  const stone = sheet.deliver(0, shot);
  while (sheet.moving && stone.z > z) sheet.substep(STEP * 2);
  return stone.z <= z ? stone.x : null;
}

/** 빈 시트에서 shot 이 지나가는 길 [{ x, z }] (조준선용). 점은 거리 간격 spacing 마다 */
export function predictPath(shot, { spacing = 0.5, sweep = 0 } = {}) {
  const sheet = new Sheet();
  const stone = sheet.deliver(0, shot);
  sheet.sweeping = sweep;
  const points = [{ x: stone.x, z: stone.z }];
  let last = points[0];
  while (sheet.moving && stone.inPlay) {
    sheet.substep(STEP * 2);
    if (Math.hypot(stone.x - last.x, stone.z - last.z) >= spacing) {
      last = { x: stone.x, z: stone.z };
      points.push(last);
    }
  }
  if (stone.inPlay) points.push({ x: stone.x, z: stone.z });
  return points;
}
