import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAt, RING_WIDTH, FACE_RADIUS, ARROW_RADIUS, TIMEOUT_HIT } from '../js/target.js';
import { ArcheryMatch, WIN_POINTS } from '../js/match.js';
import { Tournament, ROUNDS, drawOpponents } from '../js/tournament.js';
import { Wind, windDrift, DRIFT } from '../js/wind.js';
import { computerAim, computerShot } from '../js/ai.js';
import { swayAmplitude, swayOffset } from '../js/aim.js';

const hit = (score, distance = (10 - score) * RING_WIDTH + 0.01) => ({ score, distance, x: false, label: String(score) });

/** 한 세트 3발씩: a 는 첫 번째 선수, b 는 두 번째 선수의 점수 (쏘는 순서는 match 가 정한다) */
function playSet(match, a, b) {
  let result;
  for (let i = 0; i < 6; i++) {
    const scores = match.current === 0 ? a : b;
    result = match.shoot(hit(scores[match.arrows[match.current].length]));
  }
  return result;
}

test('과녁 고리별 점수', () => {
  assert.deepEqual(scoreAt(0, 0), { score: 10, x: true, distance: 0, label: 'X' });
  assert.equal(scoreAt(0.04, 0).label, '10');
  assert.equal(scoreAt(0, 0.07).score, 9);
  assert.equal(scoreAt(-0.2, 0).score, 7);
  assert.equal(scoreAt(0.4, 0.3).score, 2); // 50cm
  assert.equal(scoreAt(0.6, 0).score, 1);
  assert.equal(scoreAt(0.7, 0).label, 'M');
});

test('선에 걸친 화살은 높은 점수', () => {
  // 화살 중심은 9점 고리 안이지만 화살대가 10점 선에 닿는다
  assert.equal(scoreAt(RING_WIDTH + ARROW_RADIUS * 0.9, 0).score, 10);
  assert.equal(scoreAt(RING_WIDTH + ARROW_RADIUS * 1.1, 0).score, 9);
  assert.equal(scoreAt(FACE_RADIUS + ARROW_RADIUS * 0.5, 0).score, 1);
  assert.equal(TIMEOUT_HIT.score, 0);
});

test('세트를 이기면 2점, 비기면 1점씩', () => {
  const match = new ArcheryMatch();
  assert.equal(match.current, 0);
  match.shoot(hit(10));
  assert.equal(match.current, 1); // 번갈아 쏜다
  match.shoot(hit(9));
  assert.throws(() => match.nextSet());
  match.shoot(hit(10));
  match.shoot(hit(9));
  match.shoot(hit(8));
  const result = match.shoot(hit(9));
  assert.equal(result.setOver, true);
  assert.equal(result.setWinner, 0);
  assert.deepEqual(match.points, [2, 0]);
  assert.throws(() => match.shoot(hit(10)));
  match.nextSet();
  // 세트 점수가 낮은 선수가 다음 세트를 먼저 쏜다
  assert.equal(match.current, 1);
  assert.equal(match.setNumber, 2);
  const tie = playSet(match, [9, 9, 9], [10, 9, 8]);
  assert.equal(tie.setWinner, null);
  assert.deepEqual(match.points, [3, 1]);
});

test('세트 점수 6점을 먼저 얻으면 이긴다', () => {
  const match = new ArcheryMatch();
  playSet(match, [10, 10, 10], [9, 9, 9]);
  match.nextSet();
  playSet(match, [10, 10, 10], [9, 9, 9]);
  match.nextSet();
  const result = playSet(match, [10, 10, 10], [9, 9, 9]);
  assert.equal(result.over, true);
  assert.equal(match.winner, 0);
  assert.deepEqual(match.points, [6, 0]);
  assert.throws(() => match.nextSet());
});

test('5:5 면 슛오프, 같은 점수면 중심에 가까운 화살이 이긴다', () => {
  const match = new ArcheryMatch({ mode: 'versus' });
  for (const [a, b] of [
    [[10, 10, 10], [9, 9, 9]],
    [[9, 9, 9], [10, 10, 10]],
    [[10, 10, 10], [9, 9, 9]],
    [[9, 9, 9], [10, 10, 10]],
    [[9, 9, 9], [9, 9, 9]],
  ]) {
    playSet(match, a, b);
    match.nextSet();
  }
  assert.deepEqual(match.points, [5, 5]);
  assert.equal(match.inShootOff, true);
  assert.equal(match.arrowsPerPlayer, 1);
  assert.equal(match.current, 0); // 1세트에 먼저 쏜 선수부터
  match.shoot(hit(10, 0.02));
  const result = match.shoot(hit(10, 0.01));
  assert.equal(result.setOver, true);
  assert.equal(result.over, true);
  assert.equal(match.winner, 1);
  assert.equal(match.players[1].id, 'p2');
});

