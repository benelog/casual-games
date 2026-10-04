// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  step: { volume: 0.22, gap: 0.05 },
  push: { volume: 0.45, gap: 0.05 },
  blocked: { volume: 0.35, gap: 0.12 },
  goal: { volume: 0.55, gap: 0 },
  undo: { volume: 0.3, gap: 0.04 },
  restart: { volume: 0.4, gap: 0.1 },
  select: { volume: 0.4, gap: 0.05 },
  win: { volume: 0.7, gap: 0 },
};

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }
}
