// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩과 OpenGameArt 의 박수 소리 (assets/CREDITS.md).
// 그물을 스치는 '촥' 소리와 경기 끝 버저는 파일 없이 Web Audio 로 만든다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  release: { volume: 0.45, gap: 0.1 },
  'bounce-1': { volume: 0.7, gap: 0.05 },
  'bounce-2': { volume: 0.7, gap: 0.05 },
  'rim-1': { volume: 0.55, gap: 0.05 },
  'rim-2': { volume: 0.55, gap: 0.05 },
  'rim-hard': { volume: 0.6, gap: 0.05 },
  board: { volume: 0.6, gap: 0.06 },
  score: { volume: 0.4, gap: 0.1 },
  tick: { volume: 0.5, gap: 0.2 },
  turn: { volume: 0.45, gap: 0 },
  cheer: { volume: 0.5, gap: 0.5 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const BOUNCES = ['bounce-1', 'bounce-2'];
const RIMS = ['rim-1', 'rim-2'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }

  prepare() {
    this.noise = this.whiteNoise(1);
  }

  /** 공이 바닥에 튀었다. speed: 부딪힌 속력 (m/s). 약하게 튈수록 작고 높게 */
  bounce(speed) {
    const k = Math.min(1, speed / 6);
    this.play(pick(BOUNCES), 1.25 - k * 0.3, { volume: 0.15 + 0.85 * k });
  }

  /** 림에 맞았다. 세게 맞으면 묵직한 '깡' */
  rim(speed) {
    const k = Math.min(1, speed / 5);
    if (k > 0.55) this.play('rim-hard', 1, { volume: 0.5 + 0.5 * k });
    else this.play(pick(RIMS), 1.1 - k * 0.2, { volume: 0.2 + 0.8 * k });
  }

  board(speed) {
    const k = Math.min(1, speed / 6);
    this.play('board', 1.05 - k * 0.1, { volume: 0.3 + 0.7 * k });
  }

  /** 그물을 스치는 소리: 높은 대역의 잡음을 짧게 흘린다. clean 이면 더 또렷하게 */
  swish(clean) {
    if (!this.ready || !this.noise) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.2;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(clean ? 3800 : 2600, now);
    band.frequency.exponentialRampToValueAtTime(1400, now + 0.35);
    band.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(clean ? 0.5 : 0.32, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    source.connect(band).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.45);
  }

  /** 시간이 다 되었을 때 울리는 경기장 버저 */
  buzzer() {
    if (!this.ready) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.02);
    gain.gain.setValueAtTime(0.16, now + 0.85);
    gain.gain.linearRampToValueAtTime(0, now + 1);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 1800;
    low.connect(gain).connect(this.master);
    for (const frequency of [220, 223, 330]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = frequency;
      osc.connect(low);
      osc.start(now);
      osc.stop(now + 1.05);
    }
  }
}
