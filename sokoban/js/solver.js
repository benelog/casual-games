// 소코반 풀이기. 밀기 횟수가 가장 적은 풀이를 너비 우선 탐색으로 찾는다.
// 레벨이 실제로 풀리는지 테스트에서 확인하는 데 쓴다 (test/sokoban.test.js). 순수 로직이다.
//
// 상태는 (상자 자리들, 캐릭터가 돌아다닐 수 있는 구역) 이다. 캐릭터가 상자를 밀지 않고 걸어 다니는 것은
// 상태를 바꾸지 않으므로, 구역 안에서 가장 번호가 작은 칸으로 구역을 대표한다.

import { DIRS } from './game.js';

const LETTERS = { up: 'u', down: 'd', left: 'l', right: 'r' };
export const LETTER_DIRS = { u: 'up', d: 'down', l: 'left', r: 'right' };

/**
 * 상자가 들어가면 어떤 목표로도 못 가는 칸(구석 등)을 찾는다.
 * 목표에서 상자를 거꾸로 끌어 닿는 칸만 살아 있는 칸이다 (다른 상자는 없다고 치고).
 */
export function deadCells(level) {
  const { width, height, walls } = level;
  const offsets = Object.values(DIRS).map(([dx, dy]) => dy * width + dx);
  const alive = new Uint8Array(width * height);
  const stack = [...level.goals];
  for (const g of stack) alive[g] = 1;
  while (stack.length) {
    const cell = stack.pop();
    for (const d of offsets) {
      // 상자가 from → cell 로 밀려 왔다면 캐릭터는 from - d 에 서 있었다
      const from = cell - d;
      const stand = from - d;
      if (walls[from] || walls[stand] || alive[from]) continue;
      alive[from] = 1;
      stack.push(from);
    }
  }
  const dead = new Uint8Array(width * height);
  for (let i = 0; i < dead.length; i++) dead[i] = !walls[i] && !alive[i] ? 1 : 0;
  return dead;
}

/** start 에서 상자를 넘지 않고 닿는 칸들. mark[cell] === stamp 로 표시하고 가장 작은 칸 번호를 돌려준다 */
function flood(level, offsets, occupied, start, mark, stamp, queue) {
  let head = 0;
  let tail = 0;
  let min = start;
  queue[tail++] = start;
  mark[start] = stamp;
  while (head < tail) {
    const cell = queue[head++];
    for (const d of offsets) {
      const next = cell + d;
      if (mark[next] === stamp || level.walls[next] || occupied[next]) continue;
      mark[next] = stamp;
      if (next < min) min = next;
      queue[tail++] = next;
    }
  }
  return min;
}

/** 상자를 넘지 않고 from → to 로 걷는 가장 짧은 길 (방향 글자 문자열). 없으면 null */
function walk(level, occupied, from, to) {
  if (from === to) return '';
  const { width } = level;
  const prev = new Map([[from, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    for (const [name, [dx, dy]] of Object.entries(DIRS)) {
      const next = cell + dy * width + dx;
      if (prev.has(next) || level.walls[next] || occupied[next]) continue;
      prev.set(next, [cell, LETTERS[name]]);
      if (next === to) {
        let path = '';
        for (let at = to; prev.get(at); at = prev.get(at)[0]) path = prev.get(at)[1] + path;
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * 레벨을 푼다.
 * @param level parseLevel() 의 결과
 * @returns {{ path: string, pushes: number, states: number } | null}
 *   path 는 'u' 'd' 'l' 'r' 로 된 걸음 순서. 풀 수 없거나 maxStates 를 넘기면 null.
 */
export function solve(level, { maxStates = 3_000_000 } = {}) {
  const { width, height, walls } = level;
  const size = width * height;
  const dirs = Object.entries(DIRS).map(([name, [dx, dy]]) => ({ name, d: dy * width + dx }));
  const offsets = dirs.map((dir) => dir.d);
  const dead = deadCells(level);
  const isGoal = new Uint8Array(size);
  for (const g of level.goals) isGoal[g] = 1;

  const occupied = new Uint8Array(size);
  const mark = new Uint32Array(size); // 민 뒤의 구역 계산용
  const reach = new Uint32Array(size); // 지금 상태에서 캐릭터가 닿는 칸
  const queue = new Int32Array(size);
  let stamp = 0;

  const keyOf = (boxes, zone) => `${boxes.join(',')}|${zone}`;
  const start = [...level.boxes].sort((a, b) => a - b);
  for (const b of start) occupied[b] = 1;
  const startZone = flood(level, offsets, occupied, level.player, mark, ++stamp, queue);
  for (const b of start) occupied[b] = 0;

  // 상태마다 { 상자들, 밀고 난 뒤 캐릭터 자리, 부모, 민 상자의 원래 자리, 방향 }
  const nodes = [{ boxes: start, player: level.player, parent: -1, from: -1, dir: null }];
  const seen = new Map([[keyOf(start, startZone), 0]]);
  const done = (boxes) => boxes.every((b) => isGoal[b]);
  let goalNode = done(start) ? 0 : -1;

  for (let head = 0; head < nodes.length && goalNode < 0; head++) {
    const node = nodes[head];
    for (const b of node.boxes) occupied[b] = 1;
    flood(level, offsets, occupied, node.player, reach, ++stamp, queue);
    const here = stamp;
    search: for (let i = 0; i < node.boxes.length; i++) {
      const box = node.boxes[i];
      for (const { name, d } of dirs) {
        const stand = box - d;
        const to = box + d;
        if (reach[stand] !== here || walls[to] || occupied[to] || dead[to]) continue;
        const boxes = node.boxes.slice();
        boxes[i] = to;
        boxes.sort((a, b) => a - b);
        // 민 뒤의 구역을 구한다 (상자 자리를 잠깐 바꿔서)
        occupied[box] = 0;
        occupied[to] = 1;
        const zone = flood(level, offsets, occupied, box, mark, ++stamp, queue);
        occupied[to] = 0;
        occupied[box] = 1;
        const key = keyOf(boxes, zone);
        if (seen.has(key)) continue;
        seen.set(key, nodes.length);
        nodes.push({ boxes, player: box, parent: head, from: box, dir: name });
        if (done(boxes)) {
          goalNode = nodes.length - 1;
          break search;
        }
        if (nodes.length > maxStates) return null;
      }
    }
    for (const b of node.boxes) occupied[b] = 0;
  }
  if (goalNode < 0) return null;

  // 밀기 순서를 거슬러 올라가 모으고, 사이사이 걷는 길을 채운다
  const pushes = [];
  for (let at = goalNode; nodes[at].parent >= 0; at = nodes[at].parent) pushes.push(nodes[at]);
  pushes.reverse();
  let path = '';
  let player = level.player;
  const boxes = new Set(level.boxes);
  for (const push of pushes) {
    occupied.fill(0);
    for (const b of boxes) occupied[b] = 1;
    const d = dirs.find((dir) => dir.name === push.dir).d;
    const steps = walk(level, occupied, player, push.from - d);
    if (steps === null) throw new Error('풀이를 되짚다 길이 끊겼다');
    path += steps + LETTERS[push.dir];
    boxes.delete(push.from);
    boxes.add(push.from + d);
    player = push.from;
  }
  return { path, pushes: pushes.length, states: nodes.length };
}
