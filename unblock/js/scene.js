// Three.js 주차장 씬. 게임 상태(game.js)와 사건을 받아 그리기만 하고 규칙은 건드리지 않는다.
// 판 칸 (col, row) 의 가운데는 월드 좌표 (col - 2.5, 0, row - 2.5) 다 (three.js 는 y 가 위쪽). 한 칸이 1 단위다.
// 카메라는 남쪽(아래 줄 쪽) 위에서 비스듬히 내려다보고, 출구는 오른쪽 벽의 EXIT_ROW 줄에 뚫려 있다.
// 차 모델은 Kenney Car Kit 의 CC0 에셋이다 (assets/CREDITS.md). 바닥 선·벽·출구 표시는 단순 도형이라 코드로 만든다.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { SIZE, EXIT_ROW, GOAL_COL } from './game.js';
import { damp } from '../../shared/util.js';

const asset = (path) => new URL(`../assets/${path}`, import.meta.url).href;

// 길이 2 차와 길이 3 차(트럭·버스)로 쓰는 모델. 내 차는 빨간 스포츠 세단이다
const RED_MODEL = 'sedan-sports';
const CAR_MODELS = ['taxi', 'van', 'police', 'hatchback-sports', 'suv', 'suv-luxury'];
const TRUCK_MODELS = ['delivery', 'garbage-truck', 'ambulance'];
const MODELS = [RED_MODEL, ...CAR_MODELS, ...TRUCK_MODELS, 'cone'];

const HALF = SIZE / 2;
const CAR_WIDTH = 0.8; // 칸 너비 1 에 맞춰 모델을 옆으로 조금 줄인다
const CAR_GAP = 0.16; // 앞뒤 차 사이 틈
const MAX_HEIGHT = { 2: 0.85, 3: 1.1 }; // 뒤 칸을 너무 가리지 않게 키를 누른다
const WALL_HEIGHT = 0.28;
const WALL_THICK = 0.3;
const LANE_LENGTH = 6; // 출구 밖 길
const POLAR = 0.62; // 수직에서 기운 각도(라디안)
const SPEED = 9; // 칸/초. 멀리 남아 있으면 더 빨리 따라잡는다
const EXIT_SPEED = 1.2; // 출구로 달려 나갈 때 처음 속도와 가속도 (칸/초, 칸/초²)
const EXIT_ACCEL = 8;
const MAX_PARTICLES = 220;
const SELECT_COLOR = 0xffd166;
const HINT_COLOR = 0x5ee08a;
const CONFETTI = ['#f2c94c', '#e8504a', '#3fbf7f', '#3f8ae0', '#f08c3a', '#f3ecdc'];

/** 차 번호로 정하는 모양 (같은 단계는 언제나 같은 차들로 보이게) */
function modelFor(piece, id) {
  if (id === 0) return RED_MODEL;
  const list = piece.length === 3 ? TRUCK_MODELS : CAR_MODELS;
  const code = piece.letter.charCodeAt(0);
  return list[(code * 7 + piece.fixed) % list.length];
}

/** 바닥에 붙는 둥근 네모 (선택·힌트 표시) */
function roundedPlate(w, h, r) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return new THREE.ShapeGeometry(shape, 6).rotateX(-Math.PI / 2);
}

