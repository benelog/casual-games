import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';
import { TIERS } from '../js/game.js';

test('한/영 문구의 키가 같다', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
});

test('HTML 이 쓰는 data-i18n 키가 사전에 모두 있다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
});

test('main.js 가 쓰는 t() 키가 사전에 모두 있다', () => {
  const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/\bt\('([^'`]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
  // `tier.${…}` 처럼 이어 붙이는 키
  for (const tier of TIERS) assert.ok(`tier.${tier.id}` in MESSAGES.ko, tier.id);
});

test('수와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('levelName', { tier: t('tier.medium'), n: 3 }), '중급 3');
  assert.equal(t('result', { moves: 12, min: 10 }), '12수 · 최소 10수');
  assert.equal(t('hintToast', { n: 4 }), '표시된 곳으로! 남은 최소 4수');
  setLang('en', { persist: false });
  assert.equal(t('levelName', { tier: t('tier.expert'), n: 12 }), 'Expert 12');
  assert.equal(t('result', { moves: 1, min: 1 }), '1 move · minimum 1');
  assert.equal(t('hintToast', { n: 1 }), 'Slide it to the marked spot! 1 move to go');
  assert.equal(t('levelSolved', { name: 'Easy 2', stars: 1, moves: 9 }), 'Easy 2, solved, 1 star, best 9 moves');
  assert.equal(t('streak', { n: 3 }), '3-day streak');
  setLang('ko', { persist: false });
});
