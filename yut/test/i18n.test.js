import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';
import { RESULT_IDS, MAX_PLAYERS } from '../js/game.js';
import { LEVEL_IDS } from '../js/ai.js';

test('한/영 문구의 키가 같다', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
});

test('결과·편·실력 이름이 모두 있다', () => {
  for (const lang of ['ko', 'en']) {
    for (const id of RESULT_IDS) {
      assert.ok(MESSAGES[lang][`result.${id}`], `${lang} result.${id}`);
      assert.ok(MESSAGES[lang][`steps.${id}`], `${lang} steps.${id}`);
    }
    for (let team = 0; team < MAX_PLAYERS; team++) assert.ok(MESSAGES[lang][`team.${team}`]);
    for (const level of LEVEL_IDS) assert.ok(MESSAGES[lang][`level.${level}`]);
  }
});

test('HTML 의 data-i18n 키가 사전에 있다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 10);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
});

test('결과 이름과 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('bonus', { result: t('result.yut') }), '윷! 한 번 더');
  assert.equal(t('turnOf', { name: t('team.1') }), '파랑 차례');
  setLang('en', { persist: false });
  assert.equal(t('bonus', { result: t('result.mo') }), 'Mo! Toss again');
  assert.equal(t('result.backdo'), 'Back-do');
  setLang('ko', { persist: false });
});
