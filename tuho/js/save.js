// localStorage 에 마지막으로 고른 설정, 혼자서의 최고 기록, 컴퓨터 상대 전적(실력마다)을 남긴다.
// storage 는 바깥에서 주입한다(테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { browserStorage, JsonStore, isInt } from '../../shared/storage.js';
import { ARROW_OPTIONS, PLAYER_COUNTS, SOLO_ARROWS } from './game.js';
import { LEVEL_IDS } from './ai.js';

export { browserStorage };

export const BEST_KEY = 'casual-games.tuho.best.v1';
export const RECORD_KEY = 'casual-games.tuho.record.v1';
export const SETTINGS_KEY = 'casual-games.tuho.settings.v1';
export const MODES = ['solo', 'cpu', 'multi'];
export const DEFAULT_SETTINGS = { mode: 'solo', level: 'normal', players: 2, arrows: 10 };

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    mode: MODES.includes(data.mode) ? data.mode : DEFAULT_SETTINGS.mode,
    level: LEVEL_IDS.includes(data.level) ? data.level : DEFAULT_SETTINGS.level,
    players: PLAYER_COUNTS.includes(data.players) ? data.players : DEFAULT_SETTINGS.players,
    arrows: ARROW_OPTIONS.includes(data.arrows) ? data.arrows : DEFAULT_SETTINGS.arrows,
  };
}

function validateBest(data) {
  if (!data || typeof data !== 'object') return null;
  const { score, hits, ears } = data;
  if (!isInt(hits, 0, SOLO_ARROWS) || !isInt(ears, 0, hits) || !isInt(score, 0, SOLO_ARROWS * 5)) return null;
  return { score, hits, ears };
}

function validateRecord(data) {
  if (!data || typeof data !== 'object') return null;
  const { wins, losses, draws = 0 } = data;
  if (!isInt(wins, 0, 1e6) || !isInt(losses, 0, 1e6) || !isInt(draws, 0, 1e6)) return null;
  return { wins, losses, draws };
}

/** 읽은 데이터를 검증해 잘못된 것은 버린다 */
export class SaveStore extends JsonStore {
  loadSettings() {
    return validateSettings(this.read(SETTINGS_KEY));
  }

  saveSettings(settings) {
    return this.write(SETTINGS_KEY, validateSettings(settings));
  }

  /** 혼자서 최고 기록 { score, hits, ears } (hits·ears 는 최고 점수를 낸 판의 것). 없으면 null */
  loadBest() {
    return validateBest(this.read(BEST_KEY));
  }

  /** 한 판의 결과를 더한다. 점수가 더 높으면 바꾸고, 새 기록으로 남겼으면 true */
  recordBest(result) {
    const clean = validateBest(result);
    if (!clean) return false;
    const old = this.loadBest();
    if (old && clean.score <= old.score) return false;
    return this.write(BEST_KEY, clean);
  }

  /** 실력별 전적 { normal: { wins, losses, draws }, … } 중 올바른 것만 */
  loadAllRecords() {
    const data = this.read(RECORD_KEY);
    const clean = {};
    if (!data || typeof data !== 'object') return clean;
    for (const level of LEVEL_IDS) {
      const record = validateRecord(data[level]);
      if (record) clean[level] = record;
    }
    return clean;
  }

  loadRecord(level) {
    return this.loadAllRecords()[level] ?? null;
  }

  /** 컴퓨터와 한 판의 결과('win' | 'loss' | 'draw')를 더하고 바뀐 전적을 돌려준다 */
  recordResult(level, outcome) {
    if (!LEVEL_IDS.includes(level)) return null;
    const all = this.loadAllRecords();
    const record = all[level] ?? { wins: 0, losses: 0, draws: 0 };
    if (outcome === 'win') record.wins++;
    else if (outcome === 'loss') record.losses++;
    else record.draws++;
    all[level] = record;
    this.write(RECORD_KEY, all);
    return record;
  }
}
