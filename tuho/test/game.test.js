import test from 'node:test';
import assert from 'node:assert/strict';
import { TuhoGame, POINTS, LINES, EXTRA_LINE, MAX_EXTRA, SOLO_ARROWS, lineIndex } from '../js/game.js';

/** 지금 차례인 사람에게 results[player] 를 차례로 던지게 한다 */
function playOut(game, pick) {
  const log = [];
  while (!game.over) {
    const player = game.current;
    log.push(player);
    game.record(pick(player, game));
  }
  return log;
}

test('점수: 입 2, 귀 5, 걸침 1, 빗나감 0 이고 귀가 가장 높다', () => {
  assert.deepEqual(POINTS, { mouth: 2, ear: 5, lean: 1, miss: 0 });
  assert.ok(POINTS.ear > POINTS.mouth && POINTS.mouth > POINTS.lean);
});

test('혼자서: 화살 10개를 던지면 끝나고 점수·들어간 화살을 센다', () => {
  const game = new TuhoGame();
  assert.equal(game.players, 1);
  assert.equal(game.arrows, SOLO_ARROWS);
  const results = ['mouth', 'miss', 'ear', 'lean', 'mouth', 'miss', 'miss', 'mouth', 'ear', 'miss'];
  for (const [i, result] of results.entries()) {
    assert.equal(game.over, false);
    assert.equal(game.arrowsLeft(), SOLO_ARROWS - i);
    const info = game.record(result);
    assert.equal(info.points, POINTS[result]);
    assert.equal(info.player, 0);
  }
  assert.equal(game.over, true);
  assert.equal(game.winner, 0);
  assert.deepEqual(game.result, { score: 2 * 3 + 5 * 2 + 1, hits: 5, ears: 2 });
  assert.deepEqual(game.counts[0], { mouth: 3, ear: 2, lean: 1, miss: 4 });
  assert.throws(() => game.record('mouth'));
  assert.throws(() => new TuhoGame().record('bullseye'));
});

test('줄은 던질수록 뒤로 물러난다: 가까운 줄 → 가운데 줄 → 먼 줄', () => {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => lineIndex(i, 10)),
    [0, 0, 0, 0, 1, 1, 1, 2, 2, 2],
  );
  assert.deepEqual(
    Array.from({ length: 5 }, (_, i) => lineIndex(i, 5)),
    [0, 0, 1, 1, 2],
  );
  const game = new TuhoGame();
  const seen = [];
  let backs = 0;
  while (!game.over) {
    seen.push(game.line.id);
    if (game.record('miss').lineUp) backs++;
  }
  assert.deepEqual([...new Set(seen)], LINES.map((l) => l.id));
  assert.equal(backs, 2);
  for (let i = 1; i < LINES.length; i++) assert.ok(LINES[i].distance > LINES[i - 1].distance);
});

test('대결: 한 발씩 번갈아 던지고, 먼저 던지는 사람부터 돈다', () => {
  const game = new TuhoGame({ players: 3, arrows: 2, first: 1 });
  const log = playOut(game, () => 'miss');
  assert.deepEqual(log.slice(0, 6), [1, 2, 0, 1, 2, 0]);
  // 모두 0점이면 셋 다 연장에 들어가 같은 순서로 한 발씩 던지고, 끝까지 가려지지 않으면 비긴다
  assert.deepEqual(log.slice(6, 9), [1, 2, 0]);
  assert.equal(log.length, 6 + 3 * MAX_EXTRA);
  assert.equal(game.over, true);
  assert.equal(game.winner, -1);
});

test('대결: 합계 점수가 높은 사람이 이긴다', () => {
  const game = new TuhoGame({ players: 2, arrows: 5 });
  playOut(game, (p) => (p === 1 ? 'mouth' : 'lean'));
  assert.deepEqual(game.scores, [5, 10]);
  assert.equal(game.winner, 1);
  assert.deepEqual(game.ranking, [1, 0]);
  assert.equal(game.hits(1), 5);
  assert.equal(game.hits(0), 0);
});

test('동점이면 으뜸끼리만 연장으로 한 발씩 더 던져 가린다', () => {
  const game = new TuhoGame({ players: 4, arrows: 2, first: 0 });
  // 0·2 는 4점, 1 은 2점, 3 은 0점
  const main = { 0: 'mouth', 1: 'lean', 2: 'mouth', 3: 'miss' };
  let info;
  for (let i = 0; i < 8; i++) info = game.record(main[game.current]);
  assert.equal(info.extraStarted, true);
  assert.equal(game.over, false);
  assert.equal(game.inExtra, true);
  assert.deepEqual(game.extra.contenders, [0, 2]);
  assert.equal(game.line, LINES[EXTRA_LINE]);
  // 연장 1: 둘 다 넣어 또 같다
  assert.equal(game.current, 0);
  game.record('mouth');
  assert.equal(game.current, 2);
  info = game.record('mouth');
  assert.equal(info.extraStarted, true);
  assert.equal(game.extra.round, 2);
  // 연장 2: 2 만 넣는다
  game.record('miss');
  info = game.record('ear');
  assert.equal(info.done, true);
  assert.equal(game.over, true);
  assert.equal(game.winner, 2);
  assert.deepEqual(game.ranking.slice(0, 2), [2, 0]);
  assert.equal(game.thrown[0], 2, '연장 화살은 본 경기 화살 수에 넣지 않는다');
});

test('연장 차례는 본 경기 순서를 따른다', () => {
  const game = new TuhoGame({ players: 3, arrows: 1, first: 2 });
  // 순서 2 → 0 → 1. 2 와 1 이 같은 점수
  game.record('mouth'); // 2
  game.record('miss'); // 0
  game.record('mouth'); // 1
  assert.deepEqual(game.extra.contenders, [2, 1]);
  assert.equal(game.current, 2);
});

test(`연장을 ${MAX_EXTRA}번 돌고도 같으면 비긴다`, () => {
  const game = new TuhoGame({ players: 2, arrows: 1 });
  game.record('mouth');
  game.record('mouth');
  let rounds = 0;
  while (!game.over) {
    game.record('mouth');
    game.record('mouth');
    rounds++;
  }
  assert.equal(rounds, MAX_EXTRA);
  assert.equal(game.winner, -1);
});

test('혼자 할 때는 연장이 없다', () => {
  const game = new TuhoGame({ players: 1, arrows: 2 });
  game.record('miss');
  const info = game.record('miss');
  assert.equal(info.done, true);
  assert.equal(game.inExtra, false);
});
