import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';
import { scoreName } from '../js/game.js';
import { CAMERAS } from '../js/save.js';

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
  assert.ok(keys.length > 30);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
  // `score.${…}`, `camera.${…}` 처럼 이어 붙이는 키
  const names = new Set();
  for (let par = 2; par <= 5; par++) for (let s = 1; s <= 8; s++) names.add(scoreName(s, par));
  for (const name of names) assert.ok(`score.${name}` in MESSAGES.ko, name);
  for (const camera of CAMERAS) assert.ok(`camera.${camera}` in MESSAGES.ko, camera);
});

test('숫자와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('holeOf', { n: 3 }), '3번 홀');
  assert.equal(t('shotNth', { n: 2 }), '2타째');
  assert.equal(t('turnOf', { name: t('playerN', { n: 2 }) }), '2P 차례');
  assert.equal(t('pickedUp', { max: 7 }), '최대 7타로 마칩니다');
  setLang('en', { persist: false });
  assert.equal(t('shotNth', { n: 1 }), '1st shot');
  assert.equal(t('shotNth', { n: 2 }), '2nd shot');
  assert.equal(t('shotNth', { n: 3 }), '3rd shot');
  assert.equal(t('shotNth', { n: 4 }), '4th shot');
  assert.equal(t('shotNth', { n: 11 }), '11th shot');
  assert.equal(t('penaltyShort', { n: 1 }), '1 penalty stroke');
  assert.equal(t('penaltyShort', { n: 2 }), '2 penalty strokes');
  assert.equal(t('turnOf', { name: t('playerN', { n: 3 }) }), "P3's turn");
  assert.equal(t('score.ace'), 'Hole in one!');
});
