// 리커브 과녁 규격과 점수 계산. 70m 거리에서 지름 122cm 과녁에 쏜다.
// 좌표는 과녁 중심이 원점인 과녁 면 위의 미터 단위다. x 는 오른쪽, y 는 위.

export const FACE_RADIUS = 0.61; // 과녁 반지름
export const RING_WIDTH = 0.061; // 점수 고리 하나의 폭
export const X_RADIUS = RING_WIDTH / 2; // 10점 안쪽의 X 고리
export const ARROW_RADIUS = 0.0028; // 화살대 반지름. 선에 걸치면 높은 점수를 준다
export const DISTANCE = 70; // 사대에서 과녁까지 (m)

/** 고리 바깥에서 안쪽 순서의 색 이름: 1·2 흰색, 3·4 검정, 5·6 파랑, 7·8 빨강, 9·10 노랑 */
export const RING_COLORS = ['white', 'white', 'black', 'black', 'blue', 'blue', 'red', 'red', 'gold', 'gold'];

/**
 * 과녁 면의 한 점에 꽂힌 화살의 점수.
 * { score: 0~10, x: X 고리 안인지, distance: 중심까지 거리(m), label: 'X' | '10'…'1' | 'M' }
 */
export function scoreAt(x, y) {
  const distance = Math.hypot(x, y);
  // 화살대가 고리 선에 닿기만 해도 안쪽 점수로 친다
  const edge = Math.max(0, distance - ARROW_RADIUS);
  if (edge > FACE_RADIUS) return { score: 0, x: false, distance, label: 'M' };
  // 경계에 정확히 걸치면 floor 가 안쪽 고리를 고른다 (부동소수점 오차를 조금 봐준다)
  const ring = Math.min(9, Math.floor(edge / RING_WIDTH + 1e-9));
  const score = 10 - ring;
  const inX = edge <= X_RADIUS;
  return { score, x: inX, distance, label: inX ? 'X' : String(score) };
}

/** 시간이 지나 쏘지 못한 화살. 0점이고 거리 비교에서도 가장 멀다 */
export const TIMEOUT_HIT = Object.freeze({ score: 0, x: false, distance: Infinity, label: 'M', timeout: true });
