// 조각(폴리큐브) 정의와 회전. 좌표는 (x, y, z) 정수이고 z 가 위쪽이다.
// 각 조각의 칸은 회전 중심(피벗) 칸 [0, 0, 0] 에 대한 상대 위치로 적는다. 피벗이 정수 칸이라
// 90° 회전이 정수로 딱 떨어지고, 같은 축으로 네 번 돌리면 원래 모양으로 돌아온다.
// 화면에 보이는 조각·묶음 이름은 i18n.js 의 'piece.종류', 'set.묶음' 문구다.

export const PIECES = {
  // 작은 조각
  D2: { cells: [[0, 0, 0], [1, 0, 0]] },
  I3: { cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0]] },
  V3: { cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },
  // 평면 4칸
  I4: { cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]] },
  O4: { cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]] },
  T4: { cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]] },
  L4: { cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]] },
  S4: { cells: [[-1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  // 입체 4칸: 세 갈래와 서로 거울상인 두 나사
  B4: { cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  R4: { cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 0, 1]] },
  K4: { cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 1]] },
  // 5칸
  X5: { cells: [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] },
  P5: { cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, -1, 0]] },
  U5: { cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [-1, 1, 0], [1, 1, 0]] },
  V5: { cells: [[-1, -1, 0], [0, -1, 0], [1, -1, 0], [-1, 0, 0], [-1, 1, 0]] },
  T5: { cells: [[-1, 1, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0], [0, -1, 0]] },
  W5: { cells: [[-1, 1, 0], [-1, 0, 0], [0, 0, 0], [0, -1, 0], [1, -1, 0]] },
  Q5: { cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1]] },
  Y5: { cells: [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] },
};

const FLAT = ['D2', 'I3', 'V3', 'I4', 'O4', 'T4', 'L4', 'S4'];
const BASIC = [...FLAT, 'B4', 'R4', 'K4'];
const EXTENDED = [...BASIC, 'X5', 'P5', 'U5', 'V5', 'T5', 'W5', 'Q5', 'Y5'];

export const PIECE_SETS = {
  flat: { kinds: FLAT },
  basic: { kinds: BASIC },
  extended: { kinds: EXTENDED },
};
export const SET_IDS = Object.keys(PIECE_SETS);

const neg = (v) => 0 - v; // -0 이 생기지 않게

/** 오른손 법칙으로 axis 축을 중심으로 dir(+1 이면 +90°, -1 이면 -90°) 만큼 돌린다 */
export function rotateCell([x, y, z], axis, dir) {
  if (axis === 'x') return dir > 0 ? [x, neg(z), y] : [x, z, neg(y)];
  if (axis === 'y') return dir > 0 ? [z, y, neg(x)] : [neg(z), y, x];
  if (axis === 'z') return dir > 0 ? [neg(y), x, z] : [y, neg(x), z];
  throw new Error(`알 수 없는 축: ${axis}`);
}

export function rotateCells(cells, axis, dir) {
  return cells.map((c) => rotateCell(c, axis, dir));
}

/** 칸들의 최소·최대 좌표 */
export function bounds(cells) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of cells) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], c[i]);
      max[i] = Math.max(max[i], c[i]);
    }
  }
  return { min, max, size: max.map((v, i) => v - min[i] + 1) };
}

// 처음 나올 때 시도하는 방향. 바닥 면이 넓은 원래 방향부터, 우물이 좁으면 세워 본다
const SPAWN_TURNS = [[], [['z', 1]], [['x', 1]], [['y', 1]], [['x', 1], ['z', 1]], [['y', 1], ['z', 1]]];

/** 가로 width, 세로 depth 인 우물에 들어가는 첫 방향의 칸들. 없으면 null */
export function spawnCells(kind, width, depth) {
  for (const turns of SPAWN_TURNS) {
    let cells = PIECES[kind].cells;
    for (const [axis, dir] of turns) cells = rotateCells(cells, axis, dir);
    const { size } = bounds(cells);
    if (size[0] <= width && size[1] <= depth) return cells;
  }
  return null;
}
