// 컴퓨터: 판을 6칸짜리 창(window) 924개로 보고 평가한다. 한 창에 한 편의 돌만 있으면 그 편이 그 창을 채워
// 6목을 만들 수 있으므로, 돌이 많은 창일수록 값을 크게 친다. 상대 돌이 섞인 창은 누구에게도 쓸모없다.
//
// - 위협(threat): 내 돌이 4·5개이고 상대 돌이 없는 창. 상대가 다음 차례(두 개)에 막지 않으면 내가 6목을 만든다.
//   위협을 모두 막는 데 필요한 돌 수가 위협 수다. 위협이 3이면 상대는 두 개로 다 막지 못하므로 이긴 셈이다.
// - 한 차례의 두 돌은 함께 고른다. 판의 칸마다 공격·수비 값을 어림해 좋은 후보만 남기고(가지치기),
//   후보 두 개의 조합을 모두 놓아 본 판을 평가해 가장 좋은 조합을 고른다.
//   이길 수 있으면 먼저 6목을 완성하고, 상대에게 위협이 남는 조합은 진 것으로 쳐서 자연히 막는 수를 고른다.
// - 어려움은 좋은 조합 몇 개에 대해 상대의 가장 좋은 응수까지 따져 보고(2수 앞), 위협 공간 탐색으로
//   위협 2개짜리 수를 거듭해 몰아붙이면 이기는 길을 찾아 두거나, 상대에게 그런 길을 주는 조합을 피한다.
//
// 계산은 창마다 흑·백 돌 수를 세어 두고 돌을 놓거나 거둘 때 그 칸이 든 창(많아야 24개)만 고치므로 빠르다.
// 한 차례에 쉬움·보통은 몇 밀리초, 어려움은 대개 수십 밀리초이고 탐색 한도를 두어 길어도 백여 밀리초에서 멈춘다.
// 화면이 멈추지 않도록 브라우저에서는 worker.js 가 따로 계산한다.

import { SIZE, CELLS, EMPTY, WIN_LENGTH, DIRECTIONS, indexOf, inside } from './game.js';

/**
 * 실력. candidates: 조합을 만들 후보 칸 수, noise: 평가에 섞는 흔들림 비율, top: 좋은 조합 몇 개 중에서 고르는지,
 * lookahead: 상대 응수까지 따져 볼 조합 수 (0 이면 따지지 않는다),
 * tss: 위협을 거듭해 몰아붙이는 길을 몇 차례 앞까지 찾는지 (0 이면 찾지 않는다)
 */
export const LEVELS = {
  easy: { candidates: 8, noise: 0.45, top: 4, lookahead: 0, tss: 0 },
  normal: { candidates: 12, noise: 0.08, top: 2, lookahead: 0, tss: 0 },
  hard: { candidates: 20, noise: 0, top: 1, lookahead: 16, tss: 3 },
};
export const LEVEL_IDS = Object.keys(LEVELS);

export const WIN = 1e6;
const SURE = 5e5; // 위협이 3 이상 (상대가 다 막지 못한다)

/**
 * 평가 가중치. mine·theirs: 차례를 마친 쪽(me)이 본, 한 편의 돌만 있는 창의 값 (돌 수별, 다음은 상대가 두 개를 둔다).
 * 상대 돌만 4개 이상인 창은 상대가 바로 채우므로 값 대신 진 것으로 친다.
 * threat: 내 위협 수별 덤 (상대가 막느라 두 돌을 써야 한다).
 * attack·defense: 후보 칸을 고를 때 그 칸이 든 창의 내 돌 수 / 상대 돌 수별로 더하는 값
 */
export const WEIGHTS = {
  mine: [0, 1, 5, 20, 80, 80],
  theirs: [0, 1.2, 5, 35],
  threat: [0, 90, 400],
  attack: [1, 3, 10, 35, 120, 1000],
  defense: [0, 1, 4, 16, 400, 400],
};

// ---------- 창 ----------

