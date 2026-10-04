// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  arrow: { volume: 0.25, gap: 0.06 },
  cannon: { volume: 0.4, gap: 0.08 },
  frost: { volume: 0.35, gap: 0.08 },
  kill: { volume: 0.3, gap: 0.05 },
  leak: { volume: 0.6, gap: 0.1 },
  build: { volume: 0.6, gap: 0 },
  upgrade: { volume: 0.6, gap: 0 },
  sell: { volume: 0.6, gap: 0 },
  'wave-start': { volume: 0.5, gap: 0 },
  'wave-clear': { volume: 0.6, gap: 0 },
  win: { volume: 0.7, gap: 0 },
  lose: { volume: 0.7, gap: 0 },
};

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS, { jitter: 0.12 });
  }
}
