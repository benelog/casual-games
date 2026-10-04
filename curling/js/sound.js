// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩과 OpenGameArt 의 박수 소리 (assets/CREDITS.md).
// 스톤이 얼음 위를 미끄러지는 우르릉 소리와 스위핑하는 비질 소리는 파일 없이 잡음을 걸러 만든다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  release: { volume: 0.5, gap: 0.1 },
  'hit-1': { volume: 0.8, gap: 0.04 },
  'hit-2': { volume: 0.8, gap: 0.04 },
  'hit-3': { volume: 0.8, gap: 0.04 },
  board: { volume: 0.5, gap: 0.1 },
  turn: { volume: 0.45, gap: 0 },
  cheer: { volume: 0.55, gap: 0.5 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const HITS = ['hit-1', 'hit-2', 'hit-3'];

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }

  prepare() {
    this.buildRumble();
    this.buildSweep();
  }

  setEnabled(enabled) {
    super.setEnabled(enabled);
    if (!enabled) {
      this.setSlide(0);
      this.setSweep(0);
    }
  }

  /** 스톤끼리 부딪쳤다. speed: 부딪힌 상대 속도 (m/s). 세게 부딪힐수록 크고 조금 낮게 */
  hit(speed) {
    if (speed < 0.05) return;
    const scale = Math.min(1, speed / 2.5);
    this.play(HITS[Math.floor(Math.random() * HITS.length)], 1.15 - scale * 0.25, { volume: 0.25 + scale * 0.75 });
  }

  // ---------- 미끄러지는 소리 ----------

  /** 반복해 틀 잡음 버퍼. brown 이면 낮은 소리가 강한 갈색 잡음 */
  loopNoise(seconds, brown) {
    const ctx = this.context;
    const length = Math.ceil(ctx.sampleRate * seconds);
    const buffer = brown ? ctx.createBuffer(1, length, ctx.sampleRate) : this.whiteNoise(seconds);
    const data = buffer.getChannelData(0);
    if (brown) {
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.5;
      }
    }
    // 이음매에서 딸깍거리지 않게 앞뒤를 맞춘다
    const fade = 2048;
    for (let i = 0; i < fade; i++) data[length - fade + i] = data[length - fade + i] * (1 - i / fade) + data[i] * (i / fade);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  /** 낮게 거른 갈색 잡음을 계속 돌려 두고, 스톤 속도에 따라 볼륨만 올린다 */
  buildRumble() {
    const ctx = this.context;
    const source = this.loopNoise(2, true);
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 160;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    source.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.master);
    source.start();
  }

  /** 가장 빠른 스톤의 속도 (m/s, 0 이면 조용히) */
  setSlide(speed) {
    if (!this.rumbleGain) return;
    const now = this.context.currentTime;
    const level = this.enabled ? Math.min(1, speed / 2.5) : 0;
    this.rumbleGain.gain.setTargetAtTime(level * 0.9, now, 0.08);
    this.rumbleFilter.frequency.setTargetAtTime(110 + speed * 45, now, 0.1);
  }

  // ---------- 스위핑 ----------

  /** 높은 대역의 잡음을 비질 박자(초당 약 6번)로 흔든다 */
  buildSweep() {
    const ctx = this.context;
    const source = this.loopNoise(1.5, false);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2400;
    band.Q.value = 0.8;
    this.sweepGain = ctx.createGain();
    this.sweepGain.gain.value = 0;
    // 비질 박자: 저주파 발진기로 볼륨을 오르내린다
    const strokes = ctx.createGain();
    strokes.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(strokes.gain);
    lfo.start();
    source.connect(band).connect(strokes).connect(this.sweepGain).connect(this.master);
    source.start();
  }

  /** 스위핑 세기 0~1 */
  setSweep(level) {
    if (!this.sweepGain) return;
    const now = this.context.currentTime;
    this.sweepGain.gain.setTargetAtTime(this.enabled ? level * 0.35 : 0, now, 0.05);
  }
}
