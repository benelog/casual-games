// localStorage 에 장수별 최고 기록(혼자 할 때)과 마지막으로 고른 설정을 남긴다.
// storage 는 바깥에서 주입한다(테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도
// 게임은 저장 없이 계속된다.

import { SIZES } from './game.js';
import { browserStorage, JsonStore, isInt, isTime, mergeLowest } from '../../shared/storage.js';

export { browserStorage };

export const BEST_KEY = 'casual-games.memory.best.v1';
export const SETTINGS_KEY = 'casual-games.memory.settings.v1';
export const PLAYER_COUNTS = [1, 2];
export const DEFAULT_SETTINGS = { players: 1, size: 20, sound: true };

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    players: PLAYER_COUNTS.includes(data.players) ? data.players : DEFAULT_SETTINGS.players,
    size: SIZES.includes(data.size) ? data.size : DEFAULT_SETTINGS.size,
    sound: typeof data.sound === 'boolean' ? data.sound : DEFAULT_SETTINGS.sound,
  };
}

function validateResult(data) {
  if (!data || typeof data !== 'object') return null;
  const { time, turns } = data;
  if (!isTime(time) || !isInt(turns, 1, 1e7)) return null;
  return { time, turns };
}

/** 읽은 데이터를 검증해 잘못된 것은 버린다 */
export class SaveStore extends JsonStore {
  constructor(storage) {
    super(storage);
  }

  loadSettings() {
    return validateSettings(this.read(SETTINGS_KEY));
  }

  saveSettings(settings) {
    return this.write(SETTINGS_KEY, validateSettings(settings));
  }

  /** { "12": { time, turns }, … } 중 올바른 것만. 시간과 턴 수는 따로 겨룬다(서로 다른 판일 수 있다) */
  loadAllBest() {
    const data = this.read(BEST_KEY);
    const clean = {};
    if (!data || typeof data !== 'object') return clean;
    for (const size of SIZES) {
      const record = validateResult(data[size]);
      if (record) clean[size] = record;
    }
    return clean;
  }

  loadBest(size) {
    return this.loadAllBest()[size] ?? null;
  }

  /** 더 빠르거나 더 적은 턴에 끝냈으면 그 항목을 바꾼다. 무엇이 새 기록인지 { time, turns } 로 알려 준다 */
  recordBest(size, { time, turns }) {
    if (!SIZES.includes(size) || !validateResult({ time, turns })) return { time: false, turns: false };
    const all = this.loadAllBest();
    const { record, improved } = mergeLowest(all[size], { time, turns });
    if (improved.time || improved.turns) {
      all[size] = record;
      this.write(BEST_KEY, all);
    }
    return improved;
  }
}
