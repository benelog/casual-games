// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  'place-1': { volume: 0.7, gap: 0.03 },
  'place-2': { volume: 0.7, gap: 0.03 },
  'place-3': { volume: 0.7, gap: 0.03 },
  click: { volume: 0.35, gap: 0.03 },
  select: { volume: 0.25, gap: 0.04 },
  undo: { volume: 0.45, gap: 0.05 },
  turn: { volume: 0.4, gap: 0 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const PLACES = ['place-1', 'place-2', 'place-3'];

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }

  /** 돌이 판에 닿았다. 나무에 부딪는 소리에 돌끼리 닿는 딸깍 소리를 살짝 겹친다. pan: -1(왼쪽) ~ 1(오른쪽) */
  place(pan = 0) {
    const p = Math.round(pan * 4) / 4;
    this.play(PLACES[Math.floor(Math.random() * PLACES.length)], 1.15, { pan: p });
    this.play('click', 1.3, { volume: 0.8, pan: p });
  }
}
