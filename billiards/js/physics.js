// 당구공 물리. 당구대 평면 위의 2D 운동에 회전(3축)을 더한 순수 계산이라 node 에서 그대로 테스트한다.
// 실제 경기 화면과 컴퓨터의 수 읽기, 조준 보조선이 모두 이 엔진을 같은 고정 간격(DT)으로 돌리므로
// 같은 공 배치에 같은 샷을 치면 언제나 같은 결과가 나온다.
//
// 공 하나: 위치 (x, y), 속도 (vx, vy), 각속도 (wx, wy, wz). z 축은 위쪽이다.
// - 미끄러짐: 공이 천에 닿은 점이 미끄러지는 동안(밀어치기·끌어치기 직후) 큰 마찰이 속도와 회전을 함께 바꾼다.
//   닿은 점의 속도 u = v + w × (0, 0, -R) 이 0 이 되면 구르기로 넘어간다.
// - 구르기: 작은 구름 저항으로 천천히 느려진다.
// - 옆 회전(wz)은 천 위에서 조금씩 줄고, 쿠션에 닿을 때 마찰로 반사각을 바꾼다.
// - 공끼리: 같은 질량의 반탄성 충돌에 닿은 면의 마찰(스로)을 더한다.
// - 쿠션: 쿠션 코가 공 중심보다 조금 높아(공 지름의 63.5%) 반발할 때 구르는 방향의 회전도 바뀐다.
// 충돌은 겹친 것을 알아챈 뒤 정확히 닿은 시각까지 되돌려 처리하므로 간격이 커도 각도가 정확하다.

import { G } from './table.js';

export const DT = 1 / 1000; // 고정 간격(초)
export const MAX_TIP = 0.5; // 큐 끝이 공 중심에서 벗어날 수 있는 최대 거리 (반지름 비율)
export const MAX_TIME = 45; // 한 번 친 샷을 이 시간 넘게 돌리지 않는다

const V_STOP = 0.005; // 이보다 느리고 미끄러지지 않으면 멈춘 것으로 본다 (m/s)
const SLIP_EPS = 0.002;
const NOSE_SIN = 0.27; // 쿠션 코의 높이: 공 중심에서 반지름의 0.27 배 위
const NOSE_COS = Math.sqrt(1 - NOSE_SIN * NOSE_SIN);
const OUT_MARGIN = 0.25; // 대 밖으로 이만큼 나간 공은 가장 가까운 포켓에 빠진 것으로 친다

/** 공 배치를 복사한다. [{ id, x, y, on }] — id 는 배열 번호와 같다 */
export function cloneBalls(balls) {
  return balls.map(({ id, x, y, on }) => ({ id, x, y, on }));
}

export class Simulation {
  /**
   * table: table.js 의 당구대, balls: [{ id, x, y, on }] (on 이 false 면 대 위에 없다)
   */
  constructor(table, balls, { dt = DT } = {}) {
    this.table = table;
    this.R = table.ballRadius;
    this.dt = dt;
    this.balls = balls.map((b, i) => {
      if (b.id !== i) throw new Error('공 번호는 배열 순서와 같아야 합니다');
      return { id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, on: b.on !== false, moving: false };
    });
    this.events = []; // { t, type: 'hit' | 'cushion' | 'pocket' | 'strike', ... }
    this.time = 0;
    this.acc = 0;
    this.done = true;
  }

  /**
   * 공 id 를 친다. shot = { angle(라디안), speed(m/s), side, vert }.
   * side·vert 는 -1 ~ 1 로 큐 끝이 닿는 자리 (오른쪽·위가 +). 둘을 합친 거리는 1 을 넘지 않게 줄인다.
   */
  strike(id, { angle, speed, side = 0, vert = 0 }) {
    const ball = this.balls[id];
    const R = this.R;
    const reach = Math.hypot(side, vert);
    const k = reach > 1 ? 1 / reach : 1;
    const a = side * k * MAX_TIP; // 반지름 비율
    const b = vert * k * MAX_TIP;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    ball.vx = speed * dx;
    ball.vy = speed * dy;
    // 각충격량 r × J 를 관성 모멘트 (2/5)mR² 로 나눈다. 오른쪽을 치면 위에서 보아 반시계(wz > 0),
    // 위를 치면 앞으로 구르는 회전 (b = 0.4 에서 바로 구른다)
    const w = (5 * speed) / (2 * R);
    ball.wz = w * a;
    ball.wx = -w * b * dy;
    ball.wy = w * b * dx;
    ball.moving = true;
    this.done = false;
    this.events.push({ t: this.time, type: 'strike', ball: id, speed });
  }

