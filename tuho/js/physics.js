// 투호 화살의 움직임. Three.js 없이 계산하는 순수 로직이라 node 에서 그대로 테스트한다.
//
// 좌표: 길이 단위는 미터. 원점은 항아리 바닥 한가운데(땅 위), y 는 위(+), z 는 던지는 사람 쪽(+),
// x 는 던지는 사람이 항아리를 볼 때 오른쪽(+)이다.
//
// 항아리는 놋쇠 벽의 중심선(세로 단면의 꺾은선)을 y 축 둘레로 돌린 회전체이고, 벽은 두께 WALL 만큼 두툼하다.
// 그래서 바깥 몸통, 목 안쪽, 나팔처럼 벌어진 입 테두리, 안쪽 바닥이 모두 같은 거리 함수 하나로 계산된다.
// 양옆의 귀(耳)는 목에 붙은 작은 통으로, 같은 방식으로 각자의 축 둘레로 돌린다.
//
// 화살은 길쭉한 막대(굵기가 있는 선분)인 강체다. 무게 중심은 촉 쪽으로 치우쳐 있고, 꽁무니의 깃이 바람개비처럼
// 화살을 날아가는 방향으로 돌려세운다. 항아리·땅에 닿으면 닿은 점에서 반발과 마찰 충격을 함께 계산해
// 회전이 붙으므로, 테두리에 맞고 튕겨 나가거나 목에 비스듬히 걸리거나 미끄러져 들어간다.

export const G = 9.81;
export const STEP = 1 / 1200; // 물리 한 걸음 (초)

// ---------- 항아리 ----------

export const WALL = 0.008; // 놋쇠 벽 두께
export const HALF_WALL = WALL / 2;

/** 항아리 벽 중심선 [축에서 거리 h, 높이 y]. 바닥 가운데에서 시작해 굽·몸통·목을 지나 벌어진 입까지 */
export const POT_PROFILE = [
  [0, HALF_WALL],
  [0.095, HALF_WALL],
  [0.1, 0.02], // 굽
  [0.118, 0.04],
  [0.145, 0.08],
  [0.162, 0.13],
  [0.165, 0.18], // 몸통이 가장 불룩한 곳
  [0.158, 0.23],
  [0.138, 0.28],
  [0.108, 0.32],
  [0.078, 0.35],
  [0.062, 0.38],
  [0.056, 0.41], // 목
  [0.055, 0.47],
  [0.056, 0.52],
  [0.062, 0.55], // 입 (나팔처럼 벌어진다)
  [0.072, 0.57],
];
export const MOUTH_Y = 0.57; // 입 테두리 높이 (벽 중심선 끝)
export const MOUTH_INNER = 0.055 - HALF_WALL; // 목의 가장 좁은 안쪽 반지름
export const NECK_BOTTOM = 0.41; // 이보다 깊이 촉이 들어가야 '입' (위면 목에 걸친 것)

export const EAR_R = 0.03; // 귀 통 벽 중심선 반지름
export const EAR_INNER = EAR_R - HALF_WALL;
export const EAR_X = 0.06 + HALF_WALL + EAR_R; // 귀 통의 축 (목 바깥에 딱 붙는다)
export const EAR_BOTTOM = 0.4;
export const EAR_TOP = 0.5;
export const EAR_PROFILE = [
  [0, EAR_BOTTOM],
  [EAR_R, EAR_BOTTOM],
  [EAR_R, EAR_TOP],
];

// ---------- 화살 ----------

export const ARROW_LENGTH = 0.85;
export const ARROW_TIP = 0.37; // 무게 중심에서 촉까지 (촉 쪽이 무겁다)
export const ARROW_TAIL = ARROW_LENGTH - ARROW_TIP; // 무게 중심에서 꽁무니까지
export const ARROW_RADIUS = 0.005;
// 질량 1 당 관성 모멘트 (길이에 수직인 축). 고른 막대 + 무게 중심이 가운데에서 벗어난 만큼
const INERTIA = (ARROW_LENGTH * ARROW_LENGTH) / 12 + (ARROW_LENGTH / 2 - ARROW_TIP) ** 2;
const ALIGN = 20; // 깃이 화살을 날아가는 방향으로 돌려세우는 세기
const ALIGN_DAMP = 7; // 그 흔들림을 가라앉히는 세기

