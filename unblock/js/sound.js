// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).
// 클리어 때 내 차가 출구로 달려 나가는 엔진 소리는 파일 없이 Web Audio 로 만든다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  move: { volume: 0.5, gap: 0.05 },
  bump: { volume: 0.35, gap: 0.15 },
  select: { volume: 0.35, gap: 0.05 },
  undo: { volume: 0.3, gap: 0.04 },
  restart: { volume: 0.4, gap: 0.1 },
  hint: { volume: 0.45, gap: 0.1 },
  win: { volume: 0.6, gap: 0 },
};

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
  }

  /** 차가 미끄러져 멈췄다. cells: 간 칸 수. 멀리 갈수록 조금 낮고 크게 */
  slide(cells) {
    const scale = Math.min(1, cells / 4);
    this.play('move', 1.15 - scale * 0.25, { volume: 0.6 + scale * 0.4 });
  }

  /** 내 차가 출구로 달려 나간다: 톱니파 두 개를 걸러 낮은 엔진 소리를 내고 음을 올리며 줄인다 */
  drive(seconds = 1.1) {
    if (!this.ready) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(1600, now + seconds * 0.7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.08);
    gain.gain.setValueAtTime(0.16, now + seconds * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    filter.connect(gain).connect(this.master);
    for (const [base, detune] of [
      [55, 0],
      [82, 7],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(base * 2.6, now + seconds * 0.8);
      osc.connect(filter);
      osc.start(now);
      osc.stop(now + seconds + 0.05);
    }
  }
}
