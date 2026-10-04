import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';

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
  assert.ok(keys.length > 15);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
  // `reason.${…}`, `level.${…}`, `opponent.${…}`, `color.${…}` 처럼 이어 붙이는 키
  for (const reason of ['six', 'long', 'full']) assert.ok(`reason.${reason}` in MESSAGES.ko);
  for (const level of ['easy', 'normal', 'hard']) assert.ok(`level.${level}` in MESSAGES.ko);
  for (const color of ['black', 'white']) assert.ok(`color.${color}.detail` in MESSAGES.ko);
});

test('개수와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('left', { n: 1, total: 2 }), '남은 돌 1/2');
  assert.equal(t('turnOf', { name: t('white') }), '백 차례');
  assert.equal(t('reason.six', { name: t('possessive', { name: t('computer') }) }), '컴퓨터의 돌 6개를 한 줄로 이었습니다');
  assert.equal(t('moves', { turns: 12, moves: 23 }), '12차례 · 돌 23개');
  setLang('en', { persist: false });
  assert.equal(t('left', { n: 2, total: 2 }), '2/2 left');
  assert.equal(t('moves', { turns: 1, moves: 1 }), '1 stone in 1 turn');
  assert.equal(t('moves', { turns: 12, moves: 23 }), '23 stones in 12 turns');
  assert.equal(t('reason.long', { name: t('mine'), n: 7 }), 'Your 7 stones in a row (overlines win too)');
  assert.equal(t('turnOf', { name: t('black') }), "Black's turn");
});
