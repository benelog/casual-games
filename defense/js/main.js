// 타워 디펜스: 규칙(game.js), 3D 씬(scene.js), 저장(save.js)을 잇고 HUD·입력을 처리한다.

import { DefenseGame, STEP } from './game.js';
import { MAP, tileAt } from './map.js';
import { TOWERS, TOWER_TYPES, MAX_LEVEL, towerStats, upgradeCost, sellValue } from './towers.js';
import { waveSummary } from './waves.js';
import { SaveStore, browserStorage } from './save.js';
import { DefenseScene } from './scene.js';
import { Sound } from './sound.js';
import { t } from './i18n.js';
import { applyI18n, formatNumber, mountLangToggle } from '../../shared/i18n.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const TOWER_COLORS = { archer: '#d9774a', cannon: '#8a8fa8', frost: '#8fd3ff' };
const REASONS = ['gold', 'tile', 'occupied', 'maxLevel', 'over'];
const MAX_STEPS_PER_FRAME = 24; // 느린 기기에서 따라잡느라 멈추지 않도록

document.title = t('title');
applyI18n(t);
mountLangToggle($('lang-controls'), { className: 'chip' });

const towerName = (type) => t(`tower.${type}`);

/** 행동이 거부된 이유 문구 */
function reasonText(reason, fallback) {
  return REASONS.includes(reason) ? t(`reason.${reason}`) : t(fallback);
}

const scene = new DefenseScene($('stage'));
const store = new SaveStore(browserStorage());
const sound = new Sound(new URL('../assets/sounds/', import.meta.url));

let game = null;
let speed = 1;
let paused = false;
let accumulator = 0;
let armed = null; // 건설하려고 고른 타워 종류
let selected = null; // 선택한 타일 { col, row }
let hover = null; // 마우스가 올라간 타일
let statusTimer = 0;

// ---------- 상태 문구 ----------

function setStatus(text, seconds = 0) {
  $('status').textContent = text;
  statusTimer = seconds;
}

function defaultStatus() {
  if (!game || game.over) return '';
  if (armed) return t('statusArmed', { name: towerName(armed) });
  if (game.phase === 'build' && game.wave === 0 && game.towers.length === 0) {
    return t('statusFirst');
  }
  if (paused) return t('statusPaused');
  return '';
}

// ---------- HUD ----------

const towerButtons = {};
TOWER_TYPES.forEach((type, i) => {
  const def = TOWERS[type];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tower-btn';
  button.innerHTML =
    `<i class="swatch" style="background:${TOWER_COLORS[type]}"></i>` +
    `<span class="name">${towerName(type)} <kbd>${i + 1}</kbd></span>` +
    `<span class="cost">${t('cost', { n: formatNumber(def.cost) })}</span>`;
  button.addEventListener('click', () => chooseTower(type));
  $('tower-buttons').append(button);
  towerButtons[type] = button;
});

function describeWave(groups) {
  const counts = waveSummary(groups);
  return Object.entries(counts)
    .map(([type, n]) => `${t(`enemy.${type}`)} ${n}`)
    .join(' · ');
}

function selectedTower() {
  return selected && game ? game.towerAt(selected.col, selected.row) : null;
}

function updateHud() {
  $('wave').textContent = `${game.wave}/${game.totalWaves}`;
  $('gold').textContent = formatNumber(game.gold);
  $('lives').textContent = game.lives;
  $('btn-speed').textContent = `${speed}x`;
  $('btn-pause').textContent = paused ? t('resume') : t('pause');
  $('btn-pause').disabled = game.phase !== 'combat';

  for (const type of TOWER_TYPES) {
    const button = towerButtons[type];
    button.classList.toggle('armed', armed === type);
    button.classList.toggle('poor', game.gold < TOWERS[type].cost);
    const emptyTile = selected && !selectedTower() && tileAt(MAP, selected.col, selected.row) === 'build';
    button.classList.toggle('hint', !!emptyTile);
    button.disabled = game.over;
  }

  const waveButton = $('btn-wave');
  if (game.phase === 'build') {
    waveButton.disabled = false;
    waveButton.innerHTML = `${t('waveButton', { n: game.wave + 1 })} <kbd>Space</kbd>`;
    const next = game.nextWave;
    $('next-wave').textContent = next ? t('nextWave', { list: describeWave(next) }) : '';
  } else if (game.phase === 'combat') {
    waveButton.disabled = true;
    const remaining = game.enemies.length + game.schedule.length - game.spawnIndex;
    waveButton.textContent = t('waveCombat', { n: game.wave, remaining });
    $('next-wave').textContent = describeWave(game.waves[game.wave - 1]);
  } else {
    waveButton.disabled = true;
    waveButton.textContent = game.phase === 'won' ? t('won') : t('lost');
    $('next-wave').textContent = '';
  }

  updatePanel();
  updateMarkers();
  if (statusTimer <= 0) $('status').textContent = defaultStatus();
}

