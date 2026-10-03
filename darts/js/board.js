// 다트보드 규격과 점수 계산. 좌표는 보드 중심 기준 mm (x 오른쪽, y 위).

// 맨 위(20)부터 시계 방향
export const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

export const RADIUS = {
  bull: 6.35,
  outerBull: 15.9,
  trebleInner: 99,
  trebleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,
};

const SLICE = (Math.PI * 2) / 20;
const PREFIX = { 1: '', 2: 'D', 3: 'T' };

export function scoreAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= RADIUS.bull) return { score: 50, number: 25, multiplier: 2, label: '불스아이' };
  if (r <= RADIUS.outerBull) return { score: 25, number: 25, multiplier: 1, label: '불' };
  if (r > RADIUS.doubleOuter) return { score: 0, number: 0, multiplier: 0, label: '빗나감' };

  // 맨 위를 0 으로 시계 방향으로 재는 각도. 20 구역은 맨 위를 중심으로 좌우 9도씩이다
  const angle = (Math.atan2(x, y) + SLICE / 2 + Math.PI * 2) % (Math.PI * 2);
  const number = SEGMENTS[Math.floor(angle / SLICE)];
  let multiplier = 1;
  if (r >= RADIUS.trebleInner && r <= RADIUS.trebleOuter) multiplier = 3;
  else if (r >= RADIUS.doubleInner) multiplier = 2;
  return { score: number * multiplier, number, multiplier, label: `${PREFIX[multiplier]}${number}` };
}

/** 겨냥할 구역의 한가운데 좌표 */
export function targetPoint(number, multiplier) {
  if (number === 25) return multiplier === 2 ? { x: 0, y: 0 } : { x: 0, y: (RADIUS.bull + RADIUS.outerBull) / 2 };
  const r =
    multiplier === 3
      ? (RADIUS.trebleInner + RADIUS.trebleOuter) / 2
      : multiplier === 2
        ? (RADIUS.doubleInner + RADIUS.doubleOuter) / 2
        : (RADIUS.trebleOuter + RADIUS.doubleInner) / 2;
  const angle = SEGMENTS.indexOf(number) * SLICE;
  return { x: r * Math.sin(angle), y: r * Math.cos(angle) };
}
