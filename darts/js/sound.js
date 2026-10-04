// 효과음. 불러오기·재생은 shared/sound.js 에 있고, 여기서는 이 게임의 소리 목록을 정한다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).

import { Sound as BaseSound } from '../../shared/sound.js';

const SOUNDS = {
  throw: { volume: 0.45, gap: 0.05 },
  hit: { volume: 0.7, gap: 0.03 },
  miss: { volume: 0.5, gap: 0.03 },
  great: { volume: 0.55, gap: 0 },
  bust: { volume: 0.6, gap: 0 },
  turn: { volume: 0.35, gap: 0.2 },
  win: { volume: 0.7, gap: 0 },
  lose: { volume: 0.7, gap: 0 },
};

export class Sound extends BaseSound {
  constructor(baseUrl) {
    super(baseUrl, SOUNDS, { storageKey: 'casual-games.darts.sound' });
  }
}
