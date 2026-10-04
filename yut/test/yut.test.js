import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WAIT,
  HOME,
  START,
  CENTER,
  STATION_COUNT,
  RESULTS,
  RESULT_IDS,
  MARKED_STICK,
  FLAT_CHANCE,
  nextStation,
  forwardPath,
  backStation,
  resultOf,
  rollSticks,
  resultChances,
  optionsFor,
  applyOption,
  createPieces,
  YutGame,
} from '../js/game.js';
import { LEVEL_IDS, chooseMove, expectedMoves, dangerAt, evaluate } from '../js/ai.js';
import { SaveStore, SETTINGS_KEY, RECORD_KEY, DEFAULT_SETTINGS } from '../js/save.js';
import { createRng } from '../../shared/util.js';

// 가락 모양: 배(평평한 면)가 위인 가락 수로 결과를 만든다. 표시 가락(0번)은 빽도가 되지 않게 배가 위인 쪽에 넣는다
const STICKS = {
  backdo: [true, false, false, false],
  do: [false, true, false, false],
  gae: [true, true, false, false],
  geol: [true, true, true, false],
  yut: [true, true, true, true],
  mo: [false, false, false, false],
};

/** pieces 의 자리를 바꿔 둔 판. places: { 말 번호: [pos, prev] } */
function placed(players, places) {
  return createPieces(players).map((p) => {
    const spot = places[p.id];
    return spot ? { ...p, pos: spot[0], prev: spot[1] ?? null } : p;
  });
}

/** 게임을 move 단계로 맞춘다 */
function ready(game, pending, places = {}) {
  game.pieces = placed(game.players, places);
  game.pending = [...pending];
  game.phase = 'move';
  game.throws = 0;
  game.drain();
  return game;
}

const types = (events) => events.map((event) => event.type);

// ---------- 길 ----------

