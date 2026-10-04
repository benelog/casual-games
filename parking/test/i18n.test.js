import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';
import { CAMERAS } from '../js/save.js';

test('한/영 문구의 키가 같다', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
});

test('HTML 이 쓰는 data-i18n 키가 사전에 모두 있다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 30);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
});

test('main.js 가 쓰는 t() 키가 사전에 모두 있다', () => {
  const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/\bt\('([^'`]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
  // `camera.${…}` 처럼 이어 붙이는 키
  for (const camera of CAMERAS) assert.ok(`camera.${camera}` in MESSAGES.ko, camera);
});

test('개수와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('contact', { n: 2 }), '접촉! (2번째)');
  assert.equal(t('score', { n: 87 }), '87점');
  assert.equal(t('reason.contacts', { n: 3 }), '3번 닿아 실격입니다');
  setLang('en', { persist: false });
  assert.equal(t('contact', { n: 1 }), 'Bump! (1st)');
  assert.equal(t('contact', { n: 12 }), 'Bump! (12th)');
  assert.equal(t('contact', { n: 23 }), 'Bump! (23rd)');
  assert.equal(t('score', { n: 1 }), '1 point');
  assert.equal(t('score', { n: 90 }), '90 points');
  assert.equal(t('reason.contacts', { n: 3 }), 'Disqualified after 3 bumps');
  assert.equal(t('accuracyValue', { m: '0.12', deg: '1.5' }), '0.12 m · 1.5°');
  setLang('ko', { persist: false });
});
