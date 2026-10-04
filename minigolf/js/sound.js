// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩과 OpenGameArt 의 박수 (assets/CREDITS.md).
// 공이 잔디·모래 위를 구르는 소리와 물에 빠지는 소리는 파일 없이 잡음을 걸러 만든다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  putt: { volume: 0.6, gap: 0.05 },
  wall: { volume: 0.75, gap: 0.04 },
  thud: { volume: 0.6, gap: 0.06 },
  lip: { volume: 0.45, gap: 0.08 },
  cup: { volume: 0.8, gap: 0 },
  birdie: { volume: 0.5, gap: 0 },
  cheer: { volume: 0.55, gap: 0 },
  turn: { volume: 0.45, gap: 0 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }

  prepare() {
    this.buildRoll();
  }

  setEnabled(enabled) {
    super.setEnabled(enabled);
    if (!enabled) this.setRoll(0);
  }

  /** 공을 쳤다. power: 0~1 */
  putt(power) {
    this.play('putt', 1.3 - power * 0.3, { volume: 0.35 + power * 0.65 });
  }

  /** 벽·장애물에 부딪쳤다. speed: 부딪친 속도 (m/s), kind: physics.js 의 장애물 종류 */
  hit(speed, kind) {
    if (speed < 0.05) return;
    const scale = Math.min(1, speed / 3);
    if (kind === 'block' || kind === 'blade') this.play('thud', 1.3 - scale * 0.2, { volume: 0.3 + scale * 0.7 });
    else this.play('wall', kind === 'post' ? 1.35 : 1.1 - scale * 0.15, { volume: 0.25 + scale * 0.75 });
  }

  /** 컵 가장자리에 걸려 튕겨 나갔다 */
  lip(depth) {
    this.play('lip', 1.6, { volume: 0.4 + depth * 0.6 });
  }

  /** 물에 빠졌다: 낮게 거른 잡음이 짧게 부풀었다 가라앉는다 */
  splash() {
    if (!this.ready) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.whiteNoise(0.9);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + 0.7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.9);
  }

  // ---------- 구르는 소리 ----------

  /** 낮은 대역의 잡음을 계속 돌려 두고, 공의 속도에 따라 볼륨만 올린다 */
  buildRoll() {
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
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'bandpass';
    this.rollFilter.frequency.value = 500;
    this.rollFilter.Q.value = 0.8;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    source.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
    source.start();
  }

  /** 공의 속도 (m/s, 0 이면 조용히). 모래 위에서는 거칠고 높은 소리 */
  setRoll(speed, sand = false) {
    if (!this.rollGain) return;
    const now = this.context.currentTime;
    const level = this.enabled ? Math.min(1, speed / 2.5) : 0;
    this.rollGain.gain.setTargetAtTime(level * (sand ? 0.3 : 0.16), now, 0.05);
    this.rollFilter.frequency.setTargetAtTime(sand ? 2600 : 380 + speed * 220, now, 0.08);
  }
}
