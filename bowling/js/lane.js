// 볼링 레인 규격과 투구 궤적 계산. 렌더링·물리 엔진과 무관한 순수 로직이다.
// 좌표는 미터. 파울 라인 가운데가 원점이고 x 는 오른쪽, y 는 위, 레인은 -z 방향으로 뻗는다.

export const LANE_WIDTH = 1.0541; // 41.5 인치
export const GUTTER_WIDTH = 0.235;
export const HEAD_PIN_Z = -18.288; // 파울 라인에서 1번 핀까지 60 피트
export const PIN_SPACING = 0.3048; // 핀 사이 12 인치
const ROW_GAP = PIN_SPACING * Math.cos(Math.PI / 6);
export const PIT_Z = HEAD_PIN_Z - 0.868; // 핀 덱이 끝나고 핏으로 떨어지는 곳

export const BALL_RADIUS = 0.109;
export const BALL_START_Z = -0.3; // 공을 놓는 곳 (파울 라인 바로 앞)
export const START_LIMIT = 0.42; // 출발 위치는 가운데에서 좌우로 이만큼까지

export const PIN_HEIGHT = 0.381;
export const PIN_COM = 0.14; // 바닥에서 무게중심까지 높이

// 투구 범위. angle 은 레인 방향에서 오른쪽으로 꺾인 각도(라디안), spin 은 -1(왼쪽으로 휨) ~ 1(오른쪽으로 휨)
export const SPEED_MIN = 5.5;
export const SPEED_MAX = 9.5;
export const ANGLE_LIMIT = 0.045;
export const OIL_LENGTH = 11; // 기름이 칠해진 구간. 이 뒤부터 공이 휜다
export const HOOK_ACCEL = 0.8; // spin 1 일 때 옆으로 받는 가속도 (m/s²)

/**
 * 핀 10개의 자리. number 는 표준 번호로, 1번이 맨 앞이고 볼러가 볼 때 7번이 왼쪽 뒤, 10번이 오른쪽 뒤다.
 * 줄 r(0~3)에는 r+1 개의 핀이 왼쪽부터 놓인다.
 */
export const PIN_SPOTS = [];
for (let row = 0, number = 1; row < 4; row++) {
  for (let i = 0; i <= row; i++, number++) {
    PIN_SPOTS.push({ number, x: (i - row / 2) * PIN_SPACING, z: HEAD_PIN_Z - row * ROW_GAP });
  }
}

/** 쓰러지지 않은 핀인가: 거의 똑바로 서 있고, 핀 덱 위(레인 안, 핏 앞)에 남아 있어야 한다 */
export function isStanding({ x, y, z, upY }) {
  return upY > 0.94 && Math.abs(x) < LANE_WIDTH / 2 && z > PIT_Z && Math.abs(y - PIN_COM) < 0.02;
}

/**
 * 투구 { startX, angle, speed, spin } 의 공이 z 에 이르렀을 때의 x (마찰·충돌은 무시한 근사).
 * 기름 구간까지는 곧게 가고, 그 뒤로는 옆 가속도를 받아 휜다.
 */
export function predictX({ startX, angle, speed, spin = 0 }, z) {
  const distance = BALL_START_Z - z;
  const forward = speed * Math.cos(angle);
  let x = startX + Math.tan(angle) * distance;
  if (distance > OIL_LENGTH && spin) {
    const t = (distance - OIL_LENGTH) / forward;
    x += 0.5 * HOOK_ACCEL * spin * t * t;
  }
  return x;
}

/** 1번 핀 줄에서 targetX 를 지나도록 하는 각도. 휘는 만큼을 미리 반대쪽으로 겨냥한다 */
export function angleToward(startX, targetX, speed, spin = 0) {
  const distance = BALL_START_Z - HEAD_PIN_Z;
  const hook = predictX({ startX: 0, angle: 0, speed, spin }, HEAD_PIN_Z);
  return Math.atan2(targetX - hook - startX, distance);
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
