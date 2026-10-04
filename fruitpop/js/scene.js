// Three.js 과일 팡팡 씬. 게임 상태(game.js)를 읽어 그리기만 하고 규칙은 건드리지 않는다.
// 판마다 BoardView 가 하나씩 있고, 판 좌표 (x, y) 의 칸 가운데는 그룹 안에서 (x + 0.5, y + 0.5, 0) 이다.
// 과일·코코넛 모델은 Kenney Food Kit (assets/CREDITS.md).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import {
  WIDTH,
  VISIBLE,
  HEIGHT,
  SPAWN_X,
  EMPTY,
  GARBAGE,
  POP_TIME,
  FALL_SPEED,
  FALL_ACCEL,
  at,
  columnHeight,
  pairCells,
} from './game.js';
import { damp } from '../../shared/util.js';

const asset = (path) => new URL(`../assets/${path}`, import.meta.url).href;

// 칸 값 → 모델. tilt 는 정면에서 모양이 잘 보이게 앞으로 기울이는 각도
const MODELS = {
  1: { file: 'apple', size: 0.8, tilt: 0.3 },
  2: { file: 'lemon', size: 0.74, tilt: 0.3 },
  3: { file: 'pear', size: 0.84, tilt: 0.2 },
  4: { file: 'grapes', size: 0.84, tilt: 0.15 },
  5: { file: 'donut-sprinkles', size: 0.8, tilt: 1.15 },
  [GARBAGE]: { file: 'coconut', size: 0.72, tilt: 0.3 },
};

/** 과일 뒤 받침과 효과에 쓰는 색 (HUD 에서도 쓴다) */
export const COLORS = {
  1: '#e2503f',
  2: '#e8b92c',
  3: '#35b074',
  4: '#8d5fd6',
  5: '#ee7fb2',
  [GARBAGE]: '#7c6a5a',
};

const TRAY_Y = VISIBLE + 1.65; // 받을 코코넛을 보여 주는 자리 (숨은 줄에 있는 짝과 겹치지 않게 띄운다)
const TRAY_SLOTS = 6;
const TRAY_UNITS = [
  { amount: 30, scale: 0.95, color: '#e2503f' },
  { amount: 6, scale: 0.7, color: '#e8a02c' },
  { amount: 1, scale: 0.42, color: '#7c6a5a' },
];
const MAX_PARTICLES = 500;
const POP_BURST = 0.3; // 터지기 시작한 뒤 이만큼 지나 흩어진다
const FOCUS_SCALE = 0.5; // 좁은 화면에서 상대 판을 줄이는 배율

const WHITE = new THREE.Color('#ffffff');

/** 판 하나의 그림 */
class BoardView {
  constructor(stage, index) {
    this.stage = stage;
    this.index = index;
    this.group = new THREE.Group();
    this.base = new THREE.Vector3(); // 흔들림을 뺀 자리
    this.board = null;
    this.pools = {};
    this.used = {};
    this.offset = new Float32Array(WIDTH * HEIGHT); // 칸마다 아직 덜 떨어진 높이
    this.speed = new Float32Array(WIDTH * HEIGHT);
    this.squash = new Float32Array(WIDTH * HEIGHT); // 막 내려앉아 눌린 정도 (1 → 0)
    this.pairId = null;
    this.pairPosition = new THREE.Vector2();
    this.pairAngle = 0;
    this.pop = null; // { age, cells, burst }
    this.shake = 0;
    this.shakeDelay = 0;
    this.pendingShake = 0;
    this.result = null; // 끝난 뒤 'win' | 'lose'
    this.resultAge = 0;
    this.trayBump = 0;
    this.nextKey = '';
    this.build();
  }

