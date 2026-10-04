// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일의 출처는 assets/CREDITS.md. 화살이 날아가는 바람 소리는 파일 없이 잡음을 걸러 만든다.
// 켜고 끈 상태는 localStorage 에 남긴다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  draw: { volume: 0.5, gap: 0.2 },
  release: { volume: 0.7, gap: 0.05 },
  hit: { volume: 0.8, gap: 0.05 },
  miss: { volume: 0.6, gap: 0.05 },
  tick: { volume: 0.5, gap: 0.3 },
  'set-win': { volume: 0.55, gap: 0 },
  turn: { volume: 0.35, gap: 0.2 },
  applause: { volume: 0.45, gap: 1 },
  'ceremony-applause': { volume: 0.55, gap: 1 },
  fanfare: { volume: 0.6, gap: 1 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS, { storageKey: 'casual-games.archery.sound', jitter: 0.06 });
    this.long = new Set(); // 끌 수 있게 들고 있는 긴 소리 (박수·팡파르)
  }

  prepare() {
    this.noise = this.whiteNoise(1);
  }

  setEnabled(on) {
    super.setEnabled(on);
    if (!on) this.stopLong();
  }

  play(name, rate = 1) {
    const voice = super.play(name, rate);
    if (voice && voice.source.buffer.duration > 3) {
      this.long.add(voice);
      voice.source.onended = () => this.long.delete(voice);
    }
    return voice;
  }

  /** 시상식을 떠날 때 박수·팡파르를 줄여 끈다 */
  stopLong() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const { source, gain } of this.long) {
      gain.gain.setTargetAtTime(0, now, 0.15);
      source.stop(now + 0.6);
    }
    this.long.clear();
  }

  /** 화살이 귀 옆을 떠나 멀어지는 바람 소리: 띠 잡음의 높이와 크기를 함께 내린다 */
  whoosh(duration = 0.75) {
    if (!this.ready) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(2600, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.05);
  }
}
