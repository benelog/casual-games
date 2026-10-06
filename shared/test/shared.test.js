import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, shuffle, formatTime, damp } from '../util.js';
import { JsonStore, mergeLowest, isInt, isTime } from '../storage.js';
import { LANGUAGES, LANGS, setLang, createT, formatNumber } from '../i18n.js';

test('createRng 는 같은 시드에서 같은 수열을 낸다', () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(7);
  const seq = (rng) => Array.from({ length: 5 }, rng);
  assert.deepEqual(seq(a), seq(b));
  assert.notDeepEqual(seq(createRng(42)), seq(c));
  for (const v of seq(createRng(1))) assert.ok(v >= 0 && v < 1);
});

test('shuffle 은 제자리에서 섞고 원소를 잃지 않는다', () => {
  const list = [1, 2, 3, 4, 5, 6];
  assert.equal(shuffle(list, createRng(1)), list);
  assert.deepEqual([...list].sort(), [1, 2, 3, 4, 5, 6]);
});

test('formatTime', () => {
  assert.equal(formatTime(-3), '0:00');
  assert.equal(formatTime(65.9), '1:05');
  assert.equal(formatTime(3725), '1:02:05');
});

test('damp 는 0 과 1 사이에서 dt 가 길수록 크다', () => {
  assert.equal(damp(10, 0), 0);
  assert.ok(damp(10, 1 / 60) < damp(10, 1 / 30));
  assert.ok(damp(10, 10) <= 1);
});

test('isInt · isTime', () => {
  assert.ok(isInt(3, 0, 5));
  assert.ok(!isInt(3.5, 0, 5));
  assert.ok(!isInt(6, 0, 5));
  assert.ok(isTime(12.5));
  assert.ok(!isTime(-1));
  assert.ok(!isTime(Infinity));
});

test('JsonStore 는 JSON 으로 읽고 쓰며 예외를 삼킨다', () => {
  const data = new Map();
  const storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
  const store = new JsonStore(storage);
  assert.equal(store.read('x'), null);
  assert.equal(store.write('x', { a: 1 }), true);
  assert.deepEqual(store.read('x'), { a: 1 });
  store.remove('x');
  assert.equal(store.read('x'), null);
  data.set('broken', '{');
  assert.equal(store.read('broken'), null);

  const throwing = new JsonStore({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('full');
    },
    removeItem() {
      throw new Error('blocked');
    },
  });
  assert.equal(throwing.read('x'), null);
  assert.equal(throwing.write('x', 1), false);
  throwing.remove('x');
  assert.equal(new JsonStore(null).write('x', 1), false);
});

test('mergeLowest 는 항목마다 작은 값을 남긴다', () => {
  assert.deepEqual(mergeLowest(null, { time: 5, moves: 9 }), {
    record: { time: 5, moves: 9 },
    improved: { time: true, moves: true },
  });
  assert.deepEqual(mergeLowest({ time: 4, moves: 10 }, { time: 5, moves: 9 }), {
    record: { time: 4, moves: 9 },
    improved: { time: false, moves: true },
  });
});

test('LANGUAGES 의 언어마다 이름·짧은 이름·라벨·로케일이 있다', () => {
  assert.deepEqual(LANGS, Object.keys(LANGUAGES));
  for (const code of LANGS) {
    const { name, short, label, locale } = LANGUAGES[code];
    assert.ok(name && short && label && locale, code);
  }
});

test('createT 는 빠진 문구를 영어 → 한국어 → 키 순으로 채운다', () => {
  const t = createT({
    ko: { both: '둘 다', koOnly: '한국어만' },
    en: { both: 'Both', enOnly: 'English only', score: '{n} pts' },
  });
  setLang('ko', { persist: false });
  assert.equal(t('both'), '둘 다');
  assert.equal(t('enOnly'), 'English only');
  setLang('en', { persist: false });
  assert.equal(t('koOnly'), '한국어만');
  assert.equal(t('missing'), 'missing');
  assert.equal(t('score', { n: 3 }), '3 pts');
  assert.equal(formatNumber(12345), '12,345');
  setLang('ko', { persist: false });
});
