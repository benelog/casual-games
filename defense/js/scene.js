// Three.js 타워 디펜스 씬. 게임 상태(game.js)를 읽어 그리기만 하고 규칙은 건드리지 않는다.
// 타일 하나가 1 단위이고 맵 중심이 원점이다. 타일 (col, row) 은 월드 (x, z) 로 놓이고
// 타일 윗면 높이는 GROUND. 모델은 모두 Kenney Tower Defense Kit (assets/CREDITS.md).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const GROUND = 0.2; // 타일 윗면
const TOWER_SCALE = 0.82;
const ENEMY_HOVER = 0.12; // UFO 가 땅에서 떠 있는 높이

// 타워 모양: 레벨마다 쌓는 블록과 꼭대기 무기. 블록 높이는 모델에서 잰다
const TOWER_LOOKS = {
  archer: {
    stacks: [
      ['tower-round-bottom-a'],
      ['tower-round-bottom-a', 'tower-round-middle-a'],
      ['tower-round-bottom-a', 'tower-round-middle-a', 'tower-round-middle-b'],
    ],
    weapon: 'weapon-ballista',
  },
  cannon: {
    stacks: [
      ['tower-square-bottom-a'],
      ['tower-square-bottom-a', 'tower-square-middle-a'],
      ['tower-square-bottom-a', 'tower-square-middle-a', 'tower-square-middle-b'],
    ],
    weapon: 'weapon-cannon',
  },
  frost: {
    stacks: [
      ['tower-round-bottom-c'],
      ['tower-round-bottom-c', 'tower-round-middle-c'],
      ['tower-round-bottom-c', 'tower-round-middle-c', 'tower-round-middle-c'],
    ],
    weapon: 'frost-crystals', // tower-round-crystals 를 얼음색으로 물들인 것
  },
};

const ENEMY_LOOKS = {
  normal: { model: 'enemy-ufo-a', scale: 0.46 },
  fast: { model: 'enemy-ufo-b', scale: 0.4 },
  heavy: { model: 'enemy-ufo-c', scale: 0.56 },
  boss: { model: 'enemy-ufo-d', scale: 0.9 },
};

const BLOCK_MODELS = {
  tree: ['tile-tree', 'tile-tree-double', 'tile-tree-quad'],
  rock: ['tile-rock'],
  crystal: ['tile-crystal'],
  hill: ['tile-hill'],
};

const MODELS = [
  'tile',
  'tile-straight',
  'tile-corner-square',
  'tile-spawn-end',
  'tile-end',
  'tile-tree',
  'tile-tree-double',
  'tile-tree-quad',
  'tile-rock',
  'tile-crystal',
  'tile-hill',
  'spawn-round',
  'selection-a',
  'tower-round-bottom-a',
  'tower-round-bottom-c',
  'tower-round-middle-a',
  'tower-round-middle-b',
  'tower-round-middle-c',
  'tower-square-bottom-a',
  'tower-square-bottom-b',
  'tower-square-middle-a',
  'tower-square-middle-b',
  'tower-square-roof-a',
  'tower-round-crystals',
  'weapon-ballista',
  'weapon-cannon',
  'weapon-ammo-arrow',
  'weapon-ammo-cannonball',
  'enemy-ufo-a',
  'enemy-ufo-b',
  'enemy-ufo-c',
  'enemy-ufo-d',
  'detail-tree',
  'detail-tree-large',
  'detail-rocks',
];

// 경로 타일 모델이 열려 있는 방향 (모델 좌표 x, z). 모델 정점 색으로 확인했다
const OPEN_SIDES = {
  'tile-straight': [
    [0, 1],
    [0, -1],
  ],
  'tile-corner-square': [
    [1, 0],
    [0, 1],
  ],
  'tile-end': [[0, 1]],
  'tile-spawn-end': [[0, 1]],
};

/** y 축 회전 θ 를 적용한 방향. three.js 의 rotation.y 와 같은 방향이다 */
function rotateSide([x, z], theta) {
  const c = Math.round(Math.cos(theta));
  const s = Math.round(Math.sin(theta));
  return [x * c + z * s, -x * s + z * c];
}

