import test from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';

test('한/영 문구의 키가 같다', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
});

test('핀 수와 이름 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('pins', { n: 7 }), '7핀');
  assert.equal(t('winner', { name: t('player2') }), '플레이어 2 승리!');
  setLang('en', { persist: false });
  assert.equal(t('pins', { n: 1 }), '1 pin');
  assert.equal(t('pins', { n: 0 }), '0 pins');
  assert.equal(t('winner', { name: t('player1') }), 'Player 1 wins!');
});
