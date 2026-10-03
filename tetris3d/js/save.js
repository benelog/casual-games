// localStorage 에 최고 기록과 마지막으로 고른 설정을 남긴다. storage 는 바깥에서 주입한다
// (테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { PIECE_SETS, SET_IDS } from './pieces.js';
import { PIT_SIZES } from './game.js';

export const BEST_KEY = 'casual-games.tetris3d.best.v1';
export const SETTINGS_KEY = 'casual-games.tetris3d.settings.v1';
export const DEFAULT_SETTINGS = { set: 'basic', size: 5 };

/** 브라우저의 localStorage. 접근 자체가 막혀 있으면 null */
export function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 조각 묶음과 우물 크기마다 기록을 따로 둔다 */
export const modeKey = ({ set, size }) => `${set}-${size}`;

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    set: PIECE_SETS[data.set] ? data.set : DEFAULT_SETTINGS.set,
    size: PIT_SIZES.includes(data.size) ? data.size : DEFAULT_SETTINGS.size,
  };
}

function validateRecord(data) {
  if (!data || typeof data !== 'object') return null;
  const { score, layers, level } = data;
  if (!isInt(score, 0, 1e9) || !isInt(layers, 0, 1e6) || !isInt(level, 1, 100)) return null;
  return { score, layers, level };
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

  /** 모드별 최고 기록 { "basic-5": { score, layers, level }, … } 중 올바른 것만 */
  loadAllBest() {
    const data = this.read(BEST_KEY);
    const clean = {};
    if (!data || typeof data !== 'object') return clean;
    for (const set of SET_IDS) {
      for (const size of PIT_SIZES) {
        const key = modeKey({ set, size });
        const record = validateRecord(data[key]);
        if (record) clean[key] = record;
      }
    }
    return clean;
  }

  loadBest(mode) {
    return this.loadAllBest()[modeKey(mode)] ?? null;
  }

  /** 점수가 더 높으면 기록을 바꾸고 true */
  recordBest(mode, { score, layers, level }) {
    const all = this.loadAllBest();
    const key = modeKey(mode);
    if (all[key] && all[key].score >= score) return false;
    all[key] = { score, layers, level };
    this.write(BEST_KEY, all);
    return true;
  }
}