test('바깥 길: 기다리는 말은 도로 1번에 오르고 바깥을 돈다', () => {
  assert.deepEqual(forwardPath(WAIT, 1), [1]);
  assert.deepEqual(forwardPath(WAIT, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(forwardPath(1, 4), [2, 3, 4, 5]);
  assert.deepEqual(forwardPath(3, 3), [4, 5, 6], '모서리를 지나가기만 하면 바깥 길 그대로');
  assert.deepEqual(forwardPath(8, 3), [9, 10, 11]);
  assert.deepEqual(forwardPath(13, 4), [14, 15, 16, 17]);
  assert.deepEqual(forwardPath(15, 1), [16], '찌모에서는 지름길이 없다');
});

test('모서리에 멈추면 대각선 지름길로 들어간다', () => {
  assert.deepEqual(forwardPath(5, 1), [20]);
  assert.deepEqual(forwardPath(5, 3), [20, 21, CENTER]);
  assert.deepEqual(forwardPath(5, 5), [20, 21, CENTER, 23, 24], '가운데를 지나가면 왼쪽 아래로 그대로');
  assert.deepEqual(forwardPath(10, 2), [25, 26]);
  assert.deepEqual(forwardPath(10, 5), [25, 26, CENTER, 27, 28], '뒷모 대각선은 가운데를 지나 출발점으로');
});

test('가운데(방)에 멈추면 출발점 쪽으로 꺾는다', () => {
  assert.deepEqual(forwardPath(CENTER, 1), [27]);
  assert.deepEqual(forwardPath(CENTER, 2), [27, 28]);
  assert.deepEqual(forwardPath(CENTER, 3), [27, 28, START]);
  assert.deepEqual(forwardPath(CENTER, 4), [27, 28, START, HOME]);
  assert.deepEqual(forwardPath(21, 2), [CENTER, 23], '21 에서 가운데를 지나가면 왼쪽 아래로');
  assert.deepEqual(forwardPath(26, 2), [CENTER, 27], '26 에서 가운데를 지나가면 출발점 쪽으로');
  assert.deepEqual(forwardPath(24, 2), [15, 16], '대각선 끝(찌모)에서 바깥 길로 이어진다');
});

test('출발점을 지나야 나고, 출발점에 딱 멈추면 판에 남는다', () => {
  assert.deepEqual(forwardPath(19, 1), [START]);
  assert.deepEqual(forwardPath(19, 2), [START, HOME]);
  assert.deepEqual(forwardPath(17, 5), [18, 19, START, HOME], '넘치면 나고 거기서 멈춘다');
  assert.deepEqual(forwardPath(28, 1), [START]);
  assert.deepEqual(forwardPath(28, 2), [START, HOME]);
  assert.deepEqual(forwardPath(START, 1), [HOME], '출발점에 선 말은 무엇이 나와도 난다');
  assert.deepEqual(forwardPath(START, 5), [HOME]);
});

test('모든 자리에서 모든 걸음 수의 길이 판 안의 자리이거나 HOME 으로 끝난다', () => {
  for (let pos = WAIT; pos < STATION_COUNT; pos++) {
    for (let steps = 1; steps <= 5; steps++) {
      const path = forwardPath(pos, steps);
      assert.ok(path.length >= 1 && path.length <= steps, `${pos}+${steps}`);
      for (const [i, s] of path.entries()) {
        const valid = (s >= 0 && s < STATION_COUNT) || (s === HOME && i === path.length - 1);
        assert.ok(valid, `${pos}+${steps}: ${path}`);
      }
      if (path.length < steps) assert.equal(path[path.length - 1], HOME);
    }
  }
});

test('29 자리 모두 기다리는 말에서 갈 수 있고, 어디서든 결국 난다', () => {
  const reached = new Set();
  const queue = [WAIT];
  while (queue.length) {
    const pos = queue.shift();
    for (let steps = 1; steps <= 5; steps++) {
      const path = forwardPath(pos, steps);
      const to = path[path.length - 1];
      if (to !== HOME && !reached.has(to)) {
        reached.add(to);
        queue.push(to);
      }
    }
  }
  assert.equal(reached.size, STATION_COUNT);
  // 도만 계속 나와도 언젠가 난다(같은 자리를 맴돌지 않는다)
  for (let pos = 0; pos < STATION_COUNT; pos++) {
    let cur = pos;
    let count = 0;
    while (cur !== HOME && count < 40) {
      cur = forwardPath(cur, 1)[0];
      count++;
    }
    assert.equal(cur, HOME, `${pos} 에서 도만으로`);
  }
});

test('가장 짧은 길: 모·모·윷… 지름길로 돌면 바깥보다 훨씬 빠르다', () => {
  // 모(5) → 5번 모서리, 걸(3) → 가운데, 걸(3) → 출발점, 도 → 남
  let pos = WAIT;
  for (const steps of [5, 3, 3, 1]) pos = forwardPath(pos, steps).at(-1);
  assert.equal(pos, HOME);
  assert.throws(() => nextStation(42, null, true));
});

// ---------- 빽도 ----------

test('빽도: 한 칸 뒤로. 1번에서는 출발점으로 물러난다', () => {
  assert.equal(backStation(1, WAIT), START);
  assert.equal(backStation(4, 3), 3);
  assert.equal(backStation(6, 5), 5);
  assert.equal(backStation(16, 15), 15);
  assert.equal(backStation(20, 5), 5);
  assert.equal(backStation(25, 10), 10);
  assert.equal(backStation(23, CENTER), CENTER);
  assert.equal(backStation(27, CENTER), CENTER);
  assert.equal(backStation(WAIT, null), null, '판에 없는 말은 물러날 수 없다');
  assert.equal(backStation(HOME, null), null);
});

test('빽도: 앞 칸이 둘인 자리에서는 지나온 칸으로 돌아간다', () => {
  assert.equal(backStation(CENTER, 21), 21);
  assert.equal(backStation(CENTER, 26), 26);
  assert.equal(backStation(15, 14), 14);
  assert.equal(backStation(15, 24), 24);
  assert.equal(backStation(START, 19), 19);
  assert.equal(backStation(START, 28), 28);
  assert.equal(backStation(START, null), 19, '모르면 바깥 길로');
});

test('빽도로 물러난 뒤의 지나온 칸: 다시 빽도가 나오면 같은 줄을 따라 물러난다', () => {
  // 27 에서 빽도 → 가운데. 다시 빽도면 26(같은 대각선)
  let pieces = placed(2, { 0: [27, CENTER] });
  let [option] = optionsFor(pieces, 0, 'backdo');
  assert.equal(option.to, CENTER);
  pieces = applyOption(pieces, option);
  assert.equal(pieces[0].prev, 26);
  [option] = optionsFor(pieces, 0, 'backdo');
  assert.equal(option.to, 26);
  // 23 에서 빽도 → 가운데. 다시 빽도면 21
  pieces = placed(2, { 0: [23, CENTER] });
  pieces = applyOption(pieces, optionsFor(pieces, 0, 'backdo')[0]);
  assert.equal(optionsFor(pieces, 0, 'backdo')[0].to, 21);
});

test('빽도로 출발점에 물러난 말은 다음에 무엇이 나와도 난다', () => {
  let pieces = placed(2, { 0: [1, WAIT] });
  pieces = applyOption(pieces, optionsFor(pieces, 0, 'backdo')[0]);
  assert.equal(pieces[0].pos, START);
  const [option] = optionsFor(pieces, 0, 'do').filter((o) => o.from === START);
  assert.equal(option.home, true);
});

test('빽도로 모서리에 물러나면 그 모서리의 지름길을 탄다', () => {
  let pieces = placed(2, { 0: [20, 5] });
  pieces = applyOption(pieces, optionsFor(pieces, 0, 'backdo')[0]);
  assert.equal(pieces[0].pos, 5);
  assert.deepEqual(optionsFor(pieces, 0, 'gae').find((o) => o.from === 5).path, [20, 21]);
});

// ---------- 윷 던지기 ----------

test('배가 위인 가락 수로 결과가 정해진다', () => {
  for (const [result, sticks] of Object.entries(STICKS)) assert.equal(resultOf(sticks), result);
  assert.equal(resultOf([false, false, true, false]), 'do');
  assert.equal(resultOf(STICKS.backdo, false), 'do', '빽도 규칙을 끄면 표시 가락도 도');
  assert.equal(MARKED_STICK, 0);
});

test('결과 확률: 합이 1, 개·걸이 가장 흔하고 모가 가장 드물다', () => {
  for (const backdo of [true, false]) {
    const chances = resultChances(backdo);
    const sum = Object.values(chances).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-12);
    assert.ok(chances.gae > chances.do && chances.geol > chances.yut && chances.yut > chances.mo);
    if (!backdo) assert.equal(chances.backdo, 0);
  }
  const chances = resultChances(true);
  assert.ok(chances.backdo > 0.02 && chances.backdo < 0.06);
  assert.ok(Math.abs(chances.do + chances.backdo - 4 * FLAT_CHANCE * (1 - FLAT_CHANCE) ** 3) < 1e-12);
});

test('가락 던지기 표본이 확률과 맞는다', () => {
  const rng = createRng(3);
  const counts = Object.fromEntries(RESULT_IDS.map((id) => [id, 0]));
  let flat = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const sticks = rollSticks(rng);
    flat += sticks.filter(Boolean).length;
    counts[resultOf(sticks)]++;
  }
  assert.ok(Math.abs(flat / (n * 4) - FLAT_CHANCE) < 0.01);
  const chances = resultChances(true);
  for (const id of RESULT_IDS) assert.ok(Math.abs(counts[id] / n - chances[id]) < 0.015, id);
});

