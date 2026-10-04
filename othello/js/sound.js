// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  'place-1': { volume: 0.75, gap: 0.04 },
  'place-2': { volume: 0.75, gap: 0.04 },
  'place-3': { volume: 0.75, gap: 0.04 },
  'flip-1': { volume: 0.5, gap: 0.03 },
  'flip-2': { volume: 0.5, gap: 0.03 },
  'flip-3': { volume: 0.5, gap: 0.03 },
  pass: { volume: 0.55, gap: 0 },
  undo: { volume: 0.6, gap: 0.05 },
  turn: { volume: 0.45, gap: 0 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const pick = (names) => names[Math.floor(Math.random() * names.length)];

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }

  /** 돌을 판에 놓았다. pan: -1(왼쪽) ~ 1(오른쪽) */
  place(pan = 0) {
    this.play(pick(['place-1', 'place-2', 'place-3']), 1.05, { pan: Math.round(pan * 4) / 4 });
  }

  /** 돌 하나가 뒤집혀 내려앉았다. k: 이번 수에서 몇 번째로 뒤집힌 돌인지 (뒤로 갈수록 조금 높게) */
  flip(k = 0, pan = 0) {
    this.play(pick(['flip-1', 'flip-2', 'flip-3']), 1 + Math.min(k, 8) * 0.03, { volume: 0.8, pan: Math.round(pan * 4) / 4 });
  }
}
