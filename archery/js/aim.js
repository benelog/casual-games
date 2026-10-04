// 조준점의 흔들림. 시위를 당기면 처음에는 크게 흔들리다 차츰 가라앉고, 너무 오래 버티면 팔이 지쳐
// 다시 커진다. 흔들림은 느린 사인파의 합이라 잘 보면 원하는 곳에 오는 순간을 노릴 수 있다.

export const SHOT_CLOCK = 20; // 화살 하나에 주는 시간 (초)
export const HAND_SPREAD = 0.006; // 사람이 쏜 화살도 조준점에서 이만큼 퍼진다 (표준편차, m)

const IDLE = 0.05; // 당기기 전
const DRAWN = 0.08; // 막 당겼을 때
const STEADY = 0.022; // 가장 안정됐을 때
const SETTLE = 1.4; // 안정될 때까지 (초)
const TIRE = 6; // 이때부터 지친다 (초)
const TIRE_RATE = 0.012; // 지친 뒤 초당 늘어나는 폭
const MAX = 0.12;

const smoothstep = (k) => k * k * (3 - 2 * k);

/** 흔들림 폭 (m). held 는 시위를 당긴 뒤 지난 시간, 당기지 않았으면 null */
export function swayAmplitude(held) {
  if (held === null) return IDLE;
  if (held < SETTLE) return STEADY + (DRAWN - STEADY) * (1 - smoothstep(held / SETTLE));
  if (held < TIRE) return STEADY;
  return Math.min(MAX, STEADY + (held - TIRE) * TIRE_RATE);
}

/** 시각 t(초)의 흔들림 방향. 폭 1 기준이고 swayAmplitude 를 곱해 쓴다 */
export function swayOffset(t) {
  return {
    x: 0.6 * Math.sin(t * 1.3) + 0.4 * Math.sin(t * 2.9 + 1.1),
    y: 0.6 * Math.sin(t * 1.7 + 0.5) + 0.4 * Math.sin(t * 3.3),
  };
}