  build() {
    const { stage, group } = this;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, VISIBLE),
      new THREE.MeshBasicMaterial({ color: 0x121724, transparent: true, opacity: 0.86 }),
    );
    panel.position.set(WIDTH / 2, VISIBLE / 2, -0.5);
    panel.renderOrder = -1; // 투명한 것들(떨어질 자리 표시 등)보다 먼저 그린다
    this.panel = panel;
    group.add(panel);

    const lines = [];
    for (let x = 1; x < WIDTH; x++) lines.push(x, 0, -0.49, x, VISIBLE, -0.49);
    for (let y = 1; y < VISIBLE; y++) lines.push(0, y, -0.49, WIDTH, y, -0.49);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    group.add(
      new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x8aa0c0, transparent: true, opacity: 0.12 })),
    );

    // 테두리. 위험해지면 붉게 깜빡인다
    this.frameMaterial = new THREE.MeshStandardMaterial({ color: 0xd9b46a, roughness: 0.45, metalness: 0.3 });
    const t = 0.16;
    for (const [w, h, x, y] of [
      [WIDTH + t * 2, t, WIDTH / 2, -t / 2],
      [t, VISIBLE + t, -t / 2, VISIBLE / 2 - t / 2],
      [t, VISIBLE + t, WIDTH + t / 2, VISIBLE / 2 - t / 2],
    ]) {
      const bar = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.26, 2, 0.06), this.frameMaterial);
      bar.position.set(x, y, -0.3);
      group.add(bar);
    }

    // 짝이 나오는 칸: 여기가 막히면 진다
    const crossMaterial = new THREE.MeshBasicMaterial({ color: 0xef6b5b, transparent: true, opacity: 0.55 });
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.1), crossMaterial);
      bar.position.set(SPAWN_X + 0.5, VISIBLE - 0.5, -0.48);
      bar.rotation.z = angle;
      group.add(bar);
    }

    this.cells = new THREE.Group();
    group.add(this.cells);

    const capacity = WIDTH * HEIGHT + 2;
    this.pads = new THREE.InstancedMesh(
      new RoundedBoxGeometry(0.94, 0.94, 0.1, 2, 0.05),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 }),
      capacity,
    );
    this.links = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.62, 0.1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 }),
      capacity * 2,
    );
    this.ghosts = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.2, 0.32, 20),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
      2,
    );
    this.ghosts.renderOrder = 1;
    for (const mesh of [this.pads, this.links, this.ghosts]) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    // 받을 코코넛
    this.tray = new THREE.Group();
    this.tray.position.set(0, TRAY_Y, 0);
    this.trayItems = [];
    for (let i = 0; i < TRAY_SLOTS; i++) {
      const item = new THREE.Group();
      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(0.46, 20),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85 }),
      );
      pad.position.z = -0.35;
      const fruit = stage.makeFruit(GARBAGE);
      item.add(pad, fruit);
      item.position.set(i + 0.5, 0, 0);
      item.visible = false;
      this.tray.add(item);
      this.trayItems.push({ item, pad, fruit });
    }
    group.add(this.tray);

    // 다음, 그다음 짝
    this.next = new THREE.Group();
    const nextPanel = new THREE.Mesh(
      new RoundedBoxGeometry(1.3, 3.9, 0.1, 2, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x121724, transparent: true, opacity: 0.86 }),
    );
    nextPanel.position.set(0, -1.95, -0.5);
    this.next.add(nextPanel);
    this.nextFruits = new THREE.Group();
    this.next.add(this.nextFruits);
    group.add(this.next);
  }

  setBoard(board) {
    this.board = board;
    this.offset.fill(0);
    this.speed.fill(0);
    this.squash.fill(0);
    this.pairId = null;
    this.pop = null;
    this.shake = 0;
    this.pendingShake = 0;
    this.result = null;
    this.nextKey = '';
  }

  /** 판 좌표(칸 단위)를 월드 좌표로 */
  toWorld(x, y, out = new THREE.Vector3()) {
    return out.set(x, y, 0).multiplyScalar(this.group.scale.x).add(this.base);
  }

  take(kind) {
    const pool = (this.pools[kind] ??= []);
    const n = (this.used[kind] = (this.used[kind] ?? 0) + 1);
    if (pool.length < n) {
      const fruit = this.stage.makeFruit(kind);
      this.cells.add(fruit);
      pool.push(fruit);
    }
    const fruit = pool[n - 1];
    fruit.visible = true;
    return fruit;
  }

  startFall(cells) {
    for (const cell of cells) {
      if (cell.y === null || cell.from === cell.y) continue;
      const index = at(cell.x, cell.y);
      this.offset[index] = cell.from - cell.y;
      this.speed[index] = FALL_SPEED;
      this.squash[index] = 0;
    }
  }

  handle(event) {
    switch (event.type) {
      case 'lock':
        this.startFall(event.cells);
        for (const cell of event.cells) {
          if (cell.y !== null && cell.from === cell.y) this.squash[at(cell.x, cell.y)] = 1;
        }
        break;
      case 'land':
        this.startFall(event.cells);
        break;
      case 'garbage':
        this.startFall(event.cells);
        this.pendingShake = Math.min(0.35, 0.08 + event.amount * 0.012);
        this.shakeDelay = 0.3;
        break;
      case 'pop':
        this.pop = { age: 0, burst: false, cells: [...event.cells, ...event.garbage.map((c) => ({ ...c, color: GARBAGE }))] };
        break;
    }
  }

  setResult(result) {
    this.result = result;
    this.resultAge = 0;
  }

  update(dt, time) {
    const board = this.board;
    if (!board) return;
    const stage = this.stage;
    const matrix = stage.matrix;
    const color = stage.color;
    this.used = {};
    let pads = 0;
    let links = 0;

    if (this.pop) {
      this.pop.age += dt;
      if (!this.pop.burst && this.pop.age >= POP_BURST) {
        this.pop.burst = true;
        for (const cell of this.pop.cells) stage.burst(this.toWorld(cell.x + 0.5, cell.y + 0.5), COLORS[cell.color], this.group.scale.x);
      }
      if (this.pop.age >= POP_TIME + 0.1) this.pop = null;
    }
    const popping = board.popping.length ? new Set(board.popping) : null;
    const popK = this.pop ? Math.min(1, this.pop.age / POP_TIME) : 0;
    if (this.result) this.resultAge += dt;

    const addPad = (x, y, kind, flash = 0, scale = 1) => {
      matrix.makeScale(scale, scale, 1).setPosition(x, y, -0.36);
      this.pads.setMatrixAt(pads, matrix);
      color.set(COLORS[kind]).multiplyScalar(0.62).lerp(WHITE, flash);
      this.pads.setColorAt(pads, color);
      pads++;
    };

    const grid = board.grid;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const index = at(x, y);
        const kind = grid[index];
        if (kind === EMPTY) continue;
        // 떨어지는 중
        if (this.offset[index] > 0) {
          this.speed[index] += FALL_ACCEL * dt;
          this.offset[index] -= this.speed[index] * dt;
          if (this.offset[index] <= 0) {
            this.offset[index] = 0;
            this.squash[index] = 1;
          }
        } else if (this.squash[index] > 0) {
          this.squash[index] = Math.max(0, this.squash[index] - dt / 0.22);
        }
        if (y >= VISIBLE && this.offset[index] === 0) continue; // 숨은 줄
        let px = x + 0.5;
        let py = y + 0.5 + this.offset[index];
        let scale = 1;
        let flash = 0;
        let spin = 0;
        if (popping?.has(index)) {
          // 깜빡이며 부풀다가 사라진다
          const k = popK;
          flash = k < 0.6 ? (Math.sin(k * 40) > 0 ? 0.75 : 0.15) : 1 - k;
          scale = k < 0.6 ? 1 + 0.18 * Math.sin((k / 0.6) * Math.PI) : Math.max(0, 1 - (k - 0.6) / 0.3);
          spin = k * 3;
        }
        if (this.result === 'lose') {
          const t = Math.max(0, this.resultAge - x * 0.06 - 0.25);
          py -= 22 * t * t;
          spin = t * 4;
          if (py < -3) continue;
        } else if (this.result === 'win') {
          py += Math.abs(Math.sin(this.resultAge * 5 + x * 0.9)) * 0.22;
        }
        const fruit = this.take(kind);
        const s = Math.sin(this.squash[index] * Math.PI) * 0.2;
        fruit.position.set(px, py - s * 0.35, 0);
        fruit.scale.set(scale * (1 + s * 0.7), scale * (1 - s), scale * (1 + s * 0.7));
        fruit.userData.inner.rotation.y = Math.sin(time * 1.6 + x * 1.7 + y * 0.9) * 0.35 + spin;
        if (scale > 0.05 && this.result !== 'lose') addPad(px, py, kind, flash, Math.min(1, scale));

        // 같은 과일끼리 붙은 곳은 받침을 이어 묶음이 한눈에 보이게 한다
        if (kind === GARBAGE || this.offset[index] > 0 || this.result || y >= VISIBLE || popping?.has(index)) continue;
        if (x < WIDTH - 1 && grid[index + 1] === kind && this.offset[index + 1] === 0 && !popping?.has(index + 1)) {
          matrix.makeRotationZ(Math.PI / 2).setPosition(x + 1, y + 0.5, -0.36);
          this.links.setMatrixAt(links, matrix);
          this.links.setColorAt(links, color.set(COLORS[kind]).multiplyScalar(0.62));
          links++;
        }
        if (y < VISIBLE - 1 && grid[index + WIDTH] === kind && this.offset[index + WIDTH] === 0 && !popping?.has(index + WIDTH)) {
          matrix.makeRotationZ(0).setPosition(x + 0.5, y + 1, -0.36);
          this.links.setMatrixAt(links, matrix);
          this.links.setColorAt(links, color.set(COLORS[kind]).multiplyScalar(0.62));
          links++;
        }
      }
    }

    // 조작 중인 짝과 떨어질 자리
    let ghosts = 0;
    const pair = board.pair;
    if (pair) {
      if (this.pairId !== pair.id) {
        this.pairId = pair.id;
        this.pairPosition.set(pair.x, pair.y + 0.8);
        this.pairAngle = 0;
      }
      this.pairPosition.x += (pair.x - this.pairPosition.x) * damp(32, dt);
      this.pairPosition.y += (pair.y - this.pairPosition.y) * damp(24, dt);
      // 가까운 쪽으로 돈다
      const target = pair.rot * (Math.PI / 2);
      let delta = (target - this.pairAngle) % (Math.PI * 2);
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      this.pairAngle += delta * damp(26, dt);

      const px = this.pairPosition.x + 0.5;
      const py = this.pairPosition.y + 0.5;
      const pulse = 0.25 + 0.2 * Math.sin(time * 9);
      const positions = [
        [px, py],
        [px + Math.sin(this.pairAngle), py + Math.cos(this.pairAngle)],
      ];
      positions.forEach(([fx, fy], i) => {
        const fruit = this.take(pair.colors[i]);
        fruit.position.set(fx, fy, 0.05);
        fruit.scale.setScalar(1);
        fruit.userData.inner.rotation.y = Math.sin(time * 1.6 + i) * 0.35;
        addPad(fx, fy, pair.colors[i], i === 0 ? pulse : 0); // 축이 되는 과일은 받침이 반짝인다
      });

      const logical = pairCells(pair);
      for (const cell of board.landing()) {
        if (cell.y >= VISIBLE) continue;
        if (logical.some(([x, y]) => x === cell.x && y === cell.y)) continue; // 이미 그 자리에 있다
        matrix.makeTranslation(cell.x + 0.5, cell.y + 0.5, -0.3);
        this.ghosts.setMatrixAt(ghosts, matrix);
        this.ghosts.setColorAt(ghosts, color.set(COLORS[cell.color]));
        ghosts++;
      }
    }

    for (const [kind, pool] of Object.entries(this.pools)) {
      for (let i = this.used[kind] ?? 0; i < pool.length; i++) pool[i].visible = false;
    }
    for (const [mesh, count] of [
      [this.pads, pads],
      [this.links, links],
      [this.ghosts, ghosts],
    ]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }

    this.updateTray(dt);
    this.updateNext();
    this.updateFrame(dt, time);
  }

  updateTray(dt) {
    let rest = this.board.incoming;
    this.trayBump = Math.max(0, this.trayBump - dt / 0.3);
    const bump = 1 + Math.sin(this.trayBump * Math.PI) * 0.3;
    let slot = 0;
    for (const unit of TRAY_UNITS) {
      while (rest >= unit.amount && slot < TRAY_SLOTS) {
        rest -= unit.amount;
        const { item, pad, fruit } = this.trayItems[slot++];
        item.visible = true;
        pad.material.color.set(unit.color);
        pad.scale.setScalar(unit.scale * 1.05 * bump);
        fruit.scale.setScalar(unit.scale * bump);
      }
    }
    for (; slot < TRAY_SLOTS; slot++) this.trayItems[slot].item.visible = false;
  }

  updateNext() {
    const board = this.board;
    const pairs = board.preview(2);
    const key = `${board.count}:${pairs.flat().join('')}`;
    if (key === this.nextKey) return;
    this.nextKey = key;
    this.nextFruits.clear();
    const layout = [
      { y: -0.65, scale: 0.9 },
      { y: -2.75, scale: 0.68 },
    ];
    pairs.forEach(([pivot, satellite], i) => {
      const { y, scale } = layout[i];
      [satellite, pivot].forEach((kind, j) => {
        const fruit = this.stage.makeFruit(kind);
        fruit.scale.setScalar(scale);
        fruit.position.set(0, y - j * scale, 0);
        this.nextFruits.add(fruit);
      });
    });
  }

  updateFrame(dt, time) {
    const board = this.board;
    let highest = 0;
    for (let x = 0; x < WIDTH; x++) highest = Math.max(highest, columnHeight(board.grid, x));
    const danger = !this.result && (columnHeight(board.grid, SPAWN_X) >= VISIBLE - 3 || highest >= VISIBLE - 1);
    const k = danger ? 0.5 + 0.5 * Math.sin(time * 8) : 0;
    this.frameMaterial.color.set(0xd9b46a).lerp(this.stage.color.set(0xef4a3a), k);
    this.panel.material.color.set(0x121724).lerp(this.stage.color.set(0x3a1418), danger ? 0.5 + k * 0.3 : 0);

    if (this.shakeDelay > 0 && (this.shakeDelay -= dt) <= 0) {
      this.shake = this.pendingShake;
      this.pendingShake = 0;
    }
    this.shake *= Math.exp(-dt * 9);
    this.group.position.copy(this.base);
    if (this.shake > 0.002) {
      this.group.position.x += Math.sin(time * 71) * this.shake;
      this.group.position.y += Math.sin(time * 93) * this.shake;
    }
  }
}