  /** 실제 시간 seconds 만큼 고정 간격으로 나아간다. 이번에 생긴 사건을 돌려준다 */
  advance(seconds) {
    const from = this.events.length;
    this.acc += seconds;
    let steps = 0;
    while (this.acc >= this.dt && !this.done && steps < 5000) {
      this.step();
      this.acc -= this.dt;
      steps++;
    }
    if (this.done) this.acc = 0;
    return this.events.slice(from);
  }

  /** 끝날 때까지(또는 until(sim) 이 참일 때까지) 돌린다 */
  run({ until = null, maxTime = MAX_TIME } = {}) {
    let seen = this.events.length;
    while (!this.done && this.time < maxTime) {
      this.step();
      if (until && this.events.length !== seen) {
        seen = this.events.length;
        if (until(this)) return this;
      }
    }
    if (!this.done) this.stopAll();
    return this;
  }

  stopAll() {
    for (const b of this.balls) {
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      b.moving = false;
    }
    this.done = true;
  }

  step() {
    const { dt, balls } = this;
    for (const ball of balls) {
      if (ball.on && ball.moving) this.integrate(ball, dt);
    }
    this.collideBalls();
    this.collideCushions();
    if (this.table.pockets.length) this.checkPockets();
    this.time += dt;
    let moving = false;
    for (const ball of balls) {
      if (!ball.on || !ball.moving) continue;
      const slip = Math.hypot(ball.vx - this.R * ball.wy, ball.vy + this.R * ball.wx);
      if (Math.hypot(ball.vx, ball.vy) < V_STOP && slip < V_STOP * 2) {
        ball.vx = ball.vy = ball.wx = ball.wy = ball.wz = 0;
        ball.moving = false;
      } else moving = true;
    }
    this.done = !moving;
  }

  /** 천과의 마찰로 속도·회전을 바꾸고 움직인다 */
  integrate(ball, dt) {
    const R = this.R;
    const cloth = this.table.cloth;
    let rest = dt;
    const ux = ball.vx - R * ball.wy;
    const uy = ball.vy + R * ball.wx;
    const us = Math.hypot(ux, uy);
    if (us > SLIP_EPS) {
      // 미끄러지는 동안 닿은 점의 속도는 일정한 방향으로 3.5·μg 씩 줄어든다
      const a = cloth.slide * G;
      const tau = Math.min(dt, us / (3.5 * a));
      const ex = ux / us;
      const ey = uy / us;
      ball.vx -= a * ex * tau;
      ball.vy -= a * ey * tau;
      const k = ((2.5 * a) / R) * tau;
      ball.wx -= k * ey;
      ball.wy += k * ex;
      rest = dt - tau;
      if (rest > 0) {
        ball.wx = -ball.vy / R;
        ball.wy = ball.vx / R;
      }
    }
    if (rest > 0) {
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > 0) {
        const next = Math.max(0, speed - cloth.roll * G * rest);
        ball.vx *= next / speed;
        ball.vy *= next / speed;
      }
      ball.wx = -ball.vy / R;
      ball.wy = ball.vx / R;
    }
    if (ball.wz) {
      const dec = ((2.5 * cloth.spin * G) / R) * dt;
      ball.wz = Math.abs(ball.wz) <= dec ? 0 : ball.wz - Math.sign(ball.wz) * dec;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  }