/** 모든 6칸 창의 칸들, 칸마다 그 칸이 든 창 번호 */
export const WINDOWS = [];
export const CELL_WINDOWS = Array.from({ length: CELLS }, () => []);
for (const [dr, dc] of DIRECTIONS) {
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const endRow = row + dr * (WIN_LENGTH - 1);
      const endCol = col + dc * (WIN_LENGTH - 1);
      if (!inside(endRow, endCol)) continue;
      const cells = [];
      for (let k = 0; k < WIN_LENGTH; k++) cells.push(indexOf(row + dr * k, col + dc * k));
      for (const cell of cells) CELL_WINDOWS[cell].push(WINDOWS.length);
      WINDOWS.push(cells);
    }
  }
}

/** 판 하나와 창마다 편별 돌 수. 컴퓨터가 수를 놓아 보고 거둘 때 쓴다 */
export class Position {
  constructor(cells) {
    this.cells = Int8Array.from(cells);
    this.counts = [new Uint8Array(WINDOWS.length), new Uint8Array(WINDOWS.length)];
    this.stones = 0;
    for (let i = 0; i < CELLS; i++) {
      if (this.cells[i] === EMPTY) continue;
      this.stones++;
      for (const w of CELL_WINDOWS[i]) this.counts[this.cells[i]][w]++;
    }
  }

  place(index, team) {
    this.cells[index] = team;
    this.stones++;
    for (const w of CELL_WINDOWS[index]) this.counts[team][w]++;
  }

  remove(index) {
    const team = this.cells[index];
    this.cells[index] = EMPTY;
    this.stones--;
    for (const w of CELL_WINDOWS[index]) this.counts[team][w]--;
  }

  /** team 이 6목을 이뤘는지 (창 하나가 꽉 찼는지) */
  won(team) {
    return this.counts[team].includes(WIN_LENGTH);
  }

  /** team 의 돌만 n 개 이상 있는 창들 */
  liveWindows(team, n) {
    const mine = this.counts[team];
    const theirs = this.counts[1 - team];
    const list = [];
    for (let w = 0; w < WINDOWS.length; w++) if (mine[w] >= n && theirs[w] === 0) list.push(w);
    return list;
  }

  emptiesOf(w) {
    return WINDOWS[w].filter((i) => this.cells[i] === EMPTY);
  }

  /** team 의 위협 수: 4·5개짜리 살아 있는 창을 모두 막는 데 드는 돌 수. limit 개까지만 센다 */
  threats(team, limit = 3) {
    return blockCount(this, this.liveWindows(team, WIN_LENGTH - 2), limit);
  }
}

/** 창들을 모두 막는 데 드는 돌 수. 욕심껏 많이 막는 칸부터 세어 어림하고, limit 개까지만 센다 */
function blockCount(pos, windows, limit = 3) {
  let open = windows;
  let n = 0;
  while (open.length && n < limit) {
    const hits = new Map();
    for (const w of open) for (const i of pos.emptiesOf(w)) hits.set(i, (hits.get(i) ?? 0) + 1);
    let best = -1;
    let most = 0;
    for (const [i, k] of hits) if (k > most) [best, most] = [i, k];
    open = open.filter((w) => !WINDOWS[w].includes(best));
    n++;
  }
  return n;
}

// ---------- 평가 ----------

/**
 * me 가 차례를 마친 뒤의 판 값 (다음은 상대가 두 개를 둔다).
 * 내가 6목이면 WIN, 상대에게 위협이 남았으면 진 것(막지 못한 창이 많을수록 더 나쁘게),
 * 내 위협이 3 이상이면 거의 이긴 것, 아니면 창 값의 합.
 */
export function evaluate(pos, me) {
  const rival = 1 - me;
  if (pos.won(me)) return WIN;
  const mine = pos.counts[me];
  const theirs = pos.counts[rival];
  const { mine: MINE, theirs: THEIRS, threat: THREAT_BONUS } = WEIGHTS;
  let value = 0;
  let open = 0; // 상대가 다음 차례에 채울 수 있는 창
  for (let w = 0; w < WINDOWS.length; w++) {
    const m = mine[w];
    const o = theirs[w];
    if (o === 0) value += MINE[m];
    else if (m === 0) {
      if (o >= WIN_LENGTH - 2) open++;
      else value -= THEIRS[o];
    }
  }
  if (open) return -WIN - open;
  const threats = pos.threats(me);
  if (threats >= 3) return SURE + value;
  return value + THREAT_BONUS[threats];
}

