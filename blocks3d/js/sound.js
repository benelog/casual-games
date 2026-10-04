// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  move: { volume: 0.18, gap: 0.04 },
  rotate: { volume: 0.3, gap: 0.04 },
  drop: { volume: 0.35, gap: 0.05 },
  lock: { volume: 0.5, gap: 0.05 },
  clear: { volume: 0.6, gap: 0 },
  perfect: { volume: 0.7, gap: 0 },
  level: { volume: 0.6, gap: 0 },
  over: { volume: 0.7, gap: 0 },
};

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }
}
