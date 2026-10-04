// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md). 윷가락이 공중에서 도는 바람 소리는 파일 없이 잡음을 걸러 만든다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  'clack-1': { volume: 0.55, gap: 0.02 },
  'clack-2': { volume: 0.55, gap: 0.02 },
  'clack-3': { volume: 0.55, gap: 0.02 },
  land: { volume: 0.6, gap: 0.03 },
  step: { volume: 0.32, gap: 0.05 },
  capture: { volume: 0.6, gap: 0.05 },
  stack: { volume: 0.5, gap: 0.05 },
  home: { volume: 0.5, gap: 0.05 },
  bonus: { volume: 0.45, gap: 0.1 },
  turn: { volume: 0.35, gap: 0.1 },
  select: { volume: 0.4, gap: 0.03 },
  backdo: { volume: 0.45, gap: 0.05 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const CLACKS = ['clack-1', 'clack-2', 'clack-3'];

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS, { jitter: 0.1 });
  }

  prepare() {
    this.noise = this.whiteNoise(1);
  }

  /** 윷가락이 바닥이나 서로 부딪는 소리. strength 0~1, pan -1~1 */
  clack(strength = 1, pan = 0) {
    const name = strength > 0.85 ? 'land' : CLACKS[Math.floor(Math.random() * CLACKS.length)];
    this.play(name, 0.9 + Math.random() * 0.3, { volume: 0.35 + 0.65 * strength, pan });
  }

  /** 윷가락이 손을 떠나 공중에서 도는 휙 소리 */
  whoosh(duration = 0.6) {
    if (!this.ready || !this.noise) return;
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    const now = context.currentTime;
    filter.frequency.setValueAtTime(380, now);
    filter.frequency.exponentialRampToValueAtTime(1500, now + duration * 0.35);
    filter.frequency.exponentialRampToValueAtTime(500, now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    source.stop(now + duration + 0.05);
  }
}
