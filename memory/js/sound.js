// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  flip: { volume: 0.5, gap: 0.03 },
  hide: { volume: 0.35, gap: 0.05 },
  match: { volume: 0.45, gap: 0.05 },
  turn: { volume: 0.4, gap: 0.1 },
  shuffle: { volume: 0.4, gap: 0.3 },
  win: { volume: 0.6, gap: 0 },
};

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS, { jitter: 0.06 });
    this.waiting = null; // 아직 불러오는 중이라 못 튼 소리(시작할 때의 섞는 소리)
  }

  loaded(name) {
    if (this.waiting === name) this.play(name);
  }

  play(name, rate = 1) {
    if (!this.buffers[name]) {
      if (name === 'shuffle') this.waiting = name;
      return null;
    }
    if (this.waiting === name) this.waiting = null;
    return super.play(name, rate);
  }
}
