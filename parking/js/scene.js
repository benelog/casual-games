// Three.js 주차장 씬. 판(game.js 의 ParkingRun)의 차 자리와 단계 데이터를 받아 그리기만 하고 규칙은 건드리지 않는다.
// 길이 단위는 미터이고 좌표계는 physics.js 와 같다 (바닥이 y=0, 위에서 보아 x 오른쪽, z 아래쪽).
//
// 자동차와 콘은 Kenney Car Kit 의 CC0 모델을 모델별 크기(physics.js 의 VEHICLES)에 맞춰 늘여 그리므로
// 보이는 차체와 충돌 사각형이 같다. 바닥은 Poly Haven 의 아스팔트·콘크리트 텍스처이고,
// 주차선·연석·벽·기둥·목표 칸 표시·예상 궤적은 단순한 도형이라 코드로 만든다. 출처는 assets/CREDITS.md 참고.
//
// 카메라는 셋: 위에서 내려다보기(top), 차 뒤 3인칭(chase), 3인칭이다가 후진 기어면 차 앞에서 뒤를 보는 후방 시점(rear).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';
import { CAR, VEHICLES, advance, forward, steerAngle } from './physics.js';
import { LINE_WIDTH } from './levels.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const MODELS = ['sedan', 'suv', 'taxi', 'van', 'hatchback-sports', 'cone'];
const SPOT_COLOR = new THREE.Color(0xffc531);
const DONE_COLOR = new THREE.Color(0x3fe08a);
const TOP_TILT = 0.32; // 위에서 볼 때 수직에서 남쪽으로 기운 각도
const TOP_RADIUS = 11; // 위에서 볼 때 화면에 들어오게 할 반지름 (m). 휠로 확대·축소
const GUIDE_STEPS = 20; // 예상 궤적: 0.25m 씩 5m
const GUIDE_STEP = 0.25;
const GUIDE_WIDTH = 0.1;
const MAX_PARTICLES = 220;
const CONFETTI = ['#ffc531', '#e8504a', '#3fe08a', '#3f8ae0', '#f08c3a', '#ffffff'];
const HALF = Math.PI / 2;

