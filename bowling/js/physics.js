// 레인 물리. cannon-es 로 공과 핀 10개를 굴리고, 다 멈춘 뒤 어떤 핀이 서 있는지 알려 준다.
// 렌더링과 DOM 을 모르므로 scene.js 가 매 프레임 step() 을 부르고 pose 를 읽어 그린다.

import * as CANNON from 'cannon-es';
import {
  LANE_WIDTH,
  GUTTER_WIDTH,
  HEAD_PIN_Z,
  PIT_Z,
  PIN_SPOTS,
  PIN_COM,
  BALL_RADIUS,
  BALL_START_Z,
  OIL_LENGTH,
  HOOK_ACCEL,
  isStanding,
} from './lane.js';

const STEP = 1 / 240; // 공이 빨라 핀을 뚫고 지나가지 않도록 잘게 나눈다
const MAX_STEPS = 24; // 한 프레임에 따라잡을 최대 스텝 (느린 기기에서는 슬로 모션이 된다)
// 실제 공은 7kg 안팎이지만, 시뮬레이션에서는 공이 핀에 너무 쉽게 튕겨 나가 조금 무겁게 잡았다.
// 아래 질량·반발 계수·마찰은 포켓에 넣으면 스트라이크가 자주 나고 정면이나 옆을 맞히면 덜 쓰러지도록 맞춘 값이다
const BALL_MASS = 9;
const PIN_MASS = 1.6;
const LANE_FRONT = 3; // 어프로치 쪽 끝
const GUTTER_DROP = 0.06;
const PIT_DEPTH = 0.35;
const BALL_EXTRA_GRAVITY = 2; // 공이 뜨면 중력의 몇 배를 더 받는가
const UP = new CANNON.Vec3(0, 1, 0);
const scratch = new CANNON.Vec3();

// 핀 충돌 형상: 바닥에서부터 [아래 반지름, 위 반지름, 시작 높이, 끝 높이] 원뿔대 네 개와 머리 구.
// 공의 중심 높이(0.109)에는 곧은 원통이 오게 한다. 원뿔대의 모서리가 그 높이에 있으면
// 접촉 법선이 위로 잡혀 공이 핀을 타고 튀어 오른다
const PIN_SECTIONS = [
  [0.028, 0.05, 0, 0.06],
  [0.059, 0.059, 0.06, 0.16],
  [0.059, 0.033, 0.16, 0.24],
  [0.033, 0.027, 0.24, 0.325],
];
const PIN_HEAD = { radius: 0.035, y: 0.345 };

