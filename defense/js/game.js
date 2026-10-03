// 타워 디펜스 규칙과 시뮬레이션. DOM·Three.js 에 의존하지 않는 순수 로직이다.
// 화면 쪽은 고정 타임스텝 step() 을 필요한 만큼 부르고(배속 = 프레임당 step 횟수),
// drainEvents() 로 발사·명중·처치 같은 사건을 받아 효과를 그린다.

import { MAP, positionAt, tileAt } from './map.js';
import { TOWERS, MAX_LEVEL, towerStats, upgradeCost, sellValue } from './towers.js';
import { ENEMIES, enemyHp } from './enemies.js';
import { WAVES, waveBonus, spawnSchedule } from './waves.js';

export const STEP = 1 / 60;
export const START_GOLD = 200;
export const START_LIVES = 20;

/** 시드를 받는 작은 난수 생성기 (mulberry32). 0 이상 1 미만 */
export function createRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DefenseGame {
  constructor({ map = MAP, waves = WAVES, gold = START_GOLD, lives = START_LIVES, seed = 1 } = {}) {
    this.map = map;
    this.waves = waves;
    this.gold = gold;
    this.lives = lives;
    this.wave = 0; // 마지막으로 시작한 웨이브 번호. 건설 단계에서는 클리어한 웨이브 수와 같다
    this.phase = 'build'; // build | combat | won | lost
    this.rng = createRng(seed);
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.events = [];
    this.nextId = 1;
    this.waveTime = 0;
    this.schedule = [];
    this.spawnIndex = 0;
  }

  get totalWaves() {
    return this.waves.length;
  }

  get over() {
    return this.phase === 'won' || this.phase === 'lost';
  }

  /** 다음에 시작할 웨이브의 구성. 남은 웨이브가 없으면 null */
  get nextWave() {
    return this.phase === 'build' ? (this.waves[this.wave] ?? null) : null;
  }

  // ---------- 건설 · 업그레이드 · 판매 ----------

  towerAt(col, row) {
    return this.towers.find((t) => t.col === col && t.row === row) ?? null;
  }

  tower(id) {
    return this.towers.find((t) => t.id === id) ?? null;
  }

  /** 지을 수 없으면 이유('over' | 'tile' | 'occupied' | 'gold'), 지을 수 있으면 null */
  buildError(type, col, row) {
    if (!TOWERS[type]) throw new Error(`알 수 없는 타워 ${type}`);
    if (this.over) return 'over';
    if (tileAt(this.map, col, row) !== 'build') return 'tile';
    if (this.towerAt(col, row)) return 'occupied';
    if (this.gold < TOWERS[type].cost) return 'gold';
    return null;
  }

  build(type, col, row) {
    const reason = this.buildError(type, col, row);
    if (reason) return { ok: false, reason };
    const cost = TOWERS[type].cost;
    const tower = { id: this.nextId++, type, level: 1, col, row, invested: cost, cooldown: 0, targetId: null };
    this.towers.push(tower);
    this.gold -= cost;
    return { ok: true, tower };
  }

  upgrade(id) {
    const tower = this.tower(id);
    if (!tower) return { ok: false, reason: 'missing' };
    if (this.over) return { ok: false, reason: 'over' };
    if (tower.level >= MAX_LEVEL) return { ok: false, reason: 'maxLevel' };
    const cost = upgradeCost(tower.type, tower.level);
    if (this.gold < cost) return { ok: false, reason: 'gold' };
    this.gold -= cost;
    tower.invested += cost;
    tower.level += 1;
    return { ok: true, tower };
  }

  sell(id) {
    const tower = this.tower(id);
    if (!tower) return { ok: false, reason: 'missing' };
    if (this.over) return { ok: false, reason: 'over' };
    const refund = sellValue(tower.invested);
    this.gold += refund;
    this.towers = this.towers.filter((t) => t !== tower);
    for (const p of this.projectiles) if (p.towerId === id) p.towerId = null;
    return { ok: true, refund, tower };
  }

  // ---------- 웨이브 ----------

  startWave() {
    if (this.phase !== 'build' || this.wave >= this.waves.length) return false;
    this.wave += 1;
    this.phase = 'combat';
    this.waveTime = 0;
    this.schedule = spawnSchedule(this.waves[this.wave - 1]);
    this.spawnIndex = 0;
    this.emit({ type: 'waveStart', wave: this.wave });
    return true;
  }

  /** 시뮬레이션을 dt 초 진행한다. 전투 단계가 아니면 아무 일도 없다 */
  step(dt = STEP) {
    if (this.phase !== 'combat') return;
    this.waveTime += dt;
    this.spawnEnemies();
    this.moveEnemies(dt);
    if (this.phase !== 'combat') return; // 누수로 패배
    this.updateTowers(dt);
    this.moveProjectiles(dt);
    this.enemies = this.enemies.filter((e) => e.alive);
    this.checkWaveEnd();
  }

  spawnEnemies() {
    while (this.spawnIndex < this.schedule.length && this.schedule[this.spawnIndex].time <= this.waveTime) {
      const { type } = this.schedule[this.spawnIndex++];
      const def = ENEMIES[type];
      const hp = enemyHp(type, this.wave);
      const enemy = {
        id: this.nextId++,
        type,
        hp,
        maxHp: hp,
        speed: def.speed,
        reward: def.reward,
        damage: def.damage,
        dist: 0,
        slowTime: 0,
        slowFactor: 1,
        alive: true,
        lane: (this.rng() - 0.5) * 0.3, // 화면에서 줄지어 겹치지 않도록 옆으로 비켜 걷는 정도
        x: 0,
        y: 0,
        dx: 1,
        dy: 0,
      };
      this.place(enemy);
      this.enemies.push(enemy);
      this.emit({ type: 'spawn', id: enemy.id, enemyType: type });
    }
  }

  place(enemy) {
    const p = positionAt(this.map, enemy.dist);
    enemy.x = p.x;
    enemy.y = p.y;
    enemy.dx = p.dx;
    enemy.dy = p.dy;
  }

  /** 둔화를 반영한 지금 이동 속도 */
  currentSpeed(enemy) {
    return enemy.speed * (enemy.slowTime > 0 ? enemy.slowFactor : 1);
  }

  moveEnemies(dt) {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.dist += this.currentSpeed(enemy) * dt;
      enemy.slowTime = Math.max(0, enemy.slowTime - dt);
      if (enemy.slowTime === 0) enemy.slowFactor = 1;
      this.place(enemy);
      if (enemy.dist >= this.map.length) {
        enemy.alive = false;
        this.lives = Math.max(0, this.lives - enemy.damage);
        this.emit({ type: 'leak', id: enemy.id, damage: enemy.damage, lives: this.lives });
        if (this.lives === 0) {
          this.phase = 'lost';
          this.emit({ type: 'lose', wave: this.wave });
          return;
        }
      }
    }
  }

  /** 사거리 안에서 경로를 가장 많이 진행한 적 */
  findTarget(tower) {
    const { range } = towerStats(tower.type, tower.level);
    let best = null;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if (Math.hypot(enemy.x - tower.col, enemy.y - tower.row) > range) continue;
      if (!best || enemy.dist > best.dist) best = enemy;
    }
    return best;
  }

  updateTowers(dt) {
    for (const tower of this.towers) {
      tower.cooldown = Math.max(0, tower.cooldown - dt);
      const target = this.findTarget(tower);
      tower.targetId = target?.id ?? null;
      if (!target || tower.cooldown > 0) continue;
      const stats = towerStats(tower.type, tower.level);
      tower.cooldown = 1 / stats.rate;
      const projectile = {
        id: this.nextId++,
        towerId: tower.id,
        towerType: tower.type,
        targetId: target.id,
        x: tower.col,
        y: tower.row,
        sx: tower.col,
        sy: tower.row,
        tx: target.x,
        ty: target.y,
        speed: TOWERS[tower.type].projectile,
        damage: stats.damage,
        splash: stats.splash ?? 0,
        slow: stats.slow ?? 0,
        slowTime: stats.slowTime ?? 0,
      };
      this.projectiles.push(projectile);
      this.emit({ type: 'fire', towerId: tower.id, projectileId: projectile.id, towerType: tower.type });
    }
  }

  enemy(id) {
    return this.enemies.find((e) => e.id === id && e.alive) ?? null;
  }

  // 유도 발사체: 대상이 살아 있으면 따라가고, 죽었으면 마지막으로 본 자리로 간다
  moveProjectiles(dt) {
    const flying = [];
    for (const p of this.projectiles) {
      const target = this.enemy(p.targetId);
      if (target) {
        p.tx = target.x;
        p.ty = target.y;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const move = p.speed * dt;
      if (d > move) {
        p.x += (dx / d) * move;
        p.y += (dy / d) * move;
        flying.push(p);
        continue;
      }
      p.x = p.tx;
      p.y = p.ty;
      this.impact(p, target);
    }
    this.projectiles = flying;
  }

  impact(p, target) {
    if (p.splash > 0) {
      // 범위 피해는 대상이 이미 죽었어도 착탄 지점에서 터진다
      const hits = this.enemies.filter((e) => e.alive && Math.hypot(e.x - p.x, e.y - p.y) <= p.splash);
      for (const e of hits) this.damage(e, p.damage);
      this.emit({ type: 'hit', projectileId: p.id, towerType: p.towerType, x: p.x, y: p.y, splash: p.splash });
      return;
    }
    if (!target) {
      this.emit({ type: 'miss', projectileId: p.id, towerType: p.towerType, x: p.x, y: p.y });
      return;
    }
    if (p.slow > 0) {
      // 둔화는 겹치지 않고 남은 시간만 갱신한다
      target.slowFactor = p.slow;
      target.slowTime = Math.max(target.slowTime, p.slowTime);
    }
    this.damage(target, p.damage);
    this.emit({ type: 'hit', projectileId: p.id, towerType: p.towerType, x: p.x, y: p.y, targetId: target.id });
  }

  damage(enemy, amount) {
    if (!enemy.alive) return;
    enemy.hp -= amount;
    if (enemy.hp > 0) return;
    enemy.hp = 0;
    enemy.alive = false;
    this.gold += enemy.reward;
    this.emit({ type: 'kill', id: enemy.id, enemyType: enemy.type, reward: enemy.reward, x: enemy.x, y: enemy.y });
  }

  checkWaveEnd() {
    if (this.spawnIndex < this.schedule.length || this.enemies.length > 0) return;
    this.projectiles = [];
    for (const t of this.towers) {
      t.cooldown = 0;
      t.targetId = null;
    }
    const bonus = waveBonus(this.wave);
    this.gold += bonus;
    this.emit({ type: 'waveEnd', wave: this.wave, bonus });
    if (this.wave >= this.waves.length) {
      this.phase = 'won';
      this.emit({ type: 'win', lives: this.lives });
    } else {
      this.phase = 'build';
    }
  }

  emit(event) {
    this.events.push(event);
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  // ---------- 저장 ----------

  /** 저장에 필요한 상태. 전투 중의 적·발사체는 담지 않는다 */
  snapshot() {
    return {
      wave: this.phase === 'combat' ? this.wave - 1 : this.wave,
      gold: this.gold,
      lives: this.lives,
      towers: this.towers.map(({ type, level, col, row, invested }) => ({ type, level, col, row, invested })),
    };
  }

  /** 검증된 스냅샷(save.js 의 validateSave 결과)에서 건설 단계 게임을 만든다 */
  static fromSnapshot(snapshot, options = {}) {
    const game = new DefenseGame({ ...options, gold: snapshot.gold, lives: snapshot.lives });
    game.wave = snapshot.wave;
    for (const t of snapshot.towers) {
      game.towers.push({ id: game.nextId++, ...t, cooldown: 0, targetId: null });
    }
    return game;
  }
}
