// 종목별 판정. 물리 엔진(physics.js)이 남긴 사건 목록을 보고 득점·파울을 가린다. 순수 함수라 node 에서 그대로 테스트한다.
//
// 사건: { t, type: 'hit', a, b } 공끼리 · { t, type: 'cushion', ball, rail } 쿠션 · { t, type: 'pocket', ball } 포켓
//
// 4구 (이 게임의 규칙)
//   내 수구로 빨간 공 두 개를 모두 맞히면 1점, 계속 친다.
//   상대 수구에 내 수구가 닿으면 파울: 1점을 잃고(0점 아래로는 내려가지 않는다) 차례가 넘어간다.
//   그 밖에는(하나만 맞히거나 아무것도 못 맞히면) 점수 변화 없이 차례가 넘어간다.
// 3쿠션
//   내 수구가 두 번째 목적구에 닿기 전까지 쿠션에 3번 이상 닿고, 두 목적구를 모두 맞히면 1점, 계속 친다.
//   파울 감점은 없고, 못 하면 차례가 넘어간다.
// 8볼 (WPA 규칙을 줄인 것. 포켓을 미리 말하지 않는다)
//   브레이크 뒤에는 오픈 테이블. 처음으로 공을 넣은 사람이 그 공의 무리(단색/줄무늬)를 갖는다.
//   파울: 수구가 빠짐(스크래치) · 아무 공도 못 맞힘 · 내 무리가 아닌 공을 먼저 맞힘 ·
//         맞힌 뒤 어떤 공도 쿠션에 닿지 않고 들어간 공도 없음. 파울이면 상대가 수구를 아무 데나 놓고 친다.
//   내 무리를 다 넣은 뒤 8번을 파울 없이 넣으면 이기고, 그 전에 넣거나 넣으면서 파울하면 진다.
//   브레이크에서 8번이 들어가면 풋 스폿에 다시 놓는다.

const CUSHION_MERGE = 0.08; // 같은 쿠션에 이 시간(초) 안에 거듭 닿은 것은 한 번으로 센다 (쿠션을 타고 구를 때)

/** 사건 중 수구 cue 가 다른 공에 닿은 것을 차례로: [{ t, ball }] */
export function cueContacts(events, cue) {
  const out = [];
  for (const e of events) {
    if (e.type !== 'hit') continue;
    if (e.a === cue) out.push({ t: e.t, ball: e.b });
    else if (e.b === cue) out.push({ t: e.t, ball: e.a });
  }
  return out;
}

/** 4구 판정. cue 는 친 사람의 수구(0 또는 1), 상대 수구는 1 - cue, 빨간 공은 2·3 */
export function judgeFourBall(events, cue) {
  const touched = new Set();
  let foul = false;
  for (const { ball } of cueContacts(events, cue)) {
    if (ball === 1 - cue) foul = true;
    else touched.add(ball);
  }
  const reds = [2, 3].filter((b) => touched.has(b)).length;
  return { scored: !foul && reds === 2, foul, reds };
}

/**
 * 3쿠션 판정. cushions 는 두 번째 목적구에 닿기 전(못 닿았으면 끝까지) 수구가 쿠션에 닿은 횟수,
 * objects 는 맞힌 목적구 수.
 */
export function judgeThreeCushion(events, cue) {
  let cushions = 0;
  let last = null;
  const seen = new Set();
  for (const e of events) {
    if (e.type === 'cushion' && e.ball === cue) {
      if (!(last && last.rail === e.rail && e.t - last.t < CUSHION_MERGE)) cushions++;
      last = e;
    } else if (e.type === 'hit' && (e.a === cue || e.b === cue)) {
      const other = e.a === cue ? e.b : e.a;
      if (seen.has(other)) continue;
      seen.add(other);
      if (seen.size === 2) return { scored: cushions >= 3, cushions, objects: 2 };
    }
  }
  return { scored: false, cushions, objects: seen.size };
}

/** 8볼의 공 무리 */
export const groupOf = (n) => (n === 0 ? 'cue' : n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe');
export const otherGroup = (g) => (g === 'solid' ? 'stripe' : 'solid');

/** 이번 샷에서 먼저 맞혀도 되는 공인지. onTable 은 샷 전에 대 위에 있던 번호 공 */
export function legalFirst(ball, { group, isBreak, onTable }) {
  if (isBreak) return true;
  if (!group) return ball !== 8; // 오픈 테이블: 8번만 아니면 된다
  const left = onTable.some((n) => groupOf(n) === group);
  return left ? groupOf(ball) === group : ball === 8;
}

/**
 * 8볼 판정.
 * state = { player, groups: [g0, g1] (null 이면 아직 없음), isBreak, onTable: 샷 전에 대 위에 있던 번호 공 }
 * 돌려주는 값: { foul: null | 'scratch' | 'noHit' | 'wrongBall' | 'noRail', first, pocketed, scratch,
 *   respotEight, winner: null | 0 | 1, lostOnEight, groups(바뀐 무리), assigned, keepTurn }
 */
export function judgeEightBall(state, events) {
  const { player, isBreak, onTable } = state;
  const group = state.groups[player];
  let first = null;
  let rail = false;
  let scratch = false;
  const pocketed = [];
  for (const e of events) {
    if (e.type === 'hit' && first === null && (e.a === 0 || e.b === 0)) first = e.a === 0 ? e.b : e.a;
    else if (e.type === 'cushion' && first !== null) rail = true;
    else if (e.type === 'pocket') {
      if (e.ball === 0) scratch = true;
      else pocketed.push(e.ball);
    }
  }

  let foul = null;
  if (scratch) foul = 'scratch';
  else if (first === null) foul = 'noHit';
  else if (!legalFirst(first, { group, isBreak, onTable })) foul = 'wrongBall';
  else if (!isBreak && !rail && pocketed.length === 0) foul = 'noRail';

  const groups = [...state.groups];
  let winner = null;
  let lostOnEight = false;
  let respotEight = false;
  const eight = pocketed.includes(8);
  const balls = pocketed.filter((n) => n !== 8);
  if (eight) {
    if (isBreak) respotEight = true;
    else {
      const cleared = !!group && !onTable.some((n) => groupOf(n) === group);
      if (cleared && !foul) winner = player;
      else {
        winner = 1 - player;
        lostOnEight = true;
      }
    }
  }

  let assigned = null;
  if (!group && !isBreak && !foul && balls.length && winner === null) {
    assigned = groupOf(balls[0]);
    groups[player] = assigned;
    groups[1 - player] = otherGroup(assigned);
  }
  const own = groups[player];
  const keepTurn =
    winner === null && !foul && (own ? balls.some((n) => groupOf(n) === own) : balls.length > 0);
  return { foul, first, pocketed, scratch, respotEight, winner, lostOnEight, groups, assigned, keepTurn };
}
