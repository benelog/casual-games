// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).
// 엔진 소리와 주차 감지기의 삐삐 소리는 파일 없이 Web Audio 로 만든다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  'bump-1': { volume: 0.7, gap: 0.08 },
  'bump-2': { volume: 0.7, gap: 0.08 },
  crash: { volume: 0.9, gap: 0.2 },
  tap: { volume: 0.6, gap: 0.08 },
  gear: { volume: 0.35, gap: 0.05 },
  select: { volume: 0.4, gap: 0.05 },
  parked: { volume: 0.55, gap: 0 },
  win: { volume: 0.7, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const BEEP_HZ = 1900;

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS);
    this.nextBeep = 0;
  }

  prepare() {
    this.buildEngine();
  }

  setEnabled(enabled) {
    super.setEnabled(enabled);
    if (!enabled) this.setEngine(0, 0);
  }

  /** 부딪혔다. severity: light | hard | crash */
  contact(severity) {
    if (severity === 'crash') this.play('crash');
    else if (severity === 'hard') this.play(Math.random() < 0.5 ? 'bump-1' : 'bump-2');
    else this.play('tap', 1, { volume: 0.8 });
  }

  // ---------- 엔진 ----------

  /** 낮은 톱니파 두 개를 걸러 엔진처럼 웅웅거리게 하고, 회전수에 따라 높이와 크기를 바꾼다 */
  buildEngine() {
    const ctx = this.context;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 2;
    this.engineFilter = filter;
    this.engineOscs = [0, 1].map((i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 38 + i * 0.7; // 살짝 어긋나 맥놀이가 생긴다
      osc.connect(filter);
      osc.start();
      return osc;
    });
    filter.connect(this.engineGain).connect(this.master);
  }

  /** throttle: 0~1, speed: m/s 의 크기. 공회전이면 조용히 낮게 */
  setEngine(throttle, speed) {
    if (!this.engineGain) return;
    const now = this.context.currentTime;
    const rpm = Math.min(1, throttle * 0.6 + speed / 6);
    const level = this.enabled ? 0.05 + rpm * 0.11 : 0;
    this.engineGain.gain.setTargetAtTime(level, now, 0.08);
    for (const [i, osc] of this.engineOscs.entries()) osc.frequency.setTargetAtTime(38 + rpm * 55 + i * 0.7, now, 0.1);
    this.engineFilter.frequency.setTargetAtTime(320 + rpm * 700, now, 0.1);
  }

  // ---------- 주차 감지기 ----------

  /** 짧은 삐 소리 */
  beep(length = 0.07) {
    if (!this.ready) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = BEEP_HZ;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
    gain.gain.setValueAtTime(0.12, now + length);
    gain.gain.linearRampToValueAtTime(0, now + length + 0.01);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + length + 0.02);
  }

  /**
   * 가장 가까운 장애물까지의 거리(m, 멀면 Infinity)에 따라 삐삐 간격을 줄인다. 아주 가까우면 계속 운다.
   * 매 프레임 dt 와 함께 부른다.
   */
  sensor(distance, dt) {
    if (!Number.isFinite(distance)) {
      this.nextBeep = 0;
      return;
    }
    this.nextBeep -= dt;
    if (this.nextBeep > 0) return;
    if (distance < 0.3) {
      this.beep(0.12);
      this.nextBeep = 0.11;
    } else {
      this.beep();
      this.nextBeep = 0.12 + distance * 0.45;
    }
  }
}