/** team 이 index 에 두면 좋아지는 정도 (후보를 고르는 어림값) */
function cellValue(pos, index, team) {
  const mine = pos.counts[team];
  const theirs = pos.counts[1 - team];
  const { attack: ATTACK, defense: DEFENSE } = WEIGHTS;
  let value = 0;
  for (const w of CELL_WINDOWS[index]) {
    if (theirs[w] === 0) value += ATTACK[mine[w]];
    else if (mine[w] === 0) value += DEFENSE[theirs[w]];
  }
  return value;
}

/** 둘 만한 빈 칸: 돌에서 두 칸 안쪽. 판이 비었으면 천원 */
function nearbyEmpties(pos) {
  if (pos.stones === 0) return [indexOf((SIZE - 1) / 2, (SIZE - 1) / 2)];
  const seen = new Uint8Array(CELLS);
  const list = [];
  for (let i = 0; i < CELLS; i++) {
    if (pos.cells[i] === EMPTY) continue;
    const row = Math.floor(i / SIZE);
    const col = i % SIZE;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (!inside(row + dr, col + dc)) continue;
        const j = indexOf(row + dr, col + dc);
        if (seen[j] || pos.cells[j] !== EMPTY) continue;
        seen[j] = 1;
        list.push(j);
      }
    }
  }
  return list;
}

/**
 * team 이 둘 후보 칸 n 개 (좋은 순). 6목을 완성하거나 막아야 하는 칸은 반드시 넣는다.
 */
export function candidates(pos, team, n) {
  const must = new Set();
  for (const t of [team, 1 - team]) {
    for (const w of pos.liveWindows(t, WIN_LENGTH - 2)) for (const i of pos.emptiesOf(w)) must.add(i);
  }
  const scored = nearbyEmpties(pos).map((i) => ({ i, v: cellValue(pos, i, team) + (must.has(i) ? 1e4 : 0) }));
  scored.sort((a, b) => b.v - a.v || a.i - b.i);
  const list = scored.slice(0, Math.max(n, must.size)).map((s) => s.i);
  for (const i of must) if (!list.includes(i)) list.push(i);
  return list;
}

/**
 * team 이 이번 차례에 둘 count(1·2) 개 조합을 모두 놓아 보고 평가한다. [{ moves, value }] (좋은 순)
 */
export function rankTurns(pos, team, count, n) {
  const list = candidates(pos, team, n);
  const results = [];
  for (let a = 0; a < list.length; a++) {
    pos.place(list[a], team);
    if (count === 1 || pos.won(team)) {
      // 첫 돌로 이미 이겼으면 둘째 돌은 아무 데나 둬도 된다
      results.push({ moves: [list[a]], value: evaluate(pos, team) });
    } else {
      for (let b = a + 1; b < list.length; b++) {
        pos.place(list[b], team);
        results.push({ moves: [list[a], list[b]], value: evaluate(pos, team) });
        pos.remove(list[b]);
      }
    }
    pos.remove(list[a]);
  }
  results.sort((x, y) => y.value - x.value);
  return results;
}

/** count 개 안에 6목을 완성하는 칸들 (없으면 null) */
export function winningMoves(pos, team, count) {
  for (const w of pos.liveWindows(team, WIN_LENGTH - count)) return pos.emptiesOf(w);
  return null;
}

// ---------- 위협 공간 탐색 (어려움) ----------

/**
 * 한 번 찾을 때 놓아 보는 조합 수의 한도. 넘으면 못 찾은 것으로 친다.
 * attack 은 내가 이길 길을 찾을 때, defense 는 내 조합마다 상대가 이길 길이 생기는지 볼 때
 */
const TSS_BUDGET = { attack: 60000, defense: 12000 };

