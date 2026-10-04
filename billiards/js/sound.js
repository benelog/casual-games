// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md). 공끼리·쿠션·포켓 소리는 부딪친 속도에 따라 크기와 높이를 바꾼다.

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  cue: { volume: 0.7, gap: 0.05 },
  'clack-1': { volume: 0.9, gap: 0.015 },
  'clack-2': { volume: 0.9, gap: 0.015 },
  'clack-3': { volume: 0.9, gap: 0.015 },
  'clack-4': { volume: 0.9, gap: 0.015 },
  cushion: { volume: 0.7, gap: 0.03 },
  pocket: { volume: 0.75, gap: 0.05 },
  score: { volume: 0.45, gap: 0.1 },
  foul: { volume: 0.45, gap: 0.2 },
  turn: { volume: 0.4, gap: 0.2 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const CLACKS = ['clack-1', 'clack-2', 'clack-3', 'clack-4'];
const VOICES = 8; // 브레이크처럼 한꺼번에 부딪칠 때 동시에 내는 충돌 소리 수
const VOICE_TIME = 0.12;

export class Sound extends BaseSound {
  constructor(baseUrl, options) {
    super(baseUrl, SOUNDS, options);
    this.voices = [];
  }

  /**
   * 물리에서 일어난 사건. type: strike · hit · cushion · pocket, speed: 부딪친 속도 (m/s), pan: -1 ~ 1
   */
  impact(type, speed, pan = 0) {
    if (!this.context) return;
    pan = Math.round(pan * 4) / 4; // 같은 소리의 간격을 자리별로 세므로 몇 갈래로만 나눈다
    const now = this.context.currentTime;
    this.voices = this.voices.filter((t) => now - t < VOICE_TIME);
    if (this.voices.length >= VOICES && type !== 'strike') return;
    let played = null;
    if (type === 'strike') {
      const k = Math.min(1, speed / 6);
      played = this.play('cue', 1.1 - k * 0.2, { volume: 0.35 + 0.65 * k });
    } else if (type === 'hit') {
      if (speed < 0.03) return;
      // 세게 부딪칠수록 크고 조금 낮다
      const k = Math.min(1, speed / 4);
      const name = CLACKS[Math.floor(Math.random() * CLACKS.length)];
      played = this.play(name, 1.12 - k * 0.2, { volume: 0.12 + 0.88 * Math.sqrt(k), pan });
    } else if (type === 'cushion') {
      if (speed < 0.08) return;
      const k = Math.min(1, speed / 3.5);
      played = this.play('cushion', 1.1 - k * 0.25, { volume: 0.15 + 0.85 * k, pan });
    } else if (type === 'pocket') {
      played = this.play('pocket', 0.95 + Math.random() * 0.1, { volume: 0.5 + 0.5 * Math.min(1, speed / 2), pan });
    }
    if (played) this.voices.push(now);
  }
}
