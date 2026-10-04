// 단계가 풀리는지 확인하는 간단한 경로 탐색 (하이브리드 A*). 테스트에서 단계 데이터를 검증할 때 쓴다.
// 차를 앞뒤로, 핸들을 다섯 가지(왼쪽 끝·반·가운데·반·오른쪽 끝)로 꺾어 짧게 움직여 보는 동작을 이어 붙인다.
// 자리(0.25m)와 방향(5°)을 칸으로 나눠 같은 칸에 두 번 들르지 않는다. 가장 짧은 길을 보장하지는 않는다.

import { advance, carBox, firstHit } from './physics.js';
import { buildObstacles } from './levels.js';
import { parkStatus } from './game.js';

const CELL = 0.25;
const HEADING_BINS = 72;
const STEERS = [-1, -0.5, 0, 0.5, 1];
const REVERSE_COST = 1.4; // 후진은 조금 더 비싸게
const SWITCH_COST = 4; // 전후진 전환
const STEER_COST = 0.2; // 핸들을 바꾸는 것
const WEIGHT = 1.6; // 거리 어림값을 부풀려 빨리 찾는다

class Heap {
  constructor() {
    this.items = [];
  }

  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.items.length;
  }
}

/** 차가 pose 에서 장애물과 겹치는지 */
export function collides(pose, obstacles) {
  return !!firstHit(carBox(pose), obstacles);
}

/**
 * 출발 자리에서 주차 칸까지 가는 길을 찾는다.
 * 찾으면 { path: [{ x, z, heading, dir, steer }], switches, length, nodes }, 못 찾으면 null.
 */
export function solve(level, { maxNodes = 150000, step = 0.6, substeps = 4 } = {}) {
  const obstacles = buildObstacles(level);
  const { spot } = level;
  const start = { ...level.start };
  if (collides(start, obstacles)) return null;

  const key = (p) => {
    const h = Math.round(((p.heading / (Math.PI * 2)) * HEADING_BINS) % HEADING_BINS);
    return `${Math.round(p.x / CELL)},${Math.round(p.z / CELL)},${(h + HEADING_BINS) % HEADING_BINS}`;
  };
  const estimate = (p) => Math.hypot(p.x - spot.x, p.z - spot.z);

  const heap = new Heap();
  const closed = new Set();
  heap.push({ pose: start, g: 0, f: estimate(start), dir: 0, steer: 0, parent: null });
  let nodes = 0;
  while (heap.size && nodes < maxNodes) {
    const node = heap.pop();
    const k = key(node.pose);
    if (closed.has(k)) continue;
    closed.add(k);
    nodes++;
    for (const dir of [1, -1]) {
      for (const steer of STEERS) {
        let pose = node.pose;
        let ok = true;
        let goal = null;
        for (let i = 1; i <= substeps; i++) {
          pose = advance(pose, (dir * step) / substeps, steer);
          if (collides(pose, obstacles)) {
            ok = false;
            break;
          }
          if (parkStatus(pose, spot).aligned) {
            goal = pose;
            break;
          }
        }
        if (!ok) continue;
        const g =
          node.g +
          step * (dir < 0 ? REVERSE_COST : 1) +
          (node.dir && node.dir !== dir ? SWITCH_COST : 0) +
          Math.abs(steer - node.steer) * STEER_COST;
        const child = { pose: goal ?? pose, g, f: g + WEIGHT * estimate(pose), dir, steer, parent: node };
        if (goal) return finish(child, nodes);
        if (!closed.has(key(pose))) heap.push(child);
      }
    }
  }
  return null;
}

function finish(node, nodes) {
  const path = [];
  for (let n = node; n; n = n.parent) path.push({ ...n.pose, dir: n.dir, steer: n.steer });
  path.reverse();
  let switches = 0;
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i - 1].dir && path[i].dir !== path[i - 1].dir) switches++;
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return { path, switches, length, nodes };
}
