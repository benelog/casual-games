// localStorage 에 마지막으로 고른 설정과 컴퓨터 상대 전적(실력마다)을 남긴다. storage 는 바깥에서 주입한다
// (테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { STONE_OPTIONS } from './game.js';
import { LEVEL_IDS } from './ai.js';
import { browserStorage, JsonStore, isInt } from '../../shared/storage.js';

export { browserStorage };

export const RECORD_KEY = 'casual-games.alkkagi.record.v1';
export const SETTINGS_KEY = 'casual-games.alkkagi.settings.v1';
export const OPPONENTS = ['computer', 'versus'];
export const DEFAULT_SETTINGS = { opponent: 'computer', level: 'normal', stones: 5 };

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    opponent: OPPONENTS.includes(data.opponent) ? data.opponent : DEFAULT_SETTINGS.opponent,
    level: LEVEL_IDS.includes(data.level) ? data.level : DEFAULT_SETTINGS.level,
    stones: STONE_OPTIONS.includes(data.stones) ? data.stones : DEFAULT_SETTINGS.stones,
  };
}

function validateRecord(data) {
  if (!data || typeof data !== 'object') return null;
  const { wins, losses } = data;
  if (!isInt(wins, 0, 1e6) || !isInt(losses, 0, 1e6)) return null;
  return { wins, losses };
}

/** 읽은 데이터를 검증해 잘못된 것은 버린다 */
export class SaveStore extends JsonStore {
  loadSettings() {
    return validateSettings(this.read(SETTINGS_KEY));
  }

  saveSettings(settings) {
    return this.write(SETTINGS_KEY, validateSettings(settings));
  }

  /** 실력별 전적 { normal: { wins, losses }, … } 중 올바른 것만 */
  loadAllRecords() {
    const data = this.read(RECORD_KEY);
    const clean = {};
    if (!data || typeof data !== 'object') return clean;
    for (const level of LEVEL_IDS) {
      const record = validateRecord(data[level]);
      if (record) clean[level] = record;
    }
    return clean;
  }

  loadRecord(level) {
    return this.loadAllRecords()[level] ?? null;
  }

  /** 컴퓨터와 한 판의 결과를 더하고 바뀐 전적을 돌려준다 */
  recordResult(level, won) {
    if (!LEVEL_IDS.includes(level)) return null;
    const all = this.loadAllRecords();
    const record = all[level] ?? { wins: 0, losses: 0 };
    if (won) record.wins++;
    else record.losses++;
    all[level] = record;
    this.write(RECORD_KEY, all);
    return record;
  }
}
