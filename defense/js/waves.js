// 웨이브 구성. 각 웨이브는 차례로 나오는 무리의 목록이고, 무리는 { type, count, interval(초) }.
// 한 무리가 다 나온 뒤 GROUP_GAP 초 쉬고 다음 무리가 나온다. 보스는 5·10·15·20 웨이브.

export const WAVES = [
  /* 1 */ [{ type: 'normal', count: 8, interval: 1.2 }],
  /* 2 */ [{ type: 'normal', count: 12, interval: 1 }],
  /* 3 */ [
    { type: 'normal', count: 8, interval: 1 },
    { type: 'fast', count: 6, interval: 0.7 },
  ],
  /* 4 */ [
    { type: 'normal', count: 10, interval: 0.9 },
    { type: 'heavy', count: 2, interval: 2.5 },
  ],
  /* 5 */ [
    { type: 'normal', count: 8, interval: 1 },
    { type: 'boss', count: 1, interval: 1 },
  ],
  /* 6 */ [{ type: 'fast', count: 18, interval: 0.5 }],
  /* 7 */ [
    { type: 'normal', count: 14, interval: 0.7 },
    { type: 'heavy', count: 5, interval: 1.8 },
  ],
  /* 8 */ [
    { type: 'heavy', count: 7, interval: 1.6 },
    { type: 'fast', count: 12, interval: 0.45 },
  ],
  /* 9 */ [
    { type: 'normal', count: 18, interval: 0.6 },
    { type: 'fast', count: 10, interval: 0.45 },
  ],
  /* 10 */ [
    { type: 'heavy', count: 5, interval: 1.6 },
    { type: 'boss', count: 1, interval: 1 },
    { type: 'normal', count: 10, interval: 0.7 },
  ],
  /* 11 */ [{ type: 'fast', count: 20, interval: 0.45 }],
  /* 12 */ [
    { type: 'normal', count: 18, interval: 0.6 },
    { type: 'heavy', count: 6, interval: 1.4 },
  ],
  /* 13 */ [{ type: 'heavy', count: 10, interval: 1.3 }],
  /* 14 */ [
    { type: 'fast', count: 16, interval: 0.4 },
    { type: 'normal', count: 16, interval: 0.5 },
  ],
  /* 15 */ [
    { type: 'heavy', count: 6, interval: 1.5 },
    { type: 'boss', count: 1, interval: 1 },
    { type: 'fast', count: 12, interval: 0.4 },
  ],
  /* 16 */ [
    { type: 'normal', count: 24, interval: 0.5 },
    { type: 'heavy', count: 8, interval: 1.2 },
  ],
  /* 17 */ [{ type: 'fast', count: 28, interval: 0.35 }],
  /* 18 */ [
    { type: 'heavy', count: 14, interval: 1 },
    { type: 'normal', count: 16, interval: 0.5 },
  ],
  /* 19 */ [
    { type: 'normal', count: 20, interval: 0.45 },
    { type: 'fast', count: 20, interval: 0.35 },
    { type: 'heavy', count: 8, interval: 1 },
  ],
  /* 20 */ [
    { type: 'heavy', count: 8, interval: 1.2 },
    { type: 'boss', count: 2, interval: 6 },
    { type: 'fast', count: 20, interval: 0.35 },
  ],
];

export const GROUP_GAP = 2;

/** 웨이브를 클리어하면 받는 보너스 골드 */
export function waveBonus(wave) {
  return 20 + 3 * wave;
}

/** 웨이브 구성을 { time, type } 의 출현 일정으로 펼친다. time 은 웨이브 시작부터 초 */
export function spawnSchedule(groups) {
  const schedule = [];
  let time = 0;
  groups.forEach((group, i) => {
    if (i > 0) time += GROUP_GAP;
    for (let n = 0; n < group.count; n++) {
      schedule.push({ time, type: group.type });
      if (n < group.count - 1) time += group.interval;
    }
  });
  return schedule;
}

/** 웨이브 구성을 종류별 마릿수로 요약한다. 예: { normal: 8, boss: 1 } */
export function waveSummary(groups) {
  const counts = {};
  for (const g of groups) counts[g.type] = (counts[g.type] ?? 0) + g.count;
  return counts;
}