const MATERIALS = {
  pot: { e: 0.25, mu: 0.22 }, // 놋쇠
  ground: { e: 0.18, mu: 0.6 }, // 흙 마당·멍석
};
const BOUNCE_MIN = 0.4; // 이보다 느리게 부딪히면 튀지 않고 붙는다
const LOUD = 0.25; // 이보다 세게 부딪혀야 소리 사건을 낸다
const SAMPLES = 33; // 항아리와 가까운지 볼 때 화살을 나누는 점 수
const SPACING = ARROW_LENGTH / (SAMPLES - 1);
const STILL_SPEED = 0.04;
const STILL_SPIN = 0.6;
const STILL_TIME = 0.3; // 이만큼 가만히 있으면 멈춘 것으로 본다
const TIMEOUT = 5; // 이만큼 지나도 멈추지 않으면 그 자리에서 판정한다
const FREEZE = 10; // 이만큼 지나면 더 계산하지 않는다

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** 꺾은선의 선분마다 미리 계산해 둔 값 */
function segments(profile) {
  const list = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [h0, y0] = profile[i];
    const [h1, y1] = profile[i + 1];
    const eh = h1 - h0;
    const ey = y1 - y0;
    list.push({ h0, y0, eh, ey, len2: eh * eh + ey * ey });
  }
  return list;
}

/**
 * 부딪힐 수 있는 회전체. cx·cz 는 회전축, reach·top 은 이보다 멀면 거리 계산을 건너뛰는 테두리.
 * kind 는 항아리 몸통('pot') 인지 귀('ear') 인지
 */
export const SHAPES = [
  { id: 'pot', cx: 0, cz: 0, segs: segments(POT_PROFILE), reach: 0.18, top: MOUTH_Y + HALF_WALL },
  { id: 'earLeft', cx: -EAR_X, cz: 0, segs: segments(EAR_PROFILE), reach: EAR_R + 0.01, top: EAR_TOP + HALF_WALL, bottom: EAR_BOTTOM - 0.02 },
  { id: 'earRight', cx: EAR_X, cz: 0, segs: segments(EAR_PROFILE), reach: EAR_R + 0.01, top: EAR_TOP + HALF_WALL, bottom: EAR_BOTTOM - 0.02 },
];

const FAR = 1; // 테두리 밖의 점에 돌려주는 '먼' 거리

/**
 * 점에서 벽 겉면까지의 거리(겹쳤으면 음수). normal 을 주면 벽에서 점 쪽으로 향하는 단위 법선을 채운다.
 * 테두리 밖이면 계산하지 않고 FAR 이상을 돌려준다.
 */
export function shapeDistance(shape, px, py, pz, normal = null) {
  const dx = px - shape.cx;
  const dz = pz - shape.cz;
  const h = Math.hypot(dx, dz);
  if (!normal && (h > shape.reach + 0.03 || py > shape.top + 0.03 || py < (shape.bottom ?? -1))) return FAR;
  let best = Infinity;
  let bh = 0;
  let by = 0;
  for (const s of shape.segs) {
    const k = clamp(((h - s.h0) * s.eh + (py - s.y0) * s.ey) / s.len2, 0, 1);
    const oh = h - (s.h0 + s.eh * k);
    const oy = py - (s.y0 + s.ey * k);
    const d2 = oh * oh + oy * oy;
    if (d2 < best) {
      best = d2;
      bh = oh;
      by = oy;
    }
  }
  const dist = Math.sqrt(best);
  if (normal) {
    const inv = dist > 1e-9 ? 1 / dist : 0;
    const ux = h > 1e-9 ? dx / h : 1;
    const uz = h > 1e-9 ? dz / h : 0;
    normal.x = bh * inv * ux;
    normal.y = dist > 1e-9 ? by * inv : 1;
    normal.z = bh * inv * uz;
  }
  return dist - HALF_WALL;
}

