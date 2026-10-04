// localStorage 에 난이도별 최고 기록, 오늘의 퍼즐 결과, 마지막으로 고른 설정을 남긴다.
// storage 는 바깥에서 주입한다(테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도
// 게임은 저장 없이 계속된다.

import { SIZES } from './game.js';
import { browserStorage, JsonStore, isInt, isTime, mergeLowest } from '../../shared/storage.js';

export { browserStorage };

export const BEST_KEY = 'casual-games.pipes.best.v1';
export const DAILY_KEY = 'casual-games.pipes.daily.v1';
export const SETTINGS_KEY = 'casual-games.pipes.settings.v1';
export const MODES = ['free', 'daily'];
export const DEFAULT_SETTINGS = { mode: 'free', size: 5, sound: true };

const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 'YYYY-MM-DD' 의 하루 전 날짜 */
export function previousDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    mode: MODES.includes(data.mode) ? data.mode : DEFAULT_SETTINGS.mode,
    size: SIZES.includes(data.size) ? data.size : DEFAULT_SETTINGS.size,
    sound: typeof data.sound === 'boolean' ? data.sound : DEFAULT_SETTINGS.sound,
  };
}

function validateResult(data) {
  if (!data || typeof data !== 'object') return null;
  const { time, moves } = data;
  if (!isTime(time) || !isInt(moves, 1, 1e7)) return null;
  return { time, moves };
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

  // ---------- 난이도별 최고 기록 ----------

  /** { "5": { time, moves }, … } 중 올바른 것만. 시간과 회전 수는 따로 겨룬다(서로 다른 판일 수 있다) */
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

  /** 더 빠르거나 더 적게 돌렸으면 그 항목을 바꾼다. 무엇이 새 기록인지 { time, moves } 로 알려 준다 */
  recordBest(size, { time, moves }) {
    if (!SIZES.includes(size) || !validateResult({ time, moves })) return { time: false, moves: false };
    const all = this.loadAllBest();
    const { record, improved } = mergeLowest(all[size], { time, moves });
    if (improved.time || improved.moves) {
      all[size] = record;
      this.write(BEST_KEY, all);
    }
    return improved;
  }

  // ---------- 오늘의 퍼즐 ----------

  /** { day, results: { "5": { time, moves } }, streak, lastDay } */
  loadDailyState() {
    const data = this.read(DAILY_KEY);
    const state = { day: null, results: {}, streak: 0, lastDay: null };
    if (!data || typeof data !== 'object') return state;
    if (isDay(data.lastDay) && isInt(data.streak, 1, 1e5)) {
      state.lastDay = data.lastDay;
      state.streak = data.streak;
    }
    if (isDay(data.day) && data.results && typeof data.results === 'object') {
      state.day = data.day;
      for (const size of SIZES) {
        const result = validateResult(data.results[size]);
        if (result) state.results[size] = result;
      }
    }
    return state;
  }

  /** 그날 그 난이도의 오늘의 퍼즐을 푼 기록. 없으면 null */
  loadDaily(day, size) {
    const state = this.loadDailyState();
    return state.day === day ? (state.results[size] ?? null) : null;
  }

  /** day 까지 이어진 연속 일수. 어제도 오늘도 풀지 않았으면 0 */
  loadStreak(day) {
    const { streak, lastDay } = this.loadDailyState();
    return lastDay === day || lastDay === previousDay(day) ? streak : 0;
  }

  /**
   * 오늘의 퍼즐을 푼 결과를 남긴다. 같은 날 다시 풀면 더 빠른 쪽만 남긴다.
   * 그날 처음 푼 것이면 연속 일수가 오른다. 돌려주는 값은 { first, streak }.
   */
  recordDaily(day, size, { time, moves }) {
    const state = this.loadDailyState();
    if (!isDay(day) || !SIZES.includes(size) || !validateResult({ time, moves })) {
      return { first: false, streak: this.loadStreak(day) };
    }
    if (state.day !== day) {
      state.day = day;
      state.results = {};
    }
    const first = state.lastDay !== day;
    if (first) {
      state.streak = state.lastDay === previousDay(day) ? state.streak + 1 : 1;
      state.lastDay = day;
    }
    const old = state.results[size];
    if (!old || time < old.time) state.results[size] = { time, moves };
    this.write(DAILY_KEY, state);
    return { first, streak: state.streak };
  }
}
