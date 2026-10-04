// localStorage 에 장수별 최고 기록(혼자 할 때)과 마지막으로 고른 설정을 남긴다.
// storage 는 바깥에서 주입한다(테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도
// 게임은 저장 없이 계속된다.

import { SIZES } from './game.js';

export const BEST_KEY = 'casual-games.memory.best.v1';
export const SETTINGS_KEY = 'casual-games.memory.settings.v1';
export const PLAYER_COUNTS = [1, 2];
export const DEFAULT_SETTINGS = { players: 1, size: 20, sound: true };

/** 브라우저의 localStorage. 접근 자체가 막혀 있으면 null */
export function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e7;

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

/** storage(getItem/setItem) 를 감싸 예외와 잘못된 데이터를 모두 삼킨다 */
export class SaveStore {
  constructor(storage) {
    this.storage = storage;
  }

  read(key) {
    try {
      const text = this.storage?.getItem(key);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  write(key, value) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
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
    const improved = { time: false, turns: false };
    if (!SIZES.includes(size) || !validateResult({ time, turns })) return improved;
    const all = this.loadAllBest();
    const best = all[size];
    improved.time = !best || time < best.time;
    improved.turns = !best || turns < best.turns;
    if (improved.time || improved.turns) {
      all[size] = {
        time: improved.time ? time : best.time,
        turns: improved.turns ? turns : best.turns,
      };
      this.write(BEST_KEY, all);
    }
    return improved;
  }
}
