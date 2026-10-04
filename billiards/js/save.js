// localStorage 에 마지막으로 고른 설정과 컴퓨터 상대 전적(종목·실력마다)을 남긴다.
// storage 는 바깥에서 주입한다(테스트에서는 가짜 storage). 저장소 접근이 예외를 던져도 게임은 저장 없이 계속된다.

import { VARIANTS, VARIANT_IDS, LEVEL_IDS } from './variants.js';
import { browserStorage, JsonStore, isInt } from '../../shared/storage.js';

export { browserStorage };

export const SETTINGS_KEY = 'casual-games.billiards.settings.v1';
export const RECORD_KEY = 'casual-games.billiards.record.v1';
export const OPPONENTS = ['cpu', 'friend'];
export const GUIDES = ['long', 'short'];
export const CAMERAS = ['top', 'cue'];

export const DEFAULT_SETTINGS = {
  variant: 'fourball',
  opponent: 'cpu',
  level: 'normal',
  targets: Object.fromEntries(VARIANT_IDS.map((id) => [id, VARIANTS[id].defaultTarget])),
  guide: 'long',
  camera: 'top',
  sound: true,
};

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export function validateSettings(data) {
  if (!data || typeof data !== 'object') return structuredClone(DEFAULT_SETTINGS);
  const targets = {};
  for (const id of VARIANT_IDS) {
    targets[id] = pick(data.targets?.[id], VARIANTS[id].targets, VARIANTS[id].defaultTarget);
  }
  return {
    variant: pick(data.variant, VARIANT_IDS, DEFAULT_SETTINGS.variant),
    opponent: pick(data.opponent, OPPONENTS, DEFAULT_SETTINGS.opponent),
    level: pick(data.level, LEVEL_IDS, DEFAULT_SETTINGS.level),
    targets,
    guide: pick(data.guide, GUIDES, DEFAULT_SETTINGS.guide),
    camera: pick(data.camera, CAMERAS, DEFAULT_SETTINGS.camera),
    sound: typeof data.sound === 'boolean' ? data.sound : DEFAULT_SETTINGS.sound,
  };
}

/** 전적은 종목과 실력마다 따로: "fourball-normal" */
export const recordKey = (variant, level) => `${variant}-${level}`;

function validateRecord(data) {
  if (!data || typeof data !== 'object') return null;
  const { wins, losses, bestRun } = data;
  if (!isInt(wins, 0, 1e6) || !isInt(losses, 0, 1e6) || !isInt(bestRun, 0, 1e4)) return null;
  return { wins, losses, bestRun };
}

/** 읽은 데이터를 검증해 잘못된 것은 버린다 */
export class SaveStore extends JsonStore {
  loadSettings() {
    return validateSettings(this.read(SETTINGS_KEY));
  }

  saveSettings(settings) {
    return this.write(SETTINGS_KEY, validateSettings(settings));
  }

  loadAllRecords() {
    const data = this.read(RECORD_KEY);
    const clean = {};
    if (!data || typeof data !== 'object') return clean;
    for (const variant of VARIANT_IDS) {
      for (const level of LEVEL_IDS) {
        const key = recordKey(variant, level);
        const record = validateRecord(data[key]);
        if (record) clean[key] = record;
      }
    }
    return clean;
  }

  loadRecord(variant, level) {
    return this.loadAllRecords()[recordKey(variant, level)] ?? null;
  }

  /** 컴퓨터와 한 경기를 마쳤다. bestRun 은 이 경기에서 내 가장 긴 연속 득점. 새 하이런이면 newBest 가 참 */
  recordResult(variant, level, won, bestRun) {
    if (!VARIANT_IDS.includes(variant) || !LEVEL_IDS.includes(level)) return null;
    const all = this.loadAllRecords();
    const key = recordKey(variant, level);
    const old = all[key] ?? { wins: 0, losses: 0, bestRun: 0 };
    const run = isInt(bestRun, 0, 1e4) ? bestRun : 0;
    const record = {
      wins: old.wins + (won ? 1 : 0),
      losses: old.losses + (won ? 0 : 1),
      bestRun: Math.max(old.bestRun, run),
    };
    all[key] = record;
    this.write(RECORD_KEY, all);
    return { record, newBest: run > old.bestRun };
  }
}
