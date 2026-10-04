// Three.js 파이프 판. 게임 상태(game.js)를 읽어 그리기만 하고 규칙은 건드리지 않는다.
// 격자 칸 (x, y) 는 월드 좌표 (x - 가운데, 0, y - 가운데) 에 놓인다. 북쪽이 -z, 동쪽이 +x 고
// 한 칸이 1 단위다. 카메라는 살짝 기울여 내려다보는 자리에 고정한다(끌어도 돌지 않아 오탭이 없다).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { DIRS, SHAPES, shapeOf, turnsOf } from './game.js';
import { damp } from '../../shared/util.js';

const QUARTER = Math.PI / 2;
const TILT = 0.3; // 수직에서 기운 각도(라디안)
const PIPE_R = 0.14;
const PIPE_Y = 0.26; // 타일 윗면(y = 0)에서 파이프 축까지의 높이
const FLANGE_R = 0.2;
const FLANGE_LENGTH = 0.07;
const TILE = 0.95; // 칸 사이에 틈을 둬 하나하나 구분되게
const TILE_HEIGHT = 0.14;
const TAP_SLOP = 12; // 누른 자리에서 이만큼(픽셀) 넘게 움직이면 탭이 아니다
const WAVE_TIME = 1.5; // 완성했을 때 물결이 수원에서 가장 먼 칸까지 가는 시간(초)
const PULSE_TIME = 0.55;
const MAX_DROPS = 360;

const DRY = new THREE.Color('#d9a273');
const WET = new THREE.Color('#4db8ff');
const GLOW = new THREE.Color('#1479d8');
const TILE_DRY = [new THREE.Color('#77808f'), new THREE.Color('#6a7382')];
const TILE_WET = [new THREE.Color('#5f93b8'), new THREE.Color('#5486ab')];
const TILE_SOURCE = new THREE.Color('#d9b46a');

/** 조각 가운데에서 dir(0=북, 1=동, 2=남, 3=서) 쪽으로 뻗는 도형이 되게 돌린다. 기준은 북쪽(-z) */
function toward(geometry, dir) {
  return geometry.rotateY(-dir * QUARTER);
}

/** 가운데에서 칸 가장자리까지의 관(길이 0.5)과 이음매 테 */
function arm(dir) {
  const pipe = new THREE.CylinderGeometry(PIPE_R, PIPE_R, 0.5, 20).rotateX(QUARTER).translate(0, 0, -0.25);
  return [toward(pipe, dir), flange(dir)];
}

function flange(dir) {
  const ring = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_LENGTH, 20)
    .rotateX(QUARTER)
    .translate(0, 0, -0.5 + FLANGE_LENGTH / 2);
  return toward(ring, dir);
}

/** 모양별 도형을 기준 방향(game.js 의 SHAPES)으로 만든다 */
function buildShapes() {
  const ball = (r) => new THREE.SphereGeometry(r, 20, 14);
  const parts = {
    end: [...arm(0), ball(0.21)],
    straight: [...arm(0), ...arm(2)],
    // 꺾임은 칸의 북동쪽 모서리를 중심으로 한 4분의 1 도넛
    elbow: [
      new THREE.TorusGeometry(0.5, PIPE_R, 14, 20, QUARTER).rotateZ(QUARTER).rotateX(QUARTER).translate(0.5, 0, -0.5),
      flange(0),
      flange(1),
    ],
    tee: [...arm(0), ...arm(1), ...arm(2), ball(0.19)],
    cross: [...arm(0), ...arm(1), ...arm(2), ...arm(3), ball(0.19)],
  };
  const shapes = {};
  for (const [name, list] of Object.entries(parts)) {
    shapes[name] = mergeGeometries(list);
    for (const geometry of list) geometry.dispose();
  }
  return shapes;
}

export class PipesScene {
  constructor(container, textureUrl) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true, alpha: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.buildLights();

