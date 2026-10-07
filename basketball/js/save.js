// localStorage 에 혼자 할 때의 모드별 최고 기록과 마지막으로 고른 설정을 남긴다.
// storage 는 바깥에서 주입한다(테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { browserStorage, JsonStore, isInt } from '../../shared/storage.js';
import { MODES } from './game.js';

export { browserStorage };

export const BEST_KEY = 'casual-games.basketball.best.v1';
export const SETTINGS_KEY = 'casual-games.basketball.settings.v1';
export const SOLO_MODES = MODES.filter((mode) => mode !== 'versus');
export const DEFAULT_SETTINGS = { mode: 'time' };

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    mode: MODES.includes(data.mode) ? data.mode : DEFAULT_SETTINGS.mode,
  };
}

function validateBest(data) {
  if (!data || typeof data !== 'object') return null;
  const { score, makes, shots, streak } = data;
  if (!isInt(score, 0, 1e6) || !isInt(makes, 0, 1e5) || !isInt(shots, makes, 1e5) || !isInt(streak, 0, 1e5)) return null;
  return { score, makes, shots, streak };
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

  /** { time: { score, makes, shots, streak }, shots: … } 중 올바른 것만. makes·shots 는 최고 점수를 낸 판의 것 */
  loadAllBest() {
    const data = this.read(BEST_KEY);
    const clean = {};
    if (!data || typeof data !== 'object') return clean;
    for (const mode of SOLO_MODES) {
      const best = validateBest(data[mode]);
      if (best) clean[mode] = best;
    }
    return clean;
  }

  loadBest(mode) {
    return this.loadAllBest()[mode] ?? null;
  }

  /**
   * 한 판의 결과를 더한다. 점수가 더 높으면 그 판의 기록으로 바꾸고, 최고 연속 성공은 따로 겨룬다.
   * 무엇이 새 기록인지 { score, streak } 로 알려 준다.
   */
  recordBest(mode, result) {
    const clean = validateBest(result);
    if (!SOLO_MODES.includes(mode) || !clean) return { score: false, streak: false };
    const all = this.loadAllBest();
    const old = all[mode];
    const improved = {
      score: !old || clean.score > old.score,
      streak: !old || clean.streak > old.streak,
    };
    if (!improved.score && !improved.streak) return improved;
    const next = improved.score ? { ...clean } : { ...old };
    next.streak = Math.max(clean.streak, old?.streak ?? 0); // 연속 성공은 다른 판의 기록일 수 있다
    all[mode] = next;
    this.write(BEST_KEY, all);
    return improved;
  }
}
