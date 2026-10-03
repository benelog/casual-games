import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP, MAP_ROWS, parseMap, positionAt, tileAt } from '../js/map.js';

test('맵 크기와 타일 종류', () => {
  assert.equal(MAP.cols, 14);
  assert.equal(MAP.rows, 9);
  assert.equal(MAP_ROWS.length, 9);
  assert.equal(tileAt(MAP, 0, 1), 'path');
  assert.equal(tileAt(MAP, 0, 0), 'block');
  assert.equal(tileAt(MAP, 5, 5), 'build');
  assert.equal(tileAt(MAP, -1, 0), null);
  assert.equal(tileAt(MAP, 14, 0), null);
});

test('경로는 왼쪽 가장자리 스폰에서 오른쪽 가장자리 기지까지 끊김 없이 이어진다', () => {
  assert.equal(MAP.spawn.col, 0);
  assert.equal(MAP.base.col, MAP.cols - 1);
  for (let i = 1; i < MAP.cells.length; i++) {
    const a = MAP.cells[i - 1];
    const b = MAP.cells[i];
    assert.equal(Math.abs(a.col - b.col) + Math.abs(a.row - b.row), 1, `${i}번째 칸`);
  }
  const pathTiles = MAP.tiles.flat().filter((t) => t === 'path').length;
  assert.equal(MAP.cells.length, pathTiles);
});

test('웨이포인트와 경로 길이', () => {
  assert.deepEqual(MAP.waypoints, [
    { x: 0, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 7 },
    { x: 7, y: 7 },
    { x: 7, y: 1 },
    { x: 11, y: 1 },
    { x: 11, y: 5 },
    { x: 13, y: 5 },
  ]);
  assert.equal(MAP.length, 29);
  assert.equal(MAP.length, MAP.cells.length - 1);
});

test('경로 위의 위치', () => {
  assert.deepEqual(positionAt(MAP, 0), { x: 0, y: 1, dx: 1, dy: 0 });
  assert.deepEqual(positionAt(MAP, 4.5), { x: 3, y: 2.5, dx: 0, dy: 1 });
  assert.deepEqual(positionAt(MAP, 9), { x: 3, y: 7, dx: 1, dy: 0 });
  const end = positionAt(MAP, 100);
  assert.equal(end.x, 13);
  assert.equal(end.y, 5);
});

test('타워 하나의 사거리가 경로를 두 번 덮는 자리가 있다', () => {
  // (5, 4) 는 장식이지만 그 위아래 칸은 세로 구간 두 개(3열, 7열)에서 2칸 떨어져 있다
  assert.equal(tileAt(MAP, 5, 3), 'build');
  assert.ok(Math.abs(5 - 3) <= 2.5 && Math.abs(7 - 5) <= 2.5);
});

test('잘못된 맵은 거부한다', () => {
  assert.throws(() => parseMap(['S#..', '..#B'])); // 끊긴 경로
  assert.throws(() => parseMap(['S##B', '.#..'])); // 갈림길
  assert.throws(() => parseMap(['....', '...B'])); // 스폰 없음
  assert.throws(() => parseMap(['S#B', '..'])); // 행 길이가 다름
  assert.throws(() => parseMap(['S?B'])); // 모르는 문자
  assert.equal(parseMap(['S##B']).length, 3);
});
