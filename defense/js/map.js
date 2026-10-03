// 맵 데이터와 경로 계산. 좌표 단위는 타일이고 타일 (col, row) 의 중심이 (x, y) = (col, row) 이다.
// x 는 오른쪽, y 는 아래(화면 안쪽)로 커진다. 렌더링과 무관한 순수 로직.

// 문자 하나가 타일 하나:
//   S 스폰(경로 시작)  B 기지(경로 끝)  # 경로  . 건설 가능
//   T 나무  R 바위  C 수정  H 언덕 (장식, 건설 불가)
// 경로는 S 에서 B 까지 갈림길 없이 한 줄로 이어져야 한다. 세로 구간 사이가 3칸이라
// 가운데 열에 지은 타워는 양쪽 경로를 함께 덮는다.
export const MAP_ROWS = [
  'T.....R.....TT',
  'S###...#####.T',
  '...#...#...#..',
  'R..#...#...#..',
  '...#.C.#...#..',
  '...#...#...##B',
  'T..#...#..H...',
  '...#####......',
  'TT.....T....RT',
];

const BLOCKS = { T: 'tree', R: 'rock', C: 'crystal', H: 'hill' };
const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** 문자열 배열을 맵으로 해석하고 웨이포인트·경로 길이를 계산한다. 잘못된 맵이면 예외 */
export function parseMap(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const tiles = [];
  const decor = [];
  let spawn = null;
  let base = null;
  rows.forEach((line, row) => {
    if (line.length !== width) throw new Error(`${row}행의 길이가 다릅니다`);
    tiles.push([]);
    decor.push([]);
    [...line].forEach((ch, col) => {
      if (ch === 'S') spawn = { col, row };
      if (ch === 'B') base = { col, row };
      if (ch === 'S' || ch === 'B' || ch === '#') tiles[row].push('path');
      else if (ch === '.') tiles[row].push('build');
      else if (BLOCKS[ch]) tiles[row].push('block');
      else throw new Error(`알 수 없는 타일 '${ch}'`);
      decor[row].push(BLOCKS[ch] ?? null);
    });
  });
  if (!spawn || !base) throw new Error('스폰(S)과 기지(B)가 하나씩 있어야 합니다');

  const isPath = (col, row) => tiles[row]?.[col] === 'path';
  // 스폰에서 출발해 왔던 칸이 아닌 이웃 경로 칸을 따라간다
  const cells = [spawn];
  let prev = null;
  let cur = spawn;
  while (cur.col !== base.col || cur.row !== base.row) {
    const next = DIRS.map(([dx, dy]) => ({ col: cur.col + dx, row: cur.row + dy })).filter(
      (n) => isPath(n.col, n.row) && !(prev && n.col === prev.col && n.row === prev.row),
    );
    if (next.length !== 1) throw new Error(`경로가 (${cur.col}, ${cur.row}) 에서 끊기거나 갈라집니다`);
    prev = cur;
    cur = next[0];
    cells.push(cur);
    if (cells.length > width * height) throw new Error('경로가 순환합니다');
  }
  const pathCount = tiles.flat().filter((t) => t === 'path').length;
  if (pathCount !== cells.length) throw new Error('경로에 연결되지 않은 경로 타일이 있습니다');

  // 방향이 바뀌는 칸만 웨이포인트로 남긴다
  const waypoints = [{ x: spawn.col, y: spawn.row }];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1];
    const b = cells[i];
    const c = cells[i + 1];
    if (b.col - a.col !== c.col - b.col || b.row - a.row !== c.row - b.row) waypoints.push({ x: b.col, y: b.row });
  }
  waypoints.push({ x: base.col, y: base.row });

  const segments = [];
  let length = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ from, to, start: length, length: len, dx: (to.x - from.x) / len, dy: (to.y - from.y) / len });
    length += len;
  }

  return { cols: width, rows: height, tiles, decor, spawn, base, cells, waypoints, segments, length };
}

/** 경로를 따라 dist 만큼 간 지점. 범위를 벗어나면 양 끝에 붙는다 */
export function positionAt(map, dist) {
  const { segments } = map;
  let seg = segments[segments.length - 1];
  for (const s of segments) {
    if (dist < s.start + s.length) {
      seg = s;
      break;
    }
  }
  const t = Math.min(Math.max(dist - seg.start, 0), seg.length);
  return { x: seg.from.x + seg.dx * t, y: seg.from.y + seg.dy * t, dx: seg.dx, dy: seg.dy };
}

export function tileAt(map, col, row) {
  return map.tiles[row]?.[col] ?? null;
}

export const MAP = parseMap(MAP_ROWS);
