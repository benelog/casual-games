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
  assert.ok(keys.length > 20);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
});

test('점수와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('scores', { name: t('me'), n: 2 }), '나 2점!');
  assert.equal(t('endOf', { n: 2, total: 4 }), '2엔드 / 4');
  setLang('en', { persist: false });
  assert.equal(t('scores', { name: t('computer'), n: 1 }), 'Computer: 1 point!');
  assert.equal(t('scores', { name: t('player', { n: 2 }), n: 3 }), 'Player 2: 3 points!');
  assert.equal(t('turnOf', { name: t('player', { n: 1 }) }), "Player 1's turn");
});