test('윷·모가 나오면 한 번 더 던지고 결과가 쌓인다', () => {
  const game = new YutGame({ players: 2 });
  game.drain();
  assert.equal(game.throw(STICKS.yut), 'yut');
  assert.equal(game.phase, 'throw');
  assert.equal(game.throw(STICKS.mo), 'mo');
  assert.equal(game.phase, 'throw');
  assert.equal(game.throw(STICKS.gae), 'gae');
  assert.equal(game.phase, 'move');
  assert.deepEqual(game.pending, ['yut', 'mo', 'gae']);
  assert.deepEqual(types(game.drain()), ['throw', 'throw', 'throw']);
  assert.equal(game.throw(STICKS.do), null, 'move 단계에서는 던질 수 없다');
});

test('쌓인 결과는 원하는 순서로, 다른 말에 나눠 쓸 수 있다', () => {
  const game = new YutGame({ players: 2 });
  game.throw(STICKS.yut);
  game.throw(STICKS.geol);
  game.drain();
  // 걸을 먼저 써서 새 말을 3번에 두고, 윷으로 또 새 말을 4번에
  assert.ok(game.move('geol', WAIT));
  assert.equal(game.phase, 'move');
  assert.ok(game.move('yut', WAIT));
  assert.deepEqual(
    game.pieces.filter((p) => p.team === 0).map((p) => p.pos),
    [3, 4, WAIT, WAIT],
  );
  assert.equal(game.current, 1);
  assert.deepEqual(types(game.drain()), ['move', 'move', 'turn']);
});

test('쓰지 않은 결과나 없는 말로는 옮길 수 없다', () => {
  const game = ready(new YutGame({ players: 2 }), ['gae']);
  assert.equal(game.move('geol', WAIT), null);
  assert.equal(game.move('gae', 7), null);
  assert.ok(game.move('gae', WAIT));
});

