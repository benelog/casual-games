// Three.js 양궁장 씬. 길이 단위는 미터, 사대(쏘는 선)가 z = 0 이고 과녁은 -z 쪽 70m 에 있다.
// 선수마다 레인이 하나씩 있고, 조준할 때는 그 레인의 사대에서 망원으로 과녁을 본다.
// 시상식은 같은 경기장의 사대 뒤쪽(+z)에 세운 시상대에서 한다.
// 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createRenderer } from '../../shared/gpu.js';
import { FACE_RADIUS, RING_WIDTH, X_RADIUS, DISTANCE } from './target.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

export const PLAYER_COLORS = [0xd8362c, 0x2d6fd1];
const LANES = [-1.6, 1.6]; // 레인(과녁)의 x 위치
const TARGET_Z = -DISTANCE;
const CENTER_Y = 1.3; // 과녁 중심 높이
const TILT = THREE.MathUtils.degToRad(12); // 과녁이 뒤로 기운 각
const BOSS = 1.3; // 과녁 뒤 폼 블록 한 변
const BOSS_DEPTH = 0.35;
const EYE = new THREE.Vector3(0, 1.55, 0.3); // 레인 기준 눈 위치
const ARROW_LENGTH = 0.72;
const PODIUM = new THREE.Vector3(0, 0, 16); // 시상대 앞면 가운데
const BACKGROUND_ROTATION = 0.35; // 경기장 배경을 돌려 관중석이 과녁 뒤에 오게 한다 (라디안)
const SUN = new THREE.Vector3(-0.45, 0.75, 0.5).normalize(); // 배경 사진의 해 쪽

const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;

function loadTexture(loader, path, { srgb = false, repeat = 1 } = {}) {
  return loader.loadAsync(asset(path)).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** 두 점을 잇는 원기둥 (과녁 다리 등) */
function strut(from, to, radius, material) {
  const length = from.distanceTo(to);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** 122cm 과녁지. 종이 한 변이 BOSS 이고 가운데에 고리를 그린다 */
function drawFace(ctx, size) {
  const px = size / BOSS;
  const c = size / 2;
  ctx.fillStyle = '#f1efe8';
  ctx.fillRect(0, 0, size, size);
  const colors = { white: '#f6f5f0', black: '#1e1e21', blue: '#27a3dc', red: '#e3352b', gold: '#fcd22c' };
  const zone = (score) => ['white', 'white', 'black', 'black', 'blue', 'blue', 'red', 'red', 'gold', 'gold'][score - 1];
  for (let score = 1; score <= 10; score++) {
    ctx.beginPath();
    ctx.arc(c, c, (11 - score) * RING_WIDTH * px, 0, Math.PI * 2);
    ctx.fillStyle = colors[zone(score)];
    ctx.fill();
  }
  // 고리 사이 선: 검은 구역은 흰 선, 나머지는 검은 선
  ctx.lineWidth = Math.max(1.2, 0.002 * px);
  for (let score = 1; score <= 10; score++) {
    ctx.beginPath();
    ctx.arc(c, c, (11 - score) * RING_WIDTH * px, 0, Math.PI * 2);
    ctx.strokeStyle = zone(score) === 'black' && score !== 3 ? '#e8e8e8' : '#26262a';
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(1, 0.0015 * px);
  ctx.beginPath();
  ctx.arc(c, c, X_RADIUS * px, 0, Math.PI * 2);
  ctx.strokeStyle = '#3a3320';
  ctx.stroke();
  // 가운데 작은 십자
  const tick = 0.004 * px;
  ctx.beginPath();
  ctx.moveTo(c - tick, c);
  ctx.lineTo(c + tick, c);
  ctx.moveTo(c, c - tick);
  ctx.lineTo(c, c + tick);
  ctx.stroke();
}

function drawFoam(ctx, size) {
  ctx.fillStyle = '#d7dadc';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2500; i++) {
    const shade = 190 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${shade},${shade + 3},${shade + 6},0.5)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
}

function drawNumber(text, color, background) {
  return (ctx, w, h) => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.round(h * 0.7)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h * 0.54);
  };
}

