// localStorage 에 단계별 최고 기록(점수·별·시간·전환·접촉)과 마지막으로 하던 단계, 화면 설정(카메라·가이드)을 남긴다.
// storage 는 바깥에서 주입한다 (테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { browserStorage, JsonStore, isInt, isTime } from '../../shared/storage.js';

export { browserStorage };

export const PROGRESS_KEY = 'casual-games.parking.progress.v1';
export const SETTINGS_KEY = 'casual-games.parking.settings.v1';
export const CAMERAS = ['top', 'chase', 'rear'];
export const DEFAULT_SETTINGS = { camera: 'top', guide: true };

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    camera: CAMERAS.includes(data.camera) ? data.camera : DEFAULT_SETTINGS.camera,
    guide: typeof data.guide === 'boolean' ? data.guide : DEFAULT_SETTINGS.guide,
  };
}

function validateRecord(data) {
  if (!data || typeof data !== 'object') return null;
  const { score, stars, time, switches, contacts } = data;
  if (!isInt(score, 0, 100) || !isInt(stars, 1, 3) || !isTime(time)) return null;
  if (!isInt(switches, 0, 1e4) || !isInt(contacts, 0, 1e4)) return null;
  return { score, stars, time, switches, contacts };
}

/** a 가 b 보다 좋은 기록인지. 점수가 높은 쪽, 같으면 빠른 쪽 */
export function better(a, b) {
  if (!b) return true;
  return a.score > b.score || (a.score === b.score && a.time < b.time);
}

/** 읽은 데이터를 검증해 잘못된 것은 버린다 */
export class SaveStore extends JsonStore {
  /** @param levelIds 지금 있는 단계의 id 목록 (순서대로). 여기 없는 기록은 버린다 */
  constructor(storage, levelIds) {
    super(storage);
    this.levelIds = levelIds;
  }

  /** { best: { [id]: record }, last: id | null } 중 올바른 것만 */
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

  /** 단계를 열 수 있는지: 첫 단계이거나 바로 앞 단계를 깼으면 */
  unlocked(id, best = this.load().best) {
    const i = this.levelIds.indexOf(id);
    return i === 0 || (i > 0 && !!best[this.levelIds[i - 1]]);
  }

  /** 모은 별의 합 */
  totalStars(best = this.load().best) {
    return Object.values(best).reduce((sum, r) => sum + r.stars, 0);
  }

  saveLast(id) {
    if (!this.levelIds.includes(id)) return false;
    const data = this.load();
    data.last = id;
    return this.write(PROGRESS_KEY, data);
  }

  /**
   * 주차 결과를 남긴다. 처음 깼거나 기록이 좋아졌을 때만 바꾼다.
   * @returns {{ first: boolean, improved: boolean, previous: object | null }}
   */
  record(id, result) {
    const outcome = { first: false, improved: false, previous: null };
    const record = validateRecord({
      score: result.score,
      stars: result.stars,
      time: Math.round(result.time * 10) / 10,
      switches: result.switches,
      contacts: result.contacts,
    });
    if (!this.levelIds.includes(id) || !record) return outcome;
    const data = this.load();
    outcome.previous = data.best[id] ?? null;
    outcome.first = !outcome.previous;
    outcome.improved = better(record, outcome.previous);
    if (outcome.improved) {
      data.best[id] = record;
      this.write(PROGRESS_KEY, data);
    }
    return outcome;
  }

  /** 다음에 할 단계: 아직 못 깬 첫 단계. 다 깼으면 마지막으로 하던 단계 */
  nextUnsolved() {
    const data = this.load();
    return this.levelIds.find((id) => !data.best[id]) ?? data.last ?? this.levelIds[0];
  }

  loadSettings() {
    return validateSettings(this.read(SETTINGS_KEY));
  }

  saveSettings(settings) {
    return this.write(SETTINGS_KEY, validateSettings(settings));
  }
}