    this.shapes = buildShapes();
    this.tileGeometry = new RoundedBoxGeometry(TILE, TILE_HEIGHT, TILE, 2, 0.035);
    this.loadTextures(textureUrl);

    this.insets = { top: 0, bottom: 0, left: 0, right: 0 }; // HUD 가 가리는 화면 가장자리 픽셀
    this.cameraDirty = true;
    this.cells = [];
    this.drops = [];
    this.wave = null;
    this.cursor = -1;
    this.time = 0;
    this.game = null;
    this.onFrame = null; // (dt) => void, 프레임마다 그리기 전에 불린다
    this.onTap = null; // (index, dir) => void
    this.onHover = null; // (index) => void, 마우스가 가리키는 칸(-1 이면 없음)

    this.raycaster = new THREE.Raycaster();
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PIPE_Y / 2);
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2430, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  /** 텍스처는 늦게 와도 된다. 오기 전에는 단색으로 그린다 */
  loadTextures(baseUrl) {
    const loader = new THREE.TextureLoader();
    const load = (name, srgb) => {
      const texture = loader.load(new URL(name, baseUrl).href);
      if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      return texture;
    };
    this.textures = {
      metalColor: load('Metal032_color.jpg', true),
      metalRoughness: load('Metal032_roughness.jpg', false),
      stoneColor: load('Concrete034_color.jpg', true),
      stoneNormal: load('Concrete034_normal.jpg', false),
    };
  }

  /** 격자 칸 → 월드 좌표 */
  world(index, out = new THREE.Vector3()) {
    const x = index % this.size;
    const y = (index - x) / this.size;
    const c = (this.size - 1) / 2;
    return out.set(x - c, 0, y - c);
  }

  // ---------- 판 ----------

  /** 새 퍼즐마다 판을 다시 짓는다 */
  setup(game) {
    if (this.board) {
      this.scene.remove(this.board);
      this.dispose(this.board);
    }
    this.game = game;
    this.size = game.size;
    this.wave = null;
    this.drops = [];
    this.cursor = -1;
    this.board = new THREE.Group();
    this.scene.add(this.board);

    const n = this.size;
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(n + 0.5, 0.3, n + 0.5, 2, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x1a222e, roughness: 0.8 }),
    );
    slab.position.y = -TILE_HEIGHT - 0.13;
    slab.receiveShadow = true;
    this.board.add(slab);

    this.tiles = new THREE.InstancedMesh(
      this.tileGeometry,
      new THREE.MeshStandardMaterial({
        map: this.textures.stoneColor,
        normalMap: this.textures.stoneNormal,
        roughness: 0.85,
        metalness: 0,
      }),
      n * n,
    );
    this.tiles.receiveShadow = true;
    this.tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * n * 3), 3);
    this.board.add(this.tiles);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    this.cells = [];
    for (let index = 0; index < n * n; index++) {
      this.world(index, position);
      matrix.makeTranslation(position.x, -TILE_HEIGHT / 2, position.z);
      this.tiles.setMatrixAt(index, matrix);

      const mask = game.masks[index];
      const material = new THREE.MeshStandardMaterial({
        color: DRY,
        map: this.textures.metalColor,
        roughnessMap: this.textures.metalRoughness,
        roughness: 0.9,
        metalness: 0.55,
        emissive: GLOW,
        emissiveIntensity: 0,
      });
      const mesh = new THREE.Mesh(this.shapes[shapeOf(mask)], material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.set(position.x, PIPE_Y, position.z);
      const target = -turnsOf(mask) * QUARTER;
      const filled = game.isFilled(index);
      this.cells.push({
        mesh,
        material,
        x: position.x,
        z: position.z,
        angle: target - Math.PI, // 반 바퀴 돌며 자리 잡는다
        target,
        scale: 0,
        wet: filled ? 1 : 0,
        press: 0,
        pulseAt: Infinity,
        spouted: false,
        tileWet: -1,
      });
      this.board.add(mesh);
    }
    this.buildSource(game.source);
    this.buildCursor();
    this.buildDrops();

    const s = this.sun.shadow.camera;
    const r = n * 0.8;
    s.left = s.bottom = -r;
    s.right = s.top = r;
    s.near = 1;
    s.far = n * 5;
    s.updateProjectionMatrix();
    this.sun.position.set(-n * 0.5, n * 1.6, n * 0.25);
    this.sun.target.position.set(0, 0, 0);
    this.cameraDirty = true;
  }

  /** 수원: 가운데 조각 위에 얹은 물탱크. 조각과 같이 돈다 */
  buildSource(index) {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.27, 0.3, 0.3, 28),
      new THREE.MeshStandardMaterial({
        color: 0xe9d7a8,
        map: this.textures.metalColor,
        roughnessMap: this.textures.metalRoughness,
        metalness: 0.6,
      }),
    );
    tank.position.y = 0.06;
    tank.castShadow = true;
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(0.21, 0.21, 0.04, 28),
      new THREE.MeshStandardMaterial({ color: WET, emissive: GLOW, emissiveIntensity: 1.2, roughness: 0.15 }),
    );
    water.position.y = 0.2;
    this.sourceWater = water;
    this.cells[index].mesh.add(tank, water);
  }

  /** 마우스·키보드로 가리킨 칸의 테두리 */
  buildCursor() {
    const outer = TILE / 2 + 0.01;
    const inner = outer - 0.07;
    const shape = new THREE.Shape()
      .moveTo(-outer, -outer)
      .lineTo(outer, -outer)
      .lineTo(outer, outer)
      .lineTo(-outer, outer)
      .closePath();
    shape.holes.push(
      new THREE.Path().moveTo(-inner, -inner).lineTo(-inner, inner).lineTo(inner, inner).lineTo(inner, -inner).closePath(),
    );
    this.cursorMesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape).rotateX(-QUARTER),
      new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.cursorMesh.position.y = 0.012;
    this.cursorMesh.visible = false;
    this.board.add(this.cursorMesh);
  }

  buildDrops() {
    this.dropMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.9 }),
      MAX_DROPS,
    );
    this.dropMesh.count = 0;
    this.dropMesh.frustumCulled = false;
    this.board.add(this.dropMesh);
  }

  dispose(root) {
    const shared = new Set([this.tileGeometry, ...Object.values(this.shapes)]);
    root.traverse((o) => {
      if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      if (o.material) o.material.dispose(); // 텍스처는 계속 쓰므로 그대로 둔다
    });
  }

  // ---------- 사건 ----------

  /** game.drain() 으로 나온 사건을 화면에 옮긴다 */
  handle(event) {
    switch (event.type) {
      case 'rotate': {
        const cell = this.cells[event.index];
        cell.target -= event.dir * QUARTER;
        cell.press = 1;
        break;
      }
      case 'start':
        this.retarget();
        break;
      case 'solved':
        this.celebrate();
        break;
    }
  }

  /** 다시 섞였을 때: 조각마다 새 방향으로 가장 가까운 쪽으로 돈다 */
  retarget() {
    this.wave = null;
    this.drops = [];
    const periods = { straight: Math.PI, cross: QUARTER };
    this.cells.forEach((cell, index) => {
      const mask = this.game.masks[index];
      const period = periods[shapeOf(mask)] ?? Math.PI * 2;
      const wanted = -turnsOf(mask) * QUARTER;
      cell.target = wanted + period * Math.round((cell.target - wanted) / period);
      cell.pulseAt = Infinity;
      cell.spouted = false;
    });
  }

  /** 완성: 수원에서 먼 칸으로 물결이 퍼지고, 막힌 끝에서 물방울이 튄다 */
  celebrate() {
    const depth = this.game.depth;
    let far = 1;
    for (const d of depth) far = Math.max(far, d);
    const step = WAVE_TIME / far;
    this.wave = { time: 0 };
    this.cells.forEach((cell, index) => {
      cell.pulseAt = depth[index] * step;
      cell.spouted = false;
    });
  }

  spout(cell) {
    for (let i = 0; i < 7 && this.drops.length < MAX_DROPS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 0.9;
      this.drops.push({
        x: cell.x,
        y: PIPE_Y + 0.2,
        z: cell.z,
        vx: Math.cos(a) * r,
        vy: 2.4 + Math.random() * 1.6,
        vz: Math.sin(a) * r,
        life: 0.7 + Math.random() * 0.4,
      });
    }
  }

  setCursor(index) {
    this.cursor = index;
  }

  // ---------- 입력 ----------

  /** 화면 좌표가 가리키는 칸 번호. 판 밖이면 -1 */
  pick(clientX, clientY) {
    if (!this.game) return -1;
    this.placeCamera();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.pickPlane, new THREE.Vector3());
    if (!hit) return -1;
    const n = this.size;
    const x = Math.floor(hit.x + n / 2);
    const y = Math.floor(hit.z + n / 2);
    return x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1;
  }

  /** 누른 칸에서 그대로 떼어야 탭이다. 끌거나 두 손가락을 대면 무시한다 */
  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (down || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) {
        down = null; // 두 번째 손가락: 탭 취소
        return;
      }
      down = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        index: this.pick(e.clientX, e.clientY),
        back: e.button === 2 || e.shiftKey,
      };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const { x, y, index, back } = down;
      down = null;
      if (index < 0 || Math.hypot(e.clientX - x, e.clientY - y) > TAP_SLOP) return;
      if (this.pick(e.clientX, e.clientY) !== index) return;
      this.onTap?.(index, back ? -1 : 1);
    });
    el.addEventListener('pointercancel', () => {
      down = null;
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.onHover?.(this.pick(e.clientX, e.clientY));
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.onHover?.(-1);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault()); // 우클릭은 반시계 회전
  }

  // ---------- 카메라 ----------

  setInsets(insets) {
    this.insets = { ...this.insets, ...insets };
    this.cameraDirty = true;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.cameraDirty = true;
  }

  /** HUD 에 가리지 않는 영역 한가운데에 판 전체가 꽉 차게 보이도록 카메라를 놓는다 */
  placeCamera() {
    if (!this.cameraDirty || !this.game) return;
    this.cameraDirty = false;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const margin = Math.min(w, h) < 500 ? 6 : 18;
    const availW = Math.max(60, w - left - right - margin * 2);
    const availH = Math.max(60, h - top - bottom - margin * 2);

    const camera = this.camera;
    camera.clearViewOffset();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // 판을 감싸는 상자의 여덟 꼭짓점이 화면에서 차지하는 범위
    const half = this.size / 2 + 0.25;
    const corner = new THREE.Vector3();
    const extent = (distance) => {
      camera.position.set(0, Math.cos(TILT) * distance, Math.sin(TILT) * distance);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      let maxX = 0;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          for (const y of [-TILE_HEIGHT - 0.28, PIPE_Y + 0.25]) {
            corner.set(sx * half, y, sz * half).project(camera);
            maxX = Math.max(maxX, Math.abs(corner.x));
            minY = Math.min(minY, corner.y);
            maxY = Math.max(maxY, corner.y);
          }
        }
      }
      return { maxX, minY, maxY };
    };
    const fits = (distance) => {
      const { maxX, minY, maxY } = extent(distance);
      return maxX <= availW / w && (maxY - minY) / 2 <= availH / h;
    };
    let near = this.size * 0.5;
    let far = this.size * 40;
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    const { minY, maxY } = extent(far);
    const midY = (minY + maxY) / 2;
    const cx = (left + (w - right)) / 2;
    const cy = (top + (h - bottom)) / 2;
    camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy - (midY * h) / 2, w, h);
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.onFrame?.(dt);
    let lively = false;
    if (this.game) {
      this.placeCamera();
      lively = this.animate(dt);
    }
    if (this.loop.due(now, lively)) this.renderer.render(this.scene, this.camera);
  }

  /** 조각·물결·물방울을 움직인다. 물이 일렁이는 것 말고 움직인 것이 있으면 true */
  animate(dt) {
    const game = this.game;
    const wave = this.wave;
    if (wave) wave.time += dt;
    let moving = !!wave && wave.time < WAVE_TIME + PULSE_TIME;
    const turn = damp(18, dt);
    const soak = damp(9, dt);
    const color = new THREE.Color();
    let tilesDirty = false;

    this.cells.forEach((cell, index) => {
      const depth = game.depth[index];
      const filled = depth >= 0;
      cell.angle += (cell.target - cell.angle) * turn;
      cell.scale += (1 - cell.scale) * damp(7, dt);
      cell.wet += ((filled ? 1 : 0) - cell.wet) * soak;
      cell.press = Math.max(0, cell.press - dt * 5);
      if (
        Math.abs(cell.target - cell.angle) > 0.002 ||
        cell.scale < 0.995 ||
        cell.press > 0 ||
        Math.abs((filled ? 1 : 0) - cell.wet) > 0.01
      ) {
        moving = true;
      }

      // 완성 물결이 이 칸을 지나는 동안 솟았다 내려온다
      let pulse = 0;
      if (wave && wave.time >= cell.pulseAt) {
        const k = (wave.time - cell.pulseAt) / PULSE_TIME;
        if (k < 1) pulse = Math.sin(Math.PI * k);
        if (!cell.spouted) {
          cell.spouted = true;
          if (shapeOf(game.masks[index]) === 'end') this.spout(cell);
        }
      }

      const { mesh, material } = cell;
      mesh.rotation.y = cell.angle;
      mesh.position.y = PIPE_Y - cell.press * 0.05 + pulse * 0.16;
      mesh.scale.setScalar(Math.min(1, cell.scale + 0.001) * (1 + pulse * 0.12));
      material.color.lerpColors(DRY, WET, cell.wet);
      // 물이 찬 관은 수원에서 바깥으로 빛이 흘러가듯 일렁인다
      const ripple = 0.75 + 0.3 * Math.sin(this.time * 4.5 - Math.max(0, depth) * 0.9);
      material.emissiveIntensity = cell.wet * ripple + pulse * 1.6;
      material.metalness = 0.55 - cell.wet * 0.25;

      const tileWet = Math.round(cell.wet * 20) / 20;
      if (tileWet !== cell.tileWet) {
        cell.tileWet = tileWet;
        const parity = (index + (this.size % 2 ? 0 : Math.floor(index / this.size))) % 2;
        color.lerpColors(TILE_DRY[parity], TILE_WET[parity], tileWet);
        if (index === game.source) color.lerp(TILE_SOURCE, 0.55);
        this.tiles.setColorAt(index, color);
        tilesDirty = true;
      }
    });
    if (tilesDirty) this.tiles.instanceColor.needsUpdate = true;
    this.sourceWater.material.emissiveIntensity = 1.1 + 0.4 * Math.sin(this.time * 4.5);

    const visible = this.cursor >= 0 && this.cursor < this.cells.length && !game.solved;
    this.cursorMesh.visible = visible;
    if (visible) {
      const cell = this.cells[this.cursor];
      this.cursorMesh.position.set(cell.x, 0.012, cell.z);
    }
    this.animateDrops(dt);
    return moving || this.drops.length > 0;
  }

  animateDrops(dt) {
    const matrix = new THREE.Matrix4();
    let count = 0;
    this.drops = this.drops.filter((drop) => {
      drop.life -= dt;
      if (drop.life <= 0) return false;
      drop.vy -= 9 * dt;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;
      drop.z += drop.vz * dt;
      if (drop.y < 0.03) return false;
      matrix.makeTranslation(drop.x, drop.y, drop.z);
      this.dropMesh.setMatrixAt(count++, matrix);
      return true;
    });
    this.dropMesh.count = count;
    this.dropMesh.instanceMatrix.needsUpdate = true;
  }
}
