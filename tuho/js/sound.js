// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩과 OpenGameArt 의 박수 소리 (assets/CREDITS.md).
// 화살이 날아가는 '휙' 소리와 놋쇠 항아리가 울리는 '댕' 소리는 파일 없이 Web Audio 로 만든다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  release: { volume: 0.35, gap: 0.1 },
  'rim-1': { volume: 0.5, gap: 0.04 },
  'rim-2': { volume: 0.5, gap: 0.04 },
  'rim-hard': { volume: 0.55, gap: 0.05 },
  'clack-1': { volume: 0.6, gap: 0.04 },
  'clack-2': { volume: 0.6, gap: 0.04 },
  land: { volume: 0.6, gap: 0.05 },
  score: { volume: 0.4, gap: 0.1 },
  turn: { volume: 0.45, gap: 0 },
  cheer: { volume: 0.5, gap: 0.5 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const RIMS = ['rim-1', 'rim-2'];
const CLACKS = ['clack-1', 'clack-2'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }

  prepare() {
    this.noise = this.whiteNoise(1);
  }

  /** 화살이 항아리에 부딪혔다. speed: 부딪힌 속력 (m/s). 세게 맞으면 묵직한 '깡' */
  pot(speed) {
    const k = Math.min(1, speed / 4);
    if (k > 0.6) this.play('rim-hard', 1.15, { volume: 0.5 + 0.5 * k });
    else this.play(pick(RIMS), 1.3 - k * 0.2, { volume: 0.25 + 0.75 * k });
  }

  /** 화살이 땅(멍석)에 떨어졌다 */
  ground(speed) {
    const k = Math.min(1, speed / 5);
    if (k > 0.5) this.play('land', 1.1, { volume: 0.4 + 0.6 * k });
    else this.play(pick(CLACKS), 1.2 - k * 0.2, { volume: 0.2 + 0.8 * k });
  }

  /** 던질 때 화살이 공기를 가르는 소리: 잡음을 띠 대역으로 걸러 짧게 흘린다. power 가 셀수록 높고 크게 */
  whoosh(power = 0.5) {
    if (!this.ready || !this.noise) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(700 + power * 500, now);
    band.frequency.exponentialRampToValueAtTime(2200 + power * 800, now + 0.12);
    band.frequency.exponentialRampToValueAtTime(900, now + 0.45);
    band.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22 + 0.15 * power, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    source.connect(band).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.55);
  }

  /**
   * 놋쇠 항아리가 울리는 '댕~': 어긋난 배음의 사인파 몇 개가 천천히 사그라든다.
   * ear 면 작은 귀 통이라 더 높고 짧게 울린다
   */
  ring(ear = false) {
    if (!this.ready) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const base = ear ? 880 : 392;
    const out = ctx.createGain();
    out.gain.value = 0.16;
    out.connect(this.master);
    for (const [ratio, level, decay] of [
      [1, 1, 1.6],
      [2.76, 0.45, 0.9],
      [5.4, 0.25, 0.5],
      [8.9, 0.12, 0.3],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.004);
      const gain = ctx.createGain();
      const life = decay * (ear ? 0.6 : 1);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + life);
      osc.connect(gain).connect(out);
      osc.start(now);
      osc.stop(now + life + 0.05);
    }
  }
}