test('판에 말이 없을 때 빽도만 나오면 버리고 차례를 넘긴다', () => {
  const game = new YutGame({ players: 3 });
  game.drain();
  game.throw(STICKS.backdo);
  assert.equal(game.current, 1);
  assert.equal(game.phase, 'throw');
  assert.deepEqual(types(game.drain()), ['throw', 'discard', 'turn']);
});

test('빽도는 다른 결과로 말을 올린 뒤에 쓸 수 있다', () => {
  const game = new YutGame({ players: 2 });
  game.throw(STICKS.mo);
  game.throw(STICKS.backdo);
  assert.equal(game.phase, 'move');
  assert.equal(game.canUse('backdo'), false);
  assert.ok(game.move('mo', WAIT));
  assert.equal(game.canUse('backdo'), true);
  assert.ok(game.move('backdo', 5));
  assert.equal(game.pieces[0].pos, 4);
});

test('남은 결과를 쓸 데가 없으면 버리고 넘어간다', () => {
  // 마지막 말이 나면서 이기는 경우가 아니라, 빽도만 남았는데 판에 말이 없어진 경우
  const game = ready(new YutGame({ players: 2 }), ['gae', 'backdo'], { 0: [19, 18], 1: [HOME], 2: [HOME], 3: [WAIT] });
  game.pieces[3] = { ...game.pieces[3], pos: WAIT };
  game.move('gae', 19);
  assert.equal(game.pieces[0].pos, HOME);
  assert.equal(game.current, 1);
  assert.deepEqual(types(game.drain()), ['move', 'discard', 'turn']);
});

// ---------- 잡기 · 업기 ----------

test('상대 말이 있는 자리에 멈추면 잡아 돌려보내고 한 번 더 던진다', () => {
  // 0편 말(0번)이 2번 자리, 1편 말(4번)이 4번 자리
  const game = ready(new YutGame({ players: 2 }), ['gae', 'do'], { 0: [2, 1], 4: [4, 3] });
  const option = game.move('gae', 2);
  assert.deepEqual(option.capture, [4]);
  assert.equal(game.pieces[4].pos, WAIT);
  assert.equal(game.pieces[4].prev, null);
  assert.equal(game.phase, 'throw');
  assert.equal(game.current, 0);
  assert.deepEqual(game.pending, ['do'], '남은 결과는 그대로 남는다');
  assert.deepEqual(types(game.drain()), ['move', 'again']);
  game.throw(STICKS.geol);
  assert.deepEqual(game.pending, ['do', 'geol']);
  assert.equal(game.phase, 'move');
});

test('지나가기만 하면 잡지 않는다', () => {
  const game = ready(new YutGame({ players: 2 }), ['geol'], { 0: [2, 1], 4: [4, 3] });
  const option = game.move('geol', 2);
  assert.deepEqual(option.capture, []);
  assert.equal(game.pieces[4].pos, 4);
  assert.equal(game.current, 1);
});

test('업힌 상대 말은 한꺼번에 잡히고, 출발점의 말도 잡힌다', () => {
  const game = ready(new YutGame({ players: 2 }), ['do'], { 0: [19, 18], 4: [START, 28], 5: [START, 28] });
  const option = game.move('do', 19);
  assert.deepEqual(option.capture.sort(), [4, 5]);
  assert.equal(game.counts(1).wait, 4);
});

test('빽도로도 잡을 수 있다', () => {
  const game = ready(new YutGame({ players: 2 }), ['backdo'], { 0: [6, 5], 4: [5, 4] });
  const option = game.move('backdo', 6);
  assert.deepEqual(option.capture, [4]);
  assert.equal(game.phase, 'throw');
});

test('내 말이 있는 자리에 멈추면 업고, 다음부터 함께 움직인다', () => {
  const game = ready(new YutGame({ players: 2 }), ['gae', 'geol'], { 0: [3, 2], 1: [1, WAIT] });
  const option = game.move('gae', 1);
  assert.deepEqual(option.stack, [0]);
  assert.equal(game.pieces[1].pos, 3);
  const [together] = game.options('geol').filter((o) => o.from === 3);
  assert.deepEqual(together.pieces.sort(), [0, 1]);
  game.move('geol', 3);
  assert.equal(game.pieces[0].pos, 20 - 14, '3 + 3 = 6');
  assert.equal(game.pieces[1].pos, 6);
});

