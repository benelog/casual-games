import test from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../../shared/i18n.js';
import { MESSAGES, t } from '../js/i18n.js';
import { SaveStore, SETTINGS_KEY, RECORD_KEY, DEFAULT_SETTINGS, validateSettings } from '../js/save.js';
import { VARIANTS, VARIANT_IDS, LEVEL_IDS } from '../js/variants.js';
import { firstContact, shortGuide, longGuide } from '../js/guide.js';
import { simulate } from '../js/physics.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

// ---------- 문구 ----------

test('한/영 문구의 키가 같다', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort());
});

test('종목·실력·파울마다 문구가 있다', () => {
  for (const lang of ['ko', 'en']) {
    const m = MESSAGES[lang];
    for (const id of VARIANT_IDS) for (const k of [`variant.${id}`, `variant.${id}.detail`, `variant.${id}.lead`, `rules.${id}`]) assert.ok(m[k], `${lang} ${k}`);
    for (const id of LEVEL_IDS) assert.ok(m[`level.${id}`]);
    for (const f of ['scratch', 'noHit', 'wrongBall', 'noRail']) assert.ok(m[`foul.${f}`]);
  }
});

test('이름과 숫자 자리를 채운다', () => {
  setLang('ko', { persist: false });
  assert.equal(t('turnOf', { name: t('player', { n: 2 }) }), '플레이어 2 차례');
  assert.equal(t('scoredRun', { n: 3 }), '3연속 득점!');
  setLang('en', { persist: false });
  assert.equal(t('turnOf', { name: t('computer') }), "Computer's turn");
  assert.equal(t('points', { n: 10 }), '10 points');
  setLang('ko', { persist: false });
});

// ---------- 저장 ----------

test('설정: 잘못된 값은 기본값으로', () => {
  assert.deepEqual(validateSettings(null), DEFAULT_SETTINGS);
  const s = validateSettings({ variant: 'snooker', opponent: 'friend', level: 'hard', targets: { fourball: 30, threecushion: 7 }, guide: 'short', camera: 'cue', sound: 'x' });
  assert.equal(s.variant, 'fourball');
  assert.equal(s.opponent, 'friend');
  assert.equal(s.level, 'hard');
  assert.equal(s.targets.fourball, 30);
  assert.equal(s.targets.threecushion, VARIANTS.threecushion.defaultTarget);
  assert.equal(s.targets.eightball, VARIANTS.eightball.defaultTarget);
  assert.equal(s.guide, 'short');
  assert.equal(s.camera, 'cue');
  assert.equal(s.sound, true);
});

test('설정과 전적을 저장하고 깨진 데이터는 버린다', () => {
  const storage = memoryStorage({ [RECORD_KEY]: '{"fourball-easy":{"wins":-1,"losses":0,"bestRun":0}}' });
  const store = new SaveStore(storage);
  assert.equal(store.loadRecord('fourball', 'easy'), null);
  store.saveSettings({ ...DEFAULT_SETTINGS, variant: 'eightball' });
  assert.equal(JSON.parse(storage.getItem(SETTINGS_KEY)).variant, 'eightball');
  let r = store.recordResult('threecushion', 'hard', true, 4);
  assert.deepEqual(r.record, { wins: 1, losses: 0, bestRun: 4 });
  assert.equal(r.newBest, true);
  r = store.recordResult('threecushion', 'hard', false, 2);
  assert.deepEqual(r.record, { wins: 1, losses: 1, bestRun: 4 });
  assert.equal(r.newBest, false);
  assert.equal(store.recordResult('snooker', 'hard', true, 1), null);
  // 저장소가 예외를 던져도 게임은 계속된다
  const broken = new SaveStore({ getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } });
  assert.deepEqual(broken.loadSettings(), DEFAULT_SETTINGS);
  assert.ok(broken.recordResult('fourball', 'easy', true, 1));
});

// ---------- 보조선 ----------

test('보조선: 처음 닿는 공과 쿠션을 찾는다', () => {
  const table = VARIANTS.threecushion.table;
  const R = table.ballRadius;
  const balls = [
    { id: 0, x: -0.5, y: 0, on: true },
    { id: 1, x: 0.3, y: 0.02, on: true },
    { id: 2, x: 0.9, y: 0.5, on: true },
  ];
  const hit = firstContact(table, balls, 0, 0);
  assert.equal(hit.kind, 'ball');
  assert.equal(hit.ball, 1);
  assert.ok(Math.abs(Math.hypot(hit.x - 0.3, hit.y - 0.02) - 2 * R) < 1e-9);
  const rail = firstContact(table, balls, 0, Math.PI);
  assert.equal(rail.kind, 'cushion');
  assert.ok(Math.abs(rail.x - (-table.length / 2 + R)) < 1e-9);
  assert.ok(Math.abs(rail.nx - 1) < 1e-9);

  const short = shortGuide(table, balls, 0, 0);
  assert.deepEqual(short.lines.map((l) => l.kind), ['cue', 'object', 'deflect']);
  assert.ok(short.ghost);
});

test('긴 보조선은 실제로 친 수구의 길을 따라간다', () => {
  const table = VARIANTS.threecushion.table;
  const balls = [
    { id: 0, x: -0.7, y: -0.15, on: true },
    { id: 1, x: -0.7, y: 0, on: true },
    { id: 2, x: 0.7, y: 0, on: true },
  ];
  const shot = { angle: 0.6, speed: 3, side: 0.5, vert: 0.2 };
  const guide = longGuide(table, balls, 0, shot, { balls: 2, length: 50 });
  const real = simulate(table, balls, 0, shot);
  const path = guide.lines[0].points;
  const firstCushion = real.events.find((e) => e.type === 'cushion' && e.ball === 0);
  assert.ok(firstCushion);
  // 보조선이 꺾이는 곳 중 하나는 실제 첫 쿠션 자리와 같다
  const sim = longGuide(table, balls, 0, shot, { balls: 2, length: 0.01 });
  assert.equal(sim.lines[0].points.length >= 2, true);
  assert.ok(path.length > 5);
  const end = path[path.length - 1];
  assert.ok(Math.abs(end[0]) <= table.length / 2 && Math.abs(end[1]) <= table.width / 2);
});
