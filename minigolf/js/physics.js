// 미니 골프 공의 움직임. Three.js 없이 평면(x, z) 위의 굴림으로 계산하는 순수 로직이라 node 에서 그대로 테스트한다.
//
// 좌표: 길이 단위는 미터. x 는 오른쪽(+), z 는 화면 아래(티 쪽, +), y 는 위. 높이는 코스의 높이 함수 h(x, z) 로 준다.
// 공은 골프공 규격(지름 42.67mm), 컵은 지름 108mm.
//
// - 굴림: 인조 잔디 위에서 구름 저항으로 일정하게 느려진다(감속도 DECEL, 모래는 SAND_DECEL).
//   경사에서는 구르는 공의 가속도 (5/7)·g·기울기 로 내리막 쪽으로 끌린다. 멈춘 공은 기울기가 구름 저항보다 크면 다시 구른다.
// - 벽: 두께가 있는 선분(캡슐)과 기둥(원)에 반발 계수 WALL_E 로 튕긴다. 당구(billiards/js/physics.js)의 쿠션 반사를
//   회전 없이 줄인 것이다. 움직이는 장애물(좌우로 오가는 블록, 풍차 날개)은 그 속도를 더해 되튕긴다.
// - 컵: 공 중심이 컵 위에 오면 바닥이 없어 떨어지기 시작한다. 컵을 가로지르는 동안 공 반지름만큼 떨어지면 들어가고,
//   그 전에 반대쪽 가장자리에 닿으면 튕겨 나간다. 그래서 빠르면 튀어 나가고 느리면 들어간다(한가운데로 약 1.6 m/s 까지).
// - 물: 공 중심이 물 위에 오면 빠진다(벌타는 game.js 가 매긴다).
// 고정 간격(STEP)으로 계산하므로 같은 자리에서 같은 시각에 같은 샷을 치면 언제나 같은 결과다.

export const BALL_R = 0.0214;
export const CUP_R = 0.054;
export const G = 9.8;
export const SLOPE_K = (5 / 7) * G; // 구르는 공이 기울기 1 에서 받는 가속도
export const DECEL = 0.62; // 인조 잔디의 구름 저항 (m/s²)
export const SAND_DECEL = 3.4; // 모래
export const WALL_E = 0.7; // 벽 반발 계수
export const WALL_KEEP = 0.94; // 벽을 따라 미끄러지는 속도가 남는 비율
export const WALL_HALF = 0.03; // 벽 두께의 절반
export const CUP_DROP = BALL_R; // 컵을 건너는 동안 이만큼 떨어지면 들어간다
const LIP_DAMP = 0.85; // 컵 반대편 가장자리에 걸렸을 때 바깥쪽 속도를 잃는 정도
export const SPEED_MAX = 4.6; // 가장 세게 친 속도 (m/s). 평지에서 약 17m 구른다
export const MIN_POWER = 0.02; // 이보다 약하면 치지 않는다
export const STOP_SPEED = 0.012;
export const STEP = 1 / 600;
export const MAX_TIME = 40; // 한 번 친 공을 이보다 오래 굴리지 않는다

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** 세기(0~1) → 치는 속도. 평지에서 구르는 거리가 세기에 비례하게 한다 */
export const speedOfPower = (power) => SPEED_MAX * Math.sqrt(clamp(power, 0, 1));

/** 속도 → 세기 (speedOfPower 의 역) */
export const powerOfSpeed = (speed) => clamp(speed / SPEED_MAX, 0, 1) ** 2;

/** 이 속도로 평지를 굴러가는 거리 */
export const rollDistance = (speed, decel = DECEL) => (speed * speed) / (2 * decel);

/** 방향 각도 → 단위 벡터. 0 이면 화면 위(-z), + 면 오른쪽으로 돈다 */
export const direction = (angle) => ({ x: Math.sin(angle), z: -Math.cos(angle) });