function loadTexture(loader, path, { srgb = false } = {}) {
  return loader.loadAsync(asset(path)).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** 바닥에 붙은 띠 (x1, z1) → (x2, z2), 두께 width 를 positions 배열에 삼각형 둘로 더한다 */
function pushStrip(positions, x1, z1, x2, z2, width, y) {
  const len = Math.hypot(x2 - x1, z2 - z1) || 1;
  const nx = (-(z2 - z1) / len) * (width / 2);
  const nz = ((x2 - x1) / len) * (width / 2);
  const a = [x1 + nx, y, z1 + nz];
  const b = [x1 - nx, y, z1 - nz];
  const c = [x2 - nx, y, z2 - nz];
  const d = [x2 + nx, y, z2 + nz];
  positions.push(...a, ...c, ...b, ...a, ...d, ...c); // 위에서 보아 앞면이 되게 감는다
}

function stripMesh(positions, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** 칸 바닥에 그릴 표시: P 글자와 (방향이 정해진 칸이면) 차 앞이 향할 쪽 화살표 */
function spotTexture(arrow) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.font = 'bold 150px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('P', 128, arrow ? 330 : 256);
  if (arrow) {
    g.beginPath();
    g.moveTo(128, 40);
    g.lineTo(200, 130);
    g.lineTo(152, 130);
    g.lineTo(152, 200);
    g.lineTo(104, 200);
    g.lineTo(104, 130);
    g.lineTo(56, 130);
    g.closePath();
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** 기둥 아래쪽의 노랑·검정 빗금 */
function stripeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1d1d1f';
  for (let i = -128; i < 256; i += 48) {
    g.beginPath();
    g.moveTo(i, 128);
    g.lineTo(i + 24, 128);
    g.lineTo(i + 24 + 128, 0);
    g.lineTo(i + 128, 0);
    g.closePath();
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export class ParkingScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.view = { pos: new THREE.Vector3(0, 30, 10), look: new THREE.Vector3(), heading: 0 };
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };
    this.mode = 'top';
    this.guide = true;
    this.radius = TOP_RADIUS;
    this.snapCamera = true;
    this.shake = 0;
    this.particles = [];
    this.celebrating = -1;
    this.time = 0;
    this.run = null;
    this.input = { throttle: 0, brake: 0, steer: 0 };
    this.onFrame = null; // (dt) => void, 매 프레임 그리기 전에 불린다 (main.js 가 차를 움직인다)
    this.buildLights();

    this.renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x3a3630, 1.4);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -20;
    s.right = s.top = 20;
    s.near = 1;
    s.far = 80;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.sun = sun;
    this.scene.add(this.hemi, sun, sun.target);
  }

  /** 모델과 텍스처를 불러오고 그리기를 시작한다 */
  async load() {
    const gltf = new GLTFLoader();
    const textures = new THREE.TextureLoader();
    const [models, asphalt, asphaltNormal, concrete] = await Promise.all([
      Promise.all(MODELS.map((name) => gltf.loadAsync(asset(`models/${name}.glb`)))),
      loadTexture(textures, 'textures/clean_asphalt_diff_512.jpg', { srgb: true }),
      loadTexture(textures, 'textures/clean_asphalt_nor_gl_512.jpg'),
      loadTexture(textures, 'textures/hangar_concrete_floor_diff_512.jpg', { srgb: true }),
    ]);
    this.templates = {};
    MODELS.forEach((name, i) => {
      const root = models[i].scene;
      root.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      // 바닥 한가운데가 원점에 오도록 감싼다
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      root.position.set(-center.x, -box.min.y, -center.z);
      const holder = new THREE.Group();
      holder.add(root);
      this.templates[name] = { holder, size: box.getSize(new THREE.Vector3()) };
    });
    this.materials = {
      asphalt: new THREE.MeshStandardMaterial({ map: asphalt, normalMap: asphaltNormal, roughness: 0.95, color: 0xb8b8b8 }),
      concrete: new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.85, color: 0xe2e4e8 }),
      grass: new THREE.MeshStandardMaterial({ color: 0x6f8f55, roughness: 1 }),
      floorOut: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 1 }),
      line: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }),
      curb: new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.9 }),
      building: new THREE.MeshStandardMaterial({ color: 0xd8cbb4, roughness: 0.9 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x8c7f6c, roughness: 0.95 }),
      hedge: new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 1 }),
      wall: new THREE.MeshStandardMaterial({ color: 0xa9adb5, roughness: 0.9 }),
      pillar: new THREE.MeshStandardMaterial({ color: 0xdcdee3, roughness: 0.85 }),
      stripe: new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.8 }),
    };
    this.asphalt = asphalt;
    this.asphaltNormal = asphaltNormal;
    this.concrete = concrete;
    this.buildPlayer();
    this.buildGuide();
    this.buildBeacon();
    this.buildParticles();
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  /** 템플릿 모델을 길이 length, 너비 width 로 늘인 복제. 바퀴가 동그랗게 남도록 높이는 길이와 같은 배율 */
  vehicle(name, length, width) {
    const { holder, size } = this.templates[name];
    const model = holder.clone();
    const s = length / size.z;
    model.scale.set(width / size.x, s, s);
    return model;
  }

  // ---------- 내 차 ----------

  buildPlayer() {
    const group = new THREE.Group();
    const model = this.vehicle('sedan', CAR.length, CAR.width);
    group.add(model);
    const wheels = {};
    for (const name of ['front-left', 'front-right', 'back-left', 'back-right']) {
      const wheel = model.getObjectByName(`wheel-${name}`);
      if (!wheel) continue;
      wheel.rotation.order = 'YXZ'; // 꺾은 다음에 굴린다
      wheels[name] = wheel;
    }
    // 브레이크등·후진등: 모델 뒤에 붙인 얇은 판. 밟거나 R 기어면 켠다
    const lamp = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
    const brake = lamp(0xff2a1a);
    const reverse = lamp(0xffffff);
    const plate = new THREE.PlaneGeometry(0.34, 0.14);
    for (const side of [-1, 1]) {
      const red = new THREE.Mesh(plate, brake);
      red.position.set(side * 0.62, 0.98, -CAR.length / 2 - 0.02);
      red.rotation.y = Math.PI;
      const white = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), reverse);
      white.position.set(side * 0.36, 0.98, -CAR.length / 2 - 0.02);
      white.rotation.y = Math.PI;
      group.add(red, white);
    }
    // 바퀴 반지름 (모델 0.3 × 높이 배율)
    this.player = { group, model, wheels, brake, reverse, radius: 0.3 * model.scale.y, spin: 0 };
  }

  // ---------- 판 ----------

  /** 단계마다 바닥·선·장애물을 다시 짓는다 */
  setup(run) {
    if (this.board) {
      this.scene.remove(this.board);
      this.board.traverse((o) => {
        if (o.isMesh && o.userData.own) o.geometry.dispose();
      });
      this.spotMaterials?.forEach((m) => m.dispose());
      this.spotSign?.dispose();
    }
    this.run = run;
    const level = run.level;
    this.level = level;
    this.board = new THREE.Group();
    this.scene.add(this.board);
    this.particles = [];
    this.celebrating = -1;
    this.shake = 0;

    const { minX, maxX, minZ, maxZ } = level.bounds;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const indoor = level.indoor;

    // 바닥: 경계 안쪽은 아스팔트(지하는 콘크리트), 바깥은 잔디(지하는 어둡게)
    const floorMaterial = indoor ? this.materials.concrete : this.materials.asphalt;
    for (const texture of indoor ? [this.concrete] : [this.asphalt, this.asphaltNormal]) texture.repeat.set(width / 5, depth / 5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-HALF), floorMaterial);
    floor.position.set(cx, 0, cz);
    floor.receiveShadow = true;
    floor.userData.own = true;
    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 120, depth + 120).rotateX(-HALF),
      indoor ? this.materials.floorOut : this.materials.grass,
    );
    outside.position.set(cx, -0.02, cz);
    outside.receiveShadow = true;
    outside.userData.own = true;
    this.board.add(floor, outside);

    this.buildLines(level.lines);
    this.buildSpot(level.spot);
    for (const obstacle of run.obstacles) this.buildObstacle(obstacle, indoor);
    this.board.add(this.player.group);

    this.scene.background = new THREE.Color(indoor ? 0x15171c : 0x9fc4e4);
    this.scene.fog = indoor ? new THREE.Fog(0x15171c, 30, 70) : null;
    this.hemi.intensity = indoor ? 0.9 : 1.4;
    this.sun.intensity = indoor ? 1.6 : 2.6;
    this.sun.color.set(indoor ? 0xe8f0ff : 0xfff1dc);
    this.sunOffset = indoor ? new THREE.Vector3(2, 26, 4) : new THREE.Vector3(-12, 30, 14);

    this.snap();
  }

  buildLines(lines) {
    const white = [];
    const yellow = [];
    for (const line of lines) {
      pushStrip(line.color === 'yellow' ? yellow : white, line.x1, line.z1, line.x2, line.z2, LINE_WIDTH, 0.012);
    }
    for (const [positions, material] of [
      [white, this.materials.line],
      [yellow, this.materials.yellow],
    ]) {
      if (!positions.length) continue;
      const mesh = stripMesh(positions, material);
      mesh.userData.own = true;
      this.board.add(mesh);
    }
  }

  buildSpot(spot) {
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = spot.heading;
    const fill = new THREE.MeshBasicMaterial({ color: SPOT_COLOR, transparent: true, opacity: 0.2, depthWrite: false });
    const edge = new THREE.MeshBasicMaterial({ color: SPOT_COLOR, transparent: true, opacity: 0.95, depthWrite: false });
    this.spotSign = spotTexture(!spot.bothWays);
    const sign = new THREE.MeshBasicMaterial({ map: this.spotSign, transparent: true, opacity: 0.55, depthWrite: false, color: SPOT_COLOR });
    this.spotMaterials = [fill, edge, sign];
    const area = new THREE.Mesh(new THREE.PlaneGeometry(spot.width, spot.length).rotateX(-HALF), fill);
    area.position.y = 0.015;
    const hw = spot.width / 2;
    const hl = spot.length / 2;
    const positions = [];
    const w = 0.16;
    pushStrip(positions, -hw, -hl, hw, -hl, w, 0.02);
    pushStrip(positions, -hw, hl, hw, hl, w, 0.02);
    pushStrip(positions, -hw, -hl, -hw, hl, w, 0.02);
    pushStrip(positions, hw, -hl, hw, hl, w, 0.02);
    const outline = stripMesh(positions, edge);
    // 화살표는 칸의 앞(+z 지역 좌표)을 가리키도록 그렸다
    const size = Math.min(spot.width * 0.8, spot.length * 0.4);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 2).rotateX(-HALF).rotateY(Math.PI), sign);
    mark.position.y = 0.018;
    for (const mesh of [area, outline, mark]) {
      mesh.userData.own = true;
      mesh.renderOrder = 1;
    }
    group.add(area, outline, mark);
    this.board.add(group);
    this.spot = { group, fill, edge, sign };
    this.beacon.position.set(spot.x, 3, spot.z);
    this.board.add(this.beacon);
  }

  buildObstacle(obstacle, indoor) {
    const { box, kind } = obstacle;
    let object;
    const own = (mesh) => {
      mesh.userData.own = true;
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    };
    const slab = (height, material, y = 0, inflate = 0) => {
      const mesh = own(new THREE.Mesh(new THREE.BoxGeometry(box.hw * 2 + inflate, height, box.hl * 2 + inflate), material));
      mesh.position.y = y + height / 2;
      return mesh;
    };
    switch (kind) {
      case 'car': {
        const { length, width } = VEHICLES[obstacle.model];
        object = this.vehicle(obstacle.model, length, width);
        break;
      }
      case 'cone': {
        object = this.templates.cone.holder.clone();
        object.scale.setScalar(0.45 / this.templates.cone.size.x);
        break;
      }
      case 'pillar': {
        object = new THREE.Group();
        object.add(slab(0.9, this.materials.stripe, 0, 0.02), slab(2.2, this.materials.pillar, 0.9));
        break;
      }
      case 'curb':
        object = slab(0.18, this.materials.curb);
        break;
      case 'wall':
        if (indoor) {
          object = slab(1.1, this.materials.wall);
        } else {
          // 건물: 벽과 조금 어두운 지붕
          object = new THREE.Group();
          object.add(slab(3, this.materials.building), slab(0.12, this.materials.roof, 3, -0.3));
        }
        break;
      case 'boundary':
        if (indoor) object = slab(2.4, this.materials.wall);
        else {
          object = new THREE.Group();
          object.add(slab(0.2, this.materials.curb), slab(0.8, this.materials.hedge, 0.2, -0.4));
        }
        break;
      default:
        return;
    }
    object.position.set(box.x, 0, box.z);
    object.rotation.y = box.heading;
    this.board.add(object);
  }

  buildBeacon() {
    const material = new THREE.MeshStandardMaterial({ color: SPOT_COLOR, emissive: SPOT_COLOR, emissiveIntensity: 0.6 });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 20).rotateX(Math.PI), material);
    cone.castShadow = true;
    this.beacon = new THREE.Group();
    this.beacon.add(cone);
  }

  // ---------- 예상 궤적 ----------

  buildGuide() {
    // 양쪽 바퀴 자리 띠 2개 + 1·2·3m 가로 띠 3개
    const quads = GUIDE_STEPS * 2 + 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quads * 18), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(quads * 18), 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
    this.guideMesh = new THREE.Mesh(geometry, material);
    this.guideMesh.frustumCulled = false;
    this.guideMesh.renderOrder = 2;
    this.scene.add(this.guideMesh);
  }

  /** 지금 핸들 각도로 기어 방향에 5m 갈 때 차체 양옆 끝이 지나갈 자리 */
  updateGuide(car, visible) {
    this.guideMesh.visible = visible;
    if (!visible) return;
    const dir = car.gear === 'R' ? -1 : 1;
    const end = (dir * CAR.length) / 2;
    const hw = CAR.width / 2;
    const edge = (pose, side) => {
      const f = forward(pose.heading);
      // 왼쪽(+v) = (cos h, -sin h)
      return { x: pose.x + f.x * end + Math.cos(pose.heading) * hw * side, z: pose.z + f.z * end - Math.sin(pose.heading) * hw * side };
    };
    const poses = [car];
    for (let i = 1; i <= GUIDE_STEPS; i++) poses.push(advance(car, dir * GUIDE_STEP * i, car.steer));
    const position = this.guideMesh.geometry.attributes.position;
    const color = this.guideMesh.geometry.attributes.color;
    const colorAt = (distance) => (distance < 1 ? [1, 0.12, 0.08] : distance < 2 ? [1, 0.75, 0.05] : [0.15, 0.9, 0.35]);
    const positions = [];
    const colors = [];
    const strip = (a, b, distance, width) => {
      pushStrip(positions, a.x, a.z, b.x, b.z, width, 0.03);
      for (let k = 0; k < 6; k++) colors.push(...colorAt(distance));
    };
    for (const side of [-1, 1]) {
      for (let i = 0; i < GUIDE_STEPS; i++) strip(edge(poses[i], side), edge(poses[i + 1], side), i * GUIDE_STEP, GUIDE_WIDTH);
    }
    for (const meters of [1, 2, 3]) {
      const pose = poses[Math.round(meters / GUIDE_STEP)];
      strip(edge(pose, -1), edge(pose, 1), meters - 0.01, GUIDE_WIDTH * 0.8);
    }
    position.array.set(positions);
    color.array.set(colors);
    position.needsUpdate = color.needsUpdate = true;
  }

  // ---------- 효과 ----------

  buildParticles() {
    this.particleMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial(), MAX_PARTICLES);
    this.particleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
  }

  burst(x, z, count) {
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = 3 + Math.random() * 3;
      this.particles.push({
        position: new THREE.Vector3(x, 1.4, z),
        velocity: new THREE.Vector3(Math.cos(angle) * v, 5 + Math.random() * 4, Math.sin(angle) * v),
        spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
        color: new THREE.Color(CONFETTI[Math.floor(Math.random() * CONFETTI.length)]),
        life: 1.4 + Math.random() * 0.8,
        age: 0,
      });
    }
  }

  updateParticles(dt) {
    const dummy = (this.dummy ??= new THREE.Object3D());
    this.particles = this.particles.filter((p) => (p.age += dt) < p.life);
    let n = 0;
    for (const p of this.particles) {
      p.velocity.y -= 12 * dt;
      p.position.addScaledVector(p.velocity, dt);
      if (p.position.y < 0.07) {
        p.position.y = 0.07;
        p.velocity.multiplyScalar(0.4).setY(Math.abs(p.velocity.y));
      }
      dummy.position.copy(p.position);
      dummy.rotation.set(p.spin.x * p.age, p.spin.y * p.age, p.spin.z * p.age);
      dummy.scale.setScalar(Math.min(1, (p.life - p.age) * 3));
      dummy.updateMatrix();
      this.particleMesh.setMatrixAt(n, dummy.matrix);
      this.particleMesh.setColorAt(n, p.color);
      n++;
    }
    this.particleMesh.count = n;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    this.particleMesh.instanceColor.needsUpdate = true;
  }

  /** 게임 사건을 화면에 반영한다 */
  handle(event) {
    switch (event.type) {
      case 'contact':
        this.shake = Math.max(this.shake, event.severity === 'light' ? 0.35 : 1);
        break;
      case 'parked':
        this.celebrating = 0;
        this.burst(this.run.car.x, this.run.car.z, 90);
        break;
      case 'failed':
        this.shake = 1.4;
        break;
    }
  }

  // ---------- 카메라 ----------

  setInsets(insets) {
    Object.assign(this.insets, insets);
  }

  setMode(mode) {
    this.mode = mode;
  }

  setGuide(on) {
    this.guide = on;
  }

  /** 위에서 보기의 확대·축소 (factor > 1 이면 멀리) */
  zoom(factor) {
    this.radius = Math.max(6, Math.min(24, this.radius * factor));
  }

  /** 다음 프레임에 카메라를 바로 제자리로 */
  snap() {
    this.snapCamera = true;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 카메라가 갈 자리와 볼 곳 */
  cameraGoal(car, dt) {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const freeW = Math.max(1, w - left - right);
    const freeH = Math.max(1, h - top - bottom);
    // HUD 에 가리지 않는 영역의 가운데가 화면 가운데처럼 보이게
    this.camera.setViewOffset(w, h, (right - left) / 2, (bottom - top) / 2, w, h);
    const look = new THREE.Vector3();
    const pos = new THREE.Vector3();
    // 3인칭 카메라는 차 방향을 조금 늦게 따라간다
    let turn = car.heading - this.view.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.view.heading += this.snapCamera ? turn : turn * damp(3, dt);
    const g = forward(this.view.heading);
    const rear = this.mode === 'rear' && car.gear === 'R';
    if (this.mode === 'top') {
      // 차와 목표 칸 사이를 조금 앞당겨 보되, 차가 화면 밖으로 나가지 않게
      const spot = this.level.spot;
      let fx = (spot.x - car.x) * 0.35;
      let fz = (spot.z - car.z) * 0.35;
      const reach = Math.hypot(fx, fz);
      const limit = this.radius * 0.45;
      if (reach > limit) {
        fx *= limit / reach;
        fz *= limit / reach;
      }
      look.set(car.x + fx, 0, car.z + fz);
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      const fit = Math.tan(fov / 2) * (freeH / h) * Math.min(1, freeW / freeH);
      const distance = this.radius / fit;
      pos.set(look.x, look.y + Math.cos(TOP_TILT) * distance, look.z + Math.sin(TOP_TILT) * distance);
    } else if (rear) {
      // 후방 시점: 차 앞 위에서 차 너머 뒤쪽을 본다
      look.set(car.x - g.x * 5.5, 0, car.z - g.z * 5.5);
      pos.set(car.x + g.x * 1.6, 6.4, car.z + g.z * 1.6);
    } else {
      look.set(car.x + g.x * 3, 0.6, car.z + g.z * 3);
      pos.set(car.x - g.x * 7, 4.4, car.z - g.z * 7);
    }
    return { pos, look };
  }

  placeCamera(car, dt) {
    const { pos, look } = this.cameraGoal(car, dt);
    const k = this.snapCamera ? 1 : damp(this.mode === 'top' ? 4 : 5, dt);
    this.view.pos.lerp(pos, k);
    this.view.look.lerp(look, k);
    this.snapCamera = false;
    this.camera.position.copy(this.view.pos);
    if (this.shake > 0.01) {
      const a = this.shake * 0.12;
      this.camera.position.x += (Math.random() * 2 - 1) * a;
      this.camera.position.y += (Math.random() * 2 - 1) * a;
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.view.look);
    return this.view.pos.distanceToSquared(pos) > 1e-4;
  }

  // ---------- 프레임 ----------

  updatePlayer(car, dt) {
    const { group, model, wheels, brake, reverse, radius } = this.player;
    group.position.set(car.x, 0, car.z);
    group.rotation.y = car.heading;
    const steer = -steerAngle(car.steer); // 오른쪽으로 꺾으면 바퀴 앞이 -x 쪽으로
    if (wheels['front-left']) wheels['front-left'].rotation.y = steer;
    if (wheels['front-right']) wheels['front-right'].rotation.y = steer;
    this.player.spin += (car.speed * dt) / radius;
    for (const wheel of Object.values(wheels)) wheel.rotation.x = this.player.spin;
    brake.opacity = this.input.brake > 0 ? 0.95 : 0;
    reverse.opacity = car.gear === 'R' ? 0.9 : 0;
    // 부딪히면 차체가 잠깐 흔들린다
    model.position.x = Math.sin(this.time * 70) * this.shake * 0.05;
    model.rotation.z = Math.sin(this.time * 55) * this.shake * 0.02;
  }

  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.onFrame?.(dt);
    if (!this.run) {
      if (this.loop.due(now, false)) this.renderer.render(this.scene, this.camera);
      return;
    }
    const { car } = this.run;
    const driving = this.run.status === 'driving';
    this.updatePlayer(car, dt);
    this.shake *= Math.exp(-dt * 6);

    // 목표 칸: 맞게 들어오면 초록으로, 주차 확인 중이면 깜빡임이 빨라진다
    const fit = this.run.fit;
    const done = this.run.status === 'parked';
    const color = fit.aligned || done ? DONE_COLOR : SPOT_COLOR;
    const pulse = done ? 1 : 0.5 + 0.5 * Math.sin(this.time * (this.run.hold > 0 ? 14 : 3.5));
    this.spot.fill.color.copy(color);
    this.spot.edge.color.copy(color);
    this.spot.sign.color.copy(color);
    this.spot.fill.opacity = 0.14 + 0.14 * pulse + (done ? 0.12 : 0);
    // 멀리 있을 때만 칸 위에 떠 있는 표시
    const far = Math.hypot(car.x - this.level.spot.x, car.z - this.level.spot.z);
    this.beacon.visible = far > 7 && driving;
    this.beacon.position.y = 2.6 + Math.sin(this.time * 3) * 0.25;
    this.beacon.rotation.y += dt * 1.5;

    this.updateGuide(car, this.guide && driving);
    const cameraMoving = this.placeCamera(car, dt);

    this.sun.position.set(car.x + this.sunOffset.x, this.sunOffset.y, car.z + this.sunOffset.z);
    this.sun.target.position.set(car.x, 0, car.z);

    if (this.celebrating >= 0) this.celebrating += dt;
    this.updateParticles(dt);
    const moving = Math.abs(car.speed) > 0.01;
    // 칸 깜빡임·표시 흔들림만 있을 때는 초당 30 번으로 줄인다
    const lively = moving || cameraMoving || this.particles.length > 0 || this.shake > 0.01 || this.run.hold > 0;
    if (this.loop.due(now, lively, moving)) this.renderer.render(this.scene, this.camera);
  }
}
