// Three.js 소코반 씬. 게임 상태(game.js)와 사건을 받아 그리기만 하고 규칙은 건드리지 않는다.
// 지도 칸 (x, y) 는 월드 좌표 (x, 0, y) 방향에 놓인다 (three.js 는 y 가 위쪽). 판 가운데가 원점이고 한 칸이 1 단위다.
// 카메라는 남쪽 위에서 비스듬히 내려다보므로 지도의 위쪽이 화면 안쪽이 된다.
// 모델은 Kenney 의 CC0 에셋이다 (assets/CREDITS.md).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { DIRS } from './game.js';

const asset = (path) => new URL(`../assets/${path}`, import.meta.url).href;

const MODELS = {
  floor: 'mini-dungeon/floor',
  wall: 'mini-dungeon/wall',
  character: 'mini-dungeon/character-human',
  crate: 'platformer-kit/crate',
  crateDone: 'platformer-kit/crate-item', // 목표에 놓인 상자
};

const WALL_HEIGHT = 0.5; // 뒤 칸을 가리지 않도록 원본(1.1)보다 낮춘다
const CRATE_SIZE = 0.84;
const CHARACTER_HEIGHT = 1.05;
const MIN_VIEW = { W: 7, H: 7 }; // 카메라를 맞출 때 판을 적어도 이 크기로 친다
const POLAR = 0.5; // 수직에서 기운 각도(라디안)
const SPEED = 7.5; // 칸/초. 밀려 있으면 더 빨리 따라잡는다
const MAX_PARTICLES = 260;
const GOAL_COLOR = 0xf2c94c;
const CONFETTI = ['#f2c94c', '#e8504a', '#3fbf7f', '#3f8ae0', '#f08c3a', '#f3ecdc'];

const damp = (k, dt) => 1 - Math.exp(-k * dt);

/** position 을 target 쪽으로 일정한 속도로 옮긴다. 닿았으면 true */
function approach(position, target, dt) {
  const distance = position.distanceTo(target);
  const step = Math.max(SPEED, distance * 14) * dt;
  if (step >= distance) {
    position.copy(target);
    return true;
  }
  position.lerp(target, step / distance);
  return false;
}

