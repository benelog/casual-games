// 주차 단계. 길이 단위는 미터, 좌표와 방향은 physics.js 와 같다 (x 오른쪽, z 아래쪽, heading 0 이 +z).
// 단계마다 출발 자리(start), 목표 칸(spot), 장애물(주차된 차·기둥·벽·연석·콘), 바닥에 칠한 선(lines)을 둔다.
// 바깥 경계(bounds)에는 벽이 저절로 둘린다.
//
// 칸(spot): { x, z, heading, width, length, bothWays } — heading 은 다 세웠을 때 차 앞이 향할 방향이다.
// bothWays 면 앞뒤 어느 쪽으로 세워도 된다. 기준 기록 par: { time 초, switches 전후진 전환 횟수 } 는 별 계산에 쓴다.
// maxContacts: 이보다 많이 닿으면 실패 (null 이면 닿아도 감점만). 너무 세게 부딪히면 언제나 실패다(game.js).

import { VEHICLES, makeBox } from './physics.js';
import { createRng } from '../../shared/util.js';

const N = Math.PI; // 북쪽 (화면 위, -z)
const S = 0; // 남쪽 (+z)
const E = Math.PI / 2; // 동쪽 (+x)
const W = -Math.PI / 2; // 서쪽 (-x)

export const LINE_WIDTH = 0.12;
const PARKED = ['suv', 'taxi', 'van', 'hatchback-sports']; // 빨간 sedan 은 내 차라 세워 두지 않는다

// ---------- 도우미 ----------

/** (x1, z1) 에서 (x2, z2) 까지 두께 thick 인 벽·연석 사각형 */
function segment(x1, z1, x2, z2, thick) {
  return {
    x: (x1 + x2) / 2,
    z: (z1 + z2) / 2,
    heading: Math.atan2(x2 - x1, z2 - z1),
    length: Math.hypot(x2 - x1, z2 - z1),
    width: thick,
  };
}

/** 축에 나란한 사각형 (x1~x2, z1~z2). 건물처럼 큰 덩어리 */
function block(x1, z1, x2, z2) {
  return { x: (x1 + x2) / 2, z: (z1 + z2) / 2, heading: 0, length: Math.abs(z2 - z1), width: Math.abs(x2 - x1) };
}

/** 첫 칸 가운데 (x, z) 에서 (dx, dz) 씩 옮겨 가며 count 개의 나란한 칸 */
function stalls({ x, z, dx, dz, count, heading, width = 2.5, length = 5 }) {
  return Array.from({ length: count }, (_, i) => ({ x: x + dx * i, z: z + dz * i, heading, width, length }));
}

/**
 * 칸 rect 의 둘레 가운데 sides 에 적은 변을 칠한다. 칸 방향 기준 f 앞쪽 끝, b 뒤쪽 끝, l 왼쪽, r 오른쪽.
 * (차가 +z 를 보면 왼쪽이 +x 다)
 */
function outline(rect, sides) {
  const box = makeBox(rect.x, rect.z, rect.heading, rect.length, rect.width);
  const { u, v, hl, hw } = box;
  const at = (a, b) => ({ x: rect.x + u.x * hl * a + v.x * hw * b, z: rect.z + u.z * hl * a + v.z * hw * b });
  const edges = { f: [at(1, -1), at(1, 1)], b: [at(-1, -1), at(-1, 1)], l: [at(-1, 1), at(1, 1)], r: [at(-1, -1), at(1, -1)] };
  return [...sides].map((side) => {
    const [p, q] = edges[side];
    return { x1: p.x, z1: p.z, x2: q.x, z2: q.z };
  });
}

/** 빈 단계. build 가 칸·장애물을 채운다 */
function level(id, meta, build) {
  const data = { id, indoor: false, maxContacts: null, cars: [], pillars: [], walls: [], curbs: [], cones: [], lines: [], ...meta };
  build(data);
  return data;
}

/**
 * 칸 줄을 칠하고 차를 세운다. target 번째 칸은 목표로, empty 에 적은 칸은 비워 둔다.
 * 세운 차는 칸 안에서 조금씩 비뚤고, 앞뒤 방향도 섞인다 (seed 로 늘 같게).
 */