test('기다리는 말은 한 마리씩 오르고, 업힌 말은 한꺼번에 난다', () => {
  const game = ready(new YutGame({ players: 2 }), ['mo'], { 0: [CENTER, 21], 1: [CENTER, 21] });
  const options = game.options('mo');
  const enter = options.find((o) => o.from === WAIT);
  assert.equal(enter.pieces.length, 1);
  const out = options.find((o) => o.from === CENTER);
  assert.equal(out.home, true);
  game.move('mo', CENTER);
  assert.equal(game.counts(0).home, 2);
});

test('네 말이 모두 나면 이기고 남은 결과는 버린다', () => {
  const game = ready(new YutGame({ players: 2 }), ['gae', 'yut'], { 0: [HOME], 1: [HOME], 2: [HOME], 3: [28, 27] });
  game.move('gae', 28);
  assert.equal(game.phase, 'done');
  assert.equal(game.winner, 0);
  assert.deepEqual(game.pending, []);
  assert.deepEqual(types(game.drain()), ['move', 'win']);
  assert.equal(game.move('yut', WAIT), null);
});

test('차례는 편 수만큼 돌고, 먼저 던지는 편을 정할 수 있다', () => {
  const game = new YutGame({ players: 4, first: 2 });
  assert.equal(game.current, 2);
  const order = [];
  for (let i = 0; i < 5; i++) {
    game.throw(STICKS.backdo); // 판에 말이 없으니 버리고 넘어간다
    order.push(game.current);
  }
  assert.deepEqual(order, [3, 0, 1, 2, 3]);
  assert.throws(() => new YutGame({ players: 1 }));
  assert.throws(() => new YutGame({ players: 5 }));
});

test('복사본을 바꿔도 원래 게임은 그대로다', () => {
  const game = ready(new YutGame({ players: 2 }), ['gae'], { 0: [3, 2] });
  const copy = game.clone();
  copy.move('gae', 3);
  assert.equal(game.pieces[0].pos, 3);
  assert.deepEqual(game.pending, ['gae']);
  assert.equal(copy.pieces[0].pos, 5);
});

// ---------- 컴퓨터 ----------

test('남은 옮기기 수: 지름길 자리일수록 작고, 출발점은 거의 1 이다', () => {
  const moves = expectedMoves(true);
  assert.ok(moves.get(START) > 1 && moves.get(START) < 1.2, '빽도가 나오면 19번으로 물러난다');
  assert.ok(Math.abs(expectedMoves(false).get(START) - 1) < 1e-9);
  assert.ok(moves.get(5) < moves.get(4), '모서리가 바로 앞보다 가깝다');
  assert.ok(moves.get(CENTER) < moves.get(21));
  assert.ok(moves.get(WAIT) > moves.get(1));
  assert.ok(Math.abs(moves.get(28) - moves.get(19)) < 0.05, '28 과 19 는 둘 다 출발점 한 칸 앞');
});

test('위험: 상대 말이 닿을 수 있는 자리는 위험하다', () => {
  const pieces = placed(2, { 0: [6, 5], 4: [4, 3], 5: [HOME], 6: [HOME], 7: [HOME] });
  const chances = resultChances(true);
  assert.ok(dangerAt(pieces, 0, 6, chances) > 0.3, '개 거리');
  assert.equal(dangerAt(pieces, 0, 15, chances), 0);
});

test('컴퓨터는 잡을 수 있으면 잡는다', () => {
  for (const level of LEVEL_IDS.filter((l) => l !== 'easy')) {
    const game = ready(new YutGame({ players: 2 }), ['geol'], { 0: [7, 6], 1: [2, 1], 4: [10, 9] });
    assert.deepEqual(chooseMove(game, level, createRng(1)), { result: 'geol', from: 7 }, level);
  }
});

test('컴퓨터는 나갈 수 있는 말을 내보내고, 지름길 자리를 고른다', () => {
  const home = ready(new YutGame({ players: 2 }), ['gae'], { 0: [28, 27], 1: [8, 7] });
  assert.equal(chooseMove(home, 'normal', createRng(1)).from, 28);
  // 도·모 중 무엇을 어디에 쓸지: 4번 말에 도를 쓰면 모서리(5)에 선다
  const corner = ready(new YutGame({ players: 2 }), ['do'], { 0: [4, 3], 1: [12, 11] });
  assert.equal(chooseMove(corner, 'normal', createRng(1)).from, 4);
});