export class SokobanScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true, alpha: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300);
    this.buildLights();

    this.templates = {};
    this.size = { W: 8, H: 8 };
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 }; // HUD 가 가리는 화면 가장자리 픽셀
    this.zoom = 1; // 클리어 때 살짝 당겼다 놓는다
    this.zoomTarget = 1;
    this.particles = [];
    this.crates = [];
    this.goals = [];
    this.celebrating = -1; // 클리어 연출이 시작된 뒤 지난 시간. 음수면 연출 중이 아니다
    this.time = 0;
    this.onFrame = null; // (dt) => void, 프레임마다 그리기 전에 불린다

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x4a4038, 1.5));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  /** 모델을 불러오고 그리기를 시작한다 */
  async load() {
    const loader = new GLTFLoader();
    const names = Object.keys(MODELS);
    const gltfs = await Promise.all(names.map((name) => loader.loadAsync(asset(`models/${MODELS[name]}.glb`))));
    names.forEach((name, i) => {
      const root = gltfs[i].scene;
      root.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      this.templates[name] = root;
    });
    this.buildCharacter(gltfs[names.indexOf('character')]);
    this.buildShared();
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  /** 모델을 높이(또는 너비)가 size 가 되도록 맞춘 배율 */
  fitScale(template, size, axis = 'y') {
    const box = new THREE.Box3().setFromObject(template);
    return size / (box.max[axis] - box.min[axis]);
  }

  buildCharacter(gltf) {
    const model = gltf.scene;
    model.scale.setScalar(this.fitScale(model, CHARACTER_HEIGHT));
    model.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false; // 뼈대로 움직이는 모델은 경계 상자가 맞지 않는다
    });
    this.character = new THREE.Group();
    this.character.add(model);
    this.characterModel = model;
    this.characterBase = new THREE.Vector3(); // 부딪침·뜀을 뺀 자리
    this.characterTarget = new THREE.Vector3();
    this.heading = 0; // 바라보는 각도(라디안). 0 이 화면 앞쪽(남쪽)
    this.lunge = new THREE.Vector3(); // 막혔을 때 살짝 부딪치는 움직임

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    if (this.actions.walk) this.actions.walk.timeScale = 1.7;
    this.currentAction = null;
    this.play('idle');
  }

  /** 캐릭터 동작을 부드럽게 바꾼다. 모델에 없는 동작이면 그대로 둔다 */
  play(name) {
    const next = this.actions[name];
    if (!next || next === this.currentAction) return;
    next.reset().fadeIn(0.12).play();
    this.currentAction?.fadeOut(0.12);
    this.currentAction = next;
  }

  /** 레벨이 바뀌어도 그대로 쓰는 도형·재질 */
  buildShared() {
    // 바닥은 체스판처럼 번갈아 어둡게 해 칸이 보이게 한다
    this.floorDark = this.templates.floor.clone();
    this.floorDark.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color.multiplyScalar(0.8);
      }
    });
    this.templates.wall.scale.y = WALL_HEIGHT / new THREE.Box3().setFromObject(this.templates.wall).max.y;
    // 벽 모델은 속이 빈 망루라 안이 바닥처럼 보인다. 어두운 덩어리로 속을 채운다
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, WALL_HEIGHT - 0.06, 0.9).translate(0, (WALL_HEIGHT - 0.06) / 2, 0),
      new THREE.MeshStandardMaterial({ color: 0x4f5470, roughness: 0.9 }),
    );
    core.receiveShadow = true;
    this.wallBlock = new THREE.Group();
    this.wallBlock.add(this.templates.wall, core);
    this.templates.crate.scale.setScalar(this.fitScale(this.templates.crate, CRATE_SIZE, 'x'));
    this.templates.crateDone.scale.setScalar(this.fitScale(this.templates.crateDone, CRATE_SIZE, 'x'));
    // 목표에 놓인 상자는 은은하게 빛난다
    this.templates.crateDone.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(0xffb020);
        o.material.emissiveMap = o.material.map;
        o.material.emissiveIntensity = 0.12;
      }
    });

    // 목표 표시: 바닥에 붙은 고리와 가운데 점 (맞는 에셋이 없는 단순 도형)
    this.goalRing = new THREE.RingGeometry(0.24, 0.34, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2);
    this.goalDot = new THREE.CircleGeometry(0.1, 4, Math.PI / 4).rotateX(-Math.PI / 2);

    this.particleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.09, 0.09, 0.09),
      new THREE.MeshBasicMaterial(),
      MAX_PARTICLES,
    );
    this.particleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
  }

  /** 지도 칸 → 월드 좌표 */
  world(x, y, out = new THREE.Vector3()) {
    return out.set(x - this.center.x, 0, y - this.center.y);
  }

  cellWorld(cell, out) {
    const [x, y] = this.game.xy(cell);
    return this.world(x, y, out);
  }

  // ---------- 판 ----------

  /** 레벨마다 판을 다시 짓는다 */
  setup(game) {
    if (this.board) {
      this.board.remove(this.character);
      this.scene.remove(this.board);
      for (const goal of this.goals) goal.material.dispose();
    }
    this.game = game;
    this.particles = [];
    this.celebrating = -1;
    this.zoomTarget = 1;
    const { width: W, height: H } = game;
    this.size = { W, H };
    this.center = { x: (W - 1) / 2, y: (H - 1) / 2 };
    this.board = new THREE.Group();
    this.scene.add(this.board);

    const { walls, floor } = game.level;
    const nearFloor = (x, y) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && floor[ny * W + nx]) return true;
        }
      }
      return false;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cell = y * W + x;
        let tile = null;
        if (floor[cell]) tile = ((x + y) % 2 ? this.floorDark : this.templates.floor).clone();
        else if (walls[cell] && nearFloor(x, y)) tile = this.wallBlock.clone(); // 안쪽과 닿은 벽만 세운다
        if (!tile) continue;
        this.world(x, y, tile.position);
        this.board.add(tile);
      }
    }

    this.goals = game.level.goals.map((cell) => {
      const material = new THREE.MeshBasicMaterial({ color: GOAL_COLOR, transparent: true });
      const marker = new THREE.Group();
      marker.add(new THREE.Mesh(this.goalRing, material), new THREE.Mesh(this.goalDot, material));
      this.cellWorld(cell, marker.position).y = 0.012;
      this.board.add(marker);
      return { cell, marker, material };
    });

    this.crates = game.boxes.map((cell) => {
      const group = new THREE.Group();
      const plain = this.templates.crate.clone();
      const done = this.templates.crateDone.clone();
      group.add(plain, done);
      this.board.add(group);
      return { group, plain, done, target: new THREE.Vector3(), onGoal: null, pop: 0 };
    });
    this.board.add(this.character);
    this.snap();

    const s = this.sun.shadow.camera;
    const r = Math.hypot(W, H) / 2 + 1;
    s.left = s.bottom = -r;
    s.right = s.top = r;
    s.near = 1;
    s.far = r * 4 + 10;
    s.updateProjectionMatrix();
    this.sun.position.set(-r * 0.6, r * 1.8 + 4, r * 0.7);
    this.sun.target.position.set(0, 0, 0);
  }

  setCrateGoal(crate, onGoal) {
    crate.onGoal = onGoal;
    crate.plain.visible = !onGoal;
    crate.done.visible = onGoal;
  }

  /** 움직임 없이 지금 게임 상태 그대로 놓는다 (레벨 시작, 다시 시작) */
  snap() {
    const { game } = this;
    this.crates.forEach((crate, id) => {
      this.cellWorld(game.boxes[id], crate.target);
      crate.group.position.copy(crate.target);
      crate.arriving = false;
      crate.pop = 0;
      this.setCrateGoal(crate, game.isGoal(game.boxes[id]));
    });
    this.cellWorld(game.player, this.characterTarget);
    this.characterBase.copy(this.characterTarget);
    this.character.position.copy(this.characterBase);
    this.lunge.set(0, 0, 0);
    this.face(game.facing, true);
    this.celebrating = -1;
    this.zoomTarget = 1;
  }

  face(dir, instant = false) {
    const [dx, dy] = DIRS[dir];
    this.headingTarget = Math.atan2(dx, dy);
    if (instant) this.heading = this.headingTarget;
  }

  /** 게임 사건을 화면에 반영한다 */
  handle(event) {
    switch (event.type) {
      case 'move':
        this.face(event.dir);
        this.cellWorld(event.to, this.characterTarget);
        if (event.pushed) this.moveCrate(event.pushed, true);
        break;
      case 'undo':
        // 뒷걸음질: 보던 방향은 그대로 둔다
        this.face(event.dir);
        this.cellWorld(event.to, this.characterTarget);
        if (event.pulled) this.moveCrate(event.pulled, false);
        this.celebrating = -1;
        this.zoomTarget = 1;
        break;
      case 'blocked': {
        this.face(event.dir);
        const [dx, dy] = DIRS[event.dir];
        this.lunge.set(dx * 0.16, 0, dy * 0.16);
        break;
      }
      case 'restart':
        this.snap();
        break;
      case 'solved':
        this.pendingCelebration = true; // 마지막 상자가 자리에 닿으면 시작한다
        break;
    }
  }

  moveCrate({ box, to, onGoal }, celebrate) {
    const crate = this.crates[box];
    this.cellWorld(to, crate.target);
    crate.arriving = true;
    crate.celebrate = celebrate && onGoal;
    if (!onGoal) this.setCrateGoal(crate, false); // 목표에서 벗어나면 바로 원래 모습으로
  }

  // ---------- 효과 ----------

  burst(position, count, { colors = CONFETTI, speed = 2.4, up = 3.2, life = 0.9 } = {}) {
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        position: position.clone(),
        velocity: new THREE.Vector3(Math.cos(angle) * v, up * (0.6 + Math.random() * 0.6), Math.sin(angle) * v),
        spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
        color: new THREE.Color(colors[Math.floor(Math.random() * colors.length)]),
        life: life * (0.7 + Math.random() * 0.6),
        age: 0,
      });
    }
  }

  celebrate() {
    this.pendingCelebration = false;
    this.celebrating = 0;
    this.zoomTarget = 0.93;
    this.face('down');
    for (const crate of this.crates) {
      this.burst(crate.group.position.clone().setY(CRATE_SIZE), 22, { speed: 3, up: 5, life: 1.5 });
    }
  }

  updateParticles(dt) {
    const dummy = (this.dummy ??= new THREE.Object3D());
    let n = 0;
    this.particles = this.particles.filter((p) => (p.age += dt) < p.life);
    for (const p of this.particles) {
      p.velocity.y -= 9 * dt;
      p.position.addScaledVector(p.velocity, dt);
      if (p.position.y < 0.05) {
        p.position.y = 0.05;
        p.velocity.multiplyScalar(0.4).setY(Math.abs(p.velocity.y));
      }
      dummy.position.copy(p.position);
      dummy.rotation.set(p.spin.x * p.age, p.spin.y * p.age, p.spin.z * p.age);
      dummy.scale.setScalar(Math.min(1, (p.life - p.age) * 4));
      dummy.updateMatrix();
      this.particleMesh.setMatrixAt(n, dummy.matrix);
      this.particleMesh.setColorAt(n, p.color);
      n++;
    }
    this.particleMesh.count = n;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.particleMesh.instanceColor.needsUpdate = true;
  }

  /** 캐릭터와 상자를 움직인다. 걷거나 밀리거나 뛰는 중이면 true */
  updateActors(dt) {
    // 캐릭터
    const arrived = approach(this.characterBase, this.characterTarget, dt);
    this.lunge.multiplyScalar(Math.exp(-dt * 16));
    this.character.position.copy(this.characterBase).add(this.lunge);
    let turn = this.headingTarget - this.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn)); // 가까운 쪽으로 돈다
    this.heading += turn * damp(22, dt);
    this.character.rotation.y = this.heading;

    // 상자
    let moving = false;
    this.crates.forEach((crate, id) => {
      if (crate.arriving) {
        if (approach(crate.group.position, crate.target, dt)) {
          crate.arriving = false;
          const onGoal = this.game.isGoal(this.game.boxes[id]);
          if (onGoal && !crate.onGoal && crate.celebrate) {
            crate.pop = 1;
            this.burst(crate.target.clone().setY(0.3), 14, { colors: ['#f2c94c', '#fff3c4'], speed: 1.8, up: 2.6, life: 0.6 });
          }
          this.setCrateGoal(crate, onGoal);
        } else {
          moving = true;
        }
      }
      crate.pop *= Math.exp(-dt * 9);
      let hop = 0;
      if (this.celebrating >= 0) {
        // 클리어: 상자들이 차례로 폴짝 뛴다
        const phase = this.celebrating * 7 - id * 0.9;
        if (phase > 0 && phase < Math.PI * 3) hop = Math.abs(Math.sin(phase)) * 0.3 * (1 - phase / (Math.PI * 3));
      }
      crate.group.position.y = hop;
      crate.group.scale.setScalar(1 + crate.pop * 0.2);
    });

    if (this.pendingCelebration && !moving) this.celebrate();
    if (this.celebrating >= 0) {
      this.celebrating += dt;
      this.play(this.actions['emote-yes'] ? 'emote-yes' : 'idle');
      this.character.position.y = Math.abs(Math.sin(this.celebrating * 8)) * 0.22 * Math.max(0, 1 - this.celebrating / 2.2);
    } else {
      this.character.position.y = 0;
      this.play(arrived ? 'idle' : 'walk');
    }

    // 빈 목표는 깜빡여 눈에 띄게, 상자가 놓이면 상자에 가려진다
    const pulse = 0.62 + 0.3 * Math.sin(this.time * 3.2);
    for (const goal of this.goals) goal.material.opacity = pulse;

    return !arrived || moving || this.lunge.lengthSq() > 1e-5 || (this.celebrating >= 0 && this.celebrating < 4);
  }

  // ---------- 카메라 ----------

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

  /** HUD 에 가리지 않는 영역 한가운데에 판 전체가 꽉 차게 보이도록 카메라를 놓는다 (세로 화면에서도) */
  placeCamera() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const cx = (left + (w - right)) / 2;
    const cy = (top + (h - bottom)) / 2;
    this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);

    const direction = new THREE.Vector3(0, Math.cos(POLAR), Math.sin(POLAR));
    const target = new THREE.Vector3(0, 0, 0);
    // 화면에서 쓸 수 있는 영역 (NDC)
    const limit = {
      left: -1 + (2 * left) / w + 0.03,
      right: 1 - (2 * right) / w - 0.03,
      bottom: -1 + (2 * bottom) / h + 0.03,
      top: 1 - (2 * top) / h - 0.03,
    };
    // 작은 판이 화면을 꽉 채워 너무 커 보이지 않게 최소 크기를 둔다
    const W = Math.max(this.size.W, MIN_VIEW.W);
    const H = Math.max(this.size.H, MIN_VIEW.H);
    const corners = [];
    for (const x of [-W / 2, W / 2]) {
      for (const z of [-H / 2, H / 2]) corners.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, WALL_HEIGHT, z));
    }
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
    let hi = 200;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi * this.zoom);
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.onFrame?.(dt);

    let lively = Math.abs(this.zoomTarget - this.zoom) > 0.002;
    if (this.game) {
      if (this.updateActors(dt)) lively = true;
      this.updateParticles(dt);
      if (this.particles.length) lively = true;
    }
    this.mixer?.update(dt);
    this.zoom += (this.zoomTarget - this.zoom) * damp(5, dt);
    this.placeCamera();
    // 서 있는 캐릭터도 조금씩 움직이므로 그림자는 그릴 때마다 맞춘다
    if (this.loop.due(now, lively, true)) this.renderer.render(this.scene, this.camera);
  }
}