test('슛오프에서 거리까지 같으면 다시 쏜다', () => {
  const match = new ArcheryMatch();
  for (let i = 0; i < 5; i++) {
    playSet(match, [9, 9, 9], [9, 9, 9]);
    match.nextSet();
  }
  match.shoot(hit(8, 0.15));
  const again = match.shoot(hit(8, 0.15));
  assert.equal(again.setWinner, null);
  assert.equal(again.over, false);
  match.nextSet();
  assert.equal(match.inShootOff, true);
  assert.equal(match.arrows[0].length, 0);
  match.shoot(hit(9));
  assert.equal(match.shoot(hit(7)).winner, 0);
  assert.equal(match.points[0], 6);
});

test('바람은 옆으로 밀고, 컴퓨터는 반대로 겨눈다', () => {
  const drift = windDrift({ x: 2, y: 0 });
  assert.equal(drift.x, 2 * DRIFT);
  assert.equal(drift.y, 0);
  const wind = { x: 3, y: -1 };
  const perfect = { spread: 0, windRead: 0 };
  const aim = computerAim(wind, perfect);
  const p = computerShot(aim, wind, perfect);
  assert.ok(Math.abs(p.x) < 1e-12 && Math.abs(p.y) < 1e-12);
  assert.equal(scoreAt(p.x, p.y).label, 'X');
});

test('돌풍은 기본 바람 주위에 머문다', () => {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wind = new Wind(rng);
  wind.shuffle(4);
  assert.ok(wind.speed <= 4 && wind.speed >= 0.6);
  const base = { ...wind.base };
  let far = 0;
  for (let i = 0; i < 2000; i++) {
    wind.step(1 / 30);
    far = Math.max(far, Math.hypot(wind.x - base.x, wind.y - base.y));
  }
  assert.ok(far < 3, `돌풍이 너무 크다: ${far}`);
});

test('토너먼트: 세 번 이기면 금메달, 한 번 지면 탈락', () => {
  const t = new Tournament(() => 0);
  assert.equal(t.opponent.id, 'quarterfinal');
  t.record(true, [6, 2]);
  assert.equal(t.opponent.id, 'semifinal');
  t.record(true, [6, 4]);
  assert.equal(t.podium(), null);
  t.record(true, [7, 5]);
  assert.equal(t.champion, true);
  assert.equal(t.finished, true);
  const [gold, silver, bronze] = t.podium();
  assert.equal(gold.me, true);
  assert.equal(silver, t.opponents[2]);
  assert.equal(bronze, t.opponents[1]);
  assert.throws(() => t.record(true, [6, 0]));

  const lost = new Tournament();
  lost.record(true, [6, 0]);
  lost.record(false, [2, 6]);
  assert.equal(lost.eliminated, true);
  assert.equal(lost.champion, false);
  assert.equal(lost.results.length, 2);
});

test('라운드가 오를수록 상대가 강해진다', () => {
  const opponents = drawOpponents(() => 0.99);
  assert.equal(opponents.length, ROUNDS.length);
  for (let i = 1; i < opponents.length; i++) {
    assert.ok(opponents[i].spread < opponents[i - 1].spread);
    assert.ok(opponents[i].maxWind > opponents[i - 1].maxWind);
  }
  assert.ok(opponents.every((o) => o.name && o.country));
});

test('경기 모드', () => {
  assert.deepEqual(
    new ArcheryMatch().players.map((p) => [p.id, p.human]),
    [
      ['me', true],
      ['computer', false],
    ],
  );
  assert.throws(() => new ArcheryMatch({ mode: 'solo' }));
  assert.equal(WIN_POINTS, 6);
});

test('조준점은 당기면 가라앉았다가 오래 버티면 다시 흔들린다', () => {
  const idle = swayAmplitude(null);
  const start = swayAmplitude(0);
  const steady = swayAmplitude(3);
  const tired = swayAmplitude(12);
  assert.ok(start > idle);
  assert.ok(steady < idle / 2);
  assert.equal(swayAmplitude(2), steady);
  assert.ok(tired > steady * 3);
  assert.ok(swayAmplitude(100) <= 0.12);
  // 가장 안정됐을 때는 흔들려도 X 고리(반지름 3.05cm)를 크게 벗어나지 않는다
  for (let t = 0; t < 30; t += 0.1) {
    const { x, y } = swayOffset(t);
    assert.ok(Math.hypot(x, y) * steady < 0.035);
  }
});