/** 높이 y 에서 항아리 벽 중심선의 반지름 (몸통·목). 항아리 높이 밖이면 0 */
export function potRadiusAt(y) {
  for (let i = 1; i < POT_PROFILE.length - 1; i++) {
    const [h0, y0] = POT_PROFILE[i];
    const [h1, y1] = POT_PROFILE[i + 1];
    if (y >= y0 && y <= y1) return h0 + ((h1 - h0) * (y - y0)) / (y1 - y0);
  }
  return y > 0 && y < POT_PROFILE[1][1] + 0.02 ? POT_PROFILE[1][0] : 0;
}

// ---------- 던지기 ----------

export const RELEASE_X = 0.2; // 오른손으로 던지므로 몸 가운데보다 이만큼 오른쪽에서 놓는다
export const RELEASE_Y = 1.15; // 화살을 놓는 높이
export const RELEASE_FORWARD = 0.3; // 던지는 줄에서 이만큼 앞에서 놓는다 (팔을 뻗은 만큼)
export const ENTRY = (64 * Math.PI) / 180; // 알맞은 세기로 던졌을 때 입으로 내리꽂히는 각도
export const AIM_Y = MOUTH_Y; // 세기 50% 로 던지면 무게 중심이 입 높이에서 지나는 곳
// 깃이 화살을 돌려세우는 데 조금 늦어 화살은 날아가는 방향보다 촉을 든 채 내려온다. 그만큼 촉이 앞서므로
// 무게 중심은 입 가운데보다 조금 앞(던지는 사람 쪽)을 지나게 해야 촉이 가운데로 들어간다
export const AIM_Z = 0.045;

/** 던지는 줄이 항아리에서 distance 만큼 떨어져 있을 때 화살을 놓는 점 */
export function releasePoint(distance) {
  return { x: RELEASE_X, y: RELEASE_Y, z: distance - RELEASE_FORWARD };
}

/** 수평 거리 d, 높이 차 h 인 곳에 ENTRY 각도로 내려꽂히게 하는 발사각. tan(들어가는 각) = tan(발사각) - 2h/d */
export function launchElevation(d, h) {
  return Math.atan(Math.tan(ENTRY) + (2 * h) / d);
}

/** 높이 차 h, 수평 거리 d 인 곳에 발사각 elevation 으로 던져 닿게 하는 속력. 닿을 수 없으면 NaN */
export function idealSpeed(d, h, elevation = launchElevation(d, h)) {
  const c = Math.cos(elevation);
  const lift = d * Math.tan(elevation) - h;
  if (lift <= 0) return NaN;
  return Math.sqrt((G * d * d) / (2 * c * c * lift));
}

export const SWIPE_FULL = 0.45; // 화면 높이의 이만큼 끌어올리면 세기 100%
export const SWIPE_MIN = 0.06; // 이보다 짧게 끌면 던지지 않는다
export const YAW_GAIN = 0.15; // 끈 방향의 기울기 → 좌우 방향
export const YAW_LIMIT = 0.12;
export const SPEED_LOW = 0.94; // 세기 0% 일 때 알맞은 속력의 배수
export const SPEED_SPAN = 0.12; // 세기 0% → 100% 동안 더하는 배수 (50% 가 딱 알맞다)

/**
 * 스와이프(누른 곳 → 뗀 곳, 화면 픽셀)를 세기·방향으로 바꾼다. 위로 충분히 끌지 않았으면 null.
 * height 는 화면 높이(px). power 는 0~1, yaw 는 라디안(+ 오른쪽).
 */
export function swipeToShot(dx, dy, height) {
  const up = -dy;
  if (!(height > 0) || up < SWIPE_MIN * height) return null;
  return {
    power: clamp(up / (SWIPE_FULL * height), 0, 1),
    yaw: clamp(Math.atan2(dx, up) * YAW_GAIN, -YAW_LIMIT, YAW_LIMIT),
  };
}