/** (x, z) 방향 벡터 → 방향 각도 */
export const angleOf = (dx, dz) => Math.atan2(dx, -dz);

// ---------- 영역 ----------

/** 점이 다각형 [[x, z], …] 안에 있는지 (짝홀 규칙) */
export function inPolygon(points, x, z) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i];
    const [xj, zj] = points[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 모래·물 영역 { rect: [x0, z0, x1, z1] } 또는 { circle: [x, z, rx, rz] } 안에 있는지 */
export function inRegion(region, x, z) {
  if (region.rect) {
    const [x0, z0, x1, z1] = region.rect;
    return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && z >= Math.min(z0, z1) && z <= Math.max(z0, z1);
  }
  const [cx, cz, rx, rz = rx] = region.circle;
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  return dx * dx + dz * dz <= 1;
}

const smooth = (t) => t * t * (3 - 2 * t);
const smoothSlope = (t) => 6 * t * (1 - t);

/**
 * 지형 하나의 높이와 기울기 { h, gx, gz }.
 * - hill: (x, z) 를 중심으로 반지름 r 안에서 높이 h 인 둥근 언덕 (h 가 음수면 골짜기)
 * - ramp: axis('x'|'z') 를 따라 from 에서 to 까지 높이가 h 만큼 부드럽게 바뀌고 그 뒤는 평평하다
 * - tilt: 코스 전체가 h = gx·x + gz·z 로 기울어 있다
 */
export function terrainAt(feature, x, z) {
  if (feature.type === 'hill') {
    const dx = x - feature.x;
    const dz = z - feature.z;
    const d = Math.hypot(dx, dz);
    if (d >= feature.r) return { h: 0, gx: 0, gz: 0 };
    const k = Math.PI / feature.r;
    const h = (feature.h * (1 + Math.cos(k * d))) / 2;
    if (d < 1e-9) return { h, gx: 0, gz: 0 };
    const dh = (-feature.h * k * Math.sin(k * d)) / 2; // 중심에서 멀어지는 쪽의 기울기
    return { h, gx: (dh * dx) / d, gz: (dh * dz) / d };
  }
  if (feature.type === 'ramp') {
    const p = feature.axis === 'x' ? x : z;
    const span = feature.to - feature.from;
    const t = clamp((p - feature.from) / span, 0, 1);
    const h = feature.h * smooth(t);
    const g = t > 0 && t < 1 ? (feature.h * smoothSlope(t)) / span : 0;
    return feature.axis === 'x' ? { h, gx: g, gz: 0 } : { h, gx: 0, gz: g };
  }
  if (feature.type === 'tilt') {
    const gx = feature.gx ?? 0;
    const gz = feature.gz ?? 0;
    return { h: gx * x + gz * z, gx, gz };
  }
  throw new Error(`모르는 지형입니다: ${feature.type}`);
}

// ---------- 장애물 ----------

/** 상자 { x, z, hw, hd } 와 원(공)의 가장 가까운 점. 공 중심이 상자 안이면 가장 가까운 면으로 내보낸다 */
function boxContact(box, x, z) {
  const cx = clamp(x, box.x - box.hw, box.x + box.hw);
  const cz = clamp(z, box.z - box.hd, box.z + box.hd);
  if (cx !== x || cz !== z) return { cx, cz, inside: false };
  // 안에 들어왔다: 가장 얕은 면
  const left = x - (box.x - box.hw);
  const right = box.x + box.hw - x;
  const top = z - (box.z - box.hd);
  const bottom = box.z + box.hd - z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { cx: box.x - box.hw, cz: z, inside: true };
  if (m === right) return { cx: box.x + box.hw, cz: z, inside: true };
  if (m === top) return { cx: x, cz: box.z - box.hd, inside: true };
  return { cx: x, cz: box.z + box.hd, inside: true };
}

/** 움직이는 블록의 시각 t 에서의 상자와 속도 */
export function blockAt(block, t) {
  const box = { x: block.x, z: block.z, hw: block.w / 2, hd: block.d / 2, vx: 0, vz: 0 };
  const m = block.move;
  if (m) {
    const w = (2 * Math.PI) / m.period;
    const phase = w * t + (m.phase ?? 0);
    const offset = m.amp * Math.sin(phase);
    const speed = m.amp * w * Math.cos(phase);
    if (m.axis === 'x') {
      box.x += offset;
      box.vx = speed;
    } else {
      box.z += offset;
      box.vz = speed;
    }
  }
  return box;
}

// 풍차: 건물 앞면 위쪽의 축에서 날개 4장이 세로면(x-y)으로 돈다. 날개가 아래로 내려온 동안 굴 입구를 막는다.
export const MILL = {
  hub: 0.46, // 축 높이
  blade: 0.5, // 날개 길이 (축에서 끝까지)
  bladeWidth: 0.07,
  gapFront: 0.06, // 건물 앞면에서 날개까지
  bladeDepth: 0.03, // 날개 두께 (z)
};

/** 풍차 날개 k 의 시각 t 에서의 각도. 0 이면 아래를 가리키고 + 면 시계 방향(앞에서 보아)으로 돈다 */
export const bladeAngle = (mill, k, t) => (2 * Math.PI * t) / mill.period + (mill.phase ?? 0) + (k * Math.PI) / 2;

/** 풍차 날개의 z (건물 앞면 앞) */
export const bladeZ = (mill) => mill.z + mill.depth / 2 + MILL.gapFront;

/**
 * 공 높이(공 중심)에서 날개가 지나가는 자리를 상자로. 날개가 내려와 있지 않으면 null.
 * 날개는 축에서 비스듬히 내려오므로 공 높이에서의 x 는 (축 높이 - 공 반지름)·tan(각도) 이다.
 */
export function bladeBox(mill, k, t) {
  const a = bladeAngle(mill, k, t);
  const c = Math.cos(a);
  if (c <= 0.05) return null;
  const drop = MILL.hub - BALL_R;
  const reach = drop / c;
  if (reach > MILL.blade) return null;
  const s = Math.sin(a);
  const w = (2 * Math.PI) / mill.period;
  return {
    x: mill.x + (drop * s) / c,
    z: bladeZ(mill),
    hw: Math.min(0.12, MILL.bladeWidth / 2 / c),
    hd: MILL.bladeDepth / 2,
    vx: (drop * w) / (c * c),
    vz: 0,
  };
}

/** 풍차 건물의 굴 양쪽 두 덩어리 (정지) */
export function millBoxes(mill) {
  const side = (mill.width - mill.gap) / 4;
  const hd = mill.depth / 2;
  return [
    { x: mill.x - mill.gap / 2 - side, z: mill.z, hw: side, hd, vx: 0, vz: 0 },
    { x: mill.x + mill.gap / 2 + side, z: mill.z, hw: side, hd, vx: 0, vz: 0 },
  ];
}

/** 공을 가장 가까운 점 (cx, cz) 에서 reach 만큼 떨어뜨리고, 장애물 속도 (ux, uz) 를 기준으로 튕긴다. 튕겼으면 부딪힌 속도 */
function bounce(ball, cx, cz, reach, ux = 0, uz = 0, inside = false) {
  let nx = ball.x - cx;
  let nz = ball.z - cz;
  let d = Math.hypot(nx, nz);
  if (!inside && d >= reach) return 0;
  if (d < 1e-9) {
    // 정확히 겹쳤다: 장애물이 움직이는 쪽(없으면 공이 온 쪽)으로 내보낸다
    nx = ux || -ball.vx;
    nz = uz || -ball.vz;
    d = Math.hypot(nx, nz) || 1;
    if (!ux && !uz && !ball.vx && !ball.vz) nz = d = 1;
  }
  nx /= d;
  nz /= d;
  if (inside) {
    nx = -nx;
    nz = -nz;
  }
  ball.x = cx + nx * reach;
  ball.z = cz + nz * reach;
  const rvx = ball.vx - ux;
  const rvz = ball.vz - uz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0; // 이미 멀어지는 중
  const tx = rvx - vn * nx;
  const tz = rvz - vn * nz;
  ball.vx = ux + tx * WALL_KEEP - WALL_E * vn * nx;
  ball.vz = uz + tz * WALL_KEEP - WALL_E * vn * nz;
  return -vn;
}

// ---------- 코스 ----------

/**
 * 홀 하나의 지형과 장애물. course.js 의 홀 데이터에서 만든다.
 * 벽은 테두리(outline)의 변과 안쪽 벽(walls)으로 이루어진 두께 2·WALL_HALF 의 캡슐이다.
 */
export class Green {
  constructor(hole) {
    this.hole = hole;
    this.outline = hole.outline;
    this.tee = { x: hole.tee[0], z: hole.tee[1] };
    this.cup = { x: hole.cup[0], z: hole.cup[1] };
    this.terrain = hole.terrain ?? [];
    this.sand = hole.sand ?? [];
    this.water = hole.water ?? [];
    this.posts = (hole.posts ?? []).map(([x, z, r]) => ({ x, z, r }));
    this.blocks = hole.blocks ?? [];
    this.mills = hole.windmills ?? [];
    this.segments = [];
    const n = this.outline.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = this.outline[i];
      const [bx, bz] = this.outline[(i + 1) % n];
      this.segments.push({ ax, az, bx, bz, edge: true });
    }
    for (const [ax, az, bx, bz] of hole.walls ?? []) this.segments.push({ ax, az, bx, bz, edge: false });
    this.staticBoxes = [...this.blocks.filter((b) => !b.move).map((b) => blockAt(b, 0)), ...this.mills.flatMap(millBoxes)];
    this.movers = this.blocks.filter((b) => b.move);
    // 테두리의 범위 (카메라·지형 그리기용)
    const xs = this.outline.map((p) => p[0]);
    const zs = this.outline.map((p) => p[1]);
    this.bounds = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  }

  heightAt(x, z) {
    let h = 0;
    for (const f of this.terrain) h += terrainAt(f, x, z).h;
    return h;
  }

  /** 높이의 기울기 { gx, gz } (오르막 쪽) */
  slopeAt(x, z) {
    let gx = 0;
    let gz = 0;
    for (const f of this.terrain) {
      const t = terrainAt(f, x, z);
      gx += t.gx;
      gz += t.gz;
    }
    return { gx, gz };
  }

  inSand(x, z) {
    return this.sand.some((r) => inRegion(r, x, z));
  }

  inWater(x, z) {
    return this.water.some((r) => inRegion(r, x, z));
  }

  inside(x, z) {
    return inPolygon(this.outline, x, z);
  }

  /** 시각 t 의 움직이는 상자들 (블록, 내려온 풍차 날개). kind 로 소리를 고른다 */
  moversAt(t) {
    const boxes = this.movers.map((b) => ({ ...blockAt(b, t), kind: 'block' }));
    for (const mill of this.mills) {
      for (let k = 0; k < 4; k++) {
        const box = bladeBox(mill, k, t);
        if (box) boxes.push({ ...box, kind: 'blade' });
      }
    }
    return boxes;
  }

  /** 움직이는 장애물이 지나가는 자리 (공이 여기서 멈추면 옆으로 옮긴다). 공 반지름만큼 넓힌 상자 */
  sweeps() {
    const pad = BALL_R + 0.01;
    const list = [];
    for (const b of this.movers) {
      const { axis, amp } = b.move;
      const hw = b.w / 2 + (axis === 'x' ? amp : 0) + pad;
      const hd = b.d / 2 + (axis === 'z' ? amp : 0) + pad;
      list.push({ x: b.x, z: b.z, hw, hd });
    }
    for (const mill of this.mills) {
      const reach = (MILL.hub - BALL_R) * Math.tan(Math.acos((MILL.hub - BALL_R) / MILL.blade)) + 0.12;
      list.push({ x: mill.x, z: bladeZ(mill), hw: reach + pad, hd: MILL.bladeDepth / 2 + pad });
    }
    return list;
  }

  /** 가장 가까운 벽(테두리·안쪽 벽)까지 공 중심의 거리에서 벽 두께를 뺀 것 */
  wallClearance(x, z) {
    let best = Infinity;
    for (const s of this.segments) best = Math.min(best, segmentDistance(s, x, z) - WALL_HALF);
    for (const p of this.posts) best = Math.min(best, Math.hypot(x - p.x, z - p.z) - p.r);
    for (const b of this.staticBoxes) {
      const c = boxContact(b, x, z);
      const d = Math.hypot(x - c.cx, z - c.cz);
      best = Math.min(best, c.inside ? -d : d);
    }
    return best;
  }

  /** 공이 멈춰 있을 수 있는 자리인지 (코스 안, 벽·장애물·물·컵 밖) */
  playable(x, z) {
    return (
      this.inside(x, z) &&
      this.wallClearance(x, z) >= BALL_R &&
      !this.inWater(x, z) &&
      Math.hypot(x - this.cup.x, z - this.cup.z) > CUP_R + BALL_R
    );
  }

  /**
   * 멈춘 공이 움직이는 장애물의 길 위에 있으면 길 밖의 가장 가까운 자리로 옮긴다.
   * 옮겼으면 { x, z, moved: true }, 아니면 그대로
   */
  clearSpot(x, z) {
    const sweeps = this.sweeps();
    const blocked = (px, pz) => sweeps.some((s) => Math.abs(px - s.x) < s.hw && Math.abs(pz - s.z) < s.hd);
    if (!blocked(x, z)) return { x, z, moved: false };
    let best = null;
    for (const s of sweeps) {
      if (!(Math.abs(x - s.x) < s.hw && Math.abs(z - s.z) < s.hd)) continue;
      const m = 0.02;
      const options = [
        [x, s.z + s.hd + m],
        [x, s.z - s.hd - m],
        [s.x - s.hw - m, z],
        [s.x + s.hw + m, z],
      ];
      for (const [px, pz] of options) {
        // 벽에 붙은 자리면 안쪽으로 조금씩 밀어 본다
        for (let i = 0; i < 8; i++) {
          const k = i * 0.03;
          const qx = px + (px === x ? 0 : Math.sign(px - x) * k);
          const qz = pz + (pz === z ? 0 : Math.sign(pz - z) * k);
          if (!this.playable(qx, qz) || blocked(qx, qz)) continue;
          const d = Math.hypot(qx - x, qz - z);
          if (!best || d < best.d) best = { x: qx, z: qz, d };
          break;
        }
      }
    }
    return best ? { x: best.x, z: best.z, moved: true } : { x: this.tee.x, z: this.tee.z, moved: true };
  }
}

