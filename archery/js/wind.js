// 바람. 세트마다 기본 바람(세기·방향)을 새로 정하고, 그 주위로 돌풍이 천천히 오르내린다.
// 벡터는 위에서 내려다본 m/s 값으로, x 는 오른쪽으로 부는 옆바람, y 는 과녁 쪽으로 부는 뒷바람이다.

export const DRIFT = 0.045; // 옆바람 1 m/s 에 과녁에서 옆으로 밀리는 거리 (m)
export const DRIFT_ALONG = 0.012; // 뒷바람 1 m/s 에 위로 뜨는 거리 (맞바람이면 가라앉는다)
const SETTLE = 2.5; // 돌풍이 기본 바람으로 돌아오는 시간 상수 (초)

function gaussian(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 바람 때문에 화살이 과녁 면에서 밀리는 거리 { x, y } (m) */
export function windDrift(wind) {
  return { x: wind.x * DRIFT, y: wind.y * DRIFT_ALONG };
}

export class Wind {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.base = { x: 0, y: 0 };
    this.x = 0;
    this.y = 0;
    this.gust = 0;
  }

  /** 새 세트의 바람. maxSpeed 까지의 세기로 아무 방향에서나 분다 */
  shuffle(maxSpeed) {
    const speed = maxSpeed * (0.15 + 0.85 * this.rng());
    const angle = this.rng() * Math.PI * 2;
    this.base = { x: Math.sin(angle) * speed, y: Math.cos(angle) * speed };
    this.x = this.base.x;
    this.y = this.base.y;
    this.gust = 0.15 + speed * 0.12; // 4.5 m/s 에서 돌풍의 표준편차가 0.8 m/s 쯤
  }

  /** dt 초만큼 돌풍을 흘린다 (오른슈타인-울렌벡 과정) */
  step(dt) {
    const pull = Math.min(1, dt / SETTLE);
    const kick = this.gust * Math.sqrt(dt);
    this.x += (this.base.x - this.x) * pull + kick * gaussian(this.rng);
    this.y += (this.base.y - this.y) * pull + kick * gaussian(this.rng);
  }

  get speed() {
    return Math.hypot(this.x, this.y);
  }

  /** 바람이 불어 가는 방향. 0 이면 과녁 쪽, 시계 방향 라디안 */
  get angle() {
    return Math.atan2(this.x, this.y);
  }
}
