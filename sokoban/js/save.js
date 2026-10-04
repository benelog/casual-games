// localStorage 에 깬 레벨과 레벨별 최고 기록(가장 적은 이동 수), 마지막으로 하던 레벨을 남긴다.
// storage 는 바깥에서 주입한다 (테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

export const PROGRESS_KEY = 'casual-games.sokoban.progress.v1';

/** 브라우저의 localStorage. 접근 자체가 막혀 있으면 null */
export function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function validateRecord(data) {
  if (!data || typeof data !== 'object') return null;
  const { moves, pushes } = data;
  if (!isInt(moves, 1, 1e6) || !isInt(pushes, 1, moves)) return null;
  return { moves, pushes };
}

/** a 가 b 보다 좋은 기록인지. 이동 수가 적은 쪽, 같으면 밀기 수가 적은 쪽 */
export function better(a, b) {
  if (!b) return true;
  return a.moves < b.moves || (a.moves === b.moves && a.pushes < b.pushes);
}

/** storage(getItem/setItem) 를 감싸 예외와 잘못된 데이터를 모두 삼킨다 */
export class SaveStore {
  /** @param levelIds 지금 있는 레벨의 id 목록. 여기 없는 기록은 버린다 */
  constructor(storage, levelIds) {
    this.storage = storage;
    this.levelIds = levelIds;
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

  /** { best: { [id]: { moves, pushes } }, last: id | null } 중 올바른 것만 */
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

  /** 깬 레벨 수 */
  solvedCount() {
    return Object.keys(this.load().best).length;
  }

  /** 마지막으로 연 레벨을 기억한다 */
  saveLast(id) {
    if (!this.levelIds.includes(id)) return false;
    const data = this.load();
    data.last = id;
    return this.write(PROGRESS_KEY, data);
  }

  /**
   * 레벨을 깬 기록을 남긴다. 처음 깼거나 기록이 좋아졌을 때만 바꾼다.
   * @returns {{ first: boolean, improved: boolean, previous: object | null }}
   */
  record(id, { moves, pushes }) {
    const result = { first: false, improved: false, previous: null };
    const record = validateRecord({ moves, pushes });
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

  /** 다음에 할 레벨: 아직 못 깬 첫 레벨. 다 깼으면 마지막으로 하던 레벨(없으면 첫 레벨) */
  nextUnsolved() {
    const data = this.load();
    return this.levelIds.find((id) => !data.best[id]) ?? data.last ?? this.levelIds[0];
  }
}