/** 선분 s 에서 점까지의 거리 */
export function segmentDistance(s, x, z) {
  const c = segmentPoint(s, x, z);
  return Math.hypot(x - c.x, z - c.z);
}

function segmentPoint(s, x, z) {
  const ex = s.bx - s.ax;
  const ez = s.bz - s.az;
  const len2 = ex * ex + ez * ez;
  let k = len2 > 0 ? ((x - s.ax) * ex + (z - s.az) * ez) / len2 : 0;
  k = clamp(k, 0, 1);
  return { x: s.ax + ex * k, z: s.az + ez * k };
}

// ---------- 한 번의 샷 ----------

/**
 * 공 하나를 한 번 친 움직임. time 은 홀의 시계(움직이는 장애물의 시각)로, 치는 순간부터 이어서 흐른다.
 * advance(dt) 로 움직이고, 일어난 일은 events 에 쌓는다:
 *   { type: 'strike', speed } 쳤다
 *   { type: 'wall', speed, kind } 벽('wall')·기둥('post')·블록('block')·날개('blade')에 부딪쳤다
 *   { type: 'sand' } 모래에 들어갔다
 *   { type: 'lip', speed } 컵 가장자리에 걸려 튕겨 나갔다
 *   { type: 'cup', speed } 컵에 들어갔다
 *   { type: 'water', x, z } 물에 빠졌다
 *   { type: 'out' } 코스 밖으로 나갔다 (벽을 뚫는 일은 없어야 하지만 만일을 위해)
 *   { type: 'stop', x, z } 멈췄다
 * 끝나면 result 가 'holed' · 'water' · 'out' · 'stopped' 중 하나가 된다.
 */
