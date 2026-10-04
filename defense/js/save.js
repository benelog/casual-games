// localStorage 저장. 직렬화·검증은 순수 함수이고 storage 는 바깥에서 주입한다
// (테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.
//
// 저장은 건설 단계에서만 한다. 웨이브 시작 직전에 저장해 두면 전투 중 새로고침 때
// 그 시점(골드·목숨·타워)으로 돌아간다. 전투 중의 건설·판매는 저장본에 반영하지 않아
// 새로고침으로 골드를 불리거나 타워를 되살리는 악용을 막는다.

import { MAP, tileAt } from './map.js';
import { TOWERS, MAX_LEVEL } from './towers.js';
import { WAVES } from './waves.js';
import { browserStorage, JsonStore, isInt } from '../../shared/storage.js';

export { browserStorage };

export const SAVE_KEY = 'casual-games.defense.save.v1';
export const BEST_KEY = 'casual-games.defense.best.v1';
export const SAVE_VERSION = 1;

/** game.snapshot() 에 저장 정보를 덧붙인 저장본 */
export function serialize(game, { speed = 1, now = Date.now() } = {}) {
  return { version: SAVE_VERSION, ...game.snapshot(), speed, savedAt: now };
}

/** 저장본이 이 맵·규칙에 맞으면 정리한 사본을, 아니면 null 을 돌려준다 */
export function validateSave(data, { map = MAP, waves = WAVES } = {}) {
  if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION) return null;
  const { wave, gold, lives, towers, speed, savedAt } = data;
  // 마지막 웨이브를 클리어하면 저장본을 지우므로 wave 는 waves.length 보다 작다
  if (!isInt(wave, 0, waves.length - 1) || !isInt(gold, 0, 1e9) || !isInt(lives, 1, 1e6)) return null;
  if (!Array.isArray(towers)) return null;
  const used = new Set();
  const clean = [];
  for (const t of towers) {
    if (!t || !TOWERS[t.type] || !isInt(t.level, 1, MAX_LEVEL)) return null;
    if (!isInt(t.col, 0, map.cols - 1) || !isInt(t.row, 0, map.rows - 1)) return null;
    if (tileAt(map, t.col, t.row) !== 'build') return null;
    const key = `${t.col},${t.row}`;
    if (used.has(key)) return null;
    used.add(key);
    if (!isInt(t.invested, 0, 1e9)) return null;
    clean.push({ type: t.type, level: t.level, col: t.col, row: t.row, invested: t.invested });
  }
  return {
    version: SAVE_VERSION,
    wave,
    gold,
    lives,
    towers: clean,
    speed: speed === 2 ? 2 : 1,
    savedAt: Number.isFinite(savedAt) ? savedAt : 0,
  };
}

/** 최고 기록이 더 좋은지. 도달 웨이브가 높을수록, 승리라면 남은 목숨이 많을수록 좋다 */
export function isBetterRecord(record, best) {
  if (!best) return true;
  if (record.wave !== best.wave) return record.wave > best.wave;
  if (record.won !== best.won) return record.won;
  return record.won && record.lives > best.lives;
}

function validateBest(data) {
  if (!data || typeof data !== 'object' || !isInt(data.wave, 0, 1e4)) return null;
  const won = data.won === true;
  return { wave: data.wave, won, lives: won && isInt(data.lives, 0, 1e6) ? data.lives : 0 };
}

/** 읽은 데이터를 검증해 잘못된 것은 버린다 */
export class SaveStore extends JsonStore {
  constructor(storage, options = {}) {
    super(storage);
    this.options = options; // validateSave 에 넘길 { map, waves }
  }

  /** 유효한 저장본. 없거나 잘못됐으면 지우고 null */
  load() {
    const data = validateSave(this.read(SAVE_KEY), this.options);
    if (!data) this.remove(SAVE_KEY);
    return data;
  }

  /**
   * 건설 단계일 때만 저장한다. 전투 중에는 웨이브 시작 직전 저장본을 그대로 둔다.
   * 끝난 게임은 저장본을 지운다. 저장했으면 true
   */
  sync(game, { speed = 1, now = Date.now() } = {}) {
    if (game.over) {
      this.clear();
      return false;
    }
    if (game.phase !== 'build') return false;
    return this.write(SAVE_KEY, serialize(game, { speed, now }));
  }

  clear() {
    this.remove(SAVE_KEY);
  }

  loadBest() {
    return validateBest(this.read(BEST_KEY));
  }

  /** 기록이 더 좋으면 바꾸고 true */
  recordBest(record) {
    const best = this.loadBest();
    if (!isBetterRecord(record, best)) return false;
    this.write(BEST_KEY, { wave: record.wave, won: record.won, lives: record.won ? record.lives : 0 });
    return true;
  }
}