export class DuelScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true, alpha: true }, { shadows: false });
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 400);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x554a40, 1.5));
    const sun = new THREE.DirectionalLight(0xfff4e2, 2.2);
    sun.position.set(-4, 9, 12);
    this.scene.add(sun);

    this.matrix = new THREE.Matrix4();
    this.color = new THREE.Color();
    this.templates = {};
    this.views = [];
    this.match = null;
    this.solo = true; // 혼자 할 때 좁은 화면에서는 상대 판을 작게 그린다
    this.layout = '';
    this.bounds = { minX: -8, maxX: 8, minY: 0, maxY: 14 };
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 }; // HUD 가 가리는 화면 가장자리 픽셀
    this.particles = [];
    this.orbs = new Set();
    this.time = 0;
    this.onFrame = null; // (dt) => boolean, 프레임마다 그리기 전에 불린다. 게임이 진행 중이면 true 를 돌려준다

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** 모델을 불러오고 그리기를 시작한다 */
  async load() {
    const loader = new GLTFLoader();
    const kinds = Object.keys(MODELS);
    const gltfs = await Promise.all(kinds.map((kind) => loader.loadAsync(asset(`models/${MODELS[kind].file}.glb`))));
    kinds.forEach((kind, i) => {
      // 크기를 칸에 맞추고 가운데를 원점으로 옮긴다
      const { size, tilt } = MODELS[kind];
      const model = gltfs[i].scene;
      const box = new THREE.Box3().setFromObject(model);
      const extent = box.getSize(new THREE.Vector3());
      model.position.sub(box.getCenter(new THREE.Vector3()));
      const inner = new THREE.Group();
      inner.add(model);
      const template = new THREE.Group();
      template.add(inner);
      inner.scale.setScalar(size / Math.max(extent.x, extent.y, extent.z));
      template.rotation.x = tilt;
      this.templates[kind] = template;
    });

    this.particleMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.13, 0),
      new THREE.MeshBasicMaterial(),
      MAX_PARTICLES,
    );
    this.particleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
    this.orbGeometry = new THREE.SphereGeometry(0.3, 16, 12);

    for (let i = 0; i < 2; i++) {
      const view = new BoardView(this, i);
      this.views.push(view);
      this.scene.add(view.group);
    }
    this.applyLayout('even');
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  /** 받침 위에 올릴 과일 하나. userData.inner 를 돌려 흔든다 */
  makeFruit(kind) {
    const holder = new THREE.Group();
    const fruit = this.templates[kind].clone();
    holder.add(fruit);
    holder.userData.inner = fruit.children[0];
    return holder;
  }

  /** 새 대전을 보여 준다 */
  setup(match, { solo = true } = {}) {
    this.match = match;
    this.solo = solo;
    this.views.forEach((view, i) => view.setBoard(match.boards[i]));
    this.particles = [];
    for (const orb of this.orbs) orb.mesh.removeFromParent();
    this.orbs.clear();
    this.layout = '';
  }

  /** match.drain() 으로 꺼낸 사건을 보여 준다 */
  handle(event) {
    const view = this.views[event.player];
    view.handle(event);
    if (event.type === 'pop' && event.garbageMade > 0) {
      // 터진 자리에서 빛덩이가 날아간다: 보낼 것이 있으면 상대에게, 받을 것만 지웠으면 내 쪽으로
      const target = event.sent > 0 ? this.views[1 - event.player] : view;
      const cx = event.cells.reduce((sum, c) => sum + c.x + 0.5, 0) / event.cells.length;
      const cy = event.cells.reduce((sum, c) => sum + c.y + 0.5, 0) / event.cells.length;
      this.launchOrb(view.toWorld(cx, cy), target, COLORS[event.cells[0].color]);
    }
  }

  /** 승패 연출: 진 쪽은 과일이 쏟아져 내리고 이긴 쪽은 뛴다 */
  showResult(winner) {
    this.views.forEach((view, i) => view.setResult(winner === 'draw' ? 'lose' : i === winner ? 'win' : 'lose'));
  }

  burst(position, colorName, scale = 1) {
    const color = new THREE.Color(colorName).lerp(WHITE, 0.25);
    for (let i = 0; i < 7 && this.particles.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 4) * scale;
      this.particles.push({
        position: position.clone(),
        velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed + 2 * scale, (Math.random() - 0.2) * 3 * scale),
        life: 0,
        duration: 0.45 + Math.random() * 0.3,
        color,
        scale,
      });
    }
  }

  launchOrb(from, targetView, colorName) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorName).lerp(WHITE, 0.45), transparent: true });
    const mesh = new THREE.Mesh(this.orbGeometry, material);
    mesh.position.copy(from);
    mesh.visible = false;
    this.scene.add(mesh);
    this.orbs.add({ mesh, from: from.clone(), targetView, age: -POP_BURST, duration: 0.42 });
  }

  updateOrbs(dt) {
    const to = new THREE.Vector3();
    const middle = new THREE.Vector3();
    for (const orb of this.orbs) {
      orb.age += dt;
      if (orb.age < 0) continue;
      const k = Math.min(1, orb.age / orb.duration);
      orb.targetView.toWorld(WIDTH / 2, TRAY_Y, to);
      middle.copy(orb.from).lerp(to, 0.5);
      middle.y = Math.max(orb.from.y, to.y) + 2.5;
      // 2차 베지어 곡선
      const a = (1 - k) ** 2;
      const b = 2 * (1 - k) * k;
      orb.mesh.visible = true;
      orb.mesh.position.set(
        a * orb.from.x + b * middle.x + k * k * to.x,
        a * orb.from.y + b * middle.y + k * k * to.y,
        1,
      );
      orb.mesh.scale.setScalar((0.7 + Math.sin(k * Math.PI) * 0.8) * orb.targetView.group.scale.x ** 0.5);
      if (k >= 1) {
        orb.targetView.trayBump = 1;
        orb.mesh.removeFromParent();
        orb.mesh.material.dispose();
        this.orbs.delete(orb);
      }
    }
  }

  updateParticles(dt) {
    const matrix = this.matrix;
    this.particles = this.particles.filter((p) => (p.life += dt) < p.duration);
    this.particles.forEach((p, i) => {
      p.velocity.y -= 16 * p.scale * dt;
      p.position.addScaledVector(p.velocity, dt);
      const s = (1 - p.life / p.duration) * p.scale;
      matrix.makeScale(s, s, s).setPosition(p.position);
      this.particleMesh.setMatrixAt(i, matrix);
      this.particleMesh.setColorAt(i, p.color);
    });
    this.particleMesh.count = this.particles.length;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.particleMesh.instanceColor.needsUpdate = true;
  }

  // ---------- 배치·카메라 ----------

  setInsets(insets) {
    Object.assign(this.insets, insets);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
  }

  /**
   * even: 두 판을 같은 크기로 나란히. 다음 짝은 두 판 사이에 둔다.
   * focus: 내 판을 크게, 상대 판은 오른쪽 아래에 작게 (세로로 긴 화면에서 혼자 할 때).
   */
  applyLayout(layout) {
    if (layout === this.layout) return;
    this.layout = layout;
    const [mine, theirs] = this.views;
    if (layout === 'focus') {
      mine.base.set(-5.1, 0, 0);
      mine.group.scale.setScalar(1);
      mine.next.position.set(WIDTH + 1.1, VISIBLE, 0);
      mine.next.visible = true;
      theirs.base.set(1.55, 0.2, 0);
      theirs.group.scale.setScalar(FOCUS_SCALE);
      theirs.next.visible = false;
      this.bounds = { minX: -5.4, maxX: 4.75, minY: -0.3, maxY: VISIBLE + 2.3 };
    } else {
      mine.base.set(-WIDTH - 1.8, 0, 0);
      mine.group.scale.setScalar(1);
      mine.next.position.set(WIDTH + 1.0, VISIBLE, 0);
      mine.next.visible = true;
      theirs.base.set(1.8, 0, 0);
      theirs.group.scale.setScalar(1);
      theirs.next.position.set(-1.0, VISIBLE, 0);
      theirs.next.visible = true;
      this.bounds = { minX: -WIDTH - 2.1, maxX: WIDTH + 2.1, minY: -0.3, maxY: VISIBLE + 2.3 };
    }
    for (const view of this.views) view.group.position.copy(view.base);
  }

  /** HUD 에 가리지 않는 영역 한가운데에 두 판이 꽉 차게 보이도록 카메라를 놓는다 */
  placeCamera() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const freeWidth = Math.max(1, w - left - right);
    const freeHeight = Math.max(1, h - top - bottom);
    this.applyLayout(this.solo && freeWidth / freeHeight < 0.95 ? 'focus' : 'even');

    const cx = (left + (w - right)) / 2;
    const cy = (top + (h - bottom)) / 2;
    this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    const limit = {
      left: -1 + (2 * left) / w + 0.02,
      right: 1 - (2 * right) / w - 0.02,
      bottom: -1 + (2 * bottom) / h + 0.02,
      top: 1 - (2 * top) / h - 0.02,
    };
    const { minX, maxX, minY, maxY } = this.bounds;
    const target = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0);
    const direction = new THREE.Vector3(0, 0.1, 1).normalize(); // 살짝 위에서 내려다본다
    const corners = [];
    for (const x of [minX, maxX]) for (const y of [minY, maxY]) corners.push(new THREE.Vector3(x, y, 0));
    const point = new THREE.Vector3();
    const fits = (distance) => {
      this.camera.position.copy(target).addScaledVector(direction, distance);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      return corners.every((c) => {
        point.copy(c).project(this.camera);
        return point.z < 1 && point.x >= limit.left && point.x <= limit.right && point.y >= limit.bottom && point.y <= limit.top;
      });
    };
    let lo = 5;
    let hi = 300;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi);
  }

  /** 판이 화면에서 차지하는 자리(픽셀). HUD 를 판 위에 맞춰 놓을 때 쓴다 */
  boardRect(index) {
    const view = this.views[index];
    if (!view) return null;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const project = (x, y) => {
      const p = view.toWorld(x, y).project(this.camera);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
    };
    const low = project(0, 0);
    const high = project(WIDTH, VISIBLE);
    const tray = project(WIDTH, TRAY_Y + 0.6);
    return { left: low.x, right: high.x, bottom: low.y, top: high.y, trayTop: tray.y, scale: view.group.scale.x };
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    // 메뉴 뒤에서 도는 시범 경기는 천천히 그려도 된다
    const lively = !!this.onFrame?.(dt) || this.orbs.size > 0 || this.particles.length > 0;
    this.placeCamera();
    if (this.match) for (const view of this.views) view.update(dt, this.time);
    this.updateOrbs(dt);
    this.updateParticles(dt);
    if (this.loop.due(now, lively)) this.renderer.render(this.scene, this.camera);
  }
}
