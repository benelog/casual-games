// 한 단계의 진행: 차를 움직이고, 접촉·전후진 전환·주차 완료를 판정하고, 끝나면 점수와 별을 매긴다.
// 화면과 상관없는 순수 로직이다. 일어난 일은 사건 목록으로 쌓아 두고 main.js 가 drain() 으로 가져간다.

import { CAR, STEP, STOPPED, makeCar, makeBox, carBox, corners, containsPoint, overlap, gap, stepCar, wrapAngle } from './physics.js';
import { buildObstacles } from './levels.js';

export const ANGLE_TOLERANCE = (7 * Math.PI) / 180; // 칸과 차의 각도 차이가 이 안이어야 주차로 친다
export const EDGE_TOLERANCE = 0.03; // 차 모서리가 칸 선을 이만큼은 넘어도 봐준다 (선 두께의 절반쯤)
export const PARK_HOLD = 1; // 칸 안에 멈춘 채 이만큼(초) 있으면 주차 완료
export const CRASH_SPEED = 3; // 이보다 빠르게(m/s, 약 11 km/h) 부딪히면 사고로 실패
export const HARD_SPEED = 1.2; // 이보다 빠르면 '쾅', 느리면 '툭'
const TOUCH_MARGIN = 0.08; // 닿은 뒤 이만큼 떨어지기 전까지는 같은 장애물과 또 닿아도 한 번으로 센다
const MOVING = 0.15; // 전후진 방향을 셀 때 이보다 빨라야 움직이는 것으로 본다
const SENSOR_RANGE = 1.5; // 주차 감지기가 울리기 시작하는 거리 (m)

/** 주차 칸의 사각형 */
export const spotBox = (spot) => makeBox(spot.x, spot.z, spot.heading, spot.length, spot.width);

/**
 * 차가 칸에 얼마나 맞게 서 있는지.
 * inside: 차체 네 모서리가 모두 칸 안, angle: 칸 방향과의 차이(라디안, 양쪽 방향을 허용하는 칸이면 가까운 쪽),
 * offset: 차 가운데와 칸 가운데의 거리, aligned: inside 이고 각도 차이가 허용 범위 안.
 */
export function parkStatus(car, spot) {
  const box = spotBox(spot);
  const inside = corners(carBox(car)).every((p) => containsPoint(box, p, EDGE_TOLERANCE));
  let angle = Math.abs(wrapAngle(car.heading - spot.heading));
  if (spot.bothWays) angle = Math.min(angle, Math.PI - angle);
  const offset = Math.hypot(car.x - spot.x, car.z - spot.z);
  return { inside, angle, offset, aligned: inside && angle <= ANGLE_TOLERANCE };
}

/**
 * 결과를 100점에서 감점해 점수와 별(1~3)을 매긴다. 운전면허 기능시험처럼 감점 항목을 따로 돌려준다.
 * - 접촉: 한 번에 10점
 * - 시간: 기준 시간(par.time)을 넘긴 2초마다 1점, 최대 20점
 * - 전후진 전환: 기준(par.switches)보다 많은 한 번에 5점, 최대 20점
 * - 정렬: 칸 가운데에서 벗어난 거리 1m 에 25점 + 각도 1° 에 1.5점 (작은 오차는 봐준다), 최대 20점
 */
export function evaluate({ time, switches, contacts, offset, angle }, par) {
  const degrees = (angle * 180) / Math.PI;
  const deductions = {
    contacts: contacts * 10,
    time: Math.min(20, Math.floor(Math.max(0, time - par.time) / 2)),
    switches: Math.min(20, Math.max(0, switches - par.switches) * 5),
    accuracy: Math.min(20, Math.round(Math.max(0, offset - 0.1) * 25 + Math.max(0, degrees - 1) * 1.5)),
  };
  const score = Math.max(0, 100 - Object.values(deductions).reduce((a, b) => a + b, 0));
  return { score, stars: starsOf(score), deductions };
}

/** 점수 → 별. 90점 이상 3개, 70점 이상 2개, 나머지 1개 */
export const starsOf = (score) => (score >= 90 ? 3 : score >= 70 ? 2 : 1);

/** 한 단계를 처음부터 끝까지 운전하는 판 */
export class ParkingRun {
  constructor(level) {
    this.level = level;
    this.obstacles = buildObstacles(level);
    this.spot = level.spot;
    this.reset();
  }

  reset() {
    this.car = makeCar(this.level.start);
    this.time = 0;
    this.started = false; // 처음 페달이나 핸들을 건드리면 시간이 흐른다
    this.switches = 0;
    this.contacts = 0;
    this.direction = 0; // 마지막으로 움직인 방향 (1 앞, -1 뒤, 0 아직)
    this.touching = new Set(); // 지금 닿아 있는 (닿은 뒤 아직 떨어지지 않은) 장애물
    this.hold = 0; // 칸 안에 멈춰 있은 시간
    this.status = 'driving'; // driving | parked | failed
    this.failReason = null;
    this.result = null;
    this.accumulator = 0;
    this.events = [];
  }