function updatePanel() {
  const tower = selectedTower();
  const panel = $('panel');
  if (!tower || game.over) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const stats = towerStats(tower.type, tower.level);
  $('panel-title').textContent = `${towerName(tower.type)} Lv${tower.level}`;
  const parts = [t('damage', { n: stats.damage }), t('rate', { n: stats.rate }), t('range', { n: stats.range })];
  if (stats.splash) parts.push(t('splash', { n: stats.splash }));
  if (stats.slow) parts.push(t('slow', { n: stats.slowTime }));
  $('panel-detail').textContent = parts.join(' · ');
  const cost = upgradeCost(tower.type, tower.level);
  const upgrade = $('btn-upgrade');
  if (cost === null) {
    upgrade.textContent = t('maxLevel', { n: MAX_LEVEL });
    upgrade.disabled = true;
  } else {
    upgrade.innerHTML = `${t('upgrade', { n: formatNumber(cost) })} <kbd>U</kbd>`;
    upgrade.disabled = game.gold < cost;
  }
  $('btn-sell').innerHTML = `${t('sell', { n: formatNumber(sellValue(tower.invested)) })} <kbd>X</kbd>`;
}

/** 선택 표시, 마우스 강조, 사거리 원 */
function updateMarkers() {
  scene.setSelection(selected);
  const tower = selectedTower();
  if (armed && hover) {
    const ok = game.buildError(armed, hover.col, hover.row) === null;
    scene.setHover(hover, ok);
    scene.setRange({ ...hover, radius: towerStats(armed, 1).range, ok });
  } else if (tower) {
    scene.setHover(hover);
    scene.setRange({ col: tower.col, row: tower.row, radius: towerStats(tower.type, tower.level).range });
  } else {
    scene.setHover(hover);
    scene.setRange(null);
  }
}

// ---------- 저장 ----------

/** 건설 단계일 때만 실제로 저장된다 (save.js 참고) */
function save() {
  store.sync(game, { speed });
}

function recordBest() {
  store.recordBest({ wave: game.wave, won: game.phase === 'won', lives: game.lives });
}

// ---------- 행동 ----------

function build(type, col, row) {
  const result = game.build(type, col, row);
  if (!result.ok) {
    setStatus(reasonText(result.reason, 'cannotBuild'), 1.6);
    return false;
  }
  sound.play('build');
  save();
  return true;
}

function chooseTower(type) {
  sound.unlock();
  if (!game || game.over) return;
  // 빈 건설 칸을 골라 둔 상태면 바로 짓는다 (터치 조작)
  if (selected && !selectedTower() && tileAt(MAP, selected.col, selected.row) === 'build') {
    build(type, selected.col, selected.row);
    armed = null;
  } else {
    armed = armed === type ? null : type;
    if (armed) selected = null;
  }
  updateHud();
}

function upgradeSelected() {
  const tower = selectedTower();
  if (!tower) return;
  const result = game.upgrade(tower.id);
  if (!result.ok) {
    setStatus(reasonText(result.reason, 'cannotUpgrade'), 1.6);
  } else {
    sound.play('upgrade');
    save();
  }
  updateHud();
}