// ---------- 손 흔들림 ----------
//
// 화살을 든 손은 늘 조금씩 흔들리고, 놓는 순간의 흔들림만큼 방향과 세기가 어긋난다. 누른 채(키보드는 Space 를
// 누른 채) 잠깐 기다리면 차분해지고, 너무 오래 버티면 팔이 지쳐 다시 흔들린다. 흔들림은 느린 사인파의 합이라
// 잘 보면 가운데로 오는 순간을 노릴 수 있다. 줄이 멀수록 더 크게 흔들린다.

export const SWAY_YAW = 0.02; // 흔들림 1 일 때 방향 (라디안)
export const SWAY_POWER = 0.08; // 흔들림 1 일 때 세기
const SWAY_STEADY = 0.3; // 가장 차분할 때
const SWAY_SETTLE = 1.2; // 차분해질 때까지 (초)
const SWAY_TIRE = 5; // 이때부터 지친다 (초)
const SWAY_TIRE_RATE = 0.15; // 지친 뒤 초당 늘어나는 폭
const SWAY_MAX = 1.4;

const smoothstep = (k) => k * k * (3 - 2 * k);

/** 흔들림 폭(1 이 보통). held 는 누르고 기다린 시간(초), 누르지 않았으면 null. distance 는 줄까지 거리 */
export function swayAmplitude(held, distance = 3) {
  const far = distance / 3;
  if (held === null) return far;
  if (held < SWAY_SETTLE) return far * (SWAY_STEADY + (1 - SWAY_STEADY) * (1 - smoothstep(held / SWAY_SETTLE)));
  if (held < SWAY_TIRE) return far * SWAY_STEADY;
  return far * Math.min(SWAY_MAX, SWAY_STEADY + (held - SWAY_TIRE) * SWAY_TIRE_RATE);
}

/** 시각 t(초)의 흔들림 방향. 폭 1 기준이고 swayAmplitude 를 곱해 쓴다. x 는 좌우, y 는 세기 */
export function swayOffset(t) {
  return {
    x: 0.6 * Math.sin(t * 1.4) + 0.4 * Math.sin(t * 3.1 + 1.1),
    y: 0.6 * Math.sin(t * 1.9 + 0.5) + 0.4 * Math.sin(t * 2.7),
  };
}

/** 겨눈 shot 에 흔들림 sway({ x, y } 에 폭을 곱한 것)를 더한다. 촉도 세기가 어긋난 만큼 들리거나 숙여진다 */
export function applySway(shot, sway) {
  return {
    power: clamp(shot.power + sway.y * SWAY_POWER, 0, 1),
    yaw: clamp(shot.yaw + sway.x * SWAY_YAW, -YAW_LIMIT, YAW_LIMIT),
    pitch: sway.y * 0.05,
  };
}

/**
 * 줄에서 distance 떨어져 던질 때의 발사각, 세기 50% 의 속력, 입 가운데를 향하는 수평 방향
 * (heading: -z 에서 오른쪽(+x)으로 돈 각도. yaw 는 여기에 더한다)
 */
export function baseline(distance) {
  const from = releasePoint(distance);
  const dx = -from.x;
  const dz = AIM_Z - from.z;
  const d = Math.hypot(dx, dz);
  const h = AIM_Y - from.y;
  const elevation = launchElevation(d, h);
  return { from, elevation, speed: idealSpeed(d, h, elevation), heading: Math.atan2(dx, -dz) };
}

/**
 * 던지는 줄 distance 에서 세기 power(0~1)·방향 yaw 로 던진 화살의 처음 상태.
 * pitch 는 화살이 날아가는 방향보다 촉을 더 든(+) 각도 (손이 흔들린 만큼).
 */
export function launch(distance, { power, yaw = 0, pitch = 0 }) {
  const { from, elevation, speed: ideal, heading: base } = baseline(distance);
  const speed = ideal * (SPEED_LOW + SPEED_SPAN * clamp(power, 0, 1));
  const heading = base + yaw;
  const h = speed * Math.cos(elevation);
  const v = { x: h * Math.sin(heading), y: speed * Math.sin(elevation), z: -h * Math.cos(heading) };
  const tilt = elevation + pitch;
  const u = { x: Math.cos(tilt) * Math.sin(heading), y: Math.sin(tilt), z: -Math.cos(tilt) * Math.cos(heading) };
  return makeArrow(from, v, u);
}

