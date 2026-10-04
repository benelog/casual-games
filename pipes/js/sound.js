// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md). 물 흐르는 소리는 파일 없이 잡음을 걸러 만든다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  rotate: { volume: 0.3, gap: 0.03 },
  connect: { volume: 0.45, gap: 0.05 },
  shuffle: { volume: 0.35, gap: 0.1 },
  win: { volume: 0.6, gap: 0 },
};

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS, { jitter: 0.06 });
  }

  /** 물이 쏴 하고 흐르는 소리. 잡음을 띠 통과 필터로 걸러 duration 초 동안 커졌다 잦아든다 */
  flow(duration = 1.8) {
    if (!this.ready) return;
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = this.whiteNoise(duration);
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    const now = context.currentTime;
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(1800, now + duration * 0.6);
    filter.frequency.exponentialRampToValueAtTime(900, now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }
}