/** team 의 돌이 n 개 이상이고 상대 돌이 없는 창들의 빈 칸 */
function liveEmpties(pos, team, n) {
  const set = new Set();
  for (const w of pos.liveWindows(team, n)) for (const i of pos.emptiesOf(w)) set.add(i);
  return [...set];
}

/** a, b 를 지나는 창만 보고 team 의 위협 수를 센다. 두기 전에 team 의 위협이 없었을 때만 맞다 */
function localThreats(pos, team, a, b) {
  const mine = pos.counts[team];
  const theirs = pos.counts[1 - team];
  const open = [];
  for (const cell of [a, b]) {
    for (const w of CELL_WINDOWS[cell]) if (mine[w] >= WIN_LENGTH - 2 && theirs[w] === 0 && !open.includes(w)) open.push(w);
  }
  return open.length < 2 ? open.length : blockCount(pos, open);
}

/** 칸마다 team 의 돌이 3개 · 2개인 살아 있는 창이 몇 개 지나가는지 (위협을 만들 수 없는 조합을 미리 거른다) */
function potentials(pos, team, cells) {
  const mine = pos.counts[team];
  const theirs = pos.counts[1 - team];
  return cells.map((i) => {
    let three = 0;
    let two = 0;
    for (const w of CELL_WINDOWS[i]) {
      if (theirs[w] !== 0) continue;
      if (mine[w] >= 3) three++;
      else if (mine[w] === 2) two++;
    }
    return { i, three, two };
  });
}

/**
 * 위협 공간 탐색: attacker 가 위협 2개짜리 수를 거듭해 상대가 막기만 하게 몰고, depth 차례 안에
 * 6목을 만들거나 위협 3개(상대가 다 막지 못한다)를 만드는 첫 조합. 못 찾으면 null.
 * 상대가 막으면서 제 위협을 만들면 그 길은 끊긴 것으로 본다. 차례마다 두 돌을 두는 경우만 따진다.
 */
export function forcingWin(pos, attacker, depth = 2, budget = { left: TSS_BUDGET.attack }) {
  const defender = 1 - attacker;
  const win = winningMoves(pos, attacker, 2);
  if (win) return fill(pos, win, 2);
  // 상대에게 위협이 있으면 먼저 막아야 하므로 몰아붙일 수 없다
  if (pos.liveWindows(defender, WIN_LENGTH - 2).length) return null;
  const cells = potentials(pos, attacker, liveEmpties(pos, attacker, 2)).sort((x, y) => y.three - x.three || y.two - x.two);
  const forcing = [];
  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      const x = cells[a];
      const y = cells[b];
      // 4개짜리 창이 둘도 안 생기는 조합은 볼 필요가 없다
      if (x.three + y.three + Math.min(x.two, y.two) < 2) continue;
      if (--budget.left < 0) return null;
      pos.place(x.i, attacker);
      pos.place(y.i, attacker);
      const threats = localThreats(pos, attacker, x.i, y.i);
      pos.remove(y.i);
      pos.remove(x.i);
      if (threats >= 3) return [x.i, y.i];
      if (threats === 2 && depth > 1) forcing.push([x.i, y.i]);
    }
  }
  for (const [a, b] of forcing) {
    pos.place(a, attacker);
    pos.place(b, attacker);
    // 상대가 위협을 모두 막는 방법마다 다음 차례에도 이길 길이 있어야 한다
    const blocks = liveEmpties(pos, attacker, WIN_LENGTH - 2);
    let blocked = false;
    let refuted = false;
    for (let i = 0; i < blocks.length && !refuted; i++) {
      for (let j = i + 1; j < blocks.length && !refuted; j++) {
        pos.place(blocks[i], defender);
        pos.place(blocks[j], defender);
        if (pos.liveWindows(attacker, WIN_LENGTH - 2).length === 0) {
          blocked = true;
          if (pos.liveWindows(defender, WIN_LENGTH - 2).length > 0 || !forcingWin(pos, attacker, depth - 1, budget)) refuted = true;
        }
        pos.remove(blocks[j]);
        pos.remove(blocks[i]);
      }
    }
    pos.remove(b);
    pos.remove(a);
    if (blocked && !refuted && budget.left >= 0) return [a, b];
    if (budget.left < 0) return null;
  }
  return null;
}