/** 화살의 무게 중심이 point 를 지나게 하는 { power, yaw } (컴퓨터의 겨냥, 테스트용). 세기는 0~1 을 넘을 수 있다 */
export function aimFor(distance, point) {
  const { from, elevation, speed, heading } = baseline(distance);
  const dx = point.x - from.x;
  const dz = point.z - from.z;
  const need = idealSpeed(Math.hypot(dx, dz), point.y - from.y, elevation);
  return { power: (need / speed - SPEED_LOW) / SPEED_SPAN, yaw: Math.atan2(dx, -dz) - heading };
}

/** 겨눌 곳: 입 가운데, 왼쪽·오른쪽 귀 가운데 */
export const TARGETS = {
  mouth: { x: 0, y: AIM_Y, z: AIM_Z },
  earLeft: { x: -EAR_X, y: EAR_TOP, z: AIM_Z },
  earRight: { x: EAR_X, y: EAR_TOP, z: AIM_Z },
};

let nextId = 1;

/**
 * 화살 하나. p: 무게 중심, v: 속도, u: 촉 쪽 단위 방향, w: 각속도.
 * result 가 정해지기 전(null)까지 판정하고, 정해진 뒤에도 멈출 때까지 움직인다.
 */
export function makeArrow(p, v = { x: 0, y: 0, z: 0 }, u = { x: 0, y: 1, z: 0 }, w = { x: 0, y: 0, z: 0 }) {
  const len = Math.hypot(u.x, u.y, u.z) || 1;
  return {
    id: nextId++,
    x: p.x,
    y: p.y,
    z: p.z,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    ux: u.x / len,
    uy: u.y / len,
    uz: u.z / len,
    wx: w.x,
    wy: w.y,
    wz: w.z,
    time: 0,
    still: 0,
    resting: false,
    result: null,
    touchedPot: false,
    entered: null, // 촉이 입이나 귀 안으로 처음 들어간 구멍
    lastHit: -1,
  };
}

/** 화살 위의 점 (무게 중심에서 촉 쪽으로 s) */
export function arrowPoint(a, s) {
  return { x: a.x + a.ux * s, y: a.y + a.uy * s, z: a.z + a.uz * s };
}

export const tipOf = (a) => arrowPoint(a, ARROW_TIP);
export const tailOf = (a) => arrowPoint(a, -ARROW_TAIL);

/**
 * 촉이 어느 구멍 안에 있는지. 'mouth' | 'ear' | 'lean'(입이나 귀에 얕게 걸쳤다) | null.
 * 입은 촉이 목 아래 몸통까지 들어가야 '입', 목에 머물면 비스듬히 걸친 것이다.
 */
export function holeOf(point) {
  const { x, y, z } = point;
  const h = Math.hypot(x, z);
  if (y < MOUTH_Y && y > 0 && h < potRadiusAt(y) - HALF_WALL) return y < NECK_BOTTOM ? 'mouth' : 'lean';
  for (const side of [-1, 1]) {
    const he = Math.hypot(x - side * EAR_X, z);
    if (he < EAR_INNER && y > EAR_BOTTOM && y < EAR_TOP) return y < EAR_TOP - 0.03 ? 'ear' : 'lean';
  }
  return null;
}

/** 멈춘 화살의 결과: 'mouth' | 'ear' | 'lean' | 'miss' */
export function judge(a) {
  return holeOf(tipOf(a)) ?? 'miss';
}

/** 화살이 들어간 것으로 치는 결과 */
export const isIn = (result) => result === 'mouth' || result === 'ear';

// ---------- 충돌 ----------

const scratch = { x: 0, y: 0, z: 0 };

/** 화살을 따라 s 에서 shape 겉면까지의 거리 */
function gapAt(a, shape, s, normal = null) {
  return shapeDistance(shape, a.x + a.ux * s, a.y + a.uy * s, a.z + a.uz * s, normal) - ARROW_RADIUS;
}