  /** 기어를 바꾼다. 바뀌었으면 true */
  setGear(gear) {
    if (this.status !== 'driving' || this.car.gear === gear || (gear !== 'D' && gear !== 'R')) return false;
    this.car.gear = gear;
    this.events.push({ type: 'gear', gear });
    return true;
  }

  /** dt 초만큼 진행한다. input: { throttle, brake, steer } */
  update(dt, input) {
    if (this.status !== 'driving') return;
    if (!this.started && (input.throttle > 0 || input.brake > 0 || Math.abs(input.steer) > 0.02)) {
      this.started = true;
      this.events.push({ type: 'start' });
    }
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator >= STEP && this.status === 'driving') {
      this.accumulator -= STEP;
      this.tick(input);
    }
  }

  tick(input) {
    const { car } = this;
    if (this.started) this.time += STEP;
    const hit = stepCar(car, input, this.obstacles, STEP);

    // 닿은 장애물에서 떨어졌는지
    const near = carBox(car, TOUCH_MARGIN);
    for (const obstacle of this.touching) {
      if (!overlap(near, obstacle.box)) this.touching.delete(obstacle);
    }
    if (hit) this.contact(hit);
    if (this.status !== 'driving') return;

    // 전후진 전환: 실제로 움직인 방향이 바뀐 횟수 (처음 방향은 세지 않는다)
    if (Math.abs(car.speed) > MOVING) {
      const direction = Math.sign(car.speed);
      if (this.direction && direction !== this.direction) {
        this.switches++;
        this.events.push({ type: 'switch', switches: this.switches });
      }
      this.direction = direction;
    }

    // 주차 완료: 칸 안에, 각도를 맞춰, 멈춘 채 PARK_HOLD 초
    const status = parkStatus(car, this.spot);
    if (status.aligned && Math.abs(car.speed) < STOPPED) {
      if (this.hold === 0) this.events.push({ type: 'settling' });
      this.hold += STEP;
      if (this.hold >= PARK_HOLD) this.finish(status);
    } else if (this.hold > 0) {
      this.hold = 0;
      this.events.push({ type: 'unsettled' });
    }
  }

  contact({ obstacle, speed, normal }) {
    if (this.touching.has(obstacle)) return; // 이미 닿아 있던 곳을 또 미는 것은 세지 않는다
    this.touching.add(obstacle);
    this.contacts++;
    const severity = speed >= CRASH_SPEED ? 'crash' : speed >= HARD_SPEED ? 'hard' : 'light';
    // 닿은 자리: 차 가운데에서 장애물 쪽 차체 가장자리쯤
    const point = { x: this.car.x - normal.x * CAR.width * 0.5, z: this.car.z - normal.z * CAR.width * 0.5 };
    this.events.push({ type: 'contact', kind: obstacle.kind, speed, severity, contacts: this.contacts, point });
    const limit = this.level.maxContacts;
    if (severity === 'crash') this.fail('crash');
    else if (limit != null && this.contacts > limit) this.fail('contacts');
  }

  fail(reason) {
    this.status = 'failed';
    this.failReason = reason;
    this.car.speed = 0;
    this.events.push({ type: 'failed', reason });
  }

  finish(status) {
    this.status = 'parked';
    this.car.speed = 0;
    const metrics = {
      time: this.time,
      switches: this.switches,
      contacts: this.contacts,
      offset: status.offset,
      angle: status.angle,
    };
    this.result = { ...metrics, ...evaluate(metrics, this.level.par) };
    this.events.push({ type: 'parked', result: this.result });
  }

  /** 주차 완료까지 남은 비율 (0~1) */
  get holdProgress() {
    return Math.min(1, this.hold / PARK_HOLD);
  }

  /** 지금 칸에 얼마나 맞게 들어와 있는지 (멈추지 않았어도) */
  get fit() {
    return parkStatus(this.car, this.spot);
  }

  /**
   * 주차 감지기: 가장 가까운 장애물까지의 거리. 앞으로 갈 때는 앞쪽 절반, 뒤로 갈 때는 뒤쪽 절반만 본다.
   * SENSOR_RANGE 보다 멀면 Infinity.
   */
  sensorGap() {
    const { car } = this;
    const sign = car.gear === 'R' ? -1 : 1;
    const half = CAR.length / 4;
    const s = Math.sin(car.heading);
    const c = Math.cos(car.heading);
    // 가는 쪽 절반만 떼어 낸 사각형
    const box = makeBox(car.x + s * half * sign, car.z + c * half * sign, car.heading, CAR.length / 2, CAR.width);
    let best = Infinity;
    for (const obstacle of this.obstacles) {
      const reach = box.r + obstacle.box.r + SENSOR_RANGE;
      if ((box.x - obstacle.box.x) ** 2 + (box.z - obstacle.box.z) ** 2 > reach * reach) continue;
      best = Math.min(best, gap(box, obstacle.box));
    }
    return best <= SENSOR_RANGE ? best : Infinity;
  }

  /** 쌓인 사건을 꺼낸다 */
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }
}