/** 모델의 열린 쪽이 sides 와 맞도록 돌리는 각도 */
function fitRotation(model, sides) {
  const key = (list) =>
    list
      .map((d) => d.join(','))
      .sort()
      .join(';');
  const want = key(sides);
  for (let k = 0; k < 4; k++) {
    const theta = (k * Math.PI) / 2;
    if (key(OPEN_SIDES[model].map((d) => rotateSide(d, theta))) === want) return theta;
  }
  throw new Error(`${model} 을 ${want} 방향으로 돌릴 수 없습니다`);
}

const hash = (col, row) => ((col * 73856093) ^ (row * 19349663)) >>> 0;
const easeOut = (k) => 1 - (1 - k) * (1 - k);

export class DefenseScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels';
    container.appendChild(this.labelLayer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d2b33);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

    this.templates = {};
    this.towerViews = new Map(); // tower.id → { group, weapon, level, yaw }
    this.enemyViews = new Map(); // enemy.id → { group, model, bar, slowRing }
    this.projectileViews = new Map();
    this.effects = new Set();
    this.dying = new Set();
    this.time = 0;
    this.insets = { top: 60, bottom: 150, right: 0 }; // HUD 가 가리는 화면 가장자리 픽셀

    // 입력: 클릭(터치는 손을 뗄 때)한 타일과 마우스가 올라간 타일을 알린다
    this.onTileClick = null; // ({col, row}) => void
    this.onHover = null; // ({col, row} | null) => void
    this.onFrame = null; // (dt) => boolean, 프레임마다 그리기 전에 불린다. 전투가 진행 중이면 true 를 돌려준다
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND);
    const canvas = this.renderer.domElement;
    let down = null;
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 12) return;
      const tile = this.pickTile(e);
      if (e.pointerType !== 'mouse') this.onHover?.(tile);
      this.onTileClick?.(tile);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.onHover?.(this.pickTile(e));
    });
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.onHover?.(null);
    });

    new ResizeObserver(() => this.resize()).observe(container);
  }

  async load(map) {
    this.map = map;
    this.offset = { x: (map.cols - 1) / 2, z: (map.rows - 1) / 2 };
    const loader = new GLTFLoader();
    const gltfs = await Promise.all(MODELS.map((name) => loader.loadAsync(asset(`models/${name}.glb`))));
    MODELS.forEach((name, i) => {
      const root = gltfs[i].scene;
      root.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      this.templates[name] = root;
    });
    // 빙결탑 꼭대기: 분홍 수정을 얼음색으로 물들인다
    const crystals = this.templates['tower-round-crystals'].clone();
    crystals.traverse((o) => {
      if (o.isMesh && /crystal/.test(o.name + (o.parent?.name ?? ''))) {
        o.material = o.material.clone();
        o.material.map = null;
        o.material.color.set(0x8fdcff);
        o.material.emissive = new THREE.Color(0x1d6a99);
      }
    });
    this.templates['frost-crystals'] = crystals;
    this.heights = {};
    for (const name of MODELS) {
      this.heights[name] = new THREE.Box3().setFromObject(this.templates[name]).max.y;
    }

    this.buildLights();
    this.buildBoard();
    this.buildMarkers();
    this.resize();
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  model(name) {
    return this.templates[name].clone();
  }

  /** 타일 좌표 → 월드 좌표 */
  world(x, y, height = GROUND) {
    return new THREE.Vector3(x - this.offset.x, height, y - this.offset.z);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x4a5a3a, 1.7));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.3);
    sun.position.set(-5, 12, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -10;
    s.right = 10;
    s.top = 9;
    s.bottom = -9;
    s.near = 1;
    s.far = 40;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
  }

  buildBoard() {
    const { map } = this;
    const board = new THREE.Group();
    const place = (object, col, row, rotation = 0) => {
      object.position.copy(this.world(col, row, 0));
      object.rotation.y = rotation;
      board.add(object);
      return object;
    };

    // 경로 타일: 앞뒤 칸의 방향을 보고 직선·모퉁이·끝 모델을 고른다
    const cells = map.cells;
    cells.forEach((cell, i) => {
      const sides = [];
      for (const other of [cells[i - 1], cells[i + 1]]) {
        if (other) sides.push([other.col - cell.col, other.row - cell.row]);
      }
      let name;
      if (i === 0) name = 'tile-spawn-end';
      else if (i === cells.length - 1) name = 'tile-end';
      else if (sides[0][0] === -sides[1][0] && sides[0][1] === -sides[1][1]) name = 'tile-straight';
      else name = 'tile-corner-square';
      place(this.model(name), cell.col, cell.row, fitRotation(name, sides));
    });

    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        const type = map.tiles[row][col];
        if (type === 'build') place(this.model('tile'), col, row);
        if (type === 'block') {
          const options = BLOCK_MODELS[map.decor[row][col]];
          const h = hash(col, row);
          place(this.model(options[h % options.length]), col, row, ((h >> 4) % 4) * (Math.PI / 2));
        }
      }
    }

    // 스폰 구멍 위의 포털과 기지(성)
    const portal = place(this.model('spawn-round'), map.spawn.col, map.spawn.row);
    portal.position.y = GROUND - 0.02;
    portal.scale.setScalar(0.9);
    const castle = new THREE.Group();
    let y = GROUND;
    for (const name of ['tower-square-bottom-b', 'tower-square-middle-a', 'tower-square-roof-a']) {
      const part = this.model(name);
      part.position.y = y;
      y += this.heights[name];
      castle.add(part);
    }
    castle.scale.setScalar(0.8);
    this.base = place(castle, map.base.col, map.base.row);

    // 맵 둘레의 바닥과 나무 몇 그루: 판이 허공에 떠 보이지 않게 한다
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3f6b4a, roughness: 1 }),
    );
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    board.add(ground);
    const decor = ['detail-tree', 'detail-tree-large', 'detail-rocks', 'detail-tree'];
    const hx = map.cols / 2;
    const hz = map.rows / 2;
    const perimeter = 4 * (hx + hz);
    for (let i = 0; i < 52; i++) {
      const h = hash(i * 7 + 3, i * 13 + 5);
      // 판 테두리를 따라 돌며 바깥쪽으로 조금씩 흩어 놓는다
      let t = ((i + ((h % 100) / 100) * 0.8) / 52) * perimeter;
      const out = 0.7 + ((h >> 7) % 100) / 40;
      let x;
      let z;
      if (t < 2 * hx) [x, z] = [-hx + t, -hz - out];
      else if ((t -= 2 * hx) < 2 * hz) [x, z] = [hx + out, -hz + t];
      else if ((t -= 2 * hz) < 2 * hx) [x, z] = [hx - t, hz + out];
      else [x, z] = [-hx - out, hz - (t - 2 * hx)];
      const item = this.model(decor[h % decor.length]);
      item.position.set(x, 0, z);
      item.rotation.y = (h % 628) / 100;
      item.scale.setScalar(1 + ((h >> 5) % 10) / 16);
      board.add(item);
    }

    this.scene.add(board);
    this.board = board;
  }

  buildMarkers() {
    // 마우스가 올라간 타일
    this.hoverMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.hoverMarker.visible = false;
    this.scene.add(this.hoverMarker);

    // 선택한 타일: Kenney 선택 표시 모델
    this.selectMarker = this.model('selection-a');
    this.selectMarker.visible = false;
    this.scene.add(this.selectMarker);

    // 사거리 원
    this.rangeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    this.rangeEdgeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    this.range = new THREE.Group();
    this.range.add(
      new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), this.rangeMaterial),
      new THREE.Mesh(new THREE.RingGeometry(0.975, 1, 64).rotateX(-Math.PI / 2), this.rangeEdgeMaterial),
    );
    this.range.renderOrder = 5;
    this.range.visible = false;
    this.scene.add(this.range);

    // 체력바, 둔화 표시, 발사체·효과용 공용 재료
    this.barGeometry = new THREE.PlaneGeometry(1, 1);
    this.barBack = new THREE.SpriteMaterial({ color: 0x111111, depthTest: false, transparent: true, opacity: 0.8 });
    this.barFill = new THREE.SpriteMaterial({ color: 0x5fd35f, depthTest: false });
    this.barFillLow = new THREE.SpriteMaterial({ color: 0xf0b030, depthTest: false });
    this.slowRingGeometry = new THREE.RingGeometry(0.28, 0.4, 32).rotateX(-Math.PI / 2);
    this.slowRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x8fd3ff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.frostBall = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 1),
      new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x3aa0e0, emissiveIntensity: 0.8, roughness: 0.3 }),
    );
    this.blastGeometry = new THREE.SphereGeometry(1, 20, 12);
    this.burstGeometry = new THREE.RingGeometry(0.6, 1, 32).rotateX(-Math.PI / 2);
  }

  // ---------- 화면 맞춤 ----------

  setInsets(insets) {
    this.insets = insets;
    this.resize();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h || !this.map) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitCamera(w, h);
  }

  /**
   * 고정된 비스듬한 시점에서 맵 전체가 HUD 를 피해 화면에 들어오도록 거리와 중심을 맞춘다.
   * 세로 화면이면 맵의 긴 쪽(가로)이 화면 세로가 되도록 옆에서 본다.
   */
  fitCamera(w, h) {
    const portrait = h > w * 1.05;
    const elevation = THREE.MathUtils.degToRad(portrait ? 58 : 54);
    const dir = portrait
      ? new THREE.Vector3(Math.cos(elevation), Math.sin(elevation), 0)
      : new THREE.Vector3(0, Math.sin(elevation), Math.cos(elevation));
    const hx = this.map.cols / 2 + 0.1;
    const hz = this.map.rows / 2 + 0.1;
    const corners = [];
    for (const x of [-hx, hx]) for (const z of [-hz, hz]) for (const y of [0, 1.3]) corners.push(new THREE.Vector3(x, y, z));

    const margin = 10;
    const area = {
      left: margin,
      right: w - margin - (this.insets.right ?? 0),
      top: this.insets.top + margin,
      bottom: h - this.insets.bottom - margin,
    };
    const availW = area.right - area.left;
    const availH = Math.max(80, area.bottom - area.top);
    const target = new THREE.Vector3();
    const p = new THREE.Vector3();
    const bounds = (distance) => {
      this.camera.position.copy(target).addScaledVector(dir, distance);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const c of corners) {
        p.copy(c).project(this.camera);
        const sx = ((p.x + 1) / 2) * w;
        const sy = ((1 - p.y) / 2) * h;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
      return { minX, maxX, minY, maxY };
    };
    let distance = 20;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 3;
      let hi = 120;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const b = bounds(mid);
        if (b.maxX - b.minX <= availW && b.maxY - b.minY <= availH) hi = mid;
        else lo = mid;
      }
      distance = hi;
      // 투영된 맵의 중심을 남은 영역의 중심으로 옮긴다
      const b = bounds(distance);
      const dx = (area.left + area.right) / 2 - (b.minX + b.maxX) / 2;
      // 세로 여유가 남으면 위쪽에 붙여 아래 패널이 맵을 덜 가리게 한다
      const dy = area.top + (b.maxY - b.minY) / 2 - (b.minY + b.maxY) / 2;
      const perPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      // 화면 위쪽 이동은 땅 위에서 카메라에서 멀어지는 쪽이다
      const forward = new THREE.Vector3(up.x, 0, up.z).normalize().multiplyScalar(1 / Math.sin(elevation));
      target.addScaledVector(right, -dx * perPixel).addScaledVector(forward, dy * perPixel);
    }
    bounds(distance);
  }

  pickTile(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    if (!hit) return null;
    const col = Math.round(hit.x + this.offset.x);
    const row = Math.round(hit.z + this.offset.z);
    if (col < 0 || row < 0 || col >= this.map.cols || row >= this.map.rows) return null;
    return { col, row };
  }

  // ---------- 표시 ----------

  /** 마우스가 올라간 타일 강조. ok=false 면 붉게 */
  setHover(tile, ok = true) {
    this.hoverMarker.visible = !!tile;
    if (!tile) return;
    this.hoverMarker.position.copy(this.world(tile.col, tile.row, GROUND + 0.012));
    this.hoverMarker.material.color.set(ok ? 0xffffff : 0xff5a4a);
  }

  setSelection(tile) {
    this.selectMarker.visible = !!tile;
    if (tile) this.selectMarker.position.copy(this.world(tile.col, tile.row, GROUND));
  }

  /** 사거리 원. range: { col, row, radius, ok } 또는 null */
  setRange(range) {
    this.range.visible = !!range;
    if (!range) return;
    this.range.position.copy(this.world(range.col, range.row, GROUND + 0.02));
    this.range.scale.set(range.radius, 1, range.radius);
    const color = range.ok === false ? 0xff6a5a : 0xffffff;
    this.rangeMaterial.color.set(color);
    this.rangeEdgeMaterial.color.set(color);
  }

  // ---------- 상태 동기화 ----------

  /** 매 프레임 게임 상태를 읽어 타워·적·발사체를 맞춘다 */
  sync(game) {
    this.syncTowers(game);
    this.syncEnemies(game);
    this.syncProjectiles(game);
  }

  makeTower(type, level) {
    const look = TOWER_LOOKS[type];
    const group = new THREE.Group();
    let y = GROUND;
    for (const name of look.stacks[level - 1]) {
      const part = this.model(name);
      part.position.y = y / TOWER_SCALE;
      y += this.heights[name] * TOWER_SCALE;
      group.add(part);
    }
    const weapon = this.model(look.weapon);
    weapon.position.y = y / TOWER_SCALE + (type === 'frost' ? 0.36 : 0.08);
    group.add(weapon);
    group.scale.setScalar(TOWER_SCALE);
    group.userData.top = y + 0.25; // 발사체가 나오는 높이
    return { group, weapon };
  }

  syncTowers(game) {
    const alive = new Set();
    for (const tower of game.towers) {
      alive.add(tower.id);
      let view = this.towerViews.get(tower.id);
      if (view && view.level !== tower.level) {
        this.scene.remove(view.group);
        view = null;
      }
      if (!view) {
        const { group, weapon } = this.makeTower(tower.type, tower.level);
        group.position.copy(this.world(tower.col, tower.row, 0));
        this.scene.add(group);
        const yaw = this.towerViews.get(tower.id)?.yaw ?? 0;
        view = { group, weapon, level: tower.level, yaw, kick: 0 };
        this.towerViews.set(tower.id, view);
        this.pop(group, TOWER_SCALE);
      }
      // 무기는 지금 노리는 적을 향해 천천히 돈다 (모델의 앞은 +z)
      const target = tower.targetId ? game.enemy(tower.targetId) : null;
      if (target && tower.type !== 'frost') {
        const want = Math.atan2(target.x - tower.col, target.y - tower.row);
        let diff = want - view.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        view.yaw += diff * Math.min(1, this.dt * 12);
      }
      if (tower.type === 'frost') view.yaw += this.dt * 0.8;
      view.weapon.rotation.y = view.yaw;
      view.kick = Math.max(0, view.kick - this.dt * 6);
      view.weapon.position.x = -Math.sin(view.yaw) * view.kick * 0.12;
      view.weapon.position.z = -Math.cos(view.yaw) * view.kick * 0.12;
    }
    for (const [id, view] of this.towerViews) {
      if (alive.has(id)) continue;
      this.scene.remove(view.group);
      this.towerViews.delete(id);
    }
  }

  towerTop(id) {
    return this.towerViews.get(id)?.group.userData.top ?? 1;
  }

  makeEnemy(type) {
    const look = ENEMY_LOOKS[type];
    const group = new THREE.Group();
    const model = this.model(look.model);
    model.scale.setScalar(look.scale);
    group.add(model);
    const slowRing = new THREE.Mesh(this.slowRingGeometry, this.slowRingMaterial);
    slowRing.scale.setScalar(look.scale * 2);
    slowRing.position.y = 0.02 - ENEMY_HOVER;
    slowRing.visible = false;
    group.add(slowRing);
    const width = type === 'boss' ? 0.9 : 0.5;
    const back = new THREE.Sprite(this.barBack);
    const fill = new THREE.Sprite(this.barFill);
    for (const s of [back, fill]) {
      s.position.y = look.scale * 1.45 + 0.12;
      s.renderOrder = 20;
    }
    back.scale.set(width + 0.04, 0.09, 1);
    fill.scale.set(width, 0.06, 1);
    back.visible = fill.visible = false;
    group.add(back, fill);
    return { group, model, slowRing, back, fill, width, spin: 0 };
  }

  syncEnemies(game) {
    const alive = new Set();
    for (const enemy of game.enemies) {
      if (!enemy.alive) continue;
      alive.add(enemy.id);
      let view = this.enemyViews.get(enemy.id);
      if (!view) {
        view = this.makeEnemy(enemy.type);
        this.scene.add(view.group);
        this.enemyViews.set(enemy.id, view);
      }
      // 진행 방향의 왼쪽(경로 기준)으로 lane 만큼 비켜 간다
      const x = enemy.x - enemy.dy * enemy.lane;
      const y = enemy.y + enemy.dx * enemy.lane;
      const bob = Math.sin(this.time * 3 + enemy.id) * 0.03;
      view.group.position.copy(this.world(x, y, GROUND + ENEMY_HOVER + bob));
      const slowed = enemy.slowTime > 0;
      view.spin += this.dt * (slowed ? 1.2 : 2.5);
      view.model.rotation.y = view.spin;
      view.slowRing.visible = slowed;
      const ratio = enemy.hp / enemy.maxHp;
      const show = ratio < 1;
      view.back.visible = view.fill.visible = show;
      if (show) {
        // 스프라이트는 화면 공간에서 center 를 기준으로 늘어나므로 왼쪽 끝을 맞춘다
        view.fill.scale.x = Math.max(0.001, view.width * ratio);
        view.fill.center.set(0.5 / Math.max(ratio, 0.002), 0.5);
        view.fill.material = ratio < 0.35 ? this.barFillLow : this.barFill;
      }
    }
    for (const [id, view] of this.enemyViews) {
      if (alive.has(id)) continue;
      this.enemyViews.delete(id);
      // 처치된 적은 잠깐 줄어들며 사라진다 (누수는 effect 에서 바로 지운다)
      view.back.visible = view.fill.visible = view.slowRing.visible = false;
      if (view.leaked) {
        this.scene.remove(view.group);
        continue;
      }
      const start = view.group.scale.x;
      this.animate(0.3, (k) => {
        view.group.scale.setScalar(start * (1 - easeOut(k)));
        view.group.position.y += this.dt * 1.5;
        if (k === 1) this.scene.remove(view.group);
      });
    }
  }

  makeProjectile(type) {
    if (type === 'archer') {
      const arrow = this.model('weapon-ammo-arrow');
      arrow.scale.setScalar(0.55);
      return arrow;
    }
    if (type === 'cannon') {
      const ball = this.model('weapon-ammo-cannonball');
      ball.scale.setScalar(0.7);
      return ball;
    }
    return this.frostBall.clone();
  }

  syncProjectiles(game) {
    const alive = new Set();
    for (const p of game.projectiles) {
      alive.add(p.id);
      let view = this.projectileViews.get(p.id);
      if (!view) {
        view = { object: this.makeProjectile(p.towerType), startH: this.towerTop(p.towerId) };
        this.scene.add(view.object);
        this.projectileViews.set(p.id, view);
      }
      // 높이: 탑 꼭대기에서 적의 높이로, 대포알은 포물선을 그린다
      const done = Math.hypot(p.x - p.sx, p.y - p.sy);
      const left = Math.hypot(p.tx - p.x, p.ty - p.y);
      const k = done + left > 0 ? done / (done + left) : 1;
      const endH = GROUND + ENEMY_HOVER + 0.15;
      const arc = p.towerType === 'cannon' ? Math.sin(Math.PI * k) * 0.9 : 0;
      const pos = this.world(p.x, p.y, view.startH + (endH - view.startH) * k + arc);
      if (view.last) {
        const dir = pos.clone().sub(view.last);
        if (dir.lengthSq() > 1e-8) view.object.lookAt(pos.clone().add(dir));
      }
      view.object.position.copy(pos);
      view.last = pos;
    }
    for (const [id, view] of this.projectileViews) {
      if (alive.has(id)) continue;
      this.scene.remove(view.object);
      this.projectileViews.delete(id);
    }
  }

  // ---------- 효과 ----------

  /** game.drainEvents() 의 사건 하나에 맞는 효과를 낸다 */
  effect(event) {
    switch (event.type) {
      case 'fire': {
        const view = this.towerViews.get(event.towerId);
        if (view) view.kick = 1;
        break;
      }
      case 'hit':
        if (event.towerType === 'cannon') this.blast(event.x, event.y, event.splash);
        if (event.towerType === 'frost') this.burst(event.x, event.y, 0x9fdcff, 0.45);
        break;
      case 'kill':
        this.popLabel(this.world(event.x, event.y, GROUND + 0.6), `+${event.reward}`, 'gold');
        break;
      case 'leak': {
        const view = this.enemyViews.get(event.id);
        if (view) view.leaked = true;
        const { col, row } = this.map.base;
        this.popLabel(this.world(col, row, 1.4), `-${event.damage}`, 'leak');
        this.burst(col, row, 0xff5a4a, 0.8);
        break;
      }
      default:
    }
  }

  blast(x, y, radius) {
    const mesh = new THREE.Mesh(
      this.blastGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    mesh.position.copy(this.world(x, y, GROUND + 0.1));
    this.scene.add(mesh);
    this.animate(0.35, (k) => {
      const r = radius * (0.3 + 0.7 * easeOut(k));
      mesh.scale.set(r, r * 0.45, r);
      mesh.material.opacity = 0.55 * (1 - k);
      if (k === 1) {
        this.scene.remove(mesh);
        mesh.material.dispose();
      }
    });
  }

  burst(x, y, color, radius) {
    const mesh = new THREE.Mesh(
      this.burstGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.position.copy(this.world(x, y, GROUND + 0.05));
    this.scene.add(mesh);
    this.animate(0.4, (k) => {
      mesh.scale.setScalar(radius * (0.3 + 0.7 * easeOut(k)));
      mesh.material.opacity = 0.8 * (1 - k);
      if (k === 1) {
        this.scene.remove(mesh);
        mesh.material.dispose();
      }
    });
  }

  /** 새로 짓거나 업그레이드한 타워가 톡 튀어나온다 */
  pop(object, scale) {
    this.animate(0.25, (k) => {
      const s = scale * (0.6 + 0.4 * easeOut(k) + Math.sin(Math.PI * k) * 0.12);
      object.scale.setScalar(s);
    });
  }

  /** 기지가 위협받을 때 살짝 흔든다 */
  shakeBase() {
    const start = this.base.position.clone();
    this.animate(0.3, (k) => {
      this.base.position.x = start.x + Math.sin(k * 40) * 0.05 * (1 - k);
      if (k === 1) this.base.position.copy(start);
    });
  }

  animate(duration, update) {
    this.effects.add({ elapsed: 0, duration, update });
  }

  popLabel(position, text, className) {
    const el = document.createElement('div');
    el.className = `label ${className}`;
    el.textContent = text;
    const p = position.clone().project(this.camera);
    el.style.left = `${((p.x + 1) / 2) * this.container.clientWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * this.container.clientHeight}px`;
    this.labelLayer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.dt = dt;
    this.time += dt;
    const lively = !!this.onFrame?.(dt) || this.effects.size > 0;
    for (const e of this.effects) {
      e.elapsed += dt;
      const k = Math.min(1, e.elapsed / e.duration);
      e.update(k);
      if (k === 1) this.effects.delete(e);
    }
    if (this.selectMarker.visible) {
      const s = 1 + Math.sin(this.time * 5) * 0.04;
      this.selectMarker.scale.set(s, 1, s);
    }
    if (this.loop.due(now, lively)) this.renderer.render(this.scene, this.camera);
  }
}