test('어려움은 쌓인 결과의 순서를 읽어 잡는다', () => {
  // 개를 먼저 써서 모서리(5)에 선 뒤, 걸로 대각선을 타 가운데(22)의 상대를 잡는 길이 있다
  const game = ready(new YutGame({ players: 2 }), ['geol', 'gae'], { 0: [3, 2], 4: [CENTER, 21] });
  assert.deepEqual(chooseMove(game, 'hard', createRng(1)), { result: 'gae', from: 3 });
});

test('컴퓨터끼리 두면 실력마다 판이 끝까지 간다', () => {
  for (const level of LEVEL_IDS) {
    for (const players of [2, 4]) {
      const rng = createRng(players * 31 + level.length);
      const game = new YutGame({ players, rng });
      let guard = 0;
      while (game.phase !== 'done' && guard++ < 5000) {
        if (game.phase === 'throw') game.throw();
        else {
          const choice = chooseMove(game, level, rng);
          assert.ok(choice, '둘 데가 없으면 move 단계에 머물지 않는다');
          assert.ok(game.move(choice.result, choice.from));
        }
      }
      assert.equal(game.phase, 'done', `${level} ${players}`);
      assert.equal(game.counts(game.winner).home, 4);
    }
  }
});

test('어려움이 쉬움보다 자주 이긴다', () => {
  let wins = 0;
  const games = 60;
  for (let i = 0; i < games; i++) {
    const rng = createRng(1000 + i);
    const game = new YutGame({ players: 2, first: i % 2, rng });
    const levels = ['hard', 'easy'];
    while (game.phase !== 'done') {
      if (game.phase === 'throw') game.throw();
      else {
        const choice = chooseMove(game, levels[game.current], rng);
        game.move(choice.result, choice.from);
      }
    }
    if (game.winner === 0) wins++;
  }
  assert.ok(wins > games * 0.55, `${wins}/${games}`);
});

test('처지 점수: 앞선 쪽이 높다', () => {
  const ahead = placed(2, { 0: [CENTER, 21] });
  const behind = placed(2, { 4: [CENTER, 21] });
  assert.ok(evaluate(ahead, 0) > evaluate(behind, 0));
  assert.equal(RESULTS.mo.steps, 5);
});

// ---------- 저장 ----------

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('설정: 없거나 잘못된 값은 기본값으로', () => {
  const store = new SaveStore(
    memoryStorage({ [SETTINGS_KEY]: '{"players":7,"seats":["cpu","x"],"level":"god","backdo":0}' }),
  );
  const settings = store.loadSettings();
  assert.equal(settings.players, DEFAULT_SETTINGS.players);
  assert.deepEqual(settings.seats, ['cpu', 'cpu', 'cpu', 'cpu']);
  assert.equal(settings.level, 'normal');
  assert.equal(settings.backdo, true);
  assert.deepEqual(new SaveStore(memoryStorage({ [SETTINGS_KEY]: '{oops' })).loadSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(new SaveStore(null).loadSettings(), DEFAULT_SETTINGS);
});

test('설정을 저장하고 다시 읽는다', () => {
  const store = new SaveStore(memoryStorage());
  const settings = { players: 4, seats: ['human', 'human', 'cpu', 'cpu'], level: 'hard', backdo: false, sound: false };
  assert.equal(store.saveSettings(settings), true);
  assert.deepEqual(store.loadSettings(), settings);
});

test('전적: 실력마다 승패를 더하고 깨진 기록은 버린다', () => {
  const store = new SaveStore(
    memoryStorage({ [RECORD_KEY]: '{"easy":{"wins":-1,"losses":2},"hard":{"wins":1,"losses":0}}' }),
  );
  assert.deepEqual(store.loadAllRecords(), { hard: { wins: 1, losses: 0 } });
  assert.deepEqual(store.recordResult('hard', true), { wins: 2, losses: 0 });
  assert.deepEqual(store.recordResult('easy', false), { wins: 0, losses: 1 });
  assert.equal(store.recordResult('god', true), null);
  assert.deepEqual(store.loadRecord('easy'), { wins: 0, losses: 1 });
});

test('저장소가 예외를 던져도 게임은 계속된다', () => {
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const store = new SaveStore(broken);
  assert.deepEqual(store.loadSettings(), DEFAULT_SETTINGS);
  assert.equal(store.saveSettings(DEFAULT_SETTINGS), false);
  assert.deepEqual(store.recordResult('normal', true), { wins: 1, losses: 0 });
});
