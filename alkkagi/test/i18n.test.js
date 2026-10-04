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
  // `reason.${…}`, `level.${…}`, `opponent.${…}` 처럼 이어 붙이는 키
  for (const reason of ['all', 'self', 'both']) assert.ok(`reason.${reason}` in MESSAGES.ko);
});

test('개수와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('knocked', { n: 2 }), '2개 떨어뜨렸다!');
  assert.equal(t('turnOf', { name: t('white') }), '백 차례');
  assert.equal(t('reason.all', { loser: t('possessive', { name: t('computer') }) }), '컴퓨터의 돌을 모두 떨어뜨렸습니다');
  setLang('en', { persist: false });
  assert.equal(t('knocked', { n: 1 }), 'Knocked off 1 stone!');
  assert.equal(t('knocked', { n: 3 }), 'Knocked off 3 stones!');
  assert.equal(t('selfOut', { n: 1 }), 'Own stone fell off');
  assert.equal(t('stonesCount', { n: 5 }), '5 stones');
  assert.equal(t('reason.all', { loser: t('mine') }), 'Knocked off all of your stones');
  assert.equal(t('turnOf', { name: t('black') }), "Black's turn");
});