export class UnblockScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true, alpha: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
    this.raycaster = new THREE.Raycaster();
    this.buildLights();

    this.templates = {};
    this.cars = [];
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 }; // HUD 가 가리는 화면 가장자리 픽셀
    this.particles = [];
    this.selected = -1;
    this.hint = null; // { id, to }
    this.exiting = -1; // 내 차가 출구로 달려 나간 뒤 지난 시간. 음수면 아직
    this.time = 0;
    this.onFrame = null; // (dt) => void, 프레임마다 그리기 전에 불린다

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x3a3a40, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    const s = sun.shadow.camera;
    s.left = -7;
    s.right = 9;
    s.top = 7;
    s.bottom = -7;
    s.near = 1;
    s.far = 40;
    sun.position.set(-5, 12, 6);
    sun.target.position.set(1, 0, 0);
    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  /** 모델·텍스처를 불러오고 주차장을 짓고 그리기를 시작한다. exitLabel 은 출구 길에 쓸 글자 */
  async load({ exitLabel = 'EXIT' } = {}) {
    const loader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();
    const [gltfs, color, normal] = await Promise.all([
      Promise.all(MODELS.map((name) => loader.loadAsync(asset(`models/${name}.glb`)))),
      textureLoader.loadAsync(asset('textures/Concrete034_color.jpg')),
      textureLoader.loadAsync(asset('textures/Concrete034_normal.jpg')),
    ]);
    MODELS.forEach((name, i) => {
      const root = gltfs[i].scene;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        o.material.roughness = 0.55; // 원본은 거칠기 1 이라 차체가 너무 무르게 보인다
      });
      this.templates[name] = root;
    });
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.buildLot(color, normal, exitLabel);
    this.buildShared();
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  // ---------- 주차장 ----------

  buildLot(color, normal, exitLabel) {
    color.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [color, normal]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
    }
    const lot = new THREE.Group();

    // 바깥 바닥: 어둡게 물들인 콘크리트
    const outerColor = color.clone();
    const outerNormal = normal.clone();
    for (const texture of [outerColor, outerNormal]) texture.repeat.set(8, 8);
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: outerColor, normalMap: outerNormal, color: 0x4a4e57, roughness: 0.95 }),
    );
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    lot.add(outer);

    // 주차장 바닥: 칸 크기에 맞춘 밝은 콘크리트
    color.repeat.set(2, 2);
    normal.repeat.set(2, 2);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: color, normalMap: normal, color: 0xb5b2aa, roughness: 0.9 }),
    );
    floor.receiveShadow = true;
    lot.add(floor);

    // 칸을 가르는 흰 주차선
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf3f0e6, transparent: true, opacity: 0.55 });
    for (let k = 1; k < SIZE; k++) {
      const v = new THREE.Mesh(new THREE.PlaneGeometry(0.04, SIZE).rotateX(-Math.PI / 2), lineMaterial);
      v.position.set(k - HALF, 0.004, 0);
      const h = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, 0.04).rotateX(-Math.PI / 2), lineMaterial);
      h.position.set(0, 0.004, k - HALF);
      lot.add(v, h);
    }

    // 둘레의 낮은 벽. 오른쪽 벽은 출구 줄만 비운다
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x8d8f96, roughness: 0.85 });
    const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 });
    const wall = (x0, z0, x1, z1) => {
      const w = x1 - x0;
      const d = z1 - z0;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), wallMaterial);
      body.position.set((x0 + x1) / 2, WALL_HEIGHT / 2, (z0 + z1) / 2);
      body.castShadow = body.receiveShadow = true;
      // 위에 노란 띠를 둘러 벽이 눈에 띄게 한다
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w + 0.002, 0.05, d + 0.002), stripeMaterial);
      stripe.position.set((x0 + x1) / 2, WALL_HEIGHT - 0.02, (z0 + z1) / 2);
      lot.add(body, stripe);
    };
    const o = HALF + WALL_THICK;
    wall(-o, -o, o, -HALF); // 위
    wall(-o, HALF, o, o); // 아래
    wall(-o, -HALF, -HALF, HALF); // 왼쪽
    const gapTop = EXIT_ROW - HALF;
    const gapBottom = gapTop + 1;
    wall(HALF, -HALF, o, gapTop); // 오른쪽 (출구 위)
    wall(HALF, gapBottom, o, HALF); // 오른쪽 (출구 아래)

    // 출구 밖 길: 화살표와 글자를 그린 캔버스 텍스처
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_LENGTH, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: this.laneTexture(exitLabel), roughness: 0.9 }),
    );
    lane.position.set(HALF + LANE_LENGTH / 2, 0.003, gapTop + 0.5);
    lane.receiveShadow = true;
    lot.add(lane);

    // 출구 양옆의 고깔
    for (const z of [gapTop - 0.08, gapBottom + 0.08]) {
      const cone = this.templates.cone.clone();
      cone.scale.setScalar(0.42 / new THREE.Box3().setFromObject(this.templates.cone).getSize(new THREE.Vector3()).y);
      cone.position.set(HALF + WALL_THICK + 0.15, 0, z);
      lot.add(cone);
    }

    // 출구 칸 바닥을 은은하게 빛내 어디로 빼야 하는지 보이게 한다
    this.exitGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.exitGlow.position.set(HALF + 0.2, 0.006, gapTop + 0.5);
    lot.add(this.exitGlow);

    this.scene.add(lot);
  }

  laneTexture(label) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = '#3a3d44';
    g.fillRect(0, 0, canvas.width, canvas.height);
    // 가장자리 흰 선
    g.fillStyle = 'rgba(243,240,230,0.7)';
    g.fillRect(0, 6, canvas.width, 6);
    g.fillRect(0, canvas.height - 12, canvas.width, 6);
    // 바깥쪽을 가리키는 화살표 세 개
    g.fillStyle = '#f2c230';
    for (const x of [30, 120, 210]) {
      g.beginPath();
      g.moveTo(x, 34);
      g.lineTo(x + 34, 34);
      g.lineTo(x + 64, 64);
      g.lineTo(x + 34, 94);
      g.lineTo(x, 94);
      g.lineTo(x + 30, 64);
      g.closePath();
      g.fill();
    }
    g.fillStyle = 'rgba(243,240,230,0.9)';
    g.font = 'bold 54px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(label, 310, 66);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  /** 단계가 바뀌어도 그대로 쓰는 도형·재질 */
  buildShared() {
    this.plates = { 2: roundedPlate(2 - 0.08, 0.92, 0.18), 3: roundedPlate(3 - 0.08, 0.92, 0.18) };
    this.hintMaterial = new THREE.MeshBasicMaterial({ color: HINT_COLOR, transparent: true, opacity: 0.5, depthWrite: false });
    this.hintGhost = new THREE.Mesh(this.plates[2], this.hintMaterial);
    this.hintGhost.visible = false;
    this.scene.add(this.hintGhost);

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

  /** 모델을 칸에 맞춘 차 한 대 (가로 차는 x 축, 세로 차는 z 축을 따라 놓인다) */
  buildCar(piece, id) {
    const template = this.templates[modelFor(piece, id)];
    const model = template.clone();
    const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
    // 모델은 앞이 +z 다. 길이·너비를 칸에 맞추고 키는 길이 배율을 따르되 너무 크지 않게 누른다
    const sz = (piece.length - CAR_GAP) / size.z;
    model.scale.set(CAR_WIDTH / size.x, Math.min(sz, MAX_HEIGHT[piece.length] / size.y), sz);
    const forward = id === 0 || (piece.letter.charCodeAt(0) + piece.fixed) % 2 === 0;
    const heading = piece.horizontal ? (forward ? Math.PI / 2 : -Math.PI / 2) : forward ? 0 : Math.PI;
    const turn = new THREE.Group();
    turn.rotation.y = heading;
    turn.add(model);

    const plateMaterial = new THREE.MeshBasicMaterial({
      color: SELECT_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const plate = new THREE.Mesh(this.plates[piece.length], plateMaterial);
    plate.position.y = 0.008;
    if (!piece.horizontal) plate.rotation.y = Math.PI / 2;

    const group = new THREE.Group();
    group.add(turn, plate);
    group.traverse((o) => {
      o.userData.car = id;
    });
    return { piece, group, model: turn, plate, plateMaterial, pos: piece.start, target: piece.start, lift: 0, bump: 0 };
  }

  // ---------- 판 ----------

  /** 단계마다 차를 다시 놓는다 */
  setup(game) {
    for (const car of this.cars) {
      this.scene.remove(car.group);
      car.plateMaterial.dispose();
    }
    this.game = game;
    this.cars = game.pieces.map((piece, id) => {
      const car = this.buildCar(piece, id);
      this.scene.add(car.group);
      return car;
    });
    this.particles = [];
    this.selected = -1;
    this.dragging = -1;
    this.clearHint();
    this.snap();
  }

  /** 움직임 없이 지금 게임 상태 그대로 놓는다 (단계 시작, 다시 시작) */
  snap() {
    this.cars.forEach((car, id) => {
      car.pos = car.target = this.game.positions[id];
      car.bump = 0;
      car.group.visible = true;
      this.place(car);
    });
    this.exiting = -1;
    this.pendingExit = false;
  }

  /** 차의 자리(칸 단위, 소수 가능) → 월드 위치 */
  place(car) {
    const { piece } = car;
    const along = car.pos + piece.length / 2 - HALF + car.bump;
    const across = piece.fixed + 0.5 - HALF;
    if (piece.horizontal) car.group.position.set(along, car.lift, across);
    else car.group.position.set(across, car.lift, along);
  }

  /** 고른 차를 표시한다 (-1 이면 없음) */
  select(id) {
    this.selected = id;
  }

  /** 끄는 중인 차를 pos(소수) 에 그대로 놓는다. id 가 -1 이면 끌기를 끝낸다 */
  drag(id, pos) {
    this.dragging = id;
    if (id < 0) return;
    const car = this.cars[id];
    car.pos = car.target = pos;
  }

  /** 끌던 차를 게임의 자리로 돌려보낸다 (움직이지 않았을 때) */
  settle(id) {
    const car = this.cars[id];
    if (car) car.target = this.game.positions[id];
    this.dragging = -1;
  }

  /** 힌트: 차 id 를 to 자리로 밀면 된다 */
  showHint({ id, to }) {
    const piece = this.game.pieces[id];
    this.hint = { id, to };
    this.hintGhost.geometry = this.plates[piece.length];
    const along = to + piece.length / 2 - HALF;
    const across = piece.fixed + 0.5 - HALF;
    if (piece.horizontal) this.hintGhost.position.set(along, 0.01, across);
    else this.hintGhost.position.set(across, 0.01, along);
    this.hintGhost.rotation.y = piece.horizontal ? 0 : Math.PI / 2;
    this.hintGhost.visible = true;
  }

  clearHint() {
    this.hint = null;
    if (this.hintGhost) this.hintGhost.visible = false;
  }

  /** 게임 사건을 화면에 반영한다 */
  handle(event) {
    switch (event.type) {
      case 'move':
      case 'undo':
        this.cars[event.id].target = event.to;
        if (this.dragging === event.id) this.dragging = -1;
        if (event.type === 'undo') this.snapExit();
        this.clearHint();
        break;
      case 'blocked':
        // 끌지 않고(키보드로) 막힌 쪽으로 밀면 그쪽으로 살짝 부딪친다
        if (this.dragging !== event.id) this.cars[event.id].bump = event.dir * 0.12;
        break;
      case 'restart':
        this.clearHint();
        this.snap();
        break;
      case 'solved':
        this.pendingExit = true; // 내 차가 출구에 닿으면 달려 나간다
        this.clearHint();
        break;
    }
  }

  /** 클리어 연출 중에 되돌리면 내 차를 다시 판 위로 */
  snapExit() {
    if (this.exiting < 0 && !this.pendingExit) return;
    this.exiting = -1;
    this.pendingExit = false;
    const red = this.cars[0];
    red.pos = Math.min(red.pos, GOAL_COL);
    red.group.visible = true;
  }

  // ---------- 입력 ----------

  /** 화면 좌표 → 정규화 좌표 */
  ndc(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** 화면 좌표에서 높이 y 의 수평면과 만나는 점 → 판 좌표 { u, v } (칸 단위, 왼쪽 위 모서리가 0). 없으면 null */
  boardPoint(clientX, clientY, y = 0.35) {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return hit ? { u: hit.x + HALF, v: hit.z + HALF } : null;
  }

  /** 화면 좌표 아래의 차 번호. 모델에 맞지 않으면 그 칸의 차, 그것도 없으면 -1 */
  pickCar(clientX, clientY) {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hits = this.raycaster.intersectObjects(
      this.cars.map((car) => car.model),
      true,
    );
    if (hits.length) return hits[0].object.userData.car ?? -1;
    const point = this.boardPoint(clientX, clientY, 0.2);
    if (!point) return -1;
    return this.game.pieceAt(Math.floor(point.u), Math.floor(point.v));
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

  /** 차들을 움직인다. 움직이는 차가 있으면 true */
  updateCars(dt) {
    let moving = false;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    this.cars.forEach((car, id) => {
      if (id === 0 && this.exiting >= 0) {
        // 출구로 달려 나간다: 점점 빨라진다
        this.exiting += dt;
        car.pos = GOAL_COL + EXIT_SPEED * this.exiting + 0.5 * EXIT_ACCEL * this.exiting ** 2;
        car.group.visible = car.pos < GOAL_COL + LANE_LENGTH + 2;
        moving = car.group.visible;
      } else if (car.pos !== car.target) {
        const distance = car.target - car.pos;
        const step = Math.max(SPEED, Math.abs(distance) * 14) * dt;
        if (Math.abs(distance) <= step) {
          car.pos = car.target;
          if (id === 0 && this.pendingExit && car.pos === GOAL_COL) this.startExit();
        } else {
          car.pos += Math.sign(distance) * step;
        }
        moving = true;
      } else if (id === 0 && this.pendingExit && car.pos === GOAL_COL) {
        this.startExit();
      }
      car.bump *= Math.exp(-dt * 14);
      if (Math.abs(car.bump) < 1e-3) car.bump = 0;
      else moving = true;
      const active = id === this.selected || id === this.dragging;
      const hinted = this.hint?.id === id;
      const liftTarget = id === this.dragging ? 0.06 : 0;
      car.lift += (liftTarget - car.lift) * damp(18, dt);
      car.plateMaterial.color.setHex(hinted && !active ? HINT_COLOR : SELECT_COLOR);
      const opacity = active ? 0.55 : hinted ? 0.25 + 0.35 * pulse : 0;
      car.plateMaterial.opacity += (opacity - car.plateMaterial.opacity) * damp(16, dt);
      this.place(car);
    });
    if (this.hint) this.hintMaterial.opacity = 0.25 + 0.3 * pulse;
    this.exitGlow.material.opacity = this.exiting >= 0 ? 0.5 : 0.18 + 0.12 * Math.sin(this.time * 2.4);
    return moving || !!this.hint;
  }

  startExit() {
    this.pendingExit = false;
    this.exiting = 0;
    this.burst(new THREE.Vector3(HALF + 0.3, 0.4, EXIT_ROW + 0.5 - HALF), 70, { speed: 3, up: 5, life: 1.5 });
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

  /** HUD 에 가리지 않는 영역 한가운데에 주차장과 출구가 꽉 차게 보이도록 카메라를 놓는다 (세로 화면에서도) */
  placeCamera() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const cx = (left + (w - right)) / 2;
    const cy = (top + (h - bottom)) / 2;
    this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);

    // 좁은 화면에서는 출구 밖 길을 조금만 보여 판을 크게 그린다
    const free = (w - left - right) / Math.max(1, h - top - bottom);
    const outside = free < 0.9 ? 0.9 : 1.8;
    const x0 = -HALF - WALL_THICK;
    const x1 = HALF + WALL_THICK + outside;
    const z0 = -HALF - WALL_THICK;
    const z1 = HALF + WALL_THICK;
    const direction = new THREE.Vector3(0, Math.cos(POLAR), Math.sin(POLAR));
    const target = new THREE.Vector3((x0 + x1) / 2, 0, 0.1);
    const limit = {
      left: -1 + (2 * left) / w + 0.02,
      right: 1 - (2 * right) / w - 0.02,
      bottom: -1 + (2 * bottom) / h + 0.02,
      top: 1 - (2 * top) / h - 0.02,
    };
    const corners = [];
    for (const x of [x0, x1]) {
      for (const z of [z0, z1]) corners.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 0.5, z));
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
    fits(hi);
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.onFrame?.(dt);

    let lively = false;
    let casters = false;
    if (this.game) {
      casters = this.updateCars(dt);
      lively = casters || this.exiting >= 0;
      this.updateParticles(dt);
      if (this.particles.length) lively = true;
    }
    this.placeCamera();
    if (this.loop.due(now, lively, casters)) this.renderer.render(this.scene, this.camera);
  }
}
