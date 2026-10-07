// localStorage 에 마지막으로 고른 설정과 혼자서 친 최고 기록(9홀 합계, 홀마다 가장 적은 타수)을 남긴다.
// storage 는 바깥에서 주입한다(테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { PLAYER_OPTIONS, MAX_CAP } from './game.js';
import { HOLE_COUNT } from './course.js';
import { browserStorage, JsonStore, isInt } from '../../shared/storage.js';

export { browserStorage };

export const RECORD_KEY = 'casual-games.minigolf.record.v1';
export const SETTINGS_KEY = 'casual-games.minigolf.settings.v1';
export const CAMERAS = ['overview', 'follow'];
export const DEFAULT_SETTINGS = { players: 1, camera: 'overview' };

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    players: PLAYER_OPTIONS.includes(data.players) ? data.players : DEFAULT_SETTINGS.players,
    camera: CAMERAS.includes(data.camera) ? data.camera : DEFAULT_SETTINGS.camera,
  };
}

const emptyRecord = () => ({ total: null, holes: Array(HOLE_COUNT).fill(null) });

/** 기록 { total, holes } 중 올바른 값만 남긴다 */
export function validateRecord(data) {
  const clean = emptyRecord();
  if (!data || typeof data !== 'object') return clean;
  if (isInt(data.total, HOLE_COUNT, HOLE_COUNT * MAX_CAP)) clean.total = data.total;
  if (Array.isArray(data.holes)) {
    for (let i = 0; i < HOLE_COUNT; i++) if (isInt(data.holes[i], 1, MAX_CAP)) clean.holes[i] = data.holes[i];
  }
  return clean;
}

/** 읽은 데이터를 검증해 잘못된 것은 버린다 */
export class SaveStore extends JsonStore {
  loadSettings() {
    return validateSettings(this.read(SETTINGS_KEY));
  }

  saveSettings(settings) {
    return this.write(SETTINGS_KEY, validateSettings(settings));
  }

  loadRecord() {
    return validateRecord(this.read(RECORD_KEY));
  }

  /** 혼자서 한 홀을 마쳤다. 그 홀의 최고 기록이면 남기고 true */
  recordHole(index, strokes) {
    if (!isInt(index, 0, HOLE_COUNT - 1) || !isInt(strokes, 1, MAX_CAP)) return false;
    const record = this.loadRecord();
    const best = record.holes[index];
    if (best !== null && best <= strokes) return false;
    record.holes[index] = strokes;
    this.write(RECORD_KEY, record);
    return true;
  }

  /** 혼자서 9홀을 마쳤다. 합계 최고 기록이면 남기고 true */
  recordRound(total) {
    if (!isInt(total, HOLE_COUNT, HOLE_COUNT * MAX_CAP)) return false;
    const record = this.loadRecord();
    if (record.total !== null && record.total <= total) return false;
    record.total = total;
    this.write(RECORD_KEY, record);
    return true;
  }
}