/** 화살과 shape 의 닿은 점들 [{ s, n, depth }]. 화살을 나눈 점에서 거리가 작아지는 곳마다 촘촘히 찾아 들어간다 */
function shapeContacts(a, shape, out) {
  const gaps = new Array(SAMPLES);
  let any = false;
  for (let i = 0; i < SAMPLES; i++) {
    gaps[i] = gapAt(a, shape, -ARROW_TAIL + i * SPACING);
    if (gaps[i] < SPACING) any = true;
  }
  if (!any) return;
  let found = 0;
  let lastS = -Infinity;
  for (let i = 0; i < SAMPLES && found < 3; i++) {
    const g = gaps[i];
    if (g > SPACING * 0.5) continue;
    if ((i > 0 && gaps[i - 1] < g) || (i < SAMPLES - 1 && gaps[i + 1] < g)) continue;
    // 양옆 점 사이에서 황금 분할로 가장 가까운 곳을 찾는다
    let lo = -ARROW_TAIL + Math.max(0, i - 1) * SPACING;
    let hi = -ARROW_TAIL + Math.min(SAMPLES - 1, i + 1) * SPACING;
    const r = 0.381966;
    let m1 = lo + (hi - lo) * r;
    let m2 = hi - (hi - lo) * r;
    let g1 = gapAt(a, shape, m1);
    let g2 = gapAt(a, shape, m2);
    for (let k = 0; k < 12; k++) {
      if (g1 < g2) {
        hi = m2;
        m2 = m1;
        g2 = g1;
        m1 = lo + (hi - lo) * r;
        g1 = gapAt(a, shape, m1);
      } else {
        lo = m1;
        m1 = m2;
        g1 = g2;
        m2 = hi - (hi - lo) * r;
        g2 = gapAt(a, shape, m2);
      }
    }
    let s = g1 < g2 ? m1 : m2;
    // 양 끝은 직접 본다 (촉·꽁무니가 닿은 경우)
    if (i === 0 && gaps[0] <= Math.min(g1, g2)) s = -ARROW_TAIL;
    if (i === SAMPLES - 1 && gaps[i] <= Math.min(g1, g2)) s = ARROW_TIP;
    const n = { x: 0, y: 0, z: 0 };
    const gap = gapAt(a, shape, s, n);
    if (gap >= 0 || Math.abs(s - lastS) < 0.04) continue;
    lastS = s;
    out.push({ s, n, depth: -gap, kind: 'pot', shape: shape.id });
    found++;
  }
}

/** 땅과 닿은 점들: 촉과 꽁무니 */
function groundContacts(a, out) {
  for (const s of [ARROW_TIP, -ARROW_TAIL]) {
    const y = a.y + a.uy * s;
    if (y < ARROW_RADIUS) out.push({ s, n: { x: 0, y: 1, z: 0 }, depth: ARROW_RADIUS - y, kind: 'ground' });
  }
}

/**
 * 닿은 점 하나에 충격을 준다. restitution 이 거짓이면 튀지 않게만 한다.
 * 부딪힌 세기(법선 방향 속력)를 돌려준다
 */
