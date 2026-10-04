// 당구대 규격. 화면·소리와 분리된 순수 데이터라 node 에서 그대로 테스트한다.
//
// 좌표는 미터 단위의 평면이다. 원점은 당구대 한가운데, x 는 긴 쪽(-L/2 ~ L/2), y 는 짧은 쪽(-W/2 ~ W/2).
// L·W 는 쿠션 코(공이 닿는 선) 사이의 길이다. 헤드 스트링(브레이크 쪽)은 x = -L/4, 풋 스폿은 (L/4, 0).
//
// 쿠션은 '사슬'(이어진 꺾은선)로 적는다. 사슬을 따라가면 왼쪽이 공이 다니는 쪽이다.
// 물리는 사슬의 선분과 공 중심의 거리로 충돌을 보고, 화면은 사슬을 바깥으로 두껍게 밀어 쿠션 고무를 그린다.
// 포켓볼 대의 포켓은 쿠션이 끊긴 입구와 그 안쪽으로 들어간 턱(jaw) 선분으로 만든다.

export const G = 9.81;

/** 쿠션 고무의 두께와 레일(나무) 폭. 화면에서만 쓴다 */
export const CUSHION_WIDTH = 0.05;
export const RAIL_WIDTH = 0.11;

const CAROM_CLOTH = {
  slide: 0.14, // 미끄러질 때 천과의 마찰 계수 (실제보다 조금 낮춰 끌어치기가 잘 듣게 한다)
  roll: 0.011, // 구를 때의 저항 계수 (데운 캐롬 천은 빠르다)
  spin: 0.044, // 제자리 회전(옆 회전)이 줄어드는 정도
  cushion: 0.84, // 쿠션 반발 계수
  cushionFriction: 0.35, // 쿠션과 공 사이의 마찰 (옆 회전이 반사각을 바꾼다)
  ball: 0.94, // 공끼리의 반발 계수
  ballFriction: 0.05, // 공끼리의 마찰 (스로)
};

const POOL_CLOTH = {
  ...CAROM_CLOTH,
  slide: 0.15,
  roll: 0.014,
  cushion: 0.78,
  cushionFriction: 0.3,
};

/** 사슬의 이어진 두 점을 선분으로 */
function segmentsOf(chains) {
  const segments = [];
  chains.forEach((chain, c) => {
    for (let i = 0; i + 1 < chain.length; i++) {
      const [ax, ay] = chain[i];
      const [bx, by] = chain[i + 1];
      segments.push({ ax, ay, bx, by, chain: c });
    }
  });
  return segments;
}

/** 캐롬 대: 포켓이 없는 직사각형. 쿠션 번호는 0 아래(-y) · 1 오른쪽(+x) · 2 위(+y) · 3 왼쪽(-x) */
export function caromTable({ length, width, ballRadius }) {
  const x = length / 2;
  const y = width / 2;
  const chains = [
    [
      [-x, -y],
      [x, -y],
      [x, y],
      [-x, y],
      [-x, -y],
    ],
  ];
  const segments = segmentsOf(chains);
  segments.forEach((s, i) => (s.rail = i));
  return { kind: 'carom', length, width, ballRadius, chains, segments, pockets: [], cloth: CAROM_CLOTH, closed: true };
}

/**
 * 포켓볼 대 (9피트). 코너 포켓 입구 약 11.6cm, 사이드 포켓 입구 약 13.6cm.
 * 포켓은 { x, y: 입구 가운데, ax, ay: 안쪽 방향, half: 입구 반폭, depth: 이만큼 넘어가면 빠진다,
 * cx, cy, r: 화면에 그릴 구멍 }.
 */
export function poolTable({ length, width, ballRadius }) {
  const X = length / 2;
  const Y = width / 2;
  const R = ballRadius;
  const c = 0.082; // 코너 포켓 입구의 양 끝이 모서리에서 떨어진 거리 (입구 폭 c·√2)
  const s = 0.068; // 사이드 포켓 입구 반폭
  const j = 0.075; // 턱 길이
  const si = 0.012; // 사이드 포켓 턱이 안쪽으로 좁아지는 정도
  const jd = j * Math.SQRT1_2; // 코너 턱은 대각선으로 뻗는다

  // 반시계 방향으로 도는 사슬 6개 (아래 왼쪽부터). 각 사슬은 턱 → 쿠션 코 → 쿠션 코 → 턱
  const chains = [
    [[-X + c - jd, -Y - jd], [-X + c, -Y], [-s, -Y], [-s + si, -Y - j]],
    [[s - si, -Y - j], [s, -Y], [X - c, -Y], [X - c + jd, -Y - jd]],
    [[X + jd, -Y + c - jd], [X, -Y + c], [X, Y - c], [X + jd, Y - c + jd]],
    [[X - c + jd, Y + jd], [X - c, Y], [s, Y], [s - si, Y + j]],
    [[-s + si, Y + j], [-s, Y], [-X + c, Y], [-X + c - jd, Y + jd]],
    [[-X - jd, Y - c + jd], [-X, Y - c], [-X, -Y + c], [-X - jd, -Y + c - jd]],
  ];

  const pockets = [];
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    pockets.push({
      x: sx * (X - c / 2),
      y: sy * (Y - c / 2),
      ax: sx * Math.SQRT1_2,
      ay: sy * Math.SQRT1_2,
      half: (c * Math.SQRT2) / 2,
      depth: R * 0.9,
      cx: sx * (X + 0.012),
      cy: sy * (Y + 0.012),
      r: 0.066,
      corner: true,
    });
  }
  for (const sy of [-1, 1]) {
    pockets.push({ x: 0, y: sy * Y, ax: 0, ay: sy, half: s, depth: R * 1.05, cx: 0, cy: sy * (Y + 0.036), r: 0.064, corner: false });
  }
  return { kind: 'pool', length, width, ballRadius, chains, segments: segmentsOf(chains), pockets, cloth: POOL_CLOTH, closed: false };
}

/** 점 (x, y) 에 반지름 R 인 공을 놓을 수 있는가 (쿠션 안쪽) */
export function insideTable(table, x, y, R = table.ballRadius) {
  return Math.abs(x) <= table.length / 2 - R && Math.abs(y) <= table.width / 2 - R;
}

/** 다이아몬드(사이트) 자리. 긴 쪽 7개씩, 짧은 쪽 3개씩. 화면과 3쿠션 설명에 쓴다 */
export function diamonds(table) {
  const out = [];
  const { length: L, width: W } = table;
  for (let i = 1; i < 8; i++) {
    if (table.kind === 'pool' && i === 4) continue; // 사이드 포켓 자리
    for (const sy of [-1, 1]) out.push({ x: -L / 2 + (i * L) / 8, y: sy * W / 2, side: 'long', sy });
  }
  for (let j = 1; j < 4; j++) {
    for (const sx of [-1, 1]) out.push({ x: sx * L / 2, y: -W / 2 + (j * W) / 4, side: 'short', sx });
  }
  return out;
}
