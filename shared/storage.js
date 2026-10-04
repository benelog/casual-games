// localStorage 저장의 공통 부분. storage 는 바깥에서 주입한다(테스트에서는 가짜 storage).
// 저장소 접근이 예외를 던지거나 데이터가 깨져 있어도 게임은 저장 없이 계속된다.

/** 브라우저의 localStorage. 접근 자체가 막혀 있으면 null */
export function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
export const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e7;

/** storage(getItem/setItem/removeItem) 를 감싸 JSON 으로 읽고 쓴다. 예외는 모두 삼킨다 */
export class JsonStore {
  constructor(storage) {
    this.storage = storage;
  }

  /** 없거나 읽지 못하면 null */
  read(key) {
    try {
      const text = this.storage?.getItem(key);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  /** 저장했으면 true */
  write(key, value) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  remove(key) {
    try {
      this.storage?.removeItem(key);
    } catch {
      // 지우지 못해도 다음 저장이 덮어쓴다
    }
  }
}

/**
 * 항목마다 따로 겨루는 최고 기록(작을수록 좋다). 서로 다른 판에서 나온 값이 섞일 수 있다.
 * 합친 기록 record 와 항목별로 새 기록인지 improved 를 돌려준다.
 */
export function mergeLowest(best, result) {
  const record = {};
  const improved = {};
  for (const [key, value] of Object.entries(result)) {
    improved[key] = !best || value < best[key];
    record[key] = improved[key] ? value : best[key];
  }
  return { record, improved };
}
