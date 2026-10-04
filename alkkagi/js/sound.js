// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).
// 돌이 판 위를 미끄러지는 사각 소리는 파일 없이 잡음을 걸러 만든다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  flick: { volume: 0.55, gap: 0.05 },
  'hit-1': { volume: 0.8, gap: 0.03 },
  'hit-2': { volume: 0.8, gap: 0.03 },
  'hit-3': { volume: 0.8, gap: 0.03 },
  land: { volume: 0.55, gap: 0.06 },
  turn: { volume: 0.45, gap: 0 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const HITS = ['hit-1', 'hit-2', 'hit-3'];

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }

  prepare() {
    this.buildSlide();
  }

  setEnabled(enabled) {
    super.setEnabled(enabled);
    if (!enabled) this.setSlide(0);
  }

  /** 돌을 튕겼다. power: 0~1 */
  flick(power) {
    this.play('flick', 1.25 - power * 0.25, { volume: 0.35 + power * 0.65 });
  }

  /** 돌끼리 부딪쳤다. speed: 부딪힌 상대 속도 (m/s). 세게 부딪힐수록 크고 조금 낮게 */
  hit(speed) {
    if (speed < 0.02) return;
    const scale = Math.min(1, speed / 1.4);
    this.play(HITS[Math.floor(Math.random() * HITS.length)], 1.2 - scale * 0.25, { volume: 0.2 + scale * 0.8 });
  }

  /** 떨어진 돌이 바닥에 닿았다. pan: -1(왼쪽) ~ 1(오른쪽) */
  land(pan = 0) {
    this.play('land', 1.4, { volume: 0.7, pan: Math.round(pan * 4) / 4 });
  }

  // ---------- 미끄러지는 소리 ----------

  /** 높은 대역의 잡음을 계속 돌려 두고, 가장 빠른 돌의 속도에 따라 볼륨만 올린다 */
  buildSlide() {
    const ctx = this.context;
    const buffer = this.whiteNoise(1.5);
    const data = buffer.getChannelData(0);
    // 이음매에서 딸깍거리지 않게 앞뒤를 맞춘다
    const fade = 2048;
    const n = data.length;
    for (let i = 0; i < fade; i++) data[n - fade + i] = data[n - fade + i] * (1 - i / fade) + data[i] * (i / fade);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.slideFilter = ctx.createBiquadFilter();
    this.slideFilter.type = 'bandpass';
    this.slideFilter.frequency.value = 1800;
    this.slideFilter.Q.value = 0.9;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    source.connect(this.slideFilter).connect(this.slideGain).connect(this.master);
    source.start();
  }

  /** 가장 빠른 돌의 속도 (m/s, 0 이면 조용히) */
  setSlide(speed) {
    if (!this.slideGain) return;
    const now = this.context.currentTime;
    const level = this.enabled ? Math.min(1, speed / 1.2) : 0;
    this.slideGain.gain.setTargetAtTime(level * 0.12, now, 0.05);
    this.slideFilter.frequency.setTargetAtTime(1300 + speed * 900, now, 0.08);
  }
}
