import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLES, HOLE_COUNT, COURSE_PAR } from '../js/course.js';
import { Green, simulate, speedOfPower, BALL_R, CUP_R, DECEL, SLOPE_K } from '../js/physics.js';
import { maxStrokes } from '../js/game.js';

const greens = HOLES.map((hole) => new Green(hole));

/** 두 선분이 끝점이 아닌 곳에서 엇갈리는지 */
function crosses([a, b], [c, d]) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

test('9홀, 파는 2~5, 코스 파는 홀 파의 합', () => {
  assert.equal(HOLE_COUNT, 9);
  for (const hole of HOLES) assert.ok(Number.isInteger(hole.par) && hole.par >= 2 && hole.par <= 5);
  assert.equal(
    COURSE_PAR,
    HOLES.reduce((s, h) => s + h.par, 0),
  );
  // 뒤로 갈수록 파가 줄지 않는다 (어려워진다)
  for (let i = 1; i < HOLES.length; i++) assert.ok(HOLES[i].par >= HOLES[i - 1].par, `${i + 1}번 홀`);
});

test('홀마다 티와 컵이 있고 코스 안의 칠 수 있는 자리에 있다', () => {
  greens.forEach((green, i) => {
    const name = `${i + 1}번 홀`;
    const { tee, cup } = HOLES[i];
    assert.ok(Array.isArray(tee) && tee.length === 2, name);
    assert.ok(Array.isArray(cup) && cup.length === 2, name);
    assert.ok(green.playable(green.tee.x, green.tee.z), `${name} 티`);
    assert.ok(green.inside(green.cup.x, green.cup.z), `${name} 컵`);
    assert.ok(green.wallClearance(green.cup.x, green.cup.z) > CUP_R + BALL_R, `${name} 컵이 벽에 붙지 않는다`);
    assert.ok(!green.inWater(green.cup.x, green.cup.z) && !green.inSand(green.cup.x, green.cup.z), `${name} 컵`);
    assert.ok(!green.inSand(green.tee.x, green.tee.z), `${name} 티`);
    assert.ok(Math.hypot(green.tee.x - green.cup.x, green.tee.z - green.cup.z) > 3, `${name} 티와 컵 거리`);
    // 컵 둘레는 공이 멈춰 있을 만큼 평평하다
    for (let a = 0; a < 8; a++) {
      const x = green.cup.x + Math.cos(a) * CUP_R * 2;
      const z = green.cup.z + Math.sin(a) * CUP_R * 2;
      const { gx, gz } = green.slopeAt(x, z);
      assert.ok(SLOPE_K * Math.hypot(gx, gz) < DECEL, `${name} 컵 둘레 기울기`);
    }
  });
});

test('테두리는 스스로 엇갈리지 않는 다각형이고, 티·컵은 움직이는 장애물의 길 밖에 있다', () => {
  greens.forEach((green, i) => {
    const name = `${i + 1}번 홀`;
    const pts = green.outline;
    assert.ok(pts.length >= 3, name);
    const edges = pts.map((p, k) => [p, pts[(k + 1) % pts.length]]);
    for (const [a, b] of edges) assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.1, name);
    for (let a = 0; a < edges.length; a++) {
      for (let b = a + 1; b < edges.length; b++) assert.ok(!crosses(edges[a], edges[b]), `${name} 변 ${a}·${b}`);
    }
    for (const p of [green.tee, green.cup]) {
      const spot = green.clearSpot(p.x, p.z);
      assert.equal(spot.moved, false, name);
    }
  });
});

test('지형·장애물·영역 데이터가 올바르다', () => {
  for (const [i, hole] of HOLES.entries()) {
    const name = `${i + 1}번 홀`;
    for (const f of hole.terrain ?? []) {
      assert.ok(['hill', 'ramp', 'tilt'].includes(f.type), name);
      if (f.type === 'hill') assert.ok(f.r > 0, name);
      if (f.type === 'ramp') assert.ok(f.from !== f.to && ['x', 'z'].includes(f.axis), name);
    }
    for (const block of hole.blocks ?? []) {
      assert.ok(block.w > 0 && block.d > 0, name);
      if (block.move) assert.ok(block.move.period > 0 && block.move.amp > 0 && ['x', 'z'].includes(block.move.axis), name);
    }
    for (const mill of hole.windmills ?? []) assert.ok(mill.period > 0 && mill.gap > 4 * BALL_R && mill.width > mill.gap, name);
    for (const region of [...(hole.sand ?? []), ...(hole.water ?? [])]) assert.ok(region.rect?.length === 4 || region.circle?.length >= 3, name);
    for (const post of hole.posts ?? []) assert.equal(post.length, 3, name);
  }
});

test('뒤로 갈수록 경사·모래·물·움직이는 장애물이 섞인다', () => {
  const has = (key) => HOLES.findIndex((h) => (h[key] ?? []).length > 0);
  assert.ok(has('terrain') > 0);
  assert.ok(has('sand') > 0);
  assert.ok(has('water') > has('sand'));
  assert.ok(HOLES.some((h) => (h.blocks ?? []).some((b) => b.move)));
  assert.ok(has('windmills') > has('water'));
  // 마지막 홀은 여러 요소를 함께 쓴다
  const last = HOLES.at(-1);
  assert.ok(last.blocks.length >= 2 && last.water.length > 0 && last.terrain.length > 0);
});

/** 홀을 잘 아는 사람처럼: 가능한 샷을 물리로 쳐 보고 (컵까지 가장 가까이 가는) 가장 좋은 것을 고른다. 빨리 돌도록 간격을 키운다 */
function greedyRound(green, hole) {
  const max = maxStrokes(hole.par);
  let pos = { ...green.tee };
  let time = 0;
  for (let strokes = 1; strokes <= max; strokes++) {
    let best = null;
    for (let a = 0; a < 48; a++) {
      for (let p = 1; p <= 8; p++) {
        const shot = { angle: (a / 48) * 2 * Math.PI, speed: speedOfPower((p / 8) ** 1.5) };
        const putt = simulate(green, pos, shot, time, { step: 1 / 240 });
        const score = putt.result === 'holed' ? -1 : putt.result === 'water' ? 1e3 : Math.hypot(putt.ball.x - green.cup.x, putt.ball.z - green.cup.z);
        if (!best || score < best.score) best = { score, putt };
      }
    }
    if (best.putt.result === 'holed') return strokes;
    const spot = green.clearSpot(best.putt.ball.x, best.putt.ball.z);
    pos = { x: spot.x, z: spot.z };
    time = best.putt.time + 2;
  }
  return null;
}

test('홀마다 파 안에 넣는 길이 있다 (물리로 쳐 보기)', () => {
  greens.forEach((green, i) => {
    const strokes = greedyRound(green, HOLES[i]);
    assert.ok(strokes !== null && strokes <= HOLES[i].par, `${i + 1}번 홀: ${strokes}`);
  });
});