/**
 * 컴퓨터의 한 차례. cells: 판(game.cells), team: 둘 편, count: 이번 차례에 둘 돌 수(1·2).
 * 둘 칸 count 개를 돌려준다 (빈 칸만, 서로 다르게).
 */
export function chooseTurn(cells, team, count, level = 'normal', rng = Math.random) {
  const config = LEVELS[level] ?? LEVELS.normal;
  const pos = new Position(cells);
  const empty = CELLS - pos.stones;
  count = Math.min(count, empty);
  if (count <= 0) return [];

  // 이번 차례에 이길 수 있으면 바로 6목을 만든다
  const win = winningMoves(pos, team, count);
  if (win) return fill(pos, win, count);

  // 위협을 거듭해 몰아붙이면 이기는 길이 있으면 그 첫 조합을 둔다
  if (config.tss && count === 2) {
    const forced = forcingWin(pos, team, config.tss);
    if (forced) return fill(pos, forced, count);
  }

  let ranked = rankTurns(pos, team, count, config.candidates);
  if (config.noise > 0) {
    // 진 수·이긴 수는 그대로 두고 그 사이의 어림값만 흔든다
    ranked = ranked
      .map((r) => ({ ...r, value: Math.abs(r.value) >= SURE ? r.value : r.value * (1 + (rng() * 2 - 1) * config.noise) }))
      .sort((x, y) => y.value - x.value);
  }
  if (config.lookahead > 0 && ranked.length && ranked[0].value < SURE) {
    // 좋은 조합 몇 개에 대해 상대가 가장 잘 받았을 때를 본다
    const rival = 1 - team;
    const rivalCount = Math.min(2, empty - count);
    const deep = ranked.slice(0, config.lookahead).map((r) => {
      if (r.value <= -WIN / 2 || rivalCount <= 0) return r;
      for (const i of r.moves) pos.place(i, team);
      const reply = rankTurns(pos, rival, rivalCount, 12)[0];
      for (const i of r.moves) pos.remove(i);
      // 상대가 이기거나 막지 못할 위협을 만들면 그 조합은 나쁘다. 아니면 상대 응수 뒤의 내 형편을 더한다
      let answer = reply ? reply.value : 0;
      if (config.tss && answer < SURE && rivalCount === 2) {
        // 상대가 위협을 거듭해 몰아붙이면 이기는 길이 생기는지도 본다
        for (const i of r.moves) pos.place(i, team);
        if (forcingWin(pos, rival, config.tss, { left: TSS_BUDGET.defense })) answer = SURE / 2;
        for (const i of r.moves) pos.remove(i);
      }
      return { ...r, value: r.value * 0.35 - answer };
    });
    ranked = deep.sort((x, y) => y.value - x.value);
  }
  // 이기는 수나 지지 않는 수가 따로 있으면 그것만 두고, 실력에 따라 좋은 조합 몇 개 중에서 고른다
  const best = ranked[0];
  const pool = ranked.filter((r) => r.value > -WIN / 2 || best.value <= -WIN / 2).slice(0, best.value >= SURE ? 1 : config.top);
  const pick = pool[Math.floor(rng() * pool.length)] ?? best;
  return fill(pos, pick ? pick.moves : [], count);
}

/** moves 를 count 개로 맞춘다: 모자라면 남은 빈 칸 중 좋은 곳을 더하고, 넘치면 자른다 */
function fill(pos, moves, count) {
  const list = moves.slice(0, count);
  if (list.length < count) {
    for (const i of list) pos.place(i, 0);
    const extra = nearbyEmpties(pos).filter((i) => !list.includes(i));
    for (const i of list) pos.remove(i);
    for (const i of extra) {
      if (list.length >= count) break;
      list.push(i);
    }
    for (let i = 0; list.length < count && i < CELLS; i++) if (pos.cells[i] === EMPTY && !list.includes(i)) list.push(i);
  }
  return list;
}
