// localStorage 에 마지막으로 고른 설정과 컴퓨터 상대 전적을 남긴다. storage 는 바깥에서 주입한다
// (테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { COLOR_COUNTS } from './game.js';
import { LEVEL_IDS } from './ai.js';
import { browserStorage, JsonStore, isInt } from '../../shared/storage.js';

export { browserStorage };

export const RECORD_KEY = 'casual-games.fruitpop.record.v1';
export const SETTINGS_KEY = 'casual-games.fruitpop.settings.v1';
export const OPPONENTS = ['cpu', 'friend'];
export const DEFAULT_SETTINGS = { opponent: 'cpu', level: 'normal', colors: 4 };

/** 컴퓨터 실력과 과일 종류마다 전적을 따로 둔다 */
export const modeKey = ({ level, colors }) => `${level}-${colors}`;

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    opponent: OPPONENTS.includes(data.opponent) ? data.opponent : DEFAULT_SETTINGS.opponent,
    level: LEVEL_IDS.includes(data.level) ? data.level : DEFAULT_SETTINGS.level,
    colors: COLOR_COUNTS.includes(data.colors) ? data.colors : DEFAULT_SETTINGS.colors,
  };
}

function validateRecord(data) {
  if (!data || typeof data !== 'object') return null;
  const { wins, losses, bestChain } = data;
  if (!isInt(wins, 0, 1e6) || !isInt(losses, 0, 1e6) || !isInt(bestChain, 0, 99)) return null;
  return { wins, losses, bestChain };
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

  /** 모드별 전적 { "normal-4": { wins, losses, bestChain }, … } 중 올바른 것만 */
  loadAllRecords() {
    const data = this.read(RECORD_KEY);
    const clean = {};
    if (!data || typeof data !== 'object') return clean;
    for (const level of LEVEL_IDS) {
      for (const colors of COLOR_COUNTS) {
        const key = modeKey({ level, colors });
        const record = validateRecord(data[key]);
        if (record) clean[key] = record;
      }
    }
    return clean;
  }

  loadRecord(mode) {
    return this.loadAllRecords()[modeKey(mode)] ?? null;
  }

  /** 컴퓨터와 한 판의 결과를 더한다. 비기면 연쇄 기록만 본다. 바뀐 전적을 돌려준다 */
  recordResult(mode, { won, lost, chain }) {
    const all = this.loadAllRecords();
    const key = modeKey(mode);
    const record = all[key] ?? { wins: 0, losses: 0, bestChain: 0 };
    if (won) record.wins++;
    if (lost) record.losses++;
    record.bestChain = Math.max(record.bestChain, Math.min(99, chain));
    all[key] = record;
    this.write(RECORD_KEY, all);
    return record;
  }
}