function fill(data, list, { sides = 'lrf', target = -1, empty = [], models = PARKED, seed = 1, both = true } = {}) {
  const rng = createRng(seed);
  list.forEach((rect, i) => {
    data.lines.push(...outline(rect, sides));
    if (i === target) {
      data.spot = { ...rect, bothWays: data.spot?.bothWays ?? false };
      return;
    }
    if (empty.includes(i)) return;
    const model = models[Math.floor(rng() * models.length)];
    const { length } = VEHICLES[model];
    const room = Math.max(0, (rect.length - length) / 2 - 0.08);
    const along = (rng() * 2 - 1) * room;
    const side = (rng() * 2 - 1) * 0.1;
    const flip = both && rng() < 0.4 ? Math.PI : 0;
    const box = makeBox(rect.x, rect.z, rect.heading, 1, 1);
    data.cars.push({
      model,
      x: rect.x + box.u.x * along + box.v.x * side,
      z: rect.z + box.u.z * along + box.v.z * side,
      heading: rect.heading + flip + (rng() * 2 - 1) * 0.025,
    });
  });
}

// ---------- 단계 ----------

export const LEVELS = [
  // 1. 앞으로 곧장 들어가 서기
  level(
    'first',
    {
      name: { ko: '첫 주차', en: 'First Park' },
      tip: { ko: '앞으로 가서 노란 칸 안에 멈추세요', en: 'Drive ahead and stop inside the yellow bay' },
      bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 13 },
      start: { x: 0, z: 8, heading: N },
      par: { time: 12, switches: 0 },
    },
    (d) => {
      const row = stalls({ x: -5.4, z: -6, dx: 2.7, dz: 0, count: 5, heading: N, width: 2.7, length: 5.2 });
      fill(d, row, { target: 2, empty: [1, 3], seed: 3 });
    },
  ),

  // 2. 길에서 오른쪽 칸으로 꺾어 들어가기
  level(
    'turn-in',
    {
      name: { ko: '꺾어 들어가기', en: 'Turn In' },
      tip: { ko: '칸 앞을 지나며 핸들을 오른쪽으로 크게 돌리세요', en: 'Turn hard right as you pass the bay' },
      bounds: { minX: -9, maxX: 9, minZ: -13, maxZ: 13 },
      start: { x: -3.5, z: 9, heading: N },
      par: { time: 15, switches: 0 },
    },
    (d) => {
      const row = stalls({ x: 3.6, z: -7.8, dx: 0, dz: 2.6, count: 6, heading: E, width: 2.6, length: 5.2 });
      fill(d, row, { target: 2, empty: [4], seed: 5 });
    },
  ),

  // 3. 뒤로 곧장 넣기
  level(
    'back-in',
    {
      name: { ko: '뒤로 넣기', en: 'Back In' },
      tip: { ko: '↓ (또는 R 기어) 로 후진해 칸에 넣으세요', en: 'Reverse (↓ or gear R) into the bay' },
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 9 },
      start: { x: 0, z: -2.5, heading: N },
      par: { time: 14, switches: 0 },
    },
    (d) => {
      const row = stalls({ x: -5.2, z: 6, dx: 2.6, dz: 0, count: 5, heading: N, width: 2.6, length: 5.2 });
      fill(d, row, { sides: 'lrb', target: 2, seed: 7 });
    },
  ),

  // 4. 운전면허 기능시험의 직각(T자) 주차: 칸을 지나쳤다가 후진으로 넣는다
  level(
    'test-t',
    {
      name: { ko: '기능시험: 직각 주차', en: 'Test: T-Parking' },
      tip: {
        ko: '칸을 지나친 뒤 후진하며 핸들을 돌려 넣으세요. 연석에 세 번 닿으면 실격',
        en: 'Pass the bay, then reverse and steer into it. Three curb touches and you fail',
      },
      bounds: { minX: -17, maxX: 17, minZ: -6, maxZ: 11 },
      start: { x: -11, z: 1.5, heading: E },
      spot: { bothWays: false },
      par: { time: 35, switches: 1 },
      maxContacts: 2,
    },
    (d) => {
      const t = 0.3;
      const road = 3.75; // 길 폭의 절반
      const bay = 1.5; // 칸 폭의 절반
      const depth = 5.5;
      d.curbs.push(
        segment(-17, -road - t / 2, 17, -road - t / 2, t),
        segment(-17, road + t / 2, -bay - t, road + t / 2, t),
        segment(bay + t, road + t / 2, 17, road + t / 2, t),
        segment(-bay - t / 2, road, -bay - t / 2, road + depth + t, t),
        segment(bay + t / 2, road, bay + t / 2, road + depth + t, t),
        segment(-bay, road + depth + t / 2, bay, road + depth + t / 2, t),
      );
      fill(d, [{ x: 0, z: road + depth / 2, heading: N, width: bay * 2, length: depth }], { sides: '', target: 0 });
      // 길 가운데 점선
      for (let x = -16; x < 16; x += 3) d.lines.push({ x1: x, z1: 0, x2: x + 1.5, z2: 0, color: 'yellow' });
    },
  ),

  // 5. 운전면허 기능시험의 평행 주차
  level(
    'test-parallel',
    {
      name: { ko: '기능시험: 평행 주차', en: 'Test: Parallel Parking' },
      tip: {
        ko: '칸 앞 차 옆까지 간 뒤, 후진하며 오른쪽 → 왼쪽으로 핸들을 감으세요',
        en: 'Pull past the bay, then reverse turning right, then left',
      },
      bounds: { minX: -17, maxX: 17, minZ: -6, maxZ: 9 },
      start: { x: -11, z: 0.5, heading: E },
      spot: { bothWays: false },
      par: { time: 40, switches: 2 },
      maxContacts: 2,
    },
    (d) => {
      const t = 0.3;
      const road = 3.5;
      const half = 3.5; // 칸 길이의 절반
      const depth = 2.5;
      d.curbs.push(
        segment(-17, -road - t / 2, 17, -road - t / 2, t),
        segment(-17, road + t / 2, -half - t, road + t / 2, t),
        segment(half + t, road + t / 2, 17, road + t / 2, t),
        segment(-half - t / 2, road, -half - t / 2, road + depth + t, t),
        segment(half + t / 2, road, half + t / 2, road + depth + t, t),
        segment(-half, road + depth + t / 2, half, road + depth + t / 2, t),
      );
      fill(d, [{ x: 0, z: road + depth / 2, heading: E, width: depth, length: half * 2 }], { sides: '', target: 0 });
      for (let x = -16; x < 16; x += 3) d.lines.push({ x1: x, z1: 0, x2: x + 1.5, z2: 0, color: 'yellow' });
    },
  ),

  // 6. 사선(45°) 칸에 앞으로 넣기
  level(
    'angled',
    {
      name: { ko: '사선 주차', en: 'Angled Bay' },
      tip: { ko: '비스듬한 칸은 앞으로 넣기 쉽습니다. 일찍 꺾지 마세요', en: 'Angled bays are easy to enter nose first. Do not turn too early' },
      bounds: { minX: -12, maxX: 11, minZ: -15, maxZ: 16 },
      start: { x: -2.5, z: 12, heading: N },
      par: { time: 18, switches: 0 },
    },
    (d) => {
      const pitch = 2.5 / Math.sin(Math.PI / 4);
      const reach = 2.5 * Math.cos(Math.PI / 4); // 칸 깊이의 절반이 옆으로 나가는 거리
      const corner = 1.25 * Math.cos(Math.PI / 4); // 칸 입구 모서리가 길 쪽으로 나오는 거리
      const east = stalls({ x: corner + reach, z: -8.85 - reach, dx: 0, dz: pitch, count: 6, heading: (3 * Math.PI) / 4 });
      fill(d, east, { sides: 'lrf', target: 3, both: false, seed: 11 });
      const west = stalls({ x: -5 - corner - reach, z: -8.85 - reach, dx: 0, dz: pitch, count: 6, heading: (-3 * Math.PI) / 4 });
      fill(d, west, { sides: 'lrf', empty: [2], both: false, seed: 12 });
    },
  ),

  // 7. 양옆이 꽉 찬 좁은 칸
  level(
    'tight',
    {
      name: { ko: '양옆이 꽉 찬 칸', en: 'Squeezed In' },
      tip: { ko: '칸 폭이 좁습니다. 후진으로 넣으면 더 쉽습니다', en: 'A narrow bay. Backing in is easier' },
      bounds: { minX: -12, maxX: 12, minZ: -8.3, maxZ: 8.3 },
      start: { x: -9, z: 0, heading: E },
      spot: { bothWays: true },
      par: { time: 40, switches: 2 },
    },
    (d) => {
      const south = stalls({ x: -7.2, z: 5.5, dx: 2.4, dz: 0, count: 7, heading: N, width: 2.4, length: 5 });
      fill(d, south, { sides: 'lrb', target: 3, seed: 21, models: ['suv', 'van', 'taxi'] });
      const north = stalls({ x: -7.2, z: -5.5, dx: 2.4, dz: 0, count: 7, heading: S, width: 2.4, length: 5 });
      fill(d, north, { sides: 'lrb', seed: 22 });
    },
  ),

  // 8. 좁은 골목을 돌아 차고에 넣기
  level(
    'alley',
    {
      name: { ko: '좁은 골목', en: 'Narrow Alley' },
      tip: { ko: '모퉁이는 바깥쪽에 붙어 크게 도세요', en: 'Keep wide at the corner' },
      bounds: { minX: -8, maxX: 16, minZ: -14.6, maxZ: 15 },
      start: { x: 0, z: 10, heading: N },
      spot: { bothWays: true },
      par: { time: 45, switches: 2 },
    },
    (d) => {
      const half = 2.4; // 골목 폭의 절반
      const north = -4; // 가로 골목의 남쪽 벽
      const width = 5; // 가로 골목 폭
      const bay = { x: 8, w: 2.7 };
      d.walls.push(
        block(-8, -14.6, -half, 15), // 서쪽 건물
        block(-half, -14.6, bay.x - bay.w / 2, north - width), // 북쪽 건물 (차고 왼쪽)
        block(bay.x + bay.w / 2, -14.6, 16, north - width), // 북쪽 건물 (차고 오른쪽)
        block(half, north, 16, 15), // 남동쪽 건물
      );
      const length = 5.2;
      fill(d, [{ x: bay.x, z: north - width - length / 2, heading: N, width: bay.w, length }], { sides: 'f', target: 0 });
    },
  ),

  // 9. 기둥이 있는 지하주차장
  level(
    'underground',
    {
      name: { ko: '지하주차장', en: 'Underground' },
      tip: { ko: '기둥은 칸 입구 모서리에 있습니다. 차 옆구리를 조심하세요', en: 'Pillars stand at the bay corners. Mind your sides' },
      bounds: { minX: -14, maxX: 14, minZ: -8.6, maxZ: 8.6 },
      indoor: true,
      start: { x: -10, z: 0, heading: E },
      spot: { bothWays: true },
      par: { time: 40, switches: 2 },
    },
    (d) => {
      const aisle = 3.25;
      const xs = [-10.8, -8.3, -5.8, -2.5, 0, 2.5, 5.8, 8.3, 10.8];
      const south = xs.map((x) => ({ x, z: aisle + 2.5, heading: N, width: 2.5, length: 5 }));
      const north = xs.map((x) => ({ x, z: -aisle - 2.5, heading: S, width: 2.5, length: 5 }));
      fill(d, south, { sides: 'lrb', target: 5, empty: [7], seed: 31 });
      fill(d, north, { sides: 'lrb', empty: [1], seed: 32 });
      for (const x of [-4.15, 4.15]) {
        for (const z of [aisle + 0.45, -aisle - 0.45]) d.pillars.push({ x, z, size: 0.8 });
      }
    },
  ),

  // 10. 도로변 평행 주차: 앞뒤 차 사이
  level(
    'street',
    {
      name: { ko: '도로변 평행 주차', en: 'Curbside' },
      tip: { ko: '앞차와 나란히 선 뒤 후진을 시작하세요', en: 'Line up beside the car ahead, then start reversing' },
      bounds: { minX: -16, maxX: 16, minZ: -7, maxZ: 8 },
      start: { x: -10, z: 0.3, heading: E },
      spot: { bothWays: false },
      par: { time: 45, switches: 3 },
    },
    (d) => {
      const t = 0.3;
      const lane = { near: 3, far: 5.3 }; // 주차 차로 (z)
      d.curbs.push(segment(-16, lane.far + t / 2, 16, lane.far + t / 2, t), segment(-16, -4.15, 16, -4.15, t));
      const z = (lane.near + lane.far) / 2;
      const length = 6.4;
      d.spot = { x: 0, z, heading: E, width: lane.far - lane.near, length, bothWays: false };
      d.lines.push(...outline(d.spot, 'fb'), { x1: -16, z1: lane.near, x2: 16, z2: lane.near });
      d.cars.push(
        { model: 'taxi', x: -length / 2 - 0.2 - VEHICLES.taxi.length / 2, z, heading: E },
        { model: 'van', x: length / 2 + 0.2 + VEHICLES.van.length / 2, z, heading: E },
        { model: 'suv', x: -12.5, z, heading: E },
        { model: 'hatchback-sports', x: 12.6, z, heading: E },
      );
      for (let x = -15; x < 15; x += 3) d.lines.push({ x1: x, z1: -0.6, x2: x + 1.5, z2: -0.6, color: 'yellow' });
    },
  ),

  // 11. 일방통행 길 왼쪽에 평행 주차
  level(
    'left-parallel',
    {
      name: { ko: '왼쪽 평행 주차', en: 'Left-Side Parallel' },
      tip: { ko: '이번엔 왼쪽입니다. 핸들 방향도 반대로', en: 'This time on the left. Steer the other way' },
      bounds: { minX: -16, maxX: 16, minZ: -8, maxZ: 6 },
      start: { x: -10, z: 0, heading: E },
      spot: { bothWays: false },
      par: { time: 50, switches: 3 },
    },
    (d) => {
      const t = 0.3;
      const lane = { near: -2.6, far: -4.8 };
      d.curbs.push(segment(-16, lane.far - t / 2, 16, lane.far - t / 2, t), segment(-16, 3.35, 16, 3.35, t));
      const z = (lane.near + lane.far) / 2;
      const length = 6.2;
      d.spot = { x: 1, z, heading: E, width: lane.near - lane.far, length, bothWays: false };
      d.lines.push({ x1: -16, z1: lane.near, x2: 16, z2: lane.near });
      d.cars.push(
        { model: 'suv', x: 1 - length / 2 - 0.2 - VEHICLES.suv.length / 2, z, heading: E },
        { model: 'hatchback-sports', x: 1 + length / 2 + 0.2 + VEHICLES['hatchback-sports'].length / 2, z, heading: E },
        { model: 'van', x: -12.6, z, heading: E },
        { model: 'taxi', x: 13.2, z, heading: E },
      );
      d.cones.push({ x: -6, z: 2.6 }, { x: 7, z: 2.6 });
    },
  ),

  // 12. 막다른 골목: 칸을 지나 끝까지 간 뒤 후진으로
  level(
    'dead-end',
    {
      name: { ko: '막다른 골목', en: 'Dead End' },
      tip: { ko: '차 앞이 골목 쪽을 보게 후진으로 넣어야 합니다', en: 'Back in so the nose faces the lane' },
      bounds: { minX: -9, maxX: 6, minZ: -12, maxZ: 13 },
      start: { x: 0, z: 9, heading: N },
      spot: { bothWays: false },
      par: { time: 50, switches: 3 },
    },
    (d) => {
      const half = 2.9; // 골목 폭의 절반
      const bay = { z: -5, w: 2.6, length: 5.2 };
      d.walls.push(
        block(half, -12, 6, 13), // 동쪽 건물
        block(-9, bay.z + bay.w / 2, -half, 13), // 서쪽 건물 (칸 남쪽)
        block(-9, -12, -half, bay.z - bay.w / 2), // 서쪽 건물 (칸 북쪽)
      );
      d.spot = { x: -half - bay.length / 2, z: bay.z, heading: E, width: bay.w, length: bay.length, bothWays: false };
      d.lines.push(...outline(d.spot, 'b'));
      d.cones.push({ x: 2.2, z: -11.4 }, { x: -2.2, z: -11.4 });
    },
  ),

  // 13. 지하 2층: 기둥과 승합차 사이의 좁은 칸
  level(
    'pillar-tight',
    {
      name: { ko: '기둥 옆 좁은 칸', en: 'Pillar Squeeze' },
      tip: { ko: '통로가 좁습니다. 여러 번 나눠 넣어도 괜찮아요', en: 'A narrow aisle. Take it in several moves' },
      bounds: { minX: -15, maxX: 13, minZ: -8.1, maxZ: 8.1 },
      indoor: true,
      start: { x: 10, z: 0, heading: W },
      spot: { bothWays: true },
      par: { time: 55, switches: 3 },
    },
    (d) => {
      const aisle = 2.85;
      const xs = [-11.5, -9.1, -6.7, -3.3, -0.9, 1.5, 4.9, 7.3, 9.7];
      const south = xs.map((x) => ({ x, z: aisle + 2.5, heading: N, width: 2.4, length: 5 }));
      const north = xs.map((x) => ({ x, z: -aisle - 2.5, heading: S, width: 2.4, length: 5 }));
      fill(d, south, { sides: 'lrb', target: 3, seed: 41, models: ['van', 'suv', 'taxi'] });
      fill(d, north, { sides: 'lrb', seed: 42 });
      for (const x of [-5, 3.2, 11.4]) {
        for (const z of [aisle + 0.45, -aisle - 0.45]) d.pillars.push({ x, z, size: 0.8 });
      }
    },
  ),

  // 14. 만차 지하주차장: 줄 끝을 돌아 건너편 통로의 빈칸으로
  level(
    'full',
    {
      name: { ko: '만차', en: 'Full House' },
      tip: { ko: '줄 끝을 돌아 건너편 통로의 빈칸을 찾으세요', en: 'Round the end of the row to find the free bay' },
      bounds: { minX: -17, maxX: 15, minZ: -16.3, maxZ: 16.3 },
      indoor: true,
      start: { x: 9, z: -8, heading: W },
      spot: { bothWays: true },
      par: { time: 70, switches: 3 },
    },
    (d) => {
      const aisle = 3; // 통로 폭의 절반
      const lanes = [-8, 8]; // 통로 두 개의 가운데 (z). 그 사이에 등을 맞댄 두 줄, 바깥 벽 쪽에 한 줄씩
      const xs = [-9.6, -7.2, -4.8, -1.6, 0.8, 3.2, 6.4, 8.8, 11.2];
      const make = (z, heading) => xs.map((x) => ({ x, z, heading, width: 2.4, length: 5 }));
      fill(d, make(lanes[0] - aisle - 2.5, S), { sides: 'lrb', seed: 51 });
      fill(d, make(lanes[0] + aisle + 2.5, N), { sides: 'lrb', seed: 52 });
      fill(d, make(lanes[1] - aisle - 2.5, S), { sides: 'lrb', seed: 53 });
      fill(d, make(lanes[1] + aisle + 2.5, N), { sides: 'lrb', target: 5, seed: 54, models: ['van', 'suv'] });
      // 가운데 두 줄 사이의 낮은 벽과 칸 무리 사이의 기둥
      d.walls.push(segment(-10.9, 0, 12.5, 0, 0.3));
      for (const x of [-3.2, 4.8]) {
        for (const lane of lanes) {
          for (const side of [-1, 1]) d.pillars.push({ x, z: lane + side * (aisle + 0.45), size: 0.8 });
        }
      }
    },
  ),
];

