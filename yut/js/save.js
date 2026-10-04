// localStorage 에 마지막으로 고른 설정과 컴퓨터 상대 전적(실력별)을 남긴다. storage 는 바깥에서 주입한다
// (테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { MIN_PLAYERS, MAX_PLAYERS } from './game.js';
import { LEVEL_IDS } from './ai.js';
import { browserStorage, JsonStore, isInt } from '../../shared/storage.js';

export { browserStorage };

export const RECORD_KEY = 'casual-games.yut.record.v1';
export const SETTINGS_KEY = 'casual-games.yut.settings.v1';
export const SEATS = ['human', 'cpu'];
export const PLAYER_COUNTS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);
export const DEFAULT_SETTINGS = {
  players: 2,
  seats: ['human', 'cpu', 'cpu', 'cpu'],
  level: 'normal',
  backdo: true,
  sound: true,
};

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return structuredClone(DEFAULT_SETTINGS);
  const seats = DEFAULT_SETTINGS.seats.map((seat, i) => (SEATS.includes(data.seats?.[i]) ? data.seats[i] : seat));
  return {
    players: PLAYER_COUNTS.includes(data.players) ? data.players : DEFAULT_SETTINGS.players,
    seats,
    level: LEVEL_IDS.includes(data.level) ? data.level : DEFAULT_SETTINGS.level,
    backdo: typeof data.backdo === 'boolean' ? data.backdo : DEFAULT_SETTINGS.backdo,
    sound: typeof data.sound === 'boolean' ? data.sound : DEFAULT_SETTINGS.sound,
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
  constructor(storage) {
    super(storage);
  }

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

  /** 컴퓨터가 낀 판의 결과를 더한다. 사람 편이 이기면 승, 컴퓨터 편이 이기면 패. 바뀐 전적을 돌려준다 */
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
