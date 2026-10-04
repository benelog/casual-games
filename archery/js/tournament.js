// 컴퓨터와 겨루는 챔피언십 토너먼트: 8강 → 4강 → 결승. 한 번이라도 지면 탈락하고,
// 세 경기를 모두 이기면 금메달이다. 시상대에는 결승 상대가 은메달, 4강 상대가 동메달로 선다
// (4강에서 진 선수가 동메달 결정전을 이겼다고 본다).
// 상대 선수는 가상의 인물이다. 라운드가 오를수록 화살이 덜 퍼지고 바람을 더 잘 읽으며, 바람도 세진다.

export const ROUNDS = [
  // spread: 화살이 퍼지는 표준편차(m), windRead: 바람 계산이 틀리는 정도(1 이면 바람을 무시), maxWind: 최대 풍속(m/s)
  { id: 'quarterfinal', spread: 0.09, windRead: 0.5, maxWind: 2.5 }, // 화살 평균 약 8.6점
  { id: 'semifinal', spread: 0.07, windRead: 0.4, maxWind: 3.5 }, // 약 9.0점
  { id: 'final', spread: 0.055, windRead: 0.3, maxWind: 4.5 }, // 약 9.3점
];

// 이름은 언어와 상관없이 로마자로 쓴다
const POOL = [
  [
    { name: 'L. Moreau', country: 'FRA' },
    { name: 'T. Novak', country: 'CZE' },
    { name: 'R. Okafor', country: 'NGR' },
    { name: 'J. Lindqvist', country: 'SWE' },
    { name: 'M. Ferreira', country: 'BRA' },
  ],
  [
    { name: 'A. Castellano', country: 'ITA' },
    { name: 'K. Brandt', country: 'GER' },
    { name: 'D. Whitfield', country: 'GBR' },
    { name: 'S. Aydın', country: 'TUR' },
  ],
  [
    { name: 'H. Tanabe', country: 'JPN' },
    { name: 'E. Ramírez', country: 'MEX' },
    { name: 'P. Kowalczyk', country: 'POL' },
    { name: 'C. Harlow', country: 'USA' },
  ],
];

/** 라운드마다 상대를 한 명씩 고른다 */
export function drawOpponents(rng = Math.random) {
  return POOL.map((pool, i) => ({ ...pool[Math.floor(rng() * pool.length)], ...ROUNDS[i] }));
}

export class Tournament {
  constructor(rng = Math.random) {
    this.opponents = drawOpponents(rng);
    this.round = 0; // 지금(다음에) 치를 경기
    this.results = []; // 끝난 경기: { won, points: [나, 상대] }
  }

  get opponent() {
    return this.opponents[this.round];
  }

  get eliminated() {
    return this.results.some((r) => !r.won);
  }

  get champion() {
    return this.results.length === ROUNDS.length && !this.eliminated;
  }

  get finished() {
    return this.eliminated || this.champion;
  }

  /** 지금 라운드의 결과를 남기고, 이겼으면 다음 라운드로 */
  record(won, points) {
    if (this.finished) throw new Error('토너먼트가 끝났습니다');
    this.results.push({ won, points: [...points] });
    if (won && this.round < ROUNDS.length - 1) this.round += 1;
  }

  /** 시상대: [금, 은, 동]. 우승했을 때만 */
  podium() {
    if (!this.champion) return null;
    return [{ me: true }, this.opponents[2], this.opponents[1]];
  }
}
