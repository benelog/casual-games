// 타워 디펜스: 규칙(game.js), 3D 씬(scene.js), 저장(save.js)을 잇고 HUD·입력을 처리한다.

import { DefenseGame, STEP } from './game.js';
import { MAP, tileAt } from './map.js';
import { TOWERS, TOWER_TYPES, MAX_LEVEL, towerStats, upgradeCost, sellValue } from './towers.js';
import { ENEMIES } from './enemies.js';
import { waveSummary } from './waves.js';
import { SaveStore, browserStorage } from './save.js';
import { DefenseScene } from './scene.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const TOWER_COLORS = { archer: '#d9774a', cannon: '#8a8fa8', frost: '#8fd3ff' };
const REASONS = {
  gold: '골드가 부족합니다',
  tile: '여기에는 지을 수 없습니다',
  occupied: '이미 타워가 있습니다',
  maxLevel: '최고 레벨입니다',
  over: '게임이 끝났습니다',
};
const MAX_STEPS_PER_FRAME = 24; // 느린 기기에서 따라잡느라 멈추지 않도록

/** 받침에 맞는 목적격 조사: 궁수탑을, 대포를 */
function withObject(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (code >= 0 && code <= 11171 && code % 28 > 0 ? '을' : '를');
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
  if (armed) return `${withObject(TOWERS[armed].name)} 지을 칸을 고르세요 · Esc 취소`;
  if (game.phase === 'build' && game.wave === 0 && game.towers.length === 0) {
    return '길 옆 빈 칸을 눌러 타워를 짓고 웨이브를 시작하세요';
  }
  if (paused) return '일시정지 · Space 로 계속';
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
    `<span class="name">${def.name} <kbd>${i + 1}</kbd></span><span class="cost">${def.cost} 골드</span>`;
  button.addEventListener('click', () => chooseTower(type));
  $('tower-buttons').append(button);
  towerButtons[type] = button;
});

function describeWave(groups) {
  const counts = waveSummary(groups);
  return Object.entries(counts)
    .map(([type, n]) => `${ENEMIES[type].name} ${n}`)
    .join(' · ');
}

function selectedTower() {
  return selected && game ? game.towerAt(selected.col, selected.row) : null;
}

function updateHud() {
  $('wave').textContent = `${game.wave}/${game.totalWaves}`;
  $('gold').textContent = game.gold;
  $('lives').textContent = game.lives;
  $('btn-speed').textContent = `${speed}x`;
  $('btn-pause').textContent = paused ? '계속' : '일시정지';
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
    waveButton.innerHTML = `웨이브 ${game.wave + 1} 시작 <kbd>Space</kbd>`;
    const next = game.nextWave;
    $('next-wave').textContent = next ? `다음: ${describeWave(next)}` : '';
  } else if (game.phase === 'combat') {
    waveButton.disabled = true;
    const remaining = game.enemies.length + game.schedule.length - game.spawnIndex;
    waveButton.textContent = `웨이브 ${game.wave} · 남은 적 ${remaining}`;
    $('next-wave').textContent = describeWave(game.waves[game.wave - 1]);
  } else {
    waveButton.disabled = true;
    waveButton.textContent = game.phase === 'won' ? '승리' : '패배';
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
  const def = TOWERS[tower.type];
  const stats = towerStats(tower.type, tower.level);
  $('panel-title').textContent = `${def.name} Lv${tower.level}`;
  const parts = [`피해 ${stats.damage}`, `초당 ${stats.rate}회`, `사거리 ${stats.range}`];
  if (stats.splash) parts.push(`착탄 반경 ${stats.splash}`);
  if (stats.slow) parts.push(`${stats.slowTime}초 둔화`);
  $('panel-detail').textContent = parts.join(' · ');
  const cost = upgradeCost(tower.type, tower.level);
  const upgrade = $('btn-upgrade');
  if (cost === null) {
    upgrade.textContent = `최고 레벨 (Lv${MAX_LEVEL})`;
    upgrade.disabled = true;
  } else {
    upgrade.innerHTML = `업그레이드 ${cost} <kbd>U</kbd>`;
    upgrade.disabled = game.gold < cost;
  }
  $('btn-sell').innerHTML = `판매 +${sellValue(tower.invested)} <kbd>X</kbd>`;
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
    setStatus(REASONS[result.reason] ?? '지을 수 없습니다', 1.6);
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
    setStatus(REASONS[result.reason] ?? '업그레이드할 수 없습니다', 1.6);
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
    setStatus(`${withObject(TOWERS[tower.type].name)} 팔아 ${result.refund} 골드를 돌려받았습니다`, 2);
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
        setStatus(`웨이브 ${event.wave}${boss ? ' · 보스 출현!' : ''}`, 2.5);
        break;
      }
      case 'waveEnd':
        if (game.phase === 'build') {
          sound.play('wave-clear');
          setStatus(`웨이브 ${event.wave} 클리어! 보너스 ${event.bonus} 골드`, 3);
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
  $('banner-title').textContent = won ? '승리!' : '패배';
  $('banner-detail').textContent = won
    ? `${game.totalWaves}웨이브를 모두 막았습니다 · 남은 목숨 ${game.lives}`
    : `웨이브 ${game.wave}에서 기지가 무너졌습니다`;
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
      ? `최고 기록: 20웨이브 클리어 · 남은 목숨 ${best.lives}`
      : `최고 기록: 웨이브 ${best.wave} 도달`
    : '';
  $('btn-continue').textContent = `이어하기 · 웨이브 ${saved.wave + 1} · 골드 ${saved.gold} · 목숨 ${saved.lives}`;
  $('btn-continue').onclick = () => {
    sound.unlock();
    startGame(DefenseGame.fromSnapshot(saved), saved.speed);
    setStatus(`웨이브 ${saved.wave + 1} 시작 전 상태로 돌아왔습니다`, 3);
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
  $('loading').textContent = `불러오기에 실패했습니다: ${error.message}`;
}