function applyContact(a, c, restitution) {
  const { n, s } = c;
  const mat = MATERIALS[c.kind];
  const rx = a.ux * s;
  const ry = a.uy * s;
  const rz = a.uz * s;
  // 닿은 점의 속도 = v + ω × r
  const cx = a.vx + (a.wy * rz - a.wz * ry);
  const cy = a.vy + (a.wz * rx - a.wx * rz);
  const cz = a.vz + (a.wx * ry - a.wy * rx);
  const vn = cx * n.x + cy * n.y + cz * n.z;
  if (vn >= 0) return 0;
  const e = restitution && -vn > BOUNCE_MIN ? mat.e : 0;
  // 법선 방향 유효 질량: 1/m + |r × n|² / I
  const rnx = ry * n.z - rz * n.y;
  const rny = rz * n.x - rx * n.z;
  const rnz = rx * n.y - ry * n.x;
  const jn = (-(1 + e) * vn) / (1 + (rnx * rnx + rny * rny + rnz * rnz) / INERTIA);
  // 접선 방향: 미끄러짐을 멈출 만큼, 최대 μ·jn
  let tx = cx - vn * n.x;
  let ty = cy - vn * n.y;
  let tz = cz - vn * n.z;
  const slip = Math.hypot(tx, ty, tz);
  let jt = 0;
  if (slip > 1e-9) {
    tx /= slip;
    ty /= slip;
    tz /= slip;
    const rtx = ry * tz - rz * ty;
    const rty = rz * tx - rx * tz;
    const rtz = rx * ty - ry * tx;
    jt = Math.min(slip / (1 + (rtx * rtx + rty * rty + rtz * rtz) / INERTIA), mat.mu * jn);
  }
  const jx = n.x * jn - tx * jt;
  const jy = n.y * jn - ty * jt;
  const jz = n.z * jn - tz * jt;
  a.vx += jx;
  a.vy += jy;
  a.vz += jz;
  // ω += (r × J) / I
  a.wx += (ry * jz - rz * jy) / INERTIA;
  a.wy += (rz * jx - rx * jz) / INERTIA;
  a.wz += (rx * jy - ry * jx) / INERTIA;
  return -vn;
}

// ---------- 세계 ----------

/**
 * 마당의 화살들과 항아리. step(dt) 로 움직이고, 일어난 일은 events 에 쌓는다:
 *   { type: 'pot', arrow, speed, shape }  항아리에 부딪힘 (소리를 낼 만큼 셀 때)
 *   { type: 'ground', arrow, speed }  땅에 떨어짐
 *   { type: 'enter', arrow, hole }  촉이 입('mouth')이나 귀('ear') 안으로 처음 들어감
 *   { type: 'result', arrow, result }  판정: 'mouth' | 'ear' | 'lean' | 'miss'
 */
export class Yard {
  constructor() {
    this.arrows = [];
    this.events = [];
    this.carry = 0;
  }

  add(arrow) {
    this.arrows.push(arrow);
    return arrow;
  }

  remove(arrow) {
    this.arrows = this.arrows.filter((a) => a !== arrow);
  }

  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** 실제 시간 dt 만큼 진행한다 (작은 걸음으로 나눠서) */
  step(dt) {
    this.carry += dt;
    while (this.carry >= STEP) {
      this.carry -= STEP;
      for (const arrow of this.arrows) if (!arrow.resting) this.stepArrow(arrow, STEP);
    }
  }

  stepArrow(a, dt) {
    a.time += dt;
    // 깃이 화살을 날아가는 방향으로 돌려세운다: α = ALIGN·|v|·(u × v) - ALIGN_DAMP·|v|·ω
    const speed = Math.hypot(a.vx, a.vy, a.vz);
    if (speed > 1e-6) {
      const ax = a.uy * a.vz - a.uz * a.vy;
      const ay = a.uz * a.vx - a.ux * a.vz;
      const az = a.ux * a.vy - a.uy * a.vx;
      const k = ALIGN * speed * dt;
      const damp = Math.exp(-ALIGN_DAMP * speed * dt);
      a.wx = a.wx * damp + ax * k;
      a.wy = a.wy * damp + ay * k;
      a.wz = a.wz * damp + az * k;
    }
    a.vy -= G * dt;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.z += a.vz * dt;
    this.rotate(a, dt);

    // 충돌: 항아리 가까이 올 때만 자세히 본다
    const contacts = [];
    groundContacts(a, contacts);
    const near = Math.hypot(a.x, a.z) < 0.2 + ARROW_TAIL + 0.03 && a.y < MOUTH_Y + ARROW_TAIL + 0.03;
    if (near) for (const shape of SHAPES) shapeContacts(a, shape, contacts);
    if (contacts.length) this.resolve(a, contacts);

    // 촉이 구멍 안으로 들어갔는지
    if (!a.entered) {
      const tip = tipOf(a);
      if (tip.y < MOUTH_Y - 0.02 && holeOf(tip)) {
        // 귀 안쪽은 목 바깥(축에서 EAR_X - EAR_INNER 너머)에 있다
        a.entered = Math.hypot(tip.x, tip.z) < EAR_X - EAR_INNER ? 'mouth' : 'ear';
        this.events.push({ type: 'enter', arrow: a, hole: a.entered });
      }
    }

    // 멈췄는지
    const spin = Math.hypot(a.wx, a.wy, a.wz);
    const moving = Math.hypot(a.vx, a.vy, a.vz);
    a.still = moving < STILL_SPEED && spin < STILL_SPIN ? a.still + dt : 0;
    if (a.still > STILL_TIME || a.time > FREEZE) {
      a.resting = true;
      a.vx = a.vy = a.vz = a.wx = a.wy = a.wz = 0;
    }
    if (!a.result && (a.resting || a.time > TIMEOUT)) this.settle(a, judge(a));
  }

