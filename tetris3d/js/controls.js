// 화면 기준 조작을 우물 좌표로 바꾼다. 카메라는 우물 둘레를 돌 수 있어서, 같은 "오른쪽" 키라도
// 보는 방향에 따라 우물의 +x 일 수도 -y 일 수도 있다. 카메라 방향을 90° 단위(사분면 q)로 맞춰
// 화면 오른쪽·안쪽 방향을 정한다. q = 0 은 남쪽(-y)에서 북쪽(+y)을 바라보는 기본 시점이고,
// q 가 하나 늘 때마다 위에서 봐서 시계 반대 방향으로 90° 돈 자리에서 본다.

/** 평면 벡터 (x, y) 를 위에서 봐서 시계 반대 방향으로 q × 90° 돌린다 */
function turn([x, y], q) {
  for (let i = 0; i < ((q % 4) + 4) % 4; i++) [x, y] = [0 - y, x]; // 0 - y: -0 이 생기지 않게
  return [x, y];
}

/** 사분면 q 에서 화면 오른쪽(right)과 화면 안쪽(away) 방향 */
export function viewAxes(q) {
  return { right: turn([1, 0], q), away: turn([0, 1], q) };
}

/** 화면 기준 이동(left/right/up/down)을 우물의 [dx, dy] 로 */
export function moveVector(direction, q) {
  const { right, away } = viewAxes(q);
  switch (direction) {
    case 'right':
      return right;
    case 'left':
      return [0 - right[0], 0 - right[1]];
    case 'up':
      return away;
    case 'down':
      return [0 - away[0], 0 - away[1]];
  }
  throw new Error(`알 수 없는 방향: ${direction}`);
}

/** 평면 단위 벡터를 축 이름과 부호로: [0, -1] → ['y', -1] */
function axisOf([x, y]) {
  return x !== 0 ? ['x', Math.sign(x)] : ['y', Math.sign(y)];
}

// 화면 기준 회전. 이름은 조각이 화면에서 움직여 보이는 모양이다.
//   pitch: 화면 가로축 중심. +1 이면 윗부분이 안쪽으로 넘어간다
//   roll:  화면 안쪽 축 중심. +1 이면 윗부분이 오른쪽으로 넘어간다
//   yaw:   세로축 중심. +1 이면 위에서 봐서 시계 방향
export const TURNS = ['pitch', 'roll', 'yaw'];

/** 화면 기준 회전을 우물의 { axis, dir } 로 (pieces.js 의 오른손 법칙 회전) */
export function rotation(turnName, sign, q) {
  const { right, away } = viewAxes(q);
  let axis;
  let base;
  if (turnName === 'pitch') {
    // 오른쪽 축으로 +90° 면 위(z)가 바깥(-away)으로 오므로, 안쪽으로 넘기려면 -90°
    [axis, base] = axisOf(right);
    base = -base;
  } else if (turnName === 'roll') {
    // 안쪽 축으로 +90° 면 위(z)가 오른쪽(right)으로 간다
    [axis, base] = axisOf(away);
  } else if (turnName === 'yaw') {
    // z 축으로 +90° 는 위에서 봐서 시계 반대 방향
    axis = 'z';
    base = -1;
  } else {
    throw new Error(`알 수 없는 회전: ${turnName}`);
  }
  return { axis, dir: base * sign };
}
