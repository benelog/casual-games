// 키보드와 화면 핸들·페달을 합쳐 매 프레임 { throttle, brake, steer } 를 만든다. DOM 과 상관없는 순수 로직이다.
//
// 키보드: ↑/W 전진(기어를 D 로), ↓/S 후진(기어를 R 로), ←/→ · A/D 핸들, Space 브레이크, Shift 를 누르고 있으면 살살.
//   방향키에서 손을 떼면 핸들은 천천히 가운데로 돌아온다 (누르고 있는 동안만 꺾인다).
// 화면 핸들: 끌어서 돌리면 돌린 만큼 꺾이고, 손을 떼도 그대로 있다 (주차할 때는 끝까지 감은 채 후진하는 일이 많다).
//   두 번 톡 치면 가운데로 돌아온다.
// 페달: 누르고 있으면 가속 페달은 처음에는 살짝, 오래 누를수록 깊이 밟힌다.

export const KEYS = {
  ArrowUp: 'gas',
  KeyW: 'gas',
  ArrowDown: 'reverse',
  KeyS: 'reverse',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'brake',
};

export const WHEEL_TURN = (3 * Math.PI) / 2; // 화면 핸들을 끝까지 감는 각도 (270°)
export const KEY_STEER_RATE = 1.8; // 방향키로 핸들을 감는 빠르기 (조향 값/초)
export const KEY_RETURN_RATE = 2.4; // 방향키를 놓았을 때 가운데로 돌아오는 빠르기
export const GAS_START = 0.35; // 가속 페달을 막 밟았을 때의 깊이
export const GAS_RAMP = 1.2; // 끝까지 밟히는 데 걸리는 시간 (초)
export const GENTLE = 0.4; // Shift 를 누르고 있을 때 가속 페달 깊이의 상한
const WHEEL_DEADZONE = 14; // 핸들 가운데 이 반지름(px) 안에서는 각도가 튀므로 무시한다
const DOUBLE_TAP = 0.32; // 두 번 톡 치는 간격 (초)

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const toward = (value, target, step) => (value < target ? Math.min(target, value + step) : Math.max(target, value - step));

/** 핸들 위 두 점의 각도 차이 (가까운 쪽으로, 시계 방향이 +) */
export const wheelDelta = (from, to) => wrap(to - from);

export class Driver {
  constructor() {
    this.reset();
  }

  /** 단계를 새로 시작할 때 */
  reset() {
    this.keys = new Set(); // 누르고 있는 키 동작
    this.pedals = { gas: false, brake: false }; // 화면 페달
    this.gentle = false;
    this.gasTime = 0;
    this.steer = 0; // -1(왼쪽 끝) ~ 1(오른쪽 끝)
    this.wheel = null; // 화면 핸들을 잡고 있으면 { id, angle }
    this.centering = false; // 두 번 톡 쳐서 가운데로 돌아가는 중
    this.keySteered = false; // 방향키로 꺾었으면 놓았을 때 가운데로 돌아온다
    this.lastTap = -Infinity;
    this.time = 0;
  }

  /** 키보드 동작을 누르거나 뗀다. 기어를 바꿔야 하면 'D' | 'R' 을 돌려준다 */
  key(action, down) {
    if (down) this.keys.add(action);
    else this.keys.delete(action);
    if (!down) return null;
    if (action === 'gas') return 'D';
    if (action === 'reverse') return 'R';
    return null;
  }

  /** 모든 입력을 놓는다 (창이 포커스를 잃었을 때) */
  release() {
    this.keys.clear();
    this.pedals.gas = this.pedals.brake = false;
    this.wheel = null;
    this.gentle = false;
  }

  // ---------- 화면 핸들 ----------

  /** 핸들을 잡는다. (dx, dy) 는 핸들 가운데에서 손가락까지 (화면 픽셀, y 는 아래로) */
  grabWheel(id, dx, dy) {
    if (this.time - this.lastTap < DOUBLE_TAP) {
      this.centering = true;
      this.lastTap = -Infinity;
    } else {
      this.lastTap = this.time;
    }
    this.wheel = { id, angle: Math.hypot(dx, dy) > WHEEL_DEADZONE ? Math.atan2(dy, dx) : null };
  }

  turnWheel(id, dx, dy) {
    if (!this.wheel || this.wheel.id !== id) return;
    if (Math.hypot(dx, dy) <= WHEEL_DEADZONE) return;
    const angle = Math.atan2(dy, dx);
    if (this.wheel.angle !== null) {
      const delta = wheelDelta(this.wheel.angle, angle);
      if (Math.abs(delta) > 0.02) {
        this.centering = false;
        this.lastTap = -Infinity; // 돌렸으면 톡 친 것이 아니다
      }
      this.steer = Math.max(-1, Math.min(1, this.steer + delta / WHEEL_TURN));
    }
    this.wheel.angle = angle;
  }

  dropWheel(id) {
    if (this.wheel?.id === id) this.wheel = null;
  }

  /** 화면 핸들이 돌아간 각도 (라디안, 시계 방향이 +) */
  get wheelAngle() {
    return this.steer * WHEEL_TURN;
  }

  // ---------- 매 프레임 ----------

  /** dt 초 지난 입력을 { throttle, brake, steer } 로 */
  update(dt) {
    this.time += dt;
    const keys = this.keys;
    const gas = keys.has('gas') || keys.has('reverse') || this.pedals.gas;
    this.gasTime = gas ? this.gasTime + dt : 0;
    let throttle = gas ? Math.min(1, GAS_START + ((1 - GAS_START) * this.gasTime) / GAS_RAMP) : 0;
    if (this.gentle) throttle = Math.min(throttle, GENTLE);
    const brake = keys.has('brake') || this.pedals.brake ? 1 : 0;

    const left = keys.has('left');
    const right = keys.has('right');
    if (left !== right) {
      this.centering = false;
      this.steer = toward(this.steer, right ? 1 : -1, KEY_STEER_RATE * dt);
      this.keySteered = true;
    } else if (this.centering || (this.keySteered && !this.wheel)) {
      // 방향키를 놓았거나 두 번 톡 쳤으면 가운데로
      this.steer = toward(this.steer, 0, KEY_RETURN_RATE * dt);
      if (this.steer === 0) this.centering = this.keySteered = false;
    }
    if (this.wheel) this.keySteered = false; // 손으로 잡으면 그 자리에 둔다
    return { throttle, brake, steer: this.steer };
  }
}