  /** 각속도만큼 방향을 돌린다. 길이 방향 축을 도는 회전은 버린다 (가는 막대라 모양이 같다) */
  rotate(a, dt) {
    const ax = a.wy * a.uz - a.wz * a.uy;
    const ay = a.wz * a.ux - a.wx * a.uz;
    const az = a.wx * a.uy - a.wy * a.ux;
    a.ux += ax * dt;
    a.uy += ay * dt;
    a.uz += az * dt;
    const len = Math.hypot(a.ux, a.uy, a.uz);
    a.ux /= len;
    a.uy /= len;
    a.uz /= len;
    const along = a.wx * a.ux + a.wy * a.uy + a.wz * a.uz;
    a.wx -= along * a.ux;
    a.wy -= along * a.uy;
    a.wz -= along * a.uz;
  }

  resolve(a, contacts) {
    // 처음 한 번은 반발까지, 그 뒤로는 서로 밀어 들어가지 않게만 몇 번 더 맞춘다
    for (let pass = 0; pass < 3; pass++) {
      for (const c of contacts) {
        const speed = applyContact(a, c, pass === 0);
        if (pass > 0 || speed <= 0) continue;
        if (c.kind === 'pot') {
          if (speed > 0.05) a.touchedPot = true;
          if (speed > LOUD && a.time - a.lastHit > 0.06) {
            a.lastHit = a.time;
            this.events.push({ type: 'pot', arrow: a, speed, shape: c.shape });
          }
        } else {
          if (speed > LOUD && a.time - a.lastHit > 0.06) {
            a.lastHit = a.time;
            this.events.push({ type: 'ground', arrow: a, speed });
          }
          // 구멍에 들지 않은 채 땅에 닿으면 빗나간 것이다
          if (!a.result && !holeOf(tipOf(a))) this.settle(a, 'miss');
        }
      }
    }
    // 겹친 만큼 밀어낸다
    for (const c of contacts) {
      a.x += c.n.x * c.depth * 0.8;
      a.y += c.n.y * c.depth * 0.8;
      a.z += c.n.z * c.depth * 0.8;
    }
    const along = a.wx * a.ux + a.wy * a.uy + a.wz * a.uz;
    a.wx -= along * a.ux;
    a.wy -= along * a.uy;
    a.wz -= along * a.uz;
  }

  settle(a, result) {
    a.result = result;
    this.events.push({ type: 'result', arrow: a, result });
  }
}

/**
 * 화살 하나를 결과가 날 때까지(또는 limit 초) 날려 본다. 테스트·컴퓨터·디버그용.
 * 결과와 그동안의 사건을 돌려준다. rest 면 결과가 난 뒤에도 멈출 때까지 계속한다.
 */
export function simulate(arrow, { limit = 8, rest = false } = {}) {
  const yard = new Yard();
  yard.add(arrow);
  const events = [];
  let t = 0;
  while (t < limit) {
    yard.step(1 / 60);
    t += 1 / 60;
    events.push(...yard.drain());
    if (arrow.result && (!rest || arrow.resting)) break;
  }
  return { result: arrow.result, events, arrow };
}
