// localStorage 에 단계별 최고 기록(가장 적은 수, 힌트를 썼는지), 마지막으로 하던 단계, 오늘의 퍼즐 결과와
// 연속 일수, 소리 설정을 남긴다. storage 는 바깥에서 주입한다 (테스트에서는 가짜 storage).
// 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { browserStorage, JsonStore, isInt } from '../../shared/storage.js';

export { browserStorage };

export const PROGRESS_KEY = 'casual-games.unblock.progress.v1';
export const DAILY_KEY = 'casual-games.unblock.daily.v1';
export const SETTINGS_KEY = 'casual-games.unblock.settings.v1';
export const DEFAULT_SETTINGS = { sound: true };
export const UNLOCK_AHEAD = 3; // 깬 단계 수보다 이만큼 더 열어 둔다. 막힌 단계를 건너뛸 수 있다

const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isBoard = (v) => typeof v === 'string' && /^[A-Z.]{36}$/.test(v);

/** 'YYYY-MM-DD' 의 하루 전 날짜 */
export function previousDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

function validateRecord(data) {
  if (!data || typeof data !== 'object') return null;
  const { moves, hinted } = data;
  if (!isInt(moves, 1, 1e6) || typeof hinted !== 'boolean') return null;
  return { moves, hinted };
}

/** a 가 b 보다 좋은 기록인지. 수가 적은 쪽, 같으면 힌트 없이 푼 쪽 */
export function better(a, b) {
  if (!b) return true;
  return a.moves < b.moves || (a.moves === b.moves && b.hinted && !a.hinted);
}

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return { sound: typeof data.sound === 'boolean' ? data.sound : DEFAULT_SETTINGS.sound };
}

/** 읽은 데이터를 검증해 잘못된 것은 버린다 */
export class SaveStore extends JsonStore {
  /** @param levelIds 지금 있는 단계의 id 목록 (쉬운 순). 여기 없는 기록은 버린다 */
  constructor(storage, levelIds) {
    super(storage);
    this.levelIds = levelIds;
  }

  loadSettings() {
    return validateSettings(this.read(SETTINGS_KEY));
  }

  saveSettings(settings) {
    return this.write(SETTINGS_KEY, validateSettings(settings));
  }

  // ---------- 단계 ----------

  /** { best: { [id]: { moves, hinted } }, last: id | null } 중 올바른 것만 */
  load() {
    const data = this.read(PROGRESS_KEY);
    const clean = { best: {}, last: null };
    if (!data || typeof data !== 'object') return clean;
    for (const id of this.levelIds) {
      const record = validateRecord(data.best?.[id]);
      if (record) clean.best[id] = record;
    }
    if (this.levelIds.includes(data.last)) clean.last = data.last;
    return clean;
  }

  loadBest(id) {
    return this.load().best[id] ?? null;
  }

  /** 깬 단계 수 */
  solvedCount() {
    return Object.keys(this.load().best).length;
  }

  /** 목록에서 index 번째 단계를 할 수 있는지. 깬 단계는 언제나, 그 밖에는 앞에서부터 (깬 수 + UNLOCK_AHEAD) 개 */
  isUnlocked(index, data = this.load()) {
    const id = this.levelIds[index];
    if (id === undefined) return false;
    return !!data.best[id] || index < Object.keys(data.best).length + UNLOCK_AHEAD;
  }

  /** 마지막으로 연 단계를 기억한다 */
  saveLast(id) {
    if (!this.levelIds.includes(id)) return false;
    const data = this.load();
    data.last = id;
    return this.write(PROGRESS_KEY, data);
  }

  /**
   * 단계를 깬 기록을 남긴다. 처음 깼거나 기록이 좋아졌을 때만 바꾼다.
   * @returns {{ first: boolean, improved: boolean, previous: object | null }}
   */
  record(id, { moves, hinted }) {
    const result = { first: false, improved: false, previous: null };
    const record = validateRecord({ moves, hinted });
    if (!this.levelIds.includes(id) || !record) return result;
    const data = this.load();
    result.previous = data.best[id] ?? null;
    result.first = !result.previous;
    result.improved = better(record, result.previous);
    if (result.improved) {
      data.best[id] = record;
      this.write(PROGRESS_KEY, data);
    }
    return result;
  }

  /** 다음에 할 단계: 열려 있고 아직 못 깬 첫 단계. 다 깼으면 마지막으로 하던 단계(없으면 첫 단계) */
  nextUnsolved() {
    const data = this.load();
    return this.levelIds.find((id) => !data.best[id]) ?? data.last ?? this.levelIds[0];
  }

  // ---------- 오늘의 퍼즐 ----------

  /** { day, board, min, result: { moves, hinted } | null, streak, lastDay } */
  loadDailyState() {
    const data = this.read(DAILY_KEY);
    const state = { day: null, board: null, min: 0, result: null, streak: 0, lastDay: null };
    if (!data || typeof data !== 'object') return state;
    if (isDay(data.lastDay) && isInt(data.streak, 1, 1e5)) {
      state.lastDay = data.lastDay;
      state.streak = data.streak;
    }
    if (isDay(data.day) && isBoard(data.board) && isInt(data.min, 1, 99)) {
      state.day = data.day;
      state.board = data.board;
      state.min = data.min;
      state.result = validateRecord(data.result);
    }
    return state;
  }

  /** 그날 만들어 둔 퍼즐 { board, moves }. 오늘의 퍼즐은 만드는 데 시간이 걸려 한 번 만들면 남겨 둔다 */
  loadDailyPuzzle(day) {
    const state = this.loadDailyState();
    return state.day === day ? { board: state.board, moves: state.min } : null;
  }

  saveDailyPuzzle(day, { board, moves }) {
    const state = this.loadDailyState();
    if (!isDay(day) || !isBoard(board) || !isInt(moves, 1, 99)) return false;
    if (state.day === day && state.board === board) return true;
    Object.assign(state, { day, board, min: moves, result: null });
    return this.write(DAILY_KEY, state);
  }

  /** 그날 오늘의 퍼즐을 푼 기록. 없으면 null */
  loadDaily(day) {
    const state = this.loadDailyState();
    return state.day === day ? state.result : null;
  }

  /** day 까지 이어진 연속 일수. 어제도 오늘도 풀지 않았으면 0 */
  loadStreak(day) {
    const { streak, lastDay } = this.loadDailyState();
    return lastDay === day || lastDay === previousDay(day) ? streak : 0;
  }

  /**
   * 오늘의 퍼즐을 푼 결과를 남긴다(그 퍼즐을 saveDailyPuzzle 로 남겨 둔 날만). 같은 날 다시 풀면 더 좋은 쪽만 남긴다.
   * 그날 처음 푼 것이면 연속 일수가 오른다.
   * @returns {{ first: boolean, improved: boolean, previous: object | null, streak: number }}
   */
  recordDaily(day, { moves, hinted }) {
    const state = this.loadDailyState();
    const record = validateRecord({ moves, hinted });
    const result = { first: false, improved: false, previous: null, streak: this.loadStreak(day) };
    if (!isDay(day) || state.day !== day || !record) return result;
    result.previous = state.result;
    result.first = !state.result;
    result.improved = better(record, state.result);
    if (result.improved) state.result = record;
    if (state.lastDay !== day) {
      state.streak = state.lastDay === previousDay(day) ? state.streak + 1 : 1;
      state.lastDay = day;
    }
    result.streak = state.streak;
    this.write(DAILY_KEY, state);
    return result;
  }
}
