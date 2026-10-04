import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseShot, chooseTarget, LEVELS, LEVEL_IDS } from '../js/ai.js';
import { launch, simulate, isIn, aimFor, TARGETS } from '../js/physics.js';
import { LINES } from '../js/game.js';
import { createRng } from '../../shared/util.js';

/** levelId 의 컴퓨터가 세 줄에서 번갈아 count 발 던졌을 때의 결과 수 */
function throwMany(levelId, count, seed) {
  const rng = createRng(seed);
  const counts = { mouth: 0, ear: 0, lean: 0, miss: 0 };
  for (let i = 0; i < count; i++) {
    const distance = LINES[i % LINES.length].distance;
    const shot = chooseShot(distance, levelId, {}, rng);
    counts[simulate(launch(distance, shot)).result]++;
  }
  return { counts, rate: (counts.mouth + counts.ear) / count };
}

test('실력이 높을수록 손 떨림이 작다', () => {
  assert.deepEqual(LEVEL_IDS, ['easy', 'normal', 'hard']);
  for (const key of ['power', 'yaw', 'pitch']) {
    assert.ok(LEVELS.easy[key] > LEVELS.normal[key] && LEVELS.normal[key] > LEVELS.hard[key], key);
  }
});

test('난이도별로 그럴듯한 성공률: 쉬움은 네 발에 한 발, 보통은 절반, 어려움은 대부분', () => {
  const count = 120;
  const easy = throwMany('easy', count, 11);
  const normal = throwMany('normal', count, 12);
  const hard = throwMany('hard', count, 13);
  assert.ok(easy.rate > 0.1 && easy.rate < 0.42, `easy ${easy.rate}`);
  assert.ok(normal.rate > 0.35 && normal.rate < 0.68, `normal ${normal.rate}`);
  assert.ok(hard.rate > 0.62 && hard.rate < 0.95, `hard ${hard.rate}`);
  assert.ok(easy.rate < normal.rate && normal.rate < hard.rate);
});

test('손이 떨리지 않으면 겨눈 곳에 넣는다', () => {
  const steady = () => 0.25; // gaussian 이 0 이 되는 난수 (cos(π/2) = 0)
  for (const line of LINES) {
    const shot = chooseShot(line.distance, 'easy', {}, steady);
    assert.equal(shot.target, 'mouth');
    assert.ok(isIn(simulate(launch(line.distance, shot)).result), line.id);
  }
});

test('겨냥: 보통은 입을 노리고, 어려움은 따라잡기 어려울 만큼 뒤지면 귀를 노린다', () => {
  const rng = createRng(3);
  let ears = 0;
  for (let i = 0; i < 200; i++) if (chooseTarget('easy', {}, rng) !== 'mouth') ears++;
  assert.equal(ears, 0, '쉬움은 귀를 노리지 않는다');
  assert.equal(chooseTarget('hard', { behind: 7, left: 2 }, () => 0.9), 'earRight');
  assert.equal(chooseTarget('hard', { behind: 7, left: 2 }, () => 0.1), 'earLeft');
  assert.equal(chooseTarget('hard', { behind: 2, left: 5 }, () => 0.9), 'mouth', '따라잡을 수 있으면 입');
  assert.equal(chooseTarget('normal', { behind: 20, left: 0 }, () => 0.9), 'mouth');
  // 귀를 노린 세기·방향은 그 귀 쪽이다
  const left = aimFor(3, TARGETS.earLeft);
  const right = aimFor(3, TARGETS.earRight);
  assert.ok(left.yaw < 0 && right.yaw > 0);
});
