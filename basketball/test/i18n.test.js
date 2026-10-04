import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';
import { MODES, STAGES } from '../js/game.js';

test('한/영 문구의 키가 같다', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
});

test('HTML 이 쓰는 data-i18n 키가 사전에 모두 있다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
});

test('main.js 가 쓰는 t() 키와 모드·자리 이름이 사전에 모두 있다', () => {
  const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/\bt\('([^'`]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  keys.push('hintTouch', 'hintMouse', 'airball', 'miss', 'timeUp', 'finished');
  for (const mode of MODES) keys.push(`mode.${mode}`, `mode.${mode}.detail`);
  for (const stage of STAGES) keys.push(`stage.${stage.id}`);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
});

test('숫자와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('nextSpot', { name: t('stage.top3'), n: 3 }), '다음 자리: 3점 정면 (3점)');
  assert.equal(t('summary', { score: 12, makes: 5, shots: 8, pct: 63, streak: 3 }), '12점 · 성공 5/8 (63%) · 최고 연속 3');
  setLang('en', { persist: false });
  assert.equal(t('nextSpot', { name: t('stage.freeThrow'), n: 1 }), 'Next spot: Free throw (1 pt)');
  assert.equal(t('turnOf', { name: t('player', { n: 2 }) }), "Player 2's turn");
  assert.equal(t('ballsLeftOf', { n: 1 }), '1 ball left');
  assert.equal(t('best', { score: 20, makes: 10, shots: 15, streak: 4 }), 'Best 20 pts (10/15) · longest streak 4');
});
