import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';
import { LINES } from '../js/game.js';
import { LEVEL_IDS } from '../js/ai.js';
import { MODES } from '../js/save.js';

test('한/영 문구의 키가 같다', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
});

test('HTML 이 쓰는 data-i18n 키가 사전에 모두 있다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
});

test('main.js 가 쓰는 t() 키와 모드·실력·줄 이름이 사전에 모두 있다', () => {
  const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/\bt\('([^'`]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 30);
  // `mode.${…}`, `level.${…}`, `line.${…}`, `outcome.${…}` 처럼 이어 붙이는 키
  keys.push('hintTouch', 'hintMouse', 'bounced', 'missed');
  for (const mode of MODES) keys.push(`mode.${mode}`, `mode.${mode}.detail`);
  for (const level of LEVEL_IDS) keys.push(`level.${level}`, `level.${level}.detail`);
  for (const line of LINES) keys.push(`line.${line.id}`);
  for (const outcome of ['win', 'loss', 'draw']) keys.push(`outcome.${outcome}`);
  for (const key of keys) assert.ok(key in MESSAGES.ko, key);
});

test('영어 설명은 투호를 짧게 소개한다', () => {
  assert.match(MESSAGES.en.lead, /traditional Korean arrow-tossing game/);
});

test('숫자와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('resultEar', { n: 5 }), '귀! +5');
  assert.equal(t('summary', { score: 14, hits: 6, arrows: 10 }), '14점 · 들어간 화살 6/10');
  assert.equal(t('turnOf', { name: t('player', { n: 3 }) }), '플레이어 3 차례');
  assert.equal(t('record', { level: t('level.hard'), wins: 2, losses: 1, draws: 0 }), '어려움 상대 2승 1패 0무');
  setLang('en', { persist: false });
  assert.equal(t('turnOf', { name: t('player', { n: 2 }) }), "Player 2's turn");
  assert.equal(t('turnOf', { name: t('you') }), 'Your turn');
  assert.equal(t('arrowsLeftOf', { n: 1 }), '1 arrow left');
  assert.equal(t('best', { score: 1, hits: 1, ears: 0 }), 'Best 1 pt · 1 arrow in (0 in the ears)');
  assert.equal(
    t('rankLine', { rank: 1, name: 'Player 1', score: 9, counts: t('counts', { mouth: 2, ear: 1, lean: 0 }) }),
    '1. Player 1 9 pts (mouth 2 · ear 1 · leaning 0)',
  );
});