export class LanePhysics {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0), allowSleep: true });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 20;

    const lane = new CANNON.Material('lane');
    const pin = new CANNON.Material('pin');
    const ball = new CANNON.Material('ball');
    const wall = new CANNON.Material('wall');
    const contact = (a, b, friction, restitution) =>
      this.world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
    contact(ball, lane, 0.03, 0.05); // 기름 칠한 레인
    contact(pin, lane, 0.15, 0.2);
    contact(pin, pin, 0.2, 0.6);
    contact(ball, pin, 0.1, 0.5);
    contact(pin, wall, 0.2, 0.5);
    contact(ball, wall, 0.1, 0.3);
    this.materials = { lane, pin, ball, wall };

    this.buildLane();
    this.pins = PIN_SPOTS.map((spot) => this.makePin(spot.number));
    this.ball = new CANNON.Body({
      mass: BALL_MASS,
      material: ball,
      shape: new CANNON.Sphere(BALL_RADIUS),
      allowSleep: false,
      linearDamping: 0,
      angularDamping: 0.01,
    });

    this.accumulator = 0;
    this.rolling = null; // 굴러가는 동안의 상태
  }

  buildLane() {
    const { lane, wall } = this.materials;
    const length = LANE_FRONT - PIT_Z;
    const midZ = (LANE_FRONT + PIT_Z) / 2;
    const box = (material, x, y, z, hx, hy, hz) => {
      const body = new CANNON.Body({ mass: 0, material, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
      body.position.set(x, y, z);
      this.world.addBody(body);
    };
    // 레인 윗면이 y = 0
    box(lane, 0, -0.05, midZ, LANE_WIDTH / 2, 0.05, length / 2);
    for (const side of [-1, 1]) {
      // 거터는 레인보다 조금 낮은 평평한 바닥으로 근사한다. 핏까지 이어진다
      const gx = side * (LANE_WIDTH / 2 + GUTTER_WIDTH / 2);
      box(lane, gx, -GUTTER_DROP - 0.05, midZ, GUTTER_WIDTH / 2, 0.05, length / 2);
      // 거터 바깥 칸막이와 핀 덱 옆의 킥백 판. 킥백은 핏 옆까지 막는다
      const wx = side * (LANE_WIDTH / 2 + GUTTER_WIDTH + 0.03);
      box(wall, wx, 0.1, midZ, 0.03, 0.2, length / 2);
      box(wall, wx, 0.4, HEAD_PIN_Z - 1, 0.03, 0.8, 2);
    }
    // 핏: 핀 덱 뒤로 꺼진 바닥과 뒤쪽 쿠션
    box(lane, 0, -PIT_DEPTH - 0.05, PIT_Z - 0.6, 1.2, 0.05, 0.6);
    box(wall, 0, 0.3, PIT_Z - 1.1, 1.2, 0.7, 0.05);
    // 그래도 밖으로 튄 것이 끝없이 떨어지지 않게 받쳐 주는 바닥
    box(wall, 0, -PIT_DEPTH - 0.2, midZ, 10, 0.1, length);
  }

  makePin(number) {
    const body = new CANNON.Body({
      mass: PIN_MASS,
      material: this.materials.pin,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 0.4,
      angularDamping: 0.05,
    });
    // 바디의 원점은 무게중심이다. 형상은 바닥 기준 높이에서 PIN_COM 을 뺀 곳에 붙인다
    for (const [bottom, top, y0, y1] of PIN_SECTIONS) {
      body.addShape(new CANNON.Cylinder(top, bottom, y1 - y0, 12), new CANNON.Vec3(0, (y0 + y1) / 2 - PIN_COM, 0));
    }
    body.addShape(new CANNON.Sphere(PIN_HEAD.radius), new CANNON.Vec3(0, PIN_HEAD.y - PIN_COM, 0));
    body.number = number;
    return body;
  }

  /** 핀을 놓는다. 서 있는 상태로 잠재워 공이 닿기 전에는 흔들리지 않게 한다 */
  placePin(body, x, z) {
    body.position.set(x, PIN_COM, z);
    body.quaternion.set(0, 0, 0, 1);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    if (!this.world.bodies.includes(body)) this.world.addBody(body);
    body.sleep();
  }

  /** 핀 10개를 새로 세운다 */
  rack() {
    this.removeBall();
    this.pins.forEach((body, i) => this.placePin(body, PIN_SPOTS[i].x, PIN_SPOTS[i].z));
  }

  /** 쓰러진 핀을 치우고, 서 있는 핀은 밀려난 자리 그대로 똑바로 다시 세운다 */
  sweep() {
    this.removeBall();
    const standing = new Set(this.standing());
    for (const body of this.pins) {
      if (standing.has(body.number)) this.placePin(body, body.position.x, body.position.z);
      else if (this.world.bodies.includes(body)) this.world.removeBody(body);
    }
  }

  removeBall() {
    if (this.world.bodies.includes(this.ball)) this.world.removeBody(this.ball);
    this.rolling = null;
  }

  /** 공을 굴린다. shot: { startX, angle, speed, spin } */
  launch({ startX, angle, speed, spin = 0 }) {
    const ball = this.ball;
    ball.position.set(startX, BALL_RADIUS, BALL_START_Z);
    ball.quaternion.set(0, 0, 0, 1);
    const vx = speed * Math.sin(angle);
    const vz = -speed * Math.cos(angle);
    ball.velocity.set(vx, 0, vz);
    // 처음부터 미끄러지지 않고 구르게 한다: ω = (위 × 진행 방향) / 반지름
    ball.angularVelocity.set(vz / BALL_RADIUS, 0, -vx / BALL_RADIUS);
    if (!this.world.bodies.includes(ball)) this.world.addBody(ball);
    this.accumulator = 0;
    this.rolling = { spin, time: 0, reachedPins: null, quiet: 0, finished: false, gutter: false };
  }

  get finished() {
    return this.rolling?.finished ?? false;
  }

  /** 실제 경과 시간 dt(초)만큼 시뮬레이션을 진행한다 */
  step(dt) {
    this.accumulator = Math.min(this.accumulator + dt, STEP * MAX_STEPS);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.fixedStep();
    }
  }

  fixedStep() {
    const r = this.rolling;
    const ball = this.ball;
    if (r && !r.finished) {
      // 기름 구간을 지나면 스핀 방향으로 휜다. 레인 위를 구를 때만
      const onLane = Math.abs(ball.position.x) < LANE_WIDTH / 2 && ball.position.y < BALL_RADIUS + 0.02;
      const travelled = BALL_START_Z - ball.position.z;
      if (r.spin && onLane && travelled > OIL_LENGTH && ball.position.z > HEAD_PIN_Z - 0.3) {
        // 힘으로 밀면 마찰과 회전 관성이 대부분을 먹어 버리므로, 구르는 상태를 유지한 채 속도를 직접 바꾼다
        const dv = r.spin * HOOK_ACCEL * STEP;
        ball.velocity.x += dv;
        ball.angularVelocity.z -= dv / BALL_RADIUS;
      }
    }
    // 쓰러지는 핀을 타고 공이 높이 뛰어오르지 않도록, 공이 뜨면 더 세게 끌어내린다.
    // (속도를 잘라 내면 에너지가 사라져 공이 핀 더미에 멈춰 버린다)
    if (ball.position.y > BALL_RADIUS + 0.005) {
      ball.velocity.y -= 9.82 * BALL_EXTRA_GRAVITY * STEP;
    }
    this.world.step(STEP);
    if (r && !r.finished) this.watch(r);
  }

  /** 공이 핀에 닿고 핀이 다 멈췄는지 본다 */
  watch(r) {
    r.time += STEP;
    const ball = this.ball;
    const arrived =
      ball.position.z < HEAD_PIN_Z + 0.4 || ball.position.y < -0.05 || ball.velocity.length() < 0.15;
    if (r.reachedPins === null && arrived) r.reachedPins = r.time;
    // 핀에 닿기 전에 레인 밖으로 떨어지면 거터
    if (r.reachedPins === null && Math.abs(ball.position.x) > LANE_WIDTH / 2 + 0.02) r.gutter = true;

    // 누운 핀은 원통이라 한참 데굴데굴 구르므로, 아직 서 있거나 빠르게 움직이는 핀만 멈추기를 기다린다
    const up = scratch;
    const quiet = this.pins.every((p) => {
      if (!this.world.bodies.includes(p) || p.sleepState === CANNON.Body.SLEEPING) return true;
      const speed = p.velocity.length();
      p.quaternion.vmult(UP, up);
      if (up.y < 0.5) return speed < 0.3;
      return speed < 0.05 && p.angularVelocity.length() < 0.4;
    });
    r.quiet = quiet ? r.quiet + STEP : 0;
    const sincePins = r.reachedPins === null ? 0 : r.time - r.reachedPins;
    r.finished = (sincePins > 1.5 && r.quiet > 0.4) || sincePins > 6 || r.time > 15;
  }

  /** 서 있는 핀 번호 목록 */
  standing() {
    const up = scratch;
    return this.pins
      .filter((p) => {
        if (!this.world.bodies.includes(p)) return false;
        p.quaternion.vmult(UP, up);
        return isStanding({ x: p.position.x, y: p.position.y, z: p.position.z, upY: up.y });
      })
      .map((p) => p.number);
  }

  /** 렌더링용 자세. 치운 핀은 null */
  pinPose(i) {
    const p = this.pins[i];
    return this.world.bodies.includes(p) ? p : null;
  }

  get ballInPlay() {
    return this.world.bodies.includes(this.ball);
  }
}