function sellSelected() {
  const tower = selectedTower();
  if (!tower) return;
  const result = game.sell(tower.id);
  if (result.ok) {
    sound.play('sell');
    setStatus(t('statusSold', { name: towerName(tower.type), n: formatNumber(result.refund) }), 2);
    save();
  }
  updateHud();
}

function startWave() {
  if (game.phase !== 'build') return;
  save(); // 웨이브 시작 직전 상태: 전투 중 새로고침하면 여기로 돌아온다
  game.startWave();
  paused = false;
  accumulator = 0;
  updateHud();
}

function togglePause() {
  if (game.phase !== 'combat') return;
  paused = !paused;
  updateHud();
}

function toggleSpeed() {
  speed = speed === 1 ? 2 : 1;
  save();
  updateHud();
}

function toggleSound() {
  sound.unlock();
  sound.enabled = !sound.enabled;
  $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));
}

function clearSelection() {
  armed = null;
  selected = null;
  updateHud();
}

scene.onTileClick = (tile) => {
  sound.unlock();
  if (!game || game.over) return;
  if (!tile) return clearSelection();
  const tower = game.towerAt(tile.col, tile.row);
  if (armed && !tower) {
    if (tileAt(MAP, tile.col, tile.row) === 'build') build(armed, tile.col, tile.row);
    else armed = null;
  } else if (tower) {
    armed = null;
    selected = tile;
  } else if (tileAt(MAP, tile.col, tile.row) === 'build') {
    // 같은 빈 칸을 다시 누르면 선택 해제
    selected = selected && selected.col === tile.col && selected.row === tile.row ? null : tile;
  } else {
    selected = null;
  }
  updateHud();
};

scene.onHover = (tile) => {
  hover = tile;
  if (game) updateMarkers();
};

$('btn-wave').addEventListener('click', () => {
  sound.unlock();
  startWave();
});
$('btn-pause').addEventListener('click', togglePause);
$('btn-speed').addEventListener('click', toggleSpeed);
$('btn-sound').addEventListener('click', toggleSound);
$('btn-upgrade').addEventListener('click', upgradeSelected);
$('btn-sell').addEventListener('click', sellSelected);
$('btn-new').addEventListener('click', () => newGame());

