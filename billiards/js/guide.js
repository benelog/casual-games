// 조준 보조선. 순수 계산이라 node 에서 그대로 테스트한다.
//
// 짧게(short): 수구가 똑바로 굴러 처음 닿는 곳(공이면 그 자리에 '고스트 볼', 쿠션이면 닿는 점)까지 선을 긋고,
//              맞은 공이 갈 방향과 수구가 꺾여 나갈 방향(회전 없을 때)을 짧게 보여 준다.
// 길게(long):  물리 엔진으로 지금 세기·회전 그대로 쳐 보고 수구가 지나갈 길을 보여 준다.
//              캐롬은 두 번째 공에 닿을 때까지, 포켓볼은 처음 맞힌 뒤 조금 더. 맞은 공의 길은 짧게만.

import { Simulation } from './physics.js';

/** 반지름 R 인 공이 c 에서 방향 d 로 갈 때 점 p 를 중심으로 하는 반지름 r 원에 닿는 거리 (없으면 Infinity) */
function rayCircle(cx, cy, dx, dy, px, py, r) {
  const ox = px - cx;
  const oy = py - cy;
  const proj = ox * dx + oy * dy;
  const perp2 = ox * ox + oy * oy - proj * proj;
  if (perp2 > r * r) return Infinity;
  const t = proj - Math.sqrt(r * r - perp2);
  return t >= -1e-9 ? Math.max(0, t) : Infinity;
}

/**
 * 수구 cueId 가 각도 angle 로 똑바로 갈 때 처음 닿는 것.
 * { kind: 'ball' | 'cushion', dist, x, y(닿을 때 수구 중심), ball, nx, ny(쿠션에서 공 쪽 법선) } 또는 null
 */
export function firstContact(table, balls, cueId, angle) {
  const R = table.ballRadius;
  const cue = balls[cueId];
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = { dist: Infinity };
  for (const b of balls) {
    if (!b.on || b.id === cueId) continue;
    const t = rayCircle(cue.x, cue.y, dx, dy, b.x, b.y, 2 * R);
    if (t < best.dist) best = { kind: 'ball', dist: t, ball: b.id };
  }
  for (const s of table.segments) {
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const len = Math.hypot(ex, ey);
    // 선분의 몸통: 법선을 공 쪽으로 돌려 R 만큼 떨어진 평행선과 만나는 점
    let nx = -ey / len;
    let ny = ex / len;
    let s0 = (cue.x - s.ax) * nx + (cue.y - s.ay) * ny;
    if (s0 < 0) {
      nx = -nx;
      ny = -ny;
      s0 = -s0;
    }
    const approach = -(dx * nx + dy * ny);
    if (approach > 1e-9) {
      const t = (s0 - R) / approach;
      if (t >= -1e-9 && t < best.dist) {
        const hx = cue.x + dx * t - nx * R;
        const hy = cue.y + dy * t - ny * R;
        const k = ((hx - s.ax) * ex + (hy - s.ay) * ey) / (len * len);
        if (k >= 0 && k <= 1) best = { kind: 'cushion', dist: Math.max(0, t), nx, ny };
      }
    }
    // 선분 끝(포켓 턱 끝)
    for (const [px, py] of [
      [s.ax, s.ay],
      [s.bx, s.by],
    ]) {
      const t = rayCircle(cue.x, cue.y, dx, dy, px, py, R);
      if (t < best.dist) {
        const hx = cue.x + dx * t;
        const hy = cue.y + dy * t;
        const d = Math.hypot(hx - px, hy - py) || 1;
        best = { kind: 'cushion', dist: t, nx: (hx - px) / d, ny: (hy - py) / d };
      }
    }
  }
  if (!Number.isFinite(best.dist)) return null;
  best.x = cue.x + dx * best.dist;
  best.y = cue.y + dy * best.dist;
  return best;
}