/**
 * 단계의 모든 장애물을 { kind, box, ... } 목록으로. 바깥 경계에는 벽을 두른다.
 * kind: car | pillar | wall | curb | cone
 */
export function buildObstacles(data) {
  const list = [];
  for (const car of data.cars) {
    const { length, width } = VEHICLES[car.model];
    list.push({ kind: 'car', model: car.model, box: makeBox(car.x, car.z, car.heading, length, width) });
  }
  for (const p of data.pillars) list.push({ kind: 'pillar', box: makeBox(p.x, p.z, 0, p.size, p.size) });
  for (const w of data.walls) list.push({ kind: 'wall', box: makeBox(w.x, w.z, w.heading, w.length, w.width) });
  for (const c of data.curbs) list.push({ kind: 'curb', box: makeBox(c.x, c.z, c.heading, c.length, c.width) });
  for (const c of data.cones) list.push({ kind: 'cone', box: makeBox(c.x, c.z, 0, 0.45, 0.45) });
  const { minX, maxX, minZ, maxZ } = data.bounds;
  const t = 1;
  for (const w of [
    block(minX - t, minZ - t, maxX + t, minZ),
    block(minX - t, maxZ, maxX + t, maxZ + t),
    block(minX - t, minZ, minX, maxZ),
    block(maxX, minZ, maxX + t, maxZ),
  ]) {
    list.push({ kind: 'boundary', box: makeBox(w.x, w.z, w.heading, w.length, w.width) });
  }
  return list;
}

/** id → 단계 위치 */
export const levelIndex = (id) => LEVELS.findIndex((l) => l.id === id);