  collideBalls() {
    const { balls, R, dt } = this;
    const D = 2 * R;
    const D2 = D * D;
    for (let i = 0; i < balls.length; i++) {
      const p = balls[i];
      if (!p.on) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const q = balls[j];
        if (!q.on || !(p.moving || q.moving)) continue;
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        if (dx > D || dx < -D || dy > D || dy < -D) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= D2) continue;
        const dvx = q.vx - p.vx;
        const dvy = q.vy - p.vy;
        const closing = dx * dvx + dy * dvy;
        if (closing >= 0) continue; // 이미 멀어지는 중
        // 정확히 닿은 시각까지 되돌린다: |dp - dv·τ| = 2R
        const a = dvx * dvx + dvy * dvy;
        const b = -2 * closing;
        const c = d2 - D2;
        let tau = a > 0 ? (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a) : 0;
        if (!(tau >= 0)) tau = 0;
        if (tau > dt) tau = dt;
        p.x -= p.vx * tau;
        p.y -= p.vy * tau;
        q.x -= q.vx * tau;
        q.y -= q.vy * tau;
        dx = q.x - p.x;
        dy = q.y - p.y;
        const dist = Math.hypot(dx, dy) || D;
        const speed = this.resolveBalls(p, q, dx / dist, dy / dist);
        p.x += p.vx * tau;
        p.y += p.vy * tau;
        q.x += q.vx * tau;
        q.y += q.vy * tau;
        this.events.push({ t: this.time, type: 'hit', a: p.id, b: q.id, speed });
      }
    }
  }

  /** 공 p 와 q 의 충돌. n 은 p 에서 q 쪽. 부딪친 속도를 돌려준다 */
  resolveBalls(p, q, nx, ny) {
    const { R } = this;
    const cloth = this.table.cloth;
    const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
    const jn = (-(1 + cloth.ball) * vn) / 2;
    p.vx -= jn * nx;
    p.vy -= jn * ny;
    q.vx += jn * nx;
    q.vy += jn * ny;

    // 닿은 점끼리 미끄러지는 속도(p 기준). p 의 닿은 점은 R·n, q 의 닿은 점은 -R·n
    const rx = R * nx;
    const ry = R * ny;
    // w × r (r 은 수평)
    const spx = p.vx + -p.wz * ry;
    const spy = p.vy + p.wz * rx;
    const spz = p.wx * ry - p.wy * rx;
    const sqx = q.vx + q.wz * ry;
    const sqy = q.vy - q.wz * rx;
    const sqz = -(q.wx * ry - q.wy * rx);
    let sx = spx - sqx;
    let sy = spy - sqy;
    const sz = spz - sqz;
    const sn = sx * nx + sy * ny;
    sx -= sn * nx;
    sy -= sn * ny;
    const s = Math.hypot(sx, sy, sz);
    if (s > 1e-6) {
      const jt = Math.min(s / 7, cloth.ballFriction * jn);
      const ex = sx / s;
      const ey = sy / s;
      const ez = sz / s;
      const k = (2.5 / (R * R)) * jt;
      // p 에는 -jt·e, q 에는 +jt·e. Δw = (5/2R²) r × J
      p.vx -= jt * ex;
      p.vy -= jt * ey;
      q.vx += jt * ex;
      q.vy += jt * ey;
      // r_p × e = R (ny·ez, -nx·ez, nx·ey - ny·ex)
      const cx = ry * ez;
      const cy = -rx * ez;
      const cz = rx * ey - ry * ex;
      p.wx -= k * cx;
      p.wy -= k * cy;
      p.wz -= k * cz;
      // r_q = -r_p, J_q = +jt·e → 같은 방향 변화
      q.wx -= k * cx;
      q.wy -= k * cy;
      q.wz -= k * cz;
    }
    p.moving = q.moving = true;
    this.done = false;
    return -vn;
  }

  collideCushions() {
    const { balls, R, dt } = this;
    const segments = this.table.segments;
    for (const ball of balls) {
      if (!ball.on || !ball.moving) continue;
      for (let s = 0; s < segments.length; s++) {
        const seg = segments[s];
        const ex = seg.bx - seg.ax;
        const ey = seg.by - seg.ay;
        const len2 = ex * ex + ey * ey;
        let k = ((ball.x - seg.ax) * ex + (ball.y - seg.ay) * ey) / len2;
        k = k < 0 ? 0 : k > 1 ? 1 : k;
        const qx = seg.ax + ex * k;
        const qy = seg.ay + ey * k;
        let nx = ball.x - qx;
        let ny = ball.y - qy;
        const dist = Math.hypot(nx, ny);
        if (dist >= R || dist === 0) continue;
        nx /= dist;
        ny /= dist;
        const vn = ball.vx * nx + ball.vy * ny;
        if (vn >= 0) {
          // 겹쳤지만 멀어지는 중: 밀어내기만 한다
          ball.x = qx + nx * R;
          ball.y = qy + ny * R;
          continue;
        }
        const tau = Math.min(dt, (R - dist) / -vn);
        ball.x -= ball.vx * tau;
        ball.y -= ball.vy * tau;
        this.resolveCushion(ball, nx, ny);
        ball.x += ball.vx * tau;
        ball.y += ball.vy * tau;
        this.events.push({ t: this.time, type: 'cushion', ball: ball.id, speed: -vn, rail: seg.rail ?? seg.chain, segment: s });
      }
    }
  }

  /** 쿠션 반발. n 은 쿠션에서 공 쪽(대 안쪽) 수평 방향 */
  resolveCushion(ball, nx, ny) {
    const { R } = this;
    const cloth = this.table.cloth;
    const vn = ball.vx * nx + ball.vy * ny;
    const jn = -(1 + cloth.cushion) * vn;
    ball.vx += jn * nx;
    ball.vy += jn * ny;
    // 쿠션 코가 중심보다 높아 생기는 회전: Δw = (5/2R)·sinθ·Jn·(ẑ × n)
    const kn = (2.5 / R) * NOSE_SIN * jn;
    ball.wx += kn * -ny;
    ball.wy += kn * nx;

    // 닿은 점 r = -R·cosθ·n + R·sinθ·ẑ, 쿠션을 따라가는 방향 t = ẑ × n
    const rx = -R * NOSE_COS * nx;
    const ry = -R * NOSE_COS * ny;
    const rz = R * NOSE_SIN;
    const tx = -ny;
    const ty = nx;
    // 닿은 점의 속도 v + w × r 를 t 에 투영
    const cvx = ball.vx + (ball.wy * rz - ball.wz * ry);
    const cvy = ball.vy + (ball.wz * rx - ball.wx * rz);
    const st = cvx * tx + cvy * ty;
    const limit = cloth.cushionFriction * jn;
    let jt = -st / 3.5;
    if (jt > limit) jt = limit;
    else if (jt < -limit) jt = -limit;
    ball.vx += jt * tx;
    ball.vy += jt * ty;
    // Δw = (5/2R²)·(r × t)·Jt,  r × t = (-rz·ty, rz·tx, rx·ty - ry·tx)
    const k = (2.5 / (R * R)) * jt;
    ball.wx += k * -rz * ty;
    ball.wy += k * rz * tx;
    ball.wz += k * (rx * ty - ry * tx);
    ball.moving = true;
  }

  checkPockets() {
    const { balls, table } = this;
    const X = table.length / 2 + OUT_MARGIN;
    const Y = table.width / 2 + OUT_MARGIN;
    for (const ball of balls) {
      if (!ball.on || !ball.moving) continue;
      let hit = -1;
      for (let i = 0; i < table.pockets.length; i++) {
        const p = table.pockets[i];
        const along = (ball.x - p.x) * p.ax + (ball.y - p.y) * p.ay;
        if (along > p.depth) {
          hit = i;
          break;
        }
      }
      if (hit < 0 && (Math.abs(ball.x) > X || Math.abs(ball.y) > Y)) hit = this.nearestPocket(ball);
      if (hit < 0) continue;
      const speed = Math.hypot(ball.vx, ball.vy);
      ball.on = false;
      ball.moving = false;
      ball.vx = ball.vy = ball.wx = ball.wy = ball.wz = 0;
      this.events.push({ t: this.time, type: 'pocket', ball: ball.id, pocket: hit, speed, x: ball.x, y: ball.y });
    }
  }

  nearestPocket(ball) {
    let best = 0;
    let bestD = Infinity;
    this.table.pockets.forEach((p, i) => {
      const d = Math.hypot(ball.x - p.x, ball.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** 지금 공 배치 [{ id, x, y, on }] */
  snapshot() {
    return this.balls.map(({ id, x, y, on }) => ({ id, x, y, on }));
  }
}

/** 공 배치에서 cue 를 shot 으로 쳐 끝까지 돌린 결과 { events, balls, time } */
export function simulate(table, balls, cue, shot, { dt = DT, until = null, maxTime = MAX_TIME } = {}) {
  const sim = new Simulation(table, balls, { dt });
  sim.strike(cue, shot);
  sim.run({ until, maxTime });
  return { events: sim.events, balls: sim.snapshot(), time: sim.time, sim };
}
