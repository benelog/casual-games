// 컬링 경기 규칙: 엔드마다 점수 매기기, 해머(마지막 스톤) 넘기기, 엔드·스톤 수, 승패.
// 화면과 물리에 의존하지 않는 순수 로직이다.
//
// - 한 엔드에 팀마다 스톤 stones 개를 번갈아 던진다. 해머가 없는 팀이 먼저 던진다.
// - 엔드가 끝나면 버튼에 가장 가까운 스톤의 팀만 점수를 얻는다. 상대의 가장 가까운 스톤보다
//   버튼에 가까운 자기 스톤 하나에 1점. 하우스(12피트 원)에 닿은 스톤만 센다.
// - 점수를 낸 팀의 상대가 다음 엔드의 해머를 갖는다. 아무도 점수를 못 낸 블랭크 엔드면 해머는 그대로.
// - 정한 엔드를 다 하고도 같으면 승부가 날 때까지 엑스트라 엔드를 한다.

import { distanceToButton, inHouse } from './physics.js';

export const END_OPTIONS = [2, 4, 6];
export const STONE_OPTIONS = [4, 8];
export const TEAMS = [0, 1]; // 0 빨강, 1 노랑

/**
 * 놓여 있는 스톤 [{ team, x, z }] 으로 엔드 점수를 매긴다.
 * { team: 점수를 낸 팀 (블랭크면 -1), points, counting: 점수가 되는 스톤들, ranked: 하우스 안 스톤을 가까운 순으로 }
 * 가장 가까운 두 팀의 스톤이 똑같이 가까우면 블랭크로 본다.
 */
export function scoreEnd(stones) {
  const ranked = stones
    .filter((s) => s.inPlay !== false && inHouse(s))
    .map((s) => ({ stone: s, d: distanceToButton(s) }))
    .sort((a, b) => a.d - b.d);
  if (ranked.length === 0) return { team: -1, points: 0, counting: [], ranked: [] };
  const team = ranked[0].stone.team;
  const rival = ranked.find((r) => r.stone.team !== team);
  if (rival && Math.abs(rival.d - ranked[0].d) < 1e-6) return { team: -1, points: 0, counting: [], ranked: ranked.map((r) => r.stone) };
  const counting = [];
  for (const r of ranked) {
    if (r.stone.team !== team) break;
    counting.push(r.stone);
  }
  return { team, points: counting.length, counting, ranked: ranked.map((r) => r.stone) };
}

/** 한 경기. mode: 'computer' (팀 1 이 컴퓨터) 또는 'versus' (2인) */
export class CurlingMatch {
  constructor({ ends = 4, stones = 4, mode = 'computer', hammer = 1 } = {}) {
    if (!Number.isInteger(ends) || ends < 1) throw new Error(`엔드 수가 잘못됐습니다: ${ends}`);
    if (!Number.isInteger(stones) || stones < 1) throw new Error(`스톤 수가 잘못됐습니다: ${stones}`);
    this.ends = ends;
    this.stones = stones;
    this.mode = mode;
    this.hammer = hammer; // 이번 엔드에 마지막 스톤을 던지는 팀
    this.end = 0; // 지금 엔드 (0 부터). ends 이상이면 엑스트라 엔드
    this.shot = 0; // 이번 엔드에서 던진 스톤 수 (두 팀 합)
    this.scores = [[], []]; // 팀마다 엔드별 점수 (상대가 낸 엔드는 0)
    this.history = []; // 엔드마다 { team, points, hammer }
    this.over = false;
  }

  /** 지금 던질 팀. 해머가 없는 팀부터 번갈아 */
  get current() {
    return this.shot % 2 === 0 ? 1 - this.hammer : this.hammer;
  }

  isHuman(team) {
    return this.mode === 'versus' || team === 0;
  }

  /** team 이 이번 엔드에 아직 던지지 않은 스톤 수 */
  stonesLeft(team) {
    const thrown = team === 1 - this.hammer ? Math.ceil(this.shot / 2) : Math.floor(this.shot / 2);
    return this.stones - thrown;
  }

  /** 이번 엔드의 스톤을 모두 던졌는지 */
  get endComplete() {
    return this.shot >= this.stones * 2;
  }

  /** 이번 엔드의 마지막 스톤(해머)인지 */
  get lastStone() {
    return this.shot === this.stones * 2 - 1;
  }

  total(team) {
    return this.scores[team].reduce((sum, n) => sum + n, 0);
  }

  /** 엑스트라 엔드인지 */
  get extra() {
    return this.end >= this.ends;
  }

  /** 스톤 하나를 던졌다 */
  thrown() {
    if (this.over || this.endComplete) throw new Error('이번 엔드의 스톤을 모두 던졌습니다');
    this.shot++;
  }

  /**
   * 엔드를 끝내고 점수를 적는다. result 는 scoreEnd 의 결과.
   * { team, points, blank, hammer: 다음 엔드의 해머, gameOver } 를 돌려준다.
   */
  finishEnd(result) {
    if (this.over) throw new Error('경기가 끝났습니다');
    const { team, points } = result;
    const blank = team < 0 || points === 0;
    for (const t of TEAMS) this.scores[t][this.end] = !blank && t === team ? points : 0;
    this.history.push({ team: blank ? -1 : team, points: blank ? 0 : points, hammer: this.hammer });
    // 점수를 낸 팀의 상대가 해머를 갖는다. 블랭크면 그대로
    if (!blank) this.hammer = 1 - team;
    this.end++;
    this.shot = 0;
    const [a, b] = TEAMS.map((t) => this.total(t));
    if (this.end >= this.ends && a !== b) this.over = true;
    return { team: blank ? -1 : team, points: blank ? 0 : points, blank, hammer: this.hammer, gameOver: this.over };
  }

  /** 이긴 팀 (끝나지 않았으면 null) */
  get winner() {
    if (!this.over) return null;
    return this.total(0) > this.total(1) ? 0 : 1;
  }
}