/** 짧은 보조선 { lines: [{ kind, points }], ghost } */
export function shortGuide(table, balls, cueId, angle, { length = 0.28 } = {}) {
  const R = table.ballRadius;
  const cue = balls[cueId];
  const contact = firstContact(table, balls, cueId, angle);
  if (!contact) return { lines: [], ghost: null };
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const lines = [{ kind: 'cue', points: [[cue.x, cue.y], [contact.x, contact.y]] }];
  if (contact.kind === 'ball') {
    const b = balls[contact.ball];
    const nx = (b.x - contact.x) / (2 * R);
    const ny = (b.y - contact.y) / (2 * R);
    const along = dx * nx + dy * ny; // 두께: 1 이면 정면
    lines.push({ kind: 'object', points: [[b.x, b.y], [b.x + nx * length * (0.4 + along), b.y + ny * length * (0.4 + along)]] });
    // 수구는 맞은 공과 직각으로 갈라진다 (회전이 없을 때)
    const tx = dx - along * nx;
    const ty = dy - along * ny;
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-3) {
      lines.push({ kind: 'deflect', points: [[contact.x, contact.y], [contact.x + (tx / tl) * length * tl, contact.y + (ty / tl) * length * tl]] });
    }
    return { lines, ghost: { x: contact.x, y: contact.y }, contact };
  }
  // 쿠션: 거울처럼 반사한 방향
  const dot = dx * contact.nx + dy * contact.ny;
  const rx = dx - 2 * dot * contact.nx;
  const ry = dy - 2 * dot * contact.ny;
  lines.push({ kind: 'deflect', points: [[contact.x, contact.y], [contact.x + rx * length, contact.y + ry * length]] });
  return { lines, ghost: { x: contact.x, y: contact.y }, contact };
}

/**
 * 물리로 쳐 본 긴 보조선. options:
 *   balls: 수구가 이만큼의 서로 다른 공에 닿으면 멈춘다
 *   after: 처음 공에 닿은 뒤 수구 길을 이만큼(m)만 더 그린다
 *   length: 수구 길의 최대 길이, objectLength: 처음 맞은 공의 길 길이
 */
export function longGuide(table, balls, cueId, shot, { balls: stopBalls = 2, after = Infinity, length = 6, objectLength = 0.35 } = {}) {
  const sim = new Simulation(table, balls);
  sim.strike(cueId, shot);
  const cue = sim.balls[cueId];
  const path = [[cue.x, cue.y]];
  const touched = new Set();
  let total = 0;
  let afterFirst = 0;
  let ghost = null;
  let object = null;
  let objectBall = null;
  let objectTotal = 0;
  let seen = sim.events.length;
  const push = (list, x, y) => {
    const [px, py] = list[list.length - 1];
    const d = Math.hypot(x - px, y - py);
    list.push([x, y]);
    return d;
  };
  let cueDone = false; // 수구 길은 다 그렸고 맞은 공의 길만 더 그리는 중
  let doneAt = Infinity;
  while (!sim.done && sim.time < 20) {
    sim.step();
    for (; seen < sim.events.length; seen++) {
      const e = sim.events[seen];
      if (cueDone) continue;
      if (e.type === 'cushion' && e.ball === cueId) {
        // 꺾이는 자리를 정확히 남긴다
        const d = push(path, cue.x, cue.y);
        total += d;
        if (ghost) afterFirst += d;
      } else if (e.type === 'hit' && (e.a === cueId || e.b === cueId)) {
        const other = e.a === cueId ? e.b : e.a;
        if (!ghost) {
          ghost = { x: cue.x, y: cue.y };
          objectBall = sim.balls[other];
          object = [[objectBall.x, objectBall.y]];
        }
        touched.add(other);
        total += push(path, cue.x, cue.y);
        if (touched.size >= stopBalls) cueDone = true;
      } else if (e.type === 'pocket' && e.ball === cueId) {
        push(path, e.x, e.y);
        cueDone = true;
      }
    }
    if (!cueDone) {
      const [lx, ly] = path[path.length - 1];
      const step = Math.hypot(cue.x - lx, cue.y - ly);
      if (step > 0.012) {
        push(path, cue.x, cue.y);
        total += step;
        if (ghost) afterFirst += step;
      }
      if (total > length || afterFirst > after) cueDone = true;
    }
    if (object && objectTotal < objectLength && objectBall.on) {
      const [ox, oy] = object[object.length - 1];
      const d = Math.hypot(objectBall.x - ox, objectBall.y - oy);
      if (d > 0.012) {
        object.push([objectBall.x, objectBall.y]);
        objectTotal += d;
      }
    }
    if (cueDone && doneAt === Infinity) doneAt = sim.time;
    // 맞은 공이 느리게 굴러 길이 짧으면 오래 기다리지 않는다
    if (cueDone && (!object || objectTotal >= objectLength || !objectBall.on || sim.time - doneAt > 0.6)) break;
  }
  if (!cueDone && cue.on) push(path, cue.x, cue.y);
  const lines = [{ kind: 'cue', points: path }];
  if (object && object.length > 1) lines.push({ kind: 'object', points: object });
  return { lines, ghost };
}
