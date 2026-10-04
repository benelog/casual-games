// Three.js 3D 블록 씬. 게임 상태(game.js)를 읽어 그리기만 하고 규칙은 건드리지 않는다.
// 우물 좌표 (x, y, z) 는 z 가 위쪽이고, 월드 좌표로는 (x, z, -y) 방향에 놓인다
// (three.js 는 y 가 위쪽). 우물 바닥 가운데가 원점이고 한 칸이 1 단위다.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRenderer } from '../../shared/gpu.js';

// 쌓인 칸은 높이(층)마다 색이 다르다. 몇 층까지 찼는지 한눈에 보이도록
export const LAYER_COLORS = [
  '#e8504a',
  '#f08c3a',
  '#f2c94c',
  '#9ccf4a',
  '#3fbf7f',
  '#36b3c4',
  '#3f8ae0',
  '#6a63d9',
  '#a35ad6',
  '#d65aa8',
  '#e86f7e',
  '#c9b28f',
];
export const layerColor = (z) => LAYER_COLORS[z % LAYER_COLORS.length];

const PIECE_COLOR = new THREE.Color('#f3ecdc');
const PIECE_EMISSIVE = new THREE.Color('#5a4a28');
const GHOST_COLOR = new THREE.Color('#d9b46a');
const BLOCK = 0.94; // 칸 사이에 틈을 둬 하나하나 구분되게
const DEFAULT_POLAR = 0.55; // 수직에서 기운 각도(라디안)
const MIN_POLAR = 0.02;
const MAX_POLAR = 1.25;
const QUARTER = Math.PI / 2;
const MAX_PARTICLES = 400;

