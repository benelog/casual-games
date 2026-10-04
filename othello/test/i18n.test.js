import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';
import { LEVEL_IDS } from '../js/ai.js';
import { OPPONENTS, COLORS } from '../js/save.js';

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
  // `level.${…}`, `opponent.${…}`, `color.${…}` 처럼 이어 붙이는 키
  for (const level of LEVEL_IDS) for (const key of [`level.${level}`, `level.${level}.detail`]) assert.ok(key in MESSAGES.ko, key);
  for (const o of OPPONENTS) for (const key of [`opponent.${o}`, `opponent.${o}.detail`]) assert.ok(key in MESSAGES.ko, key);
  for (const c of COLORS) for (const key of [`color.${c}`, `color.${c}.detail`]) assert.ok(key in MESSAGES.ko, key);
  // 삼항으로 고르는 키
  for (const key of ['hints.on', 'hints.off', 'recordDraws', 'win', 'lose', 'draw', 'me', 'computer', 'black', 'white']) {
    assert.ok(key in MESSAGES.ko, key);
  }
});

test('개수와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('hintPlace', { n: 4 }), '둘 수 있는 곳 4군데');
  assert.equal(t('turnOf', { name: t('white') }), '백 차례');
  assert.equal(t('pass', { name: t('computer') }), '컴퓨터: 둘 곳이 없어 넘깁니다');
  assert.equal(t('finalDetail', { a: 40, b: 24, moves: t('movesCount', { n: 60 }) }), '흑 40 : 백 24 · 60수');
  assert.equal(t('record', { level: t('level.hard'), wins: 2, losses: 1 }), '어려움 상대 2승 1패');
  setLang('en', { persist: false });
  assert.equal(t('hintPlace', { n: 1 }), '1 place to play');
  assert.equal(t('hintPlace', { n: 5 }), '5 places to play');
  assert.equal(t('flipped', { n: 7 }), 'Flipped 7 discs!');
  assert.equal(t('movesCount', { n: 1 }), '1 move');
  assert.equal(t('turnOf', { name: t('black') }), "Black's turn");
  assert.equal(t('pass', { name: t('white') }), 'White has no move and passes');
  assert.equal(t('finalDetail', { a: 32, b: 32, moves: t('movesCount', { n: 60 }) }), 'Black 32 : White 32 · 60 moves');
  setLang('ko', { persist: false });
});