/** 과녁 뒤 가림막. 경기장 이름처럼 보이는 글자를 반복한다 */
function drawBackdrop(ctx, w, h) {
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, '#16336b');
  gradient.addColorStop(1, '#0d2047');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d9b46a';
  ctx.fillRect(0, h * 0.86, w, h * 0.05);
  ctx.font = `600 ${Math.round(h * 0.34)}px Georgia, serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(243, 236, 220, 0.7)';
  // 텍스처가 반복될 때 이음매에서 글자가 잘리지 않게 폭을 정확히 나눠 찍는다
  const word = 'ARCHERY  ·  70 M  ·  ';
  const count = Math.max(1, Math.floor(w / ctx.measureText(word).width));
  for (let i = 0; i < count; i++) ctx.fillText(word, (i * w) / count, h * 0.45);
}

export class ArcheryScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels';
    container.appendChild(this.labelLayer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fa6bf);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.look = new THREE.Vector3(); // 카메라가 보는 곳
    this.view = null; // 지금 카메라 위치·방향·화각 { position, look, height } (height 는 과녁 거리에서 보이는 높이)

    this.tweens = new Set();
    this.arrows = [];
    this.mixers = [];
    this.flags = [];
    this.wind = { x: 0, y: 0 };
    this.time = 0;
    this.onFrame = null; // (dt) => void
    this.swing = null; // 시상식 카메라가 돈 시간

    // 조준: aimLane 의 과녁 면 좌표 (m)
    this.aimLane = null;
    this.aim = new THREE.Vector2();
    this.reticlePoint = { x: 0, y: 0 }; // 흔들림까지 더해 실제로 그릴 곳 (main 이 정한다)
    this.onDraw = null; // 시위를 당긴다
    this.onRelease = null; // 놓는다

    this.raycaster = new THREE.Raycaster();
    this.bindPointer();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load() {
    const textures = new THREE.TextureLoader();
    const gltf = new GLTFLoader();
    const [env, background, grass, grassNormal, grassRough, man, man2, man3] = await Promise.all([
      new RGBELoader().loadAsync(asset('hdri/orlando_stadium_1k.hdr')),
      textures.loadAsync(asset('hdri/orlando_stadium_4k.jpg')),
      loadTexture(textures, 'textures/Grass005_color.jpg', { srgb: true, repeat: 220 }),
      loadTexture(textures, 'textures/Grass005_normal.jpg', { repeat: 220 }),
      loadTexture(textures, 'textures/Grass005_roughness.jpg', { repeat: 220 }),
      gltf.loadAsync(asset('models/Man.glb')),
      gltf.loadAsync(asset('models/Man2.glb')),
      gltf.loadAsync(asset('models/ManLongSleeves.glb')),
    ]);

    env.mapping = THREE.EquirectangularReflectionMapping;
    background.mapping = THREE.EquirectangularReflectionMapping;
    background.colorSpace = THREE.SRGBColorSpace;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.6;
    this.scene.environmentRotation.y = BACKGROUND_ROTATION;
    this.scene.background = background;
    this.scene.backgroundRotation.y = BACKGROUND_ROTATION;
    this.scene.backgroundIntensity = 1;

    this.buildGround(grass, grassNormal, grassRough);
    this.buildLights();
    LANES.forEach((x, lane) => this.buildTarget(x, lane));
    this.buildBackdrop();
    this.buildReticle();
    this.buildArrowParts();
    this.models = [man, man2, man3];
    this.buildArchers();
    this.buildPodium();

    this.setView(this.wideView(), { instant: true });
    this.last = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  // ---------- 경기장 ----------

  buildGround(map, normalMap, roughnessMap) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(660, 660),
      new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, color: 0xb8c8a8 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -30;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 사대(쏘는 선)와 과녁 선
    const paint = new THREE.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 0.8 });
    for (const [z, width] of [
      [0, 0.06],
      [TARGET_Z + 1.4, 0.06],
    ]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(14, width), paint);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.004, z);
      line.receiveShadow = true;
      this.scene.add(line);
    }
    // 레인 사이 선
    for (const x of [-3.2, 0, 3.2]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.04, DISTANCE), paint);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.003, -DISTANCE / 2);
      this.scene.add(line);
    }
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x5d7a3a, 0.5));
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    const box = sun.shadow.camera;
    box.left = box.bottom = -5;
    box.right = box.top = 5;
    box.near = 1;
    box.far = 120;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    this.focusShadow(new THREE.Vector3(0, 1, TARGET_Z));
  }

  /** 그림자 맵은 좁은 곳만 덮으므로 지금 보는 곳으로 옮긴다 */
  focusShadow(center, size = 5) {
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(SUN, 60);
    const box = this.sun.shadow.camera;
    box.left = box.bottom = -size;
    box.right = box.top = size;
    box.updateProjectionMatrix();
  }

  buildTarget(x, lane) {
    const stand = new THREE.Group();
    stand.position.set(x, 0, TARGET_Z);
    this.scene.add(stand);

    // 뒤로 기운 폼 블록과 과녁지. face 의 원점이 과녁 중심이고 +z 가 사대 쪽이다
    const face = new THREE.Group();
    face.position.y = CENTER_Y;
    face.rotation.x = -TILT;
    stand.add(face);

    const foam = new THREE.MeshStandardMaterial({ map: canvasTexture(256, 256, drawFoam), roughness: 0.95 });
    const boss = new THREE.Mesh(new THREE.BoxGeometry(BOSS, BOSS, BOSS_DEPTH), foam);
    boss.position.z = -BOSS_DEPTH / 2;
    boss.castShadow = boss.receiveShadow = true;
    face.add(boss);

    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(BOSS, BOSS),
      new THREE.MeshStandardMaterial({ map: canvasTexture(2048, 2048, (ctx, s) => drawFace(ctx, s)), roughness: 0.9 }),
    );
    paper.position.z = 0.002;
    paper.receiveShadow = true;
    face.add(paper);

    // 다리: 앞 둘, 뒤 하나
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.7 });
    const top = (sx, sy) => face.localToWorld(new THREE.Vector3(sx * BOSS * 0.42, sy * BOSS * 0.5, -BOSS_DEPTH * 0.5));
    face.updateWorldMatrix(true, false);
    for (const side of [-1, 1]) {
      const from = stand.worldToLocal(new THREE.Vector3(x + side * BOSS * 0.42, 0, TARGET_Z + 0.25));
      stand.add(strut(from, stand.worldToLocal(top(side, 0.4)), 0.035, wood));
    }
    stand.add(
      strut(
        stand.worldToLocal(new THREE.Vector3(x, 0, TARGET_Z - 1.0)),
        stand.worldToLocal(top(0, 0.45)),
        0.035,
        wood,
      ),
    );

    // 레인 번호판
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.26),
      new THREE.MeshStandardMaterial({ map: canvasTexture(128, 96, drawNumber(String(lane + 1), '#14161b', '#f4f1e6')) }),
    );
    plate.position.set(0, BOSS / 2 + 0.16, -0.05);
    face.add(plate);

    // 바람 깃발: 폼 블록 위 깃대
    const poleTop = face.localToWorld(new THREE.Vector3(BOSS * 0.38, BOSS / 2 + 0.55, -BOSS_DEPTH / 2));
    const poleBottom = face.localToWorld(new THREE.Vector3(BOSS * 0.38, BOSS / 2 - 0.05, -BOSS_DEPTH / 2));
    const metal = new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.8, roughness: 0.35 });
    stand.add(strut(stand.worldToLocal(poleBottom), stand.worldToLocal(poleTop.clone()), 0.008, metal));
    const geometry = new THREE.PlaneGeometry(0.36, 0.22, 12, 6).translate(0.18, -0.11, 0);
    const flag = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.8, side: THREE.DoubleSide }),
    );
    flag.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.copy(stand.worldToLocal(poleTop));
    pivot.add(flag);
    stand.add(pivot);
    this.flags.push({ pivot, flag, base: geometry.attributes.position.array.slice(), phase: lane * 1.7 });

    if (!this.faces) this.faces = [];
    this.faces.push(face);
  }

  buildBackdrop() {
    const texture = canvasTexture(2048, 128, drawBackdrop);
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = 6;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.9, 0.2),
      [
        new THREE.MeshStandardMaterial({ color: 0x0d2047 }),
        new THREE.MeshStandardMaterial({ color: 0x0d2047 }),
        new THREE.MeshStandardMaterial({ color: 0x0d2047 }),
        new THREE.MeshStandardMaterial({ color: 0x0d2047 }),
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 }),
        new THREE.MeshStandardMaterial({ color: 0x0d2047 }),
      ],
    );
    wall.position.set(0, 0.45, TARGET_Z - 12);
    wall.receiveShadow = true;
    this.scene.add(wall);
  }

  buildReticle() {
    // 활의 조준기처럼 고리와 가운데 점
    // 어느 색 고리 위에서도 보이도록 밝은 초록 위에 어두운 테두리를 두른다
    const material = new THREE.MeshBasicMaterial({ color: 0x7dff6a, depthTest: false, transparent: true, opacity: 0.95 });
    const outline = new THREE.MeshBasicMaterial({ color: 0x0b1a08, depthTest: false, transparent: true, opacity: 0.7 });
    this.reticle = new THREE.Group();
    const add = (geometry, mat, order, x = 0, y = 0, rotation = 0) => {
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.set(x, y, 0);
      mesh.rotation.z = rotation;
      mesh.renderOrder = order;
      this.reticle.add(mesh);
    };
    add(new THREE.RingGeometry(0.036, 0.05, 48), outline, 10);
    add(new THREE.RingGeometry(0.039, 0.047, 48), material, 11);
    add(new THREE.CircleGeometry(0.009, 20), outline, 10);
    add(new THREE.CircleGeometry(0.006, 20), material, 11);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const [x, y] = [Math.sin(a) * 0.068, Math.cos(a) * 0.068];
      add(new THREE.PlaneGeometry(0.01, 0.034), outline, 10, x, y, -a);
      add(new THREE.PlaneGeometry(0.005, 0.03), material, 11, x, y, -a);
    }
    this.reticle.visible = false;
  }

  // ---------- 화살 ----------

  // 화살촉이 원점, 화살대는 +z 방향 (오니 쪽)
  buildArrowParts() {
    const along = (geometry, z) => geometry.rotateX(Math.PI / 2).translate(0, 0, z);
    const vane = new THREE.Shape();
    vane.moveTo(0, 0);
    vane.lineTo(0.016, 0.012);
    vane.lineTo(0.016, 0.05);
    vane.lineTo(0, 0.065);
    const vaneGeometry = new THREE.ShapeGeometry(vane).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0, ARROW_LENGTH - 0.095);
    this.arrowParts = {
      point: along(new THREE.CylinderGeometry(0.0015, 0.003, 0.03, 10), 0.015),
      shaft: along(new THREE.CylinderGeometry(0.0028, 0.0028, ARROW_LENGTH - 0.03, 10), 0.03 + (ARROW_LENGTH - 0.03) / 2),
      nock: along(new THREE.CylinderGeometry(0.0034, 0.003, 0.02, 10), ARROW_LENGTH + 0.005),
      vane: vaneGeometry,
      steel: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.3 }),
      carbon: new THREE.MeshStandardMaterial({ color: 0x232428, metalness: 0.3, roughness: 0.35 }),
      colors: PLAYER_COLORS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, side: THREE.DoubleSide })),
      white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5, side: THREE.DoubleSide }),
    };
  }

  makeArrow(player) {
    const p = this.arrowParts;
    const arrow = new THREE.Group();
    arrow.add(
      new THREE.Mesh(p.point, p.steel),
      new THREE.Mesh(p.shaft, p.carbon),
      new THREE.Mesh(p.nock, p.colors[player]),
    );
    // 깃 셋: 하나는 선수 색, 둘은 흰색
    for (let i = 0; i < 3; i++) {
      const vane = new THREE.Mesh(p.vane, i === 0 ? p.colors[player] : p.white);
      const holder = new THREE.Group();
      holder.rotation.z = (i * Math.PI * 2) / 3;
      holder.add(vane);
      arrow.add(holder);
    }
    arrow.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    return arrow;
  }

  /** 레인 lane 의 과녁 면 좌표 point 로 화살을 날린다. 다 날아가면 끝난다 */
  async shoot(lane, player, point) {
    const face = this.faces[lane];
    const arrow = this.makeArrow(player);
    this.scene.add(arrow);
    this.arrows.push(arrow);

    // 과녁 면을 벗어나도 폼 블록 너비 안이면 블록에, 아니면 뒤쪽 잔디로 간다
    const onBoss = Math.abs(point.x) <= BOSS / 2 && Math.abs(point.y) <= BOSS / 2;
    const to = onBoss
      ? face.localToWorld(new THREE.Vector3(point.x, point.y, 0))
      : new THREE.Vector3(LANES[lane] + point.x * 3, 0.02, TARGET_Z - 4 - Math.random() * 3);
    const from = new THREE.Vector3(LANES[lane] - 0.05, EYE.y - 0.12, -0.5);
    const lift = 1.0; // 포물선 꼭대기가 직선보다 높은 정도
    const place = (k, out) => out.lerpVectors(from, to, k).setY(out.y + 4 * lift * k * (1 - k));
    const behind = new THREE.Vector3();
    await this.tween(780, (k) => {
      // 촉이 나아가는 방향을 보게 한다. lookAt 은 몸통(+z)을 목표로 돌리므로 지나온 쪽을 바라보게 한다
      place(Math.max(0, k - 0.01), behind);
      place(k, arrow.position);
      if (k > 0) arrow.lookAt(behind);
    });
    // 꽂힌 모습: 촉이 조금 박히고 꼬리가 살짝 흔들린다
    const forward = to.clone().sub(behind).normalize();
    arrow.position.copy(to).addScaledVector(forward, onBoss ? 0.07 : 0.25);
    const rest = arrow.quaternion.clone();
    this.tween(500, (k) => {
      const wobble = Math.sin(k * Math.PI * 7) * (1 - k) * 0.03;
      arrow.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), wobble));
    });
    return { onBoss, position: to };
  }

  clearArrows() {
    for (const arrow of this.arrows) this.scene.remove(arrow);
    this.arrows = [];
  }

  /** 꽂힌 자리 위에 잠깐 떠오르는 점수 라벨 */
  popLabel(position, text, tone = '') {
    const el = document.createElement('div');
    el.className = `label hit ${tone}`.trim();
    el.textContent = text;
    const p = position.clone().project(this.camera);
    el.style.left = `${((p.x + 1) / 2) * this.container.clientWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * this.container.clientHeight}px`;
    this.labelLayer.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  // ---------- 바람 ----------

  setWind(wind) {
    this.wind = wind;
  }

  updateFlags() {
    const { x, y } = this.wind;
    const speed = Math.hypot(x, y);
    // 깃발은 바람이 불어 가는 쪽으로 나부낀다. 세기가 약하면 아래로 처진다
    const heading = Math.atan2(y, x);
    const lift = Math.min(1, speed / 4);
    const droop = (1 - lift) * 1.25;
    for (const f of this.flags) {
      f.pivot.rotation.y = THREE.MathUtils.lerp(f.pivot.rotation.y, heading, 0.08);
      const pos = f.flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const bx = f.base[i * 3];
        const by = f.base[i * 3 + 1];
        const u = bx / 0.36;
        const wave = Math.sin(u * 6 - this.time * (4 + speed * 2.5) + f.phase) * u * (0.015 + 0.03 * lift);
        pos.setXYZ(i, bx * Math.cos(droop), by + -bx * Math.sin(droop), wave);
      }
      pos.needsUpdate = true;
      f.flag.geometry.computeVertexNormals();
    }
  }

  // ---------- 선수 · 시상대 ----------

  /** 모델을 복제하고 키를 맞춘다. shirt 를 주면 셔츠 색을 바꾼다 */
  makePerson(index, { shirt = null } = {}) {
    const source = this.models[index];
    const model = SkeletonUtils.clone(source.scene);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material = o.material.clone();
      if (shirt !== null && /^Shirt/.test(o.material.name)) o.material.color.setHex(shirt).multiplyScalar(0.55);
    });
    // 스킨 메시의 경계 상자는 뼈 위치로 계산하므로 뼈의 월드 행렬부터 갱신한다
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const scale = 1.75 / (box.max.y - box.min.y);
    model.scale.setScalar(scale);
    const person = new THREE.Group();
    model.position.y = -box.min.y * scale;
    person.add(model);

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const clip of source.animations) {
      const name = clip.name.split('|').pop().replace(/^(Man|Female)_/, ''); // 'HumanArmature|Man_Idle' -> 'Idle'
      actions[name] = mixer.clipAction(clip);
    }
    person.userData = { mixer, actions, model, active: null };
    this.mixers.push(mixer);
    this.play(person, 'Idle', { offset: Math.random() * 3 });
    return person;
  }

  play(person, name, { once = false, offset = 0 } = {}) {
    const data = person.userData;
    const next = data.actions[name];
    if (!next) return;
    next.reset();
    next.loop = once ? THREE.LoopOnce : THREE.LoopRepeat;
    next.clampWhenFinished = once;
    next.time = offset;
    if (data.active && data.active !== next) data.active.crossFadeTo(next, 0.3, false);
    next.play();
    data.active = next;
    if (once) {
      const back = (e) => {
        if (e.action !== next) return;
        data.mixer.removeEventListener('finished', back);
        this.play(person, 'Idle');
      };
      data.mixer.addEventListener('finished', back);
    }
  }

  /**
   * 리커브 활: 손잡이(라이저), 끝이 앞으로 휘는 위아래 날개(림), 시위, 앞으로 뻗은 안정봉.
   * 맞는 오픈소스 모델을 찾지 못해 단순 도형으로 만든다. 손잡이 가운데가 원점, 앞은 -z
   */
  makeBow() {
    const bow = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x24262b, metalness: 0.6, roughness: 0.35 });
    const limbMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.4 });
    bow.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.6, 0.05), dark));
    const tips = [];
    for (const side of [1, -1]) {
      const curve = new THREE.CatmullRomCurve3(
        [
          [0, 0.28, 0],
          [0, 0.5, -0.06],
          [0, 0.72, -0.07],
          [0, 0.82, -0.03],
          [0, 0.85, 0.0],
        ].map(([x, y, z]) => new THREE.Vector3(x, y * side, z)),
      );
      bow.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.011, 6), limbMaterial));
      tips.push(new THREE.Vector3(0, 0.8 * side, -0.035));
    }
    const string = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0015, 0.0015, tips[0].distanceTo(tips[1]), 4),
      new THREE.MeshStandardMaterial({ color: 0xe8e4d8 }),
    );
    string.position.set(0, 0, -0.035);
    bow.add(string);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 8).rotateX(Math.PI / 2), dark);
    rod.position.set(0, -0.08, -0.37);
    bow.add(rod);
    bow.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    return bow;
  }

  /** 사대에 선 두 선수. 오른손잡이처럼 왼쪽 어깨가 과녁을 향하고, 왼손 옆에 활을 세워 든다 */
  buildArchers() {
    this.archers = LANES.map((x, i) => {
      const person = this.makePerson(i, { shirt: PLAYER_COLORS[i] });
      const bow = this.makeBow();
      bow.position.set(0.3, 0.86, 0.02);
      bow.rotation.set(-0.35, Math.PI, 0, 'YXZ'); // 선수 앞(+z)을 보고, 안정봉이 앞쪽 아래로 처지게
      person.add(bow);
      person.position.set(x - 0.25, 0, 0.75);
      person.rotation.y = Math.PI / 2;
      this.scene.add(person);
      return person;
    });
  }

  buildPodium() {
    const group = new THREE.Group();
    group.position.copy(PODIUM);
    this.podium = group;
    this.scene.add(group);
    // 시상대: 가운데 1위, 보는 쪽에서 왼쪽이 2위, 오른쪽이 3위
    const steps = [
      { x: 0, height: 0.75, label: '1', color: '#c9a227' },
      { x: -1.05, height: 0.5, label: '2', color: '#8d949c' },
      { x: 1.05, height: 0.35, label: '3', color: '#a8673a' },
    ];
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 });
    this.steps = steps.map((step) => {
      const front = new THREE.MeshStandardMaterial({
        map: canvasTexture(256, 192, drawNumber(step.label, step.color, '#f2f0ea')),
        roughness: 0.6,
      });
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, step.height, 0.9), [white, white, white, white, front, white]);
      box.position.set(step.x, step.height / 2, -0.45);
      box.castShadow = box.receiveShadow = true;
      group.add(box);
      return step;
    });
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(3.9, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x1b3f86, roughness: 0.9 }),
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.006, -0.45);
    carpet.receiveShadow = true;
    group.add(carpet);
  }

  // ---------- 카메라 ----------

  /** 사대 뒤에서 경기장 전체를 보는 시점 */
  wideView() {
    return { position: new THREE.Vector3(0, 2.4, 9), look: new THREE.Vector3(0, 1.2, -45), height: null, fov: 46, hfov: 40 };
  }

  /** 레인 lane 의 사대에서 망원으로 과녁을 보는 시점 */
  laneView(lane) {
    const x = LANES[lane];
    return {
      position: new THREE.Vector3(x, EYE.y, EYE.z),
      look: new THREE.Vector3(x, CENTER_Y + 0.12, TARGET_Z),
      height: 2.9, // 과녁 거리에서 이만큼의 높이가 보이게 한다
      core: 1.6, // 과녁과 둘레: 점수판·안내 문구에 가리지 않는 영역(safeArea)에 들어와야 한다
    };
  }

  /** 시상대: 아래쪽 결과 패널에 가리지 않도록 화면 위쪽에 둔다 */
  podiumView() {
    return {
      position: PODIUM.clone().add(new THREE.Vector3(0, 1.5, 7.5)),
      look: PODIUM.clone().add(new THREE.Vector3(0, 0.6, 0)),
      height: 5.2,
      width: 3.8,
    };
  }

  /** 화각: height 가 있으면 보는 곳의 거리에서 그 높이와 너비(기본은 과녁 너비)가 들어오게 정한다 */
  fovFor(view) {
    if (!view.height) {
      // 세로로 긴 화면에서는 가로 화각이 hfov 보다 좁아지지 않게 넓힌다
      const deg = THREE.MathUtils.degToRad;
      const minimum = view.hfov ? 2 * Math.atan(Math.tan(deg(view.hfov) / 2) / this.camera.aspect) : 0;
      return Math.max(view.fov, THREE.MathUtils.radToDeg(minimum));
    }
    const distance = view.position.distanceTo(view.look);
    const room = view.core ? this.safeRoom() : 1;
    const height = Math.max(view.height, (view.core ?? 0) / room, (view.width ?? 1.75) / this.camera.aspect);
    return THREE.MathUtils.radToDeg(2 * Math.atan(height / 2 / distance));
  }

  /**
   * 점수판(위)과 안내 문구(아래)를 뺀 화면 영역 (px). 과녁 시점(core 가 있는 시점)은
   * 과녁이 이 영역 가운데 오도록 화면을 옮긴다. 휴대폰 세로 화면처럼 점수판이 과녁 위를 덮을 때 쓴다
   */
  setSafeArea(top, bottom) {
    this.safeArea = { top, bottom };
    if (this.view && !this.tweens.size) this.applyView(this.view);
  }

  safeRoom() {
    const h = this.container.clientHeight;
    if (!this.safeArea || !h) return 1;
    return THREE.MathUtils.clamp((this.safeArea.bottom - this.safeArea.top) / h, 0.3, 1);
  }

  /** weight 0 이면 화면 가운데, 1 이면 safeArea 가운데로 내용을 옮긴다 */
  applyShift(weight) {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.shiftWeight = weight;
    const shift = this.safeArea && h ? ((this.safeArea.top + this.safeArea.bottom) / 2 - h / 2) * weight : 0;
    if (Math.abs(shift) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, 0, -shift, w, h); // 음수 오프셋은 내용을 아래로 내린다
  }

  applyView(view) {
    this.camera.position.copy(view.position);
    this.look.copy(view.look);
    this.camera.fov = this.fovFor(view);
    this.camera.lookAt(this.look);
    this.applyShift(view.core ? 1 : 0);
    this.camera.updateProjectionMatrix();
  }

  /** 시점을 옮긴다. 화각은 로그 공간에서 보간해 확대가 고르게 보이게 한다 */
  setView(view, { instant = false, duration = 900 } = {}) {
    const from = this.view;
    this.view = view;
    if (instant || !from) {
      this.applyView(view);
      return Promise.resolve();
    }
    const startPos = this.camera.position.clone();
    const startLook = this.look.clone();
    const startFov = Math.log(this.camera.fov);
    const startShift = this.shiftWeight ?? 0;
    return this.tween(duration, (k) => {
      const e = easeInOut(k);
      this.camera.position.lerpVectors(startPos, view.position, e);
      this.look.lerpVectors(startLook, view.look, e);
      this.camera.fov = Math.exp(THREE.MathUtils.lerp(startFov, Math.log(this.fovFor(view)), easeOut(k)));
      this.camera.lookAt(this.look);
      this.applyShift(THREE.MathUtils.lerp(startShift, view.core ? 1 : 0, e));
      this.camera.updateProjectionMatrix();
    });
  }

  /** 경기 시작: 경기장 전체를 보여 주고 첫 사수의 과녁으로 확대한다 */
  async intro(lane) {
    this.endCeremony();
    this.focusShadow(new THREE.Vector3(0, 1, 2), 6);
    await this.setView(this.wideView(), { instant: true });
    await this.tween(900, () => {});
    this.focusShadow(new THREE.Vector3(0, 1, TARGET_Z));
    await this.setView(this.laneView(lane), { duration: 2200 });
  }

  showLane(lane) {
    if (this.view?.height && this.view.position.x === LANES[lane]) return Promise.resolve();
    return this.setView(this.laneView(lane), { duration: 700 });
  }

  /** 경기와 경기 사이: 경기장 전체 */
  showWide() {
    this.focusShadow(new THREE.Vector3(0, 1, 2), 6);
    return this.setView(this.wideView(), { duration: 1400 });
  }

  // ---------- 조준 ----------

  setAiming(lane) {
    this.aimLane = lane;
    if (lane === null) {
      this.reticle.removeFromParent();
      this.reticle.visible = false;
      this.renderer.domElement.style.cursor = '';
      return;
    }
    this.faces[lane].add(this.reticle);
    this.reticle.visible = true;
    this.renderer.domElement.style.cursor = 'crosshair';
  }

  /** 화면 좌표를 aimLane 과녁 면 좌표로 */
  facePoint(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const face = this.faces[this.aimLane];
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(face.getWorldQuaternion(new THREE.Quaternion()));
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, face.getWorldPosition(new THREE.Vector3()));
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    const local = face.worldToLocal(hit);
    return new THREE.Vector2(local.x, local.y);
  }

  clampAim() {
    const limit = BOSS * 0.75;
    this.aim.clampScalar(-limit, limit);
  }

  /**
   * 마우스: 조준점이 포인터를 따라가고, 누르면 당기고 떼면 쏜다.
   * 터치: 손가락이 조준점을 가리지 않도록, 누른 채 끄는 만큼 조준점을 천천히 옮기고 떼면 쏜다.
   */
  bindPointer() {
    const canvas = this.renderer.domElement;
    let touchFrom = null;
    canvas.addEventListener('pointermove', (e) => {
      if (this.aimLane === null) return;
      const point = this.facePoint(e);
      if (!point) return;
      if (e.pointerType === 'mouse') this.aim.copy(point);
      else if (touchFrom) {
        this.aim.addScaledVector(point.clone().sub(touchFrom), 0.45);
        touchFrom = point;
      }
      this.clampAim();
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (this.aimLane === null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      canvas.setPointerCapture(e.pointerId);
      const point = this.facePoint(e);
      if (e.pointerType === 'mouse') {
        if (point) this.aim.copy(point);
      } else touchFrom = point;
      this.clampAim();
      this.onDraw?.();
    });
    const release = (e, cancel) => {
      touchFrom = null;
      if (this.aimLane === null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      this.onRelease?.(cancel);
    };
    canvas.addEventListener('pointerup', (e) => release(e, false));
    canvas.addEventListener('pointercancel', (e) => release(e, true));
  }

  /** 키보드로 조준점을 옮긴다 (m) */
  nudge(dx, dy) {
    this.aim.x += dx;
    this.aim.y += dy;
    this.clampAim();
  }

  /** 과녁 면 좌표의 세계 위치 (라벨용) */
  facePosition(lane, point) {
    return this.faces[lane].localToWorld(new THREE.Vector3(point.x, point.y, 0.05));
  }

  // ---------- 시상식 ----------

  /** 금·은·동 선수를 세운다. names 는 시상대 위에 띄울 이름 [금, 은, 동] */
  async setupCeremony(names) {
    this.endCeremony();
    const looks = [
      { model: 0, shirt: PLAYER_COLORS[0] },
      { model: 1, shirt: PLAYER_COLORS[1] },
      { model: 2, shirt: null },
    ];
    this.medalists = this.steps.map((step, i) => {
      const person = this.makePerson(looks[i].model, { shirt: looks[i].shirt });
      person.position.set(step.x, step.height, -0.45);
      this.podium.add(person);
      return person;
    });
    this.nameLabels = names.map((name, i) => {
      const el = document.createElement('div');
      el.className = `label podium-name rank-${i + 1}`;
      el.textContent = name;
      this.labelLayer.appendChild(el);
      return el;
    });
    this.buildConfetti();
    this.focusShadow(PODIUM.clone().add(new THREE.Vector3(0, 1, 0)), 4);
    await this.setView(this.podiumView(), { duration: 1800 });
    this.swing = 0; // 이제부터 카메라가 천천히 좌우로 돈다
  }

  /** rank (0 금, 1 은, 2 동) 선수에게 메달을 걸어 준다 */
  async awardMedal(rank) {
    const person = this.medalists[rank];
    const colors = [0xd8b03a, 0xc4c9cf, 0xb0703c];
    const medal = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.01, 40).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: colors[rank], metalness: 1, roughness: 0.25 }),
    );
    const ribbonMaterial = new THREE.MeshStandardMaterial({ color: 0x1b3f86, roughness: 0.7, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.28), ribbonMaterial);
      ribbon.position.set(side * 0.065, 0.17, -0.02);
      ribbon.rotation.z = side * 0.42;
      medal.add(ribbon);
    }
    medal.add(disc);
    medal.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    // 가슴 앞, 위에서 내려온다
    person.updateWorldMatrix(true, true);
    const chest = person.localToWorld(new THREE.Vector3(0, 1.22, 0.16));
    const start = chest.clone().add(new THREE.Vector3(0, 0.9, 0.2));
    this.scene.add(medal);
    await this.tween(900, (k) => {
      medal.position.lerpVectors(start, chest, easeOut(k));
      medal.rotation.y = (1 - k) * Math.PI * 2;
      medal.scale.setScalar(0.6 + 0.4 * easeOut(k));
    });
    // 몸통 뼈에 붙여 움직임을 따라가게 한다
    const torso = person.getObjectByName('Torso');
    torso?.attach(medal);
    this.play(person, 'Jump', { once: true });
    this.medalists.forEach((other, i) => {
      if (i !== rank) this.play(other, 'Clapping');
    });
  }

  buildConfetti() {
    const count = 260;
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.04, 0.025),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 }),
      count,
    );
    const palette = [0xf2c94c, 0xffffff, 0xd8362c, 0x2d6fd1, 0xc4c9cf].map((c) => new THREE.Color(c));
    this.confetti = { mesh, pieces: [], active: false };
    for (let i = 0; i < count; i++) {
      mesh.setColorAt(i, palette[i % palette.length]);
      this.confetti.pieces.push(this.spawnConfetti({}, true));
    }
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  spawnConfetti(piece, scatter = false) {
    piece.position = PODIUM.clone().add(
      new THREE.Vector3((Math.random() - 0.5) * 6, 3.5 + Math.random() * (scatter ? 3 : 1), (Math.random() - 0.5) * 3),
    );
    piece.speed = 0.5 + Math.random() * 0.6;
    piece.spin = new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    piece.rotation = new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    piece.sway = Math.random() * 6;
    return piece;
  }

  startConfetti() {
    if (this.confetti) this.confetti.active = this.confetti.mesh.visible = true;
  }

  updateConfetti(dt) {
    const c = this.confetti;
    if (!c?.active) return;
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    c.pieces.forEach((piece, i) => {
      piece.position.y -= piece.speed * dt;
      piece.position.x += Math.sin(this.time * 2 + piece.sway) * 0.3 * dt;
      piece.rotation.x += piece.spin.x * dt;
      piece.rotation.y += piece.spin.y * dt;
      if (piece.position.y < 0) this.spawnConfetti(piece);
      matrix.compose(piece.position, q.setFromEuler(piece.rotation), one);
      c.mesh.setMatrixAt(i, matrix);
    });
    c.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 시상대 위 이름표를 선수 머리 위에 붙인다 */
  updateNameLabels() {
    if (!this.nameLabels) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.nameLabels.forEach((el, i) => {
      const person = this.medalists[i];
      const p = person.localToWorld(new THREE.Vector3(0, 2.05, 0)).project(this.camera);
      el.style.left = `${((p.x + 1) / 2) * width}px`;
      el.style.top = `${((1 - p.y) / 2) * height}px`;
    });
  }

  endCeremony() {
    for (const person of this.medalists ?? []) {
      person.removeFromParent();
      this.mixers = this.mixers.filter((m) => m !== person.userData.mixer);
    }
    this.medalists = null;
    this.swing = null;
    for (const el of this.nameLabels ?? []) el.remove();
    this.nameLabels = null;
    if (this.confetti) {
      this.scene.remove(this.confetti.mesh);
      this.confetti = null;
    }
  }

  // ---------- 프레임 ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    if (this.view && !this.tweens.size) this.applyView(this.view);
    else this.camera.updateProjectionMatrix();
  }

  frame(now) {
    const dt = THREE.MathUtils.clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.time += dt;
    this.onFrame?.(dt);
    for (const t of this.tweens) {
      t.elapsed += dt * 1000;
      const k = Math.min(1, t.elapsed / t.duration);
      t.update(k);
      if (k === 1) {
        this.tweens.delete(t);
        t.resolve();
      }
    }
    for (const mixer of this.mixers) mixer.update(dt);
    this.updateFlags();
    if (this.aimLane !== null) this.reticle.position.set(this.reticlePoint.x, this.reticlePoint.y, 0.01);
    if (this.medalists) {
      // 시상식 동안 카메라가 천천히 좌우로 돈다. 메달을 거는 동안에는 멈춘다
      if (this.swing !== null && !this.tweens.size) {
        this.swing += dt;
        const swing = Math.sin(this.swing * 0.18) * 0.35;
        const base = this.view.position.clone().sub(this.view.look);
        base.applyAxisAngle(new THREE.Vector3(0, 1, 0), swing);
        this.camera.position.copy(this.view.look).add(base);
        this.camera.lookAt(this.view.look);
      }
      this.updateConfetti(dt);
      this.updateNameLabels();
    }
    this.renderer.render(this.scene, this.camera);
  }

  tween(duration, update) {
    return new Promise((resolve) => this.tweens.add({ elapsed: 0, duration, update, resolve }));
  }
}