export class Putt {
  constructor(green, { x, z }, time = 0) {
    this.green = green;
    this.ball = { x, z, vx: 0, vz: 0, drop: 0 };
    this.time = time;
    this.elapsed = 0;
    this.carry = 0;
    this.moving = false;
    this.overCup = false;
    this.fall = 0; // 컵 위에서 떨어진 시간
    this.wasSand = green.inSand(x, z);
    this.result = null;
    this.events = [];
  }

  /** shot { angle, speed } 로 친다 */
  strike({ angle, speed }) {
    const d = direction(angle);
    const v = clamp(speed, 0, SPEED_MAX);
    this.ball.vx = d.x * v;
    this.ball.vz = d.z * v;
    this.moving = true;
    this.elapsed = 0;
    this.carry = 0;
    this.events.push({ type: 'strike', speed: v });
    return this;
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

  /** 끝날 때까지 돌린다 (테스트·코스 점검용). step 을 키우면 빠르지만 덜 정확하다 */
  run({ step = STEP } = {}) {
    while (this.moving) this.substep(step);
    return this;
  }

  get speed() {
    return Math.hypot(this.ball.vx, this.ball.vz);
  }

  substep(h) {
    const b = this.ball;
    const green = this.green;
    this.time += h;
    this.elapsed += h;
    if (this.overCup) return this.overCupStep(h);

    // 경사와 구름 저항
    const sand = green.inSand(b.x, b.z);
    if (sand && !this.wasSand) this.events.push({ type: 'sand' });
    this.wasSand = sand;
    const decel = sand ? SAND_DECEL : DECEL;
    const { gx, gz } = green.slopeAt(b.x, b.z);
    const ax = -SLOPE_K * gx;
    const az = -SLOPE_K * gz;
    b.vx += ax * h;
    b.vz += az * h;
    const speed = Math.hypot(b.vx, b.vz);
    const next = speed - decel * h;
    const hold = Math.hypot(ax, az) <= decel; // 기울기가 구름 저항을 못 이기면 멈춰 있을 수 있다
    if (next <= 0 || (next < STOP_SPEED && hold)) {
      b.vx = b.vz = 0;
      if (hold) return this.finish('stopped');
    } else {
      b.vx *= next / speed;
      b.vz *= next / speed;
    }
    b.x += b.vx * h;
    b.z += b.vz * h;

    this.collide();

    if (green.inWater(b.x, b.z)) {
      this.events.push({ type: 'water', x: b.x, z: b.z });
      return this.finish('water');
    }
    if (!green.inside(b.x, b.z)) {
      this.events.push({ type: 'out' });
      return this.finish('out');
    }
    const cx = b.x - green.cup.x;
    const cz = b.z - green.cup.z;
    if (cx * cx + cz * cz < CUP_R * CUP_R) {
      this.overCup = true;
      this.fall = 0;
    }
    if (this.elapsed >= MAX_TIME) this.finish('stopped');
  }

  /** 컵 위를 지나는 중: 바닥이 없어 떨어지며 곧게 간다 */
  overCupStep(h) {
    const b = this.ball;
    const cup = this.green.cup;
    this.fall += h;
    b.drop = 0.5 * G * this.fall * this.fall;
    b.x += b.vx * h;
    b.z += b.vz * h;
    if (b.drop >= CUP_DROP) {
      this.events.push({ type: 'cup', speed: this.speed });
      b.x = cup.x;
      b.z = cup.z;
      b.vx = b.vz = 0;
      return this.finish('holed');
    }
    const dx = b.x - cup.x;
    const dz = b.z - cup.z;
    const d = Math.hypot(dx, dz);
    if (d <= CUP_R) return;
    // 반대편 가장자리에 걸렸다. 많이 떨어졌을수록 세게 걸려 느려지고 꺾인다
    const k = b.drop / CUP_DROP;
    const nx = dx / d;
    const nz = dz / d;
    const vn = b.vx * nx + b.vz * nz;
    if (vn > 0) {
      b.vx -= nx * vn * LIP_DAMP * k;
      b.vz -= nz * vn * LIP_DAMP * k;
    }
    const keep = 1 - 0.3 * k;
    b.vx *= keep;
    b.vz *= keep;
    // 컵 가장자리 밖으로 내보내 곧바로 다시 걸리지 않게 한다
    b.x = cup.x + nx * (CUP_R + 1e-4);
    b.z = cup.z + nz * (CUP_R + 1e-4);
    b.drop = 0;
    this.overCup = false;
    this.events.push({ type: 'lip', speed: this.speed, depth: k });
    if (this.speed < STOP_SPEED) {
      // 가장자리에 걸려 멈추면 결국 떨어진다
      b.x = cup.x;
      b.z = cup.z;
      this.events.push({ type: 'cup', speed: 0 });
      this.finish('holed');
    }
  }

  /** 장애물에 부딪친 것을 처리한다. 움직이는 것을 먼저, 고정된 벽을 나중에 보아 공이 코스 밖으로 밀려나지 않게 한다 */
  collide() {
    const b = this.ball;
    const green = this.green;
    const reach = BALL_R;
    for (const box of green.moversAt(this.time)) {
      const c = boxContact(box, b.x, b.z);
      const hit = bounce(b, c.cx, c.cz, reach, box.vx, box.vz, c.inside);
      if (hit > 0.02) this.events.push({ type: 'wall', speed: hit, kind: box.kind });
    }
    for (const box of green.staticBoxes) {
      const c = boxContact(box, b.x, b.z);
      const hit = bounce(b, c.cx, c.cz, reach, 0, 0, c.inside);
      if (hit > 0.02) this.events.push({ type: 'wall', speed: hit, kind: 'block' });
    }
    for (const p of green.posts) {
      const hit = bounce(b, p.x, p.z, reach + p.r);
      if (hit > 0.02) this.events.push({ type: 'wall', speed: hit, kind: 'post' });
    }
    for (const s of green.segments) {
      const c = segmentPoint(s, b.x, b.z);
      const hit = bounce(b, c.x, c.z, reach + WALL_HALF);
      if (hit > 0.02) this.events.push({ type: 'wall', speed: hit, kind: 'wall' });
    }
  }

  finish(result) {
    const b = this.ball;
    this.moving = false;
    this.result = result;
    if (result !== 'holed') b.drop = 0;
    if (result === 'stopped') {
      b.vx = b.vz = 0;
      this.events.push({ type: 'stop', x: b.x, z: b.z });
    }
  }

  /** 쌓인 사건을 꺼내고 비운다 */
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }
}

/** green 의 (x, z) 에서 시각 time 에 shot 을 쳐 끝까지 굴린 결과 */
export function simulate(green, from, shot, time = 0, options = {}) {
  return new Putt(green, from, time).strike(shot).run(options);
}