window.addEventListener('keydown', (e) => {
  if (!game || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (!$('menu').hidden) return;
  sound.unlock();
  const key = e.key.toLowerCase();
  const index = ['1', '2', '3'].indexOf(key);
  if (index >= 0) chooseTower(TOWER_TYPES[index]);
  else if (key === 'u') upgradeSelected();
  else if (key === 'x') sellSelected();
  else if (key === 'f') toggleSpeed();
  else if (key === 'm') toggleSound();
  else if (key === 'escape') clearSelection();
  else if (key === ' ') {
    e.preventDefault();
    if (e.target instanceof HTMLButtonElement) e.target.blur();
    if (game.phase === 'build') startWave();
    else togglePause();
  } else return;
});

// ---------- 시뮬레이션 루프 ----------

function handleEvents() {
  for (const event of game.drainEvents()) {
    scene.effect(event);
    switch (event.type) {
      case 'fire':
        sound.play(event.towerType === 'archer' ? 'arrow' : event.towerType === 'cannon' ? 'cannon' : 'frost');
        break;
      case 'kill':
        sound.play('kill');
        break;
      case 'leak':
        sound.play('leak');
        scene.shakeBase();
        flashLives();
        break;
      case 'waveStart': {
        sound.play('wave-start');
        const boss = game.waves[event.wave - 1].some((g) => g.type === 'boss');
        setStatus(t('statusWaveStart', { n: event.wave }) + (boss ? t('statusBoss') : ''), 2.5);
        break;
      }
      case 'waveEnd':
        if (game.phase === 'build') {
          sound.play('wave-clear');
          setStatus(t('statusWaveClear', { n: event.wave, bonus: formatNumber(event.bonus) }), 3);
          paused = false;
          recordBest();
          save();
        }
        break;
      case 'win':
      case 'lose':
        endGame();
        break;
      default:
    }
  }
}

function flashLives() {
  const stat = $('lives').parentElement;
  stat.classList.add('flash');
  setTimeout(() => stat.classList.remove('flash'), 400);
}

function endGame() {
  const won = game.phase === 'won';
  sound.play(won ? 'win' : 'lose');
  recordBest();
  store.clear();
  armed = null;
  selected = null;
  paused = false;
  $('banner-title').textContent = won ? t('bannerWon') : t('bannerLost');
  $('banner-detail').textContent = won
    ? t('detailWon', { waves: game.totalWaves, lives: game.lives })
    : t('detailLost', { n: game.wave });
  $('banner').dataset.tone = won ? 'win' : 'lose';
  $('banner').hidden = false;
  setStatus('');
}

let hudClock = 0;
scene.onFrame = (dt) => {
  if (!game) return;
  if (statusTimer > 0) {
    statusTimer -= dt;
    if (statusTimer <= 0) $('status').textContent = defaultStatus();
  }
  if (game.phase === 'combat' && !paused) {
    accumulator += dt * speed;
    let steps = 0;
    while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      game.step(STEP);
      accumulator -= STEP;
      steps++;
      if (game.phase !== 'combat') break;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
  }
  handleEvents();
  scene.sync(game);
  // 행동 직후에는 바로 갱신하므로 여기서는 10 번/초 정도면 충분하다
  hudClock -= dt;
  if (hudClock <= 0) {
    hudClock = 0.1;
    updateHud();
  }
  return game.phase === 'combat' && !paused;
};

// ---------- 시작 ----------

function startGame(newGameInstance, savedSpeed = 1) {
  game = newGameInstance;
  speed = savedSpeed;
  paused = false;
  accumulator = 0;
  armed = null;
  selected = null;
  $('menu').hidden = true;
  $('banner').hidden = true;
  $('stats').hidden = false;
  $('controls').hidden = false;
  $('bottom').hidden = false;
  updateHud();
  fitInsets();
}

function newGame() {
  store.clear();
  startGame(new DefenseGame());
  save();
}

function showMenu(saved) {
  const best = store.loadBest();
  $('menu-best').textContent = best
    ? best.won
      ? t('bestWon', { lives: best.lives })
      : t('bestWave', { n: best.wave })
    : '';
  $('btn-continue').textContent = t('continue', {
    wave: saved.wave + 1,
    gold: formatNumber(saved.gold),
    lives: saved.lives,
  });
  $('btn-continue').onclick = () => {
    sound.unlock();
    startGame(DefenseGame.fromSnapshot(saved), saved.speed);
    setStatus(t('statusRestored', { n: saved.wave + 1 }), 3);
  };
  $('btn-menu-new').onclick = () => {
    sound.unlock();
    newGame();
  };
  $('menu').hidden = false;
  $('btn-continue').focus();
}

const sideLayout = window.matchMedia('(max-height: 520px) and (min-aspect-ratio: 4/3)');

/** HUD 가 가리는 화면 가장자리를 씬에 알려 맵이 그 사이에 들어오게 한다 */
function fitInsets() {
  const top = document.querySelector('.top').getBoundingClientRect().bottom;
  const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
  if (!toolbar.height) return scene.setInsets({ top, bottom: 150, right: 0 });
  if (sideLayout.matches) {
    // 도구 막대가 오른쪽 세로 막대가 된다
    scene.setInsets({ top, bottom: 0, right: window.innerWidth - toolbar.left });
  } else {
    // 선택 패널이 뜰 자리까지 조금 더 비워 둔다
    scene.setInsets({ top, bottom: window.innerHeight - toolbar.top + 46, right: 0 });
  }
}
new ResizeObserver(fitInsets).observe(document.querySelector('.toolbar'));
window.addEventListener('resize', fitInsets);

// ?debug 로 열면 콘솔에서 게임과 씬을 들여다볼 수 있다
if (params.has('debug')) {
  window.defense = {
    scene,
    store,
    sound,
    get game() {
      return game;
    },
  };
}

try {
  await scene.load(MAP);
  $('loading').hidden = true;
  const saved = store.load();
  if (saved) showMenu(saved);
  else newGame();
  fitInsets();
} catch (error) {
  console.error(error);
  $('loading').textContent = t('loadFailed', { message: error.message });
}