const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class TetrisScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true, alpha: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.environment;
    this.buildLights();

    this.blockGeometry = new RoundedBoxGeometry(BLOCK, BLOCK, BLOCK, 2, 0.1);
    this.edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(BLOCK, BLOCK, BLOCK));
    this.pieceMaterial = new THREE.MeshStandardMaterial({
      color: PIECE_COLOR,
      emissive: PIECE_EMISSIVE,
      roughness: 0.3,
      metalness: 0.05,
    });
    this.pieceEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xd9b46a, transparent: true, opacity: 0.9 });
    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: GHOST_COLOR,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    });
    this.ghostEdgeMaterial = new THREE.LineBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.75 });

    this.view = { azimuth: 0, polar: DEFAULT_POLAR, zoom: 1 };
    this.viewTarget = { ...this.view };
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 }; // HUD 가 가리는 화면 가장자리 픽셀
    this.effects = new Set();
    this.particles = [];
    this.bump = 0;
    this.time = 0;
    this.onFrame = null; // (dt) => void, 그리기 직전에 불린다
    this.previewElement = null;

    this.buildPreview();
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.last = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2430, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  /** 우물 좌표(칸 가운데) → 월드 좌표 */
  world(x, y, z, out = new THREE.Vector3()) {
    return out.set(x - this.center.x, z + 0.5, this.center.y - y);
  }

  // ---------- 우물 ----------

  /** 새 게임마다 우물 크기에 맞춰 다시 짓는다 */
  setup(game) {
    if (this.pit) {
      this.scene.remove(this.pit);
      this.dispose(this.pit);
    }
    for (const effect of this.effects) effect.dispose?.();
    this.effects.clear();
    this.particles = [];

    const { width: W, depth: D, height: H } = game;
    this.size = { W, D, H };
    this.center = { x: (W - 1) / 2, y: (D - 1) / 2 };
    this.pit = new THREE.Group();
    this.scene.add(this.pit);
    this.buildPit();

    this.blocks = new THREE.InstancedMesh(
      this.blockGeometry,
      new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.04 }),
      W * D * H,
    );
    this.blocks.castShadow = this.blocks.receiveShadow = true;
    this.blocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(W * D * H * 3), 3);
    this.blocks.count = 0;
    this.pit.add(this.blocks);
    this.layerOffset = new Float32Array(H);
    this.layerSpeed = new Float32Array(H);
    this.dropDelay = 0;
    this.blocksDirty = true;

    this.particleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.28, 0.28, 0.28),
      new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: 0x222222 }),
      MAX_PARTICLES,
    );
    this.particleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.pit.add(this.particleMesh);

    this.active = new THREE.Group();
    this.ghost = new THREE.Group();
    this.pit.add(this.active, this.ghost);
    this.activeKey = '';
    this.activeId = null;

    const s = this.sun.shadow.camera;
    const r = Math.max(W, D, H) * 0.8;
    s.left = s.bottom = -r;
    s.right = s.top = r;
    s.near = 1;
    s.far = H * 4;
    s.updateProjectionMatrix();
    this.sun.position.set(-W * 0.35, H * 2.2, D * 0.6);
    this.sun.target.position.set(0, 0, 0);
    this.game = game;
  }

  buildPit() {
    const { W, D, H } = this.size;
    const pit = this.pit;

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.3, 0.3, D + 0.3),
      new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.85 }),
    );
    floor.position.y = -0.15;
    floor.receiveShadow = true;
    pit.add(floor);

    // 바닥과 네 벽의 격자. 벽은 칸이 보이도록 선과 아주 옅은 면만 둔다
    const x0 = -W / 2;
    const x1 = W / 2;
    const z0 = -D / 2;
    const z1 = D / 2;
    const floorLines = [];
    for (let i = 0; i <= W; i++) floorLines.push(x0 + i, 0.002, z0, x0 + i, 0.002, z1);
    for (let j = 0; j <= D; j++) floorLines.push(x0, 0.002, z0 + j, x1, 0.002, z0 + j);
    pit.add(this.lines(floorLines, 0x7d93a8, 0.55));

    const wallLines = [];
    for (let k = 1; k <= H; k++) {
      wallLines.push(x0, k, z0, x1, k, z0, x1, k, z0, x1, k, z1, x1, k, z1, x0, k, z1, x0, k, z1, x0, k, z0);
    }
    for (let i = 0; i <= W; i++) wallLines.push(x0 + i, 0, z0, x0 + i, H, z0, x0 + i, 0, z1, x0 + i, H, z1);
    for (let j = 1; j < D; j++) wallLines.push(x0, 0, z0 + j, x0, H, z0 + j, x1, 0, z0 + j, x1, H, z0 + j);
    pit.add(this.lines(wallLines, 0x6c8299, 0.28));

    const wallMaterial = new THREE.MeshBasicMaterial({
      color: 0x8aa4c0,
      transparent: true,
      opacity: 0.035,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const walls = [
      [W, [0, H / 2, z0], 0],
      [W, [0, H / 2, z1], 0],
      [D, [x0, H / 2, 0], QUARTER],
      [D, [x1, H / 2, 0], QUARTER],
    ];
    for (const [span, position, rotation] of walls) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(span, H), wallMaterial);
      wall.position.set(...position);
      wall.rotation.y = rotation;
      wall.renderOrder = -1;
      pit.add(wall);
    }

    // 맨 위 테두리
    pit.add(this.lines([x0, H, z0, x1, H, z0, x1, H, z0, x1, H, z1, x1, H, z1, x0, H, z1, x0, H, z1, x0, H, z0], 0xd9b46a, 0.9));

    // 벽 바깥 모서리에 층 색 눈금
    const tick = new THREE.BoxGeometry(0.08, 0.86, 0.08);
    for (let z = 0; z < H; z++) {
      const material = new THREE.MeshBasicMaterial({ color: layerColor(z), transparent: true, opacity: 0.8 });
      for (const [x, y] of [
        [x0, z0],
        [x1, z0],
        [x0, z1],
        [x1, z1],
      ]) {
        const mark = new THREE.Mesh(tick, material);
        mark.position.set(x * 1.012, z + 0.5, y * 1.012);
        pit.add(mark);
      }
    }
  }

  lines(points, color, opacity) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
  }

  // ---------- 조각 ----------

  cube(material, edgeMaterial) {
    const group = new THREE.Group();
    if (material) {
      const mesh = new THREE.Mesh(this.blockGeometry, material);
      mesh.castShadow = material === this.pieceMaterial;
      group.add(mesh);
    }
    if (edgeMaterial) group.add(new THREE.LineSegments(this.edgeGeometry, edgeMaterial));
    return group;
  }

  /** 조각 칸들을 피벗 기준 위치로 놓는다 (월드 방향으로) */
  layoutCells(group, cells, make) {
    while (group.children.length < cells.length) group.add(make());
    group.children.forEach((child, i) => {
      child.visible = i < cells.length;
      if (i < cells.length) {
        const [x, y, z] = cells[i];
        child.position.set(x, z, -y);
      }
    });
  }

  /** 게임 상태를 그릴 목표로 맞춘다. 매 프레임 불러도 된다 */
  sync(game) {
    const piece = game.piece;
    this.active.visible = !!piece && !game.over;
    this.ghost.visible = this.active.visible;
    if (!piece) return;

    const key = JSON.stringify(piece.cells);
    if (this.activeId !== piece.id) {
      // 새 조각: 애니메이션 없이 제자리에
      this.activeId = piece.id;
      this.activeKey = '';
      this.world(...piece.pos, this.active.position);
      this.active.quaternion.identity();
    }
    if (key !== this.activeKey) {
      this.activeKey = key;
      this.layoutCells(this.active, piece.cells, () => this.cube(this.pieceMaterial, this.pieceEdgeMaterial));
      this.layoutCells(this.ghost, piece.cells, () => this.cube(this.ghostMaterial, this.ghostEdgeMaterial));
    }
    this.pieceTarget = this.world(...piece.pos, this.pieceTarget);
    const landing = game.landing();
    this.world(...landing, this.ghost.position);
    // 거의 다 내려와 조각과 겹치면 그림자는 숨긴다
    this.ghost.visible = landing[2] !== piece.pos[2];
  }

  /** 회전 애니메이션: 새 방향으로 칸을 놓고 그룹을 반대로 돌려 둔 뒤 제자리로 돌린다 */
  animateRotation(axis, dir) {
    const worldAxis = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, -1), z: new THREE.Vector3(0, 1, 0) }[axis];
    // 칸은 이미 새 방향으로 놓였으니, 그룹을 반대로 돌려 두면 화면에는 아직 옛 방향으로 보인다
    const undo = new THREE.Quaternion().setFromAxisAngle(worldAxis, -dir * QUARTER);
    this.active.quaternion.multiply(undo);
  }

  // ---------- 쌓인 칸 ----------

  rebuildBlocks() {
    const game = this.game;
    const { W, D, H } = this.size;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const color = new THREE.Color();
    let n = 0;
    for (let z = 0; z < H; z++) {
      color.set(layerColor(z));
      for (let y = 0; y < D; y++) {
        for (let x = 0; x < W; x++) {
          if (!game.filled(x, y, z)) continue;
          this.world(x, y, z, position);
          position.y += this.layerOffset[z];
          matrix.makeTranslation(position.x, position.y, position.z);
          this.blocks.setMatrixAt(n, matrix);
          this.blocks.setColorAt(n, color);
          n++;
        }
      }
    }
    this.blocks.count = n;
    this.blocks.instanceMatrix.needsUpdate = true;
    this.blocks.instanceColor.needsUpdate = true;
  }

  // ---------- 효과 ----------

  /** game.drain() 으로 꺼낸 사건을 보여 준다 */
  handle(event) {
    if (!this.game) return;
    switch (event.type) {
      case 'rotate':
        this.animateRotation(event.axis, event.dir);
        break;
      case 'spawn':
        break;
      case 'drop':
        this.bump = Math.min(0.25, 0.05 + event.distance * 0.015);
        this.dropDistance = event.distance;
        break;
      case 'lock':
        this.flashCells(event.cells, this.dropDistance ?? 0);
        this.dropDistance = 0;
        this.blocksDirty = true;
        break;
      case 'clear':
        this.clearLayers(event.layers);
        break;
    }
  }

  /** 함께 쓰는 지오메트리·재질은 남기고 나머지를 정리한다 */
  dispose(root) {
    const shared = new Set([
      this.blockGeometry,
      this.edgeGeometry,
      this.pieceMaterial,
      this.pieceEdgeMaterial,
      this.ghostMaterial,
      this.ghostEdgeMaterial,
    ]);
    root.traverse((o) => {
      if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      if (o.material && !shared.has(o.material)) o.material.dispose();
    });
  }

  addEffect(object, duration, update) {
    const effect = {
      age: 0,
      update: (dt) => {
        effect.age += dt;
        const k = Math.min(1, effect.age / duration);
        update(k, object);
        return k < 1;
      },
      dispose: () => {
        object.removeFromParent();
        this.dispose(object);
      },
    };
    this.pit.add(object);
    this.effects.add(effect);
  }

  /** 굳은 칸이 잠깐 빛나고, 바로 떨어뜨렸으면 떨어진 자취가 남는다 */
  flashCells(cells, distance) {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const [x, y, z] of cells) {
      const flash = new THREE.Mesh(this.blockGeometry, material);
      this.world(x, y, z, flash.position);
      flash.scale.setScalar(1.06);
      group.add(flash);
    }
    if (distance > 1) {
      const trail = new THREE.MeshBasicMaterial({
        color: 0xd9b46a,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const geometry = new THREE.BoxGeometry(0.7, distance, 0.7);
      const top = new Map(); // 같은 기둥은 맨 위 칸에서만 자취를 그린다
      for (const [x, y, z] of cells) {
        const k = `${x},${y}`;
        if (!top.has(k) || top.get(k)[2] < z) top.set(k, [x, y, z]);
      }
      for (const [x, y, z] of top.values()) {
        const streak = new THREE.Mesh(geometry, trail);
        this.world(x, y, z, streak.position);
        streak.position.y += distance / 2 + 0.5;
        group.add(streak);
      }
    }
    this.addEffect(group, 0.28, (k) => {
      material.opacity = 0.6 * (1 - k);
      group.children.forEach((child) => {
        if (child.material !== material) {
          child.material.opacity = 0.35 * (1 - k);
          child.scale.x = child.scale.z = 1 - k * 0.6;
        }
      });
    });
  }

  /** 지워진 층이 번쩍이고 조각이 흩어지며, 위층은 떨어지듯 내려온다 */
  clearLayers(layers) {
    const { W, D, H } = this.size;
    for (const z of layers) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 1, D), material);
      slab.position.set(0, z + 0.5, 0);
      const color = new THREE.Color(layerColor(z));
      this.addEffect(slab, 0.5, (k) => {
        material.color.copy(color).lerp(new THREE.Color(0xffffff), 1 - k);
        material.opacity = 0.9 * (1 - k) ** 1.5;
        slab.scale.set(1 + k * 0.12, 1 - k * 0.7, 1 + k * 0.12);
      });
      for (let y = 0; y < D; y++) {
        for (let x = 0; x < W; x++) {
          if (this.particles.length >= MAX_PARTICLES) break;
          const position = this.world(x, y, z);
          const out = new THREE.Vector3(position.x, 0, position.z).normalize();
          this.particles.push({
            position,
            velocity: new THREE.Vector3(
              out.x * 2.5 + (Math.random() - 0.5) * 3,
              2 + Math.random() * 3,
              out.z * 2.5 + (Math.random() - 0.5) * 3,
            ),
            spin: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
            life: 0,
            duration: 0.7 + Math.random() * 0.35,
            color,
          });
        }
      }
    }
    // 남은 층들이 원래 있던 높이에서 출발해 떨어지게 한다
    const kept = [];
    for (let z = 0; z < H; z++) if (!layers.includes(z)) kept.push(z);
    kept.forEach((from, z) => {
      this.layerOffset[z] = Math.max(this.layerOffset[z], from - z);
      this.layerSpeed[z] = 0;
    });
    this.dropDelay = 0.14;
    this.blocksDirty = true;
  }

  updateParticles(dt) {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    this.particles = this.particles.filter((p) => (p.life += dt) < p.duration);
    this.particles.forEach((p, i) => {
      p.velocity.y -= 14 * dt;
      p.position.addScaledVector(p.velocity, dt);
      p.spin.x += dt * 6;
      p.spin.y += dt * 4;
      quaternion.setFromEuler(p.spin);
      scale.setScalar(1 - p.life / p.duration);
      matrix.compose(p.position, quaternion, scale);
      this.particleMesh.setMatrixAt(i, matrix);
      this.particleMesh.setColorAt(i, p.color);
    });
    this.particleMesh.count = this.particles.length;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.particleMesh.instanceColor.needsUpdate = true;
  }

  updateLayerDrop(dt) {
    if (this.dropDelay > 0) {
      this.dropDelay -= dt;
      return;
    }
    let moving = false;
    for (let z = 0; z < this.size.H; z++) {
      if (this.layerOffset[z] <= 0) continue;
      this.layerSpeed[z] += 40 * dt;
      this.layerOffset[z] = Math.max(0, this.layerOffset[z] - this.layerSpeed[z] * dt);
      moving = true;
    }
    if (moving) this.blocksDirty = true;
  }

  // ---------- 다음 조각 미리보기 ----------

  buildPreview() {
    this.previewScene = new THREE.Scene();
    this.previewScene.environment = this.environment;
    this.previewScene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.4));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(2, 5, 3);
    this.previewScene.add(light);
    // 재질을 두 장면이 함께 쓰면 조명이 달라 프레임마다 셰이더를 다시 만든다. 따로 둔다
    this.previewMaterial = this.pieceMaterial.clone();
    this.previewEdgeMaterial = this.pieceEdgeMaterial.clone();
    this.previewCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.previewCamera.position.set(0, 3.2, 4.6);
    this.previewCamera.lookAt(0, 0, 0);
    this.previewGroup = new THREE.Group();
    this.previewScene.add(this.previewGroup);
    this.previewKind = null;
  }

  setPreview(element) {
    this.previewElement = element;
  }

  showNext(cells, kind) {
    if (this.previewKind === kind) return;
    this.previewKind = kind;
    const group = this.previewGroup;
    group.clear();
    const box = new THREE.Box3();
    const inner = new THREE.Group();
    for (const [x, y, z] of cells) {
      const cube = this.cube(this.previewMaterial, this.previewEdgeMaterial);
      cube.position.set(x, z, -y);
      inner.add(cube);
    }
    box.setFromObject(inner);
    inner.position.sub(box.getCenter(new THREE.Vector3()));
    group.add(inner);
    const size = box.getSize(new THREE.Vector3()).length();
    group.scale.setScalar(Math.min(1, 2.8 / size));
  }

  // ---------- 카메라 ----------

  bindPointer() {
    const canvas = this.renderer.domElement;
    const pointers = new Map();
    canvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last.x = e.clientX;
      last.y = e.clientY;
      if (pointers.size > 1) return;
      this.viewTarget.azimuth -= dx * 0.008;
      this.viewTarget.polar = THREE.MathUtils.clamp(this.viewTarget.polar - dy * 0.006, MIN_POLAR, MAX_POLAR);
    });
    const release = (e) => pointers.delete(e.pointerId);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('dblclick', () => this.resetView());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.viewTarget.zoom = THREE.MathUtils.clamp(this.viewTarget.zoom * Math.exp(e.deltaY * 0.001), 0.6, 1.6);
      },
      { passive: false },
    );
  }

  /** 카메라가 보는 방향을 90° 단위로 맞춘 사분면 (controls.js 참고) */
  quadrant() {
    return ((Math.round(this.viewTarget.azimuth / QUARTER) % 4) + 4) % 4;
  }

  /** 우물 둘레로 90° 돌아간다. step 이 +1 이면 시계 반대 방향 자리로 */
  turnView(step) {
    const snapped = Math.round(this.viewTarget.azimuth / QUARTER) * QUARTER;
    this.viewTarget.azimuth = snapped + step * QUARTER;
  }

  resetView() {
    const snapped = Math.round(this.viewTarget.azimuth / (2 * Math.PI)) * 2 * Math.PI;
    Object.assign(this.viewTarget, { azimuth: snapped, polar: DEFAULT_POLAR, zoom: 1 });
  }

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

  /** HUD 에 가리지 않는 영역 한가운데에 우물이 꽉 차게 보이도록 카메라를 놓는다 */
  placeCamera() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const cx = (left + (w - right)) / 2;
    const cy = (top + (h - bottom)) / 2;
    this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);

    const { azimuth, polar, zoom } = this.view;
    const direction = new THREE.Vector3(
      Math.sin(polar) * Math.sin(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.cos(azimuth),
    );
    const target = new THREE.Vector3(0, (this.size?.H ?? 10) * 0.5 - this.bump, 0);
    // 화면에서 쓸 수 있는 영역 (NDC)
    const limit = {
      left: -1 + (2 * left) / w + 0.04,
      right: 1 - (2 * right) / w - 0.04,
      bottom: -1 + (2 * bottom) / h + 0.04,
      top: 1 - (2 * top) / h - 0.04,
    };
    const { W = 5, D = 5, H = 12 } = this.size ?? {};
    const corners = [];
    for (const x of [-W / 2, W / 2]) for (const y of [0, H]) for (const z of [-D / 2, D / 2]) corners.push(new THREE.Vector3(x, y, z));
    const point = new THREE.Vector3();
    const fits = (distance) => {
      this.camera.position.copy(target).addScaledVector(direction, distance);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      return corners.every((c) => {
        point.copy(c).project(this.camera);
        return (
          point.z < 1 && point.x >= limit.left && point.x <= limit.right && point.y >= limit.bottom && point.y <= limit.top
        );
      });
    };
    let lo = 2;
    let hi = 150;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi * zoom);
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.onFrame?.(dt);

    const k = damp(12, dt);
    this.view.azimuth += (this.viewTarget.azimuth - this.view.azimuth) * k;
    this.view.polar += (this.viewTarget.polar - this.view.polar) * k;
    this.view.zoom += (this.viewTarget.zoom - this.view.zoom) * k;
    this.bump *= Math.exp(-dt * 14);

    if (this.game) {
      if (this.pieceTarget) this.active.position.lerp(this.pieceTarget, damp(28, dt));
      this.active.quaternion.slerp(new THREE.Quaternion(), damp(22, dt));
      this.updateLayerDrop(dt);
      if (this.blocksDirty) {
        this.blocksDirty = false;
        this.rebuildBlocks();
      }
      for (const effect of this.effects) {
        if (!effect.update(dt)) {
          effect.dispose();
          this.effects.delete(effect);
        }
      }
      this.updateParticles(dt);
    }

    this.placeCamera();
    const renderer = this.renderer;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
    renderer.render(this.scene, this.camera);
    this.renderPreview(dt);
  }

  renderPreview(dt) {
    const element = this.previewElement;
    if (!element || !this.previewKind || element.offsetParent === null) return;
    const rect = element.getBoundingClientRect();
    const host = this.renderer.domElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width < 4 || height < 4) return;
    const left = rect.left - host.left;
    const bottom = host.bottom - rect.bottom;
    this.previewGroup.rotation.y += dt * 0.8;
    this.previewCamera.aspect = width / height;
    this.previewCamera.updateProjectionMatrix();
    const renderer = this.renderer;
    renderer.setScissorTest(true);
    renderer.setScissor(left, bottom, width, height);
    renderer.setViewport(left, bottom, width, height);
    renderer.render(this.previewScene, this.previewCamera);
    renderer.setScissorTest(false);
  }
}
