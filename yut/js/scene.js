// Three.js 윷판. 게임 상태(game.js)를 읽어 그리기만 하고 규칙은 건드리지 않는다.
//
// 바닥에 둥근 멍석을 깔고, 그 위에 윷판을 그린 삼베 천과 윷을 던지는 담요를 나란히 놓는다.
// 담요는 세로 화면이면 판 아래(카메라 쪽), 가로 화면이면 판 오른쪽에 두어 판이 가장 크게 보이게 한다.
// 판 안쪽의 네 삼각형 빈자리는 편마다 기다리는 말을 세워 두는 마구간이다(0편 아래, 1편 위, 2편 왼쪽, 3편 오른쪽).
// 말은 Quaternius 의 말 모델을 편 색으로 칠해 쓰고, 업힌 말은 정말로 앞 말의 등에 올라탄다.
// 윷가락은 물리 엔진 없이 정해진 결과로 떨어지는 궤적을 계산해 굴린다(공중에서 돌다 바닥에 튀고 구르며 멎는다).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';
import { WAIT, HOME, START, CENTER, CORNERS, STICK_COUNT, MARKED_STICK, forwardPath } from './game.js';

/** 편 색. style.css 의 --p0 … --p3 과 같다 */
export const TEAM_COLORS = ['#e5533d', '#3a86e8', '#f0c02f', '#3fae6a'];

const SHARED_ASSETS = new URL('../../shared/assets/', import.meta.url);
const sharedAsset = (path) => new URL(path, SHARED_ASSETS).href;

// ---------- 판의 치수 (단위는 대략 6cm) ----------

const EDGE = 5; // 바깥 자리들이 놓인 정사각형의 반
const STEP = 2; // 바깥 자리 사이
const CLOTH_HALF = 6.4; // 삼베 천의 반
const CLOTH_T = 0.06;
const TOP = CLOTH_T; // 말이 서는 높이
const MAT_W = 8.4; // 윷 담요(긴 변)
const MAT_D = 4.6; // 윷 담요(짧은 변)
const MAT_T = 0.1;
const MAT_GAP = 0.9; // 판과 담요 사이
const STICK_L = 2.3;
const STICK_W = 0.48;
const STICK_FLAT = 0.1; // 가락 중심에서 평평한 면(배)까지
const STICK_H = 0.25; // 가락 두께(배에서 등 꼭대기까지)
const STICK_END = 0.2; // 둥글게 깎은 끝의 길이
const HORSE_LEN = 1.3; // 말 모델의 몸길이
const TILT = 0.56; // 카메라가 수직에서 기운 각도(라디안)
const TAP_SLOP = 12; // 누른 자리에서 이만큼(픽셀) 넘게 움직이면 탭이 아니다
const HOP_TIME = 0.3; // 한 칸 뛰는 시간(초)

/** 자리 번호 → 판 위 좌표 { x, z }. 출발점(0)이 오른쪽 아래(카메라 쪽), 시계 반대 방향으로 돈다 */
export const STATIONS = (() => {
  const pos = [];
  pos[START] = [EDGE, EDGE];
  for (let i = 1; i <= 4; i++) pos[i] = [EDGE, EDGE - STEP * i];
  pos[5] = [EDGE, -EDGE];
  for (let i = 6; i <= 9; i++) pos[i] = [EDGE - STEP * (i - 5), -EDGE];
  pos[10] = [-EDGE, -EDGE];
  for (let i = 11; i <= 14; i++) pos[i] = [-EDGE, -EDGE + STEP * (i - 10)];
  pos[15] = [-EDGE, EDGE];
  for (let i = 16; i <= 19; i++) pos[i] = [-EDGE + STEP * (i - 15), EDGE];
  const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  const c = [0, 0];
  pos[20] = lerp(pos[5], c, 1 / 3);
  pos[21] = lerp(pos[5], c, 2 / 3);
  pos[CENTER] = c;
  pos[23] = lerp(c, pos[15], 1 / 3);
  pos[24] = lerp(c, pos[15], 2 / 3);
  pos[25] = lerp(pos[10], c, 1 / 3);
  pos[26] = lerp(pos[10], c, 2 / 3);
  pos[27] = lerp(c, pos[0], 1 / 3);
  pos[28] = lerp(c, pos[0], 2 / 3);
  return pos.map(([x, z]) => ({ x, z }));
})();
const EXIT = { x: EDGE + 1.9, z: EDGE + 1.9 }; // 난 말이 빠져나가는 곳
const BIG = new Set([START, CENTER, ...CORNERS]);

/** 편마다 마구간(기다리는 말 자리) 가운데 */
const STABLES = [
  { x: 0, z: 3.15 },
  { x: 0, z: -3.15 },
  { x: -3.15, z: 0 },
  { x: 3.15, z: 0 },
];
const STABLE_W = 2.1;
const STABLE_D = 2.75;
const stableSlot = (team, index) => ({
  x: STABLES[team].x + ((index % 2) - 0.5) * 0.95,
  z: STABLES[team].z + (Math.floor(index / 2) - 0.5) * 1.3,
});

const smooth = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - (1 - k) ** 3;
const lerp = (a, b, k) => a + (b - a) * k;
const angleTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
/** 각도 a 에서 b 로 가장 짧게 돌 때의 차이 */
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function loadTexture(loader, url, { color = false, repeat = 1 } = {}) {
  const texture = loader.load(url);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 윷가락 하나. 길이 방향이 x, 평평한 면(배)이 +y 를 본다. 등은 반달 모양으로 둥글고 양 끝은 둥글게 깎였다.
 * 그룹 0 이 배(평평한 면), 그룹 1 이 등(둥근 면)이다.
 */
function stickGeometry() {
  const along = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    // 끝으로 갈수록 촘촘하게
    const k = i / n;
    along.push(Math.sign(k - 0.5) * Math.abs(2 * k - 1) ** 0.8 * (STICK_L / 2));
  }
  const taper = (x) => {
    const inner = STICK_L / 2 - STICK_END;
    const over = Math.abs(x) - inner;
    return over <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - (over / STICK_END) ** 2));
  };
  const positions = [];
  const uvs = [];
  const indices = [];
  const groups = [];
  const strip = (count, point) => {
    const start = positions.length / 3;
    const first = indices.length;
    for (const x of along) {
      const s = taper(x);
      for (let j = 0; j <= count; j++) {
        const [z, y, v] = point(j / count, s);
        positions.push(x, y, z);
        uvs.push(x / 1.4 + 0.5, v);
      }
    }
    const row = count + 1;
    for (let i = 0; i < along.length - 1; i++) {
      for (let j = 0; j < count; j++) {
        const a = start + i * row + j;
        const b = a + row;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    groups.push([first, indices.length - first]);
  };
  const half = STICK_W / 2;
  // 배: 평평한 면. 끝이 좁아지는 만큼 폭이 줄어든다
  strip(6, (k, s) => [(k - 0.5) * STICK_W * s, STICK_FLAT - (1 - s) * 0.04, k * 0.34]);
  // 등: 반달. 끝에서는 두께도 절반쯤으로 준다
  strip(14, (k, s) => {
    const a = Math.PI * k;
    const depth = STICK_H * (0.45 + 0.55 * s);
    return [Math.cos(a) * half * s, STICK_FLAT - (1 - s) * 0.04 - Math.sin(a) * depth, k * 0.6];
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); // 배와 등은 꼭짓점을 나누지 않아 모서리가 또렷하다
  for (const [start, count] of groups) geometry.addGroup(start, count, geometry.groups.length);
  return geometry;
}

/** 가락이 바닥에 닿는지 볼 때 쓰는 겉의 점들(가락 좌표) */
const STICK_HULL = (() => {
  const points = [];
  const half = STICK_W / 2;
  for (const x of [-(STICK_L / 2 - STICK_END), 0, STICK_L / 2 - STICK_END]) {
    points.push(new THREE.Vector3(x, STICK_FLAT, half), new THREE.Vector3(x, STICK_FLAT, -half));
    for (let j = 1; j < 8; j++) {
      const a = (Math.PI * j) / 8;
      points.push(new THREE.Vector3(x, STICK_FLAT - Math.sin(a) * STICK_H, Math.cos(a) * half));
    }
  }
  points.push(
    new THREE.Vector3(STICK_L / 2, STICK_FLAT - 0.06, 0),
    new THREE.Vector3(-STICK_L / 2, STICK_FLAT - 0.06, 0),
  );
  return points;
})();

/** 가락이 이 자세일 때 중심에서 가장 낮은 점까지의 높이 */
function stickClearance(quaternion) {
  let min = Infinity;
  const v = new THREE.Vector3();
  for (const p of STICK_HULL) min = Math.min(min, v.copy(p).applyQuaternion(quaternion).y);
  return -min;
}

/** 둥근 모서리 직사각형(바닥에 눕힌 판). w × d */
function roundedPlane(w, d, r) {
  const x = w / 2;
  const z = d / 2;
  const shape = new THREE.Shape()
    .moveTo(-x + r, -z)
    .lineTo(x - r, -z)
    .quadraticCurveTo(x, -z, x, -z + r)
    .lineTo(x, z - r)
    .quadraticCurveTo(x, z, x - r, z)
    .lineTo(-x + r, z)
    .quadraticCurveTo(-x, z, -x, z - r)
    .lineTo(-x, -z + r)
    .quadraticCurveTo(-x, -z, -x + r, -z);
  return new THREE.ShapeGeometry(shape, 6).rotateX(-Math.PI / 2);
}

export class YutScene {
  constructor(container, assetUrl) {
    this.container = container;
    this.assetUrl = assetUrl;
    this.renderer = createRenderer(THREE, { antialias: true, alpha: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 }; // HUD 가 가리는 화면 가장자리 픽셀
    this.cameraDirty = true;
    this.layout = null; // 'below' | 'side' : 담요가 판의 어디에 있나
    this.speed = 1; // 애니메이션 빠르기(?debug 에서 바꿔 판을 빨리 돌린다)
    this.views = []; // 말 하나마다 { root, mixer, actions, … }
    this.sticks = [];
    this.markers = null;
    this.preview = null;
    this.turn = -1;
    this.game = null;
    this.time = 0;
    this.onFrame = null; // (dt) => void, 프레임마다 그리기 전에 불린다
    this.onPick = null; // (target) => void, target: { type: 'station', id } | { type: 'stable', team } | { type: 'mat' }
    this.onHover = null; // (target | null) => void, 마우스가 가리키는 것
    this.onSound = null; // (name, { strength, pan }) => void, 애니메이션 중 나는 소리

    this.raycaster = new THREE.Raycaster();
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load() {
    const textures = new THREE.TextureLoader();
    const asset = (path) => new URL(path, this.assetUrl).href;
    const [env, horse] = await Promise.all([
      new RGBELoader().loadAsync(sharedAsset('hdri/warm_bar_1k.hdr')),
      new GLTFLoader().loadAsync(asset('models/Horse.glb')),
    ]);
    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;

    // 텍스처는 늦게 와도 된다. 오기 전에는 재질의 색만으로 그린다
    const tex = (path, options) => loadTexture(textures, asset(`textures/${path}`), options);
    const shared = (path, options) => loadTexture(textures, sharedAsset(`textures/${path}`), options);
    this.material = {
      floor: new THREE.MeshStandardMaterial({
        map: tex('tatami_mat_diff.jpg', { color: true, repeat: 6 }),
        normalMap: tex('tatami_mat_nor_gl.jpg', { repeat: 6 }),
        color: 0xd8cdb0,
        roughness: 0.9,
      }),
      cloth: new THREE.MeshStandardMaterial({
        map: tex('hessian_380_diff.jpg', { color: true, repeat: 3 }),
        normalMap: tex('hessian_380_nor_gl.jpg', { repeat: 3 }),
        color: 0xfff4dc,
        roughness: 0.95,
      }),
      blanket: new THREE.MeshStandardMaterial({
        color: 0x7a1d25,
        normalMap: shared('velour_velvet_nor_gl_1k.jpg', { repeat: 3 }),
        roughnessMap: shared('velour_velvet_rough_1k.jpg', { repeat: 3 }),
        roughness: 1,
      }),
      flat: new THREE.MeshStandardMaterial({
        map: tex('okoume_veneer_diff.jpg', { color: true }),
        normalMap: tex('okoume_veneer_nor_gl.jpg'),
        color: 0xfff2e2,
        roughness: 0.55,
      }),
      round: new THREE.MeshStandardMaterial({
        map: shared('dark_wood_diff_1k.jpg', { color: true }),
        normalMap: shared('dark_wood_nor_gl_1k.jpg'),
        roughnessMap: shared('dark_wood_rough_1k.jpg'),
        color: 0xc88a5a,
        roughness: 0.6,
      }),
    };
    this.horse = horse;
    this.buildLights();
    this.buildTable();
    this.buildSticks();
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  /** 다음 프레임을 꼭 그리게 한다(startLoop 가 frame 밖에서 불린 메서드를 보고 알아챈다) */
  redraw() {}

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff3df, 0x3a2a1c, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  buildTable() {
    // 멍석: 판과 담요를 다 덮는 둥근 돗자리
    const floor = new THREE.Mesh(new THREE.CircleGeometry(24, 64).rotateX(-Math.PI / 2), this.material.floor);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 윷판을 그린 삼베 천
    const cloth = new THREE.Mesh(
      new RoundedBoxGeometry(CLOTH_HALF * 2, CLOTH_T, CLOTH_HALF * 2, 2, 0.03),
      this.material.cloth,
    );
    cloth.position.y = CLOTH_T / 2;
    cloth.receiveShadow = true;
    this.scene.add(cloth);

    this.inkCanvas = document.createElement('canvas');
    this.inkCanvas.width = this.inkCanvas.height = 1024;
    this.inkTexture = new THREE.CanvasTexture(this.inkCanvas);
    this.inkTexture.colorSpace = THREE.SRGBColorSpace;
    this.inkTexture.anisotropy = 4;
    const ink = new THREE.Mesh(
      new THREE.PlaneGeometry(CLOTH_HALF * 2, CLOTH_HALF * 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: this.inkTexture, transparent: true, roughness: 0.9, depthWrite: false }),
    );
    ink.position.y = TOP + 0.002;
    ink.receiveShadow = true;
    this.scene.add(ink);

    // 마구간: 편 색 깔개. 차례인 편의 것이 밝아진다
    this.stablePads = STABLES.map((center) => {
      const pad = new THREE.Mesh(
        roundedPlane(STABLE_W, STABLE_D, 0.35),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.3,
          roughness: 0.9,
          depthWrite: false,
        }),
      );
      pad.position.set(center.x, TOP + 0.004, center.z);
      pad.receiveShadow = true;
      pad.visible = false;
      this.scene.add(pad);
      return pad;
    });

    // 윷 담요
    this.mat = new THREE.Group();
    const blanket = new THREE.Mesh(new RoundedBoxGeometry(MAT_W, MAT_T, MAT_D, 3, 0.05), this.material.blanket);
    blanket.position.y = MAT_T / 2;
    blanket.receiveShadow = true;
    this.mat.add(blanket);
    this.scene.add(this.mat);

    // 누를 수 있는 것들의 보이지 않는 표적
    this.proxies = [];
    const proxyMaterial = new THREE.MeshBasicMaterial();
    // 자리마다 서 있는 말 무더기를 감싸는 기둥. 높이는 누를 때 말 수에 맞춘다(pick)
    const tower = new THREE.CylinderGeometry(0.55, 0.55, 1, 12).translate(0, 0.5, 0);
    this.towers = STATIONS.map(({ x, z }, id) => {
      const mesh = new THREE.Mesh(tower, proxyMaterial);
      mesh.position.set(x, TOP, z);
      mesh.userData.target = { type: 'station', id };
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    });
    const stable = new THREE.BoxGeometry(STABLE_W, 1, STABLE_D);
    STABLES.forEach(({ x, z }, team) => {
      const mesh = new THREE.Mesh(stable, proxyMaterial);
      mesh.position.set(x, 0.5, z);
      mesh.userData.target = { type: 'stable', team };
      this.proxies.push(mesh);
    });
    const matProxy = new THREE.Mesh(new THREE.BoxGeometry(MAT_W, 0.6, MAT_D), proxyMaterial);
    matProxy.position.y = 0.3;
    matProxy.userData.target = { type: 'mat' };
    this.mat.add(matProxy);
    this.proxies.push(matProxy);
    for (const proxy of this.proxies) {
      proxy.visible = false;
      if (!proxy.parent) this.scene.add(proxy);
    }
  }

  /** 먹으로 그린 윷판: 바깥 네모, 두 대각선, 29 자리, 출발 표시 */
  drawBoard(startLabel) {
    const canvas = this.inkCanvas;
    const g = canvas.getContext('2d');
    const size = canvas.width;
    const scale = size / (CLOTH_HALF * 2);
    const px = (v) => (v + CLOTH_HALF) * scale;
    g.clearRect(0, 0, size, size);
    const ink = 'rgba(42, 24, 14, 0.92)';

    // 가장자리 두 줄 테
    g.strokeStyle = 'rgba(120, 30, 24, 0.75)';
    g.lineWidth = 0.07 * scale;
    g.strokeRect(
      px(-CLOTH_HALF + 0.3),
      px(-CLOTH_HALF + 0.3),
      (CLOTH_HALF - 0.3) * 2 * scale,
      (CLOTH_HALF - 0.3) * 2 * scale,
    );
    g.lineWidth = 0.025 * scale;
    g.strokeRect(
      px(-CLOTH_HALF + 0.45),
      px(-CLOTH_HALF + 0.45),
      (CLOTH_HALF - 0.45) * 2 * scale,
      (CLOTH_HALF - 0.45) * 2 * scale,
    );

    // 줄
    g.strokeStyle = ink;
    g.lineCap = 'round';
    g.lineWidth = 0.08 * scale;
    g.strokeRect(px(-EDGE), px(-EDGE), EDGE * 2 * scale, EDGE * 2 * scale);
    g.beginPath();
    g.moveTo(px(-EDGE), px(-EDGE));
    g.lineTo(px(EDGE), px(EDGE));
    g.moveTo(px(EDGE), px(-EDGE));
    g.lineTo(px(-EDGE), px(EDGE));
    g.stroke();

    // 출발점에서 1번 쪽으로 가는 방향 화살표
    const ax = px(EDGE + 0.75);
    g.fillStyle = 'rgba(150, 32, 24, 0.85)';
    g.strokeStyle = 'rgba(150, 32, 24, 0.85)';
    g.lineWidth = 0.06 * scale;
    g.beginPath();
    g.moveTo(ax, px(EDGE - 0.8));
    g.lineTo(ax, px(EDGE - 2.6));
    g.stroke();
    g.beginPath();
    g.moveTo(ax, px(EDGE - 2.95));
    g.lineTo(ax - 0.2 * scale, px(EDGE - 2.5));
    g.lineTo(ax + 0.2 * scale, px(EDGE - 2.5));
    g.closePath();
    g.fill();

    // 자리
    STATIONS.forEach(({ x, z }, id) => {
      const big = BIG.has(id);
      const r = (big ? 0.62 : 0.42) * scale;
      g.beginPath();
      g.arc(px(x), px(z), r, 0, Math.PI * 2);
      g.fillStyle = id === START ? 'rgba(176, 40, 30, 0.9)' : 'rgba(248, 238, 214, 0.92)';
      g.fill();
      g.lineWidth = 0.07 * scale;
      g.strokeStyle = ink;
      g.stroke();
      if (big) {
        g.beginPath();
        g.arc(px(x), px(z), r * 0.68, 0, Math.PI * 2);
        g.lineWidth = 0.04 * scale;
        g.strokeStyle = id === START ? 'rgba(255, 230, 200, 0.9)' : ink;
        g.stroke();
      }
    });

    // 출발 글씨
    g.save();
    g.translate(px(EDGE), px(EDGE + 0.98));
    g.fillStyle = 'rgba(120, 26, 20, 0.95)';
    g.font = `700 ${0.42 * scale}px 'Noto Serif KR', Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(startLabel, 0, 0);
    g.restore();
    this.inkTexture.needsUpdate = true;
  }

  buildSticks() {
    const geometry = stickGeometry();
    const markCanvas = document.createElement('canvas');
    markCanvas.width = markCanvas.height = 128;
    const g = markCanvas.getContext('2d');
    g.strokeStyle = 'rgba(150, 20, 18, 0.95)';
    g.lineWidth = 16;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(30, 30);
    g.lineTo(98, 98);
    g.moveTo(98, 30);
    g.lineTo(30, 98);
    g.stroke();
    const markTexture = new THREE.CanvasTexture(markCanvas);
    markTexture.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < STICK_COUNT; i++) {
      const mesh = new THREE.Mesh(geometry, [this.material.flat, this.material.round]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      let mark = null;
      if (i === MARKED_STICK) {
        // 빽도 가락: 배 가운데에 붉은 ✕
        mark = new THREE.Mesh(
          new THREE.PlaneGeometry(0.34, 0.34).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ map: markTexture, transparent: true, roughness: 0.6, depthWrite: false }),
        );
        mark.position.y = STICK_FLAT + 0.003;
        mesh.add(mark);
      }
      this.scene.add(mesh);
      // rest: 담요 위에서 멎은 자리(담요 좌표) { x, z, yaw, flat }
      const rest = { x: (i - 1.5) * 0.62, z: 0.2, yaw: Math.PI / 2 + (i - 1.5) * 0.04, flat: i % 2 === 0 };
      this.sticks.push({ mesh, mark, rest, plan: null });
    }
  }

  // ---------- 판 ----------

  /** 새 판마다 말을 다시 만든다. labels: { start } 판에 쓸 글씨 */
  setup(game, { labels = { start: '' }, backdo = true } = {}) {
    for (const view of this.views) {
      this.scene.remove(view.root);
      view.mixer.stopAllAction();
    }
    this.game = game;
    this.drawBoard(labels.start);
    this.stablePads.forEach((pad, team) => {
      pad.visible = team < game.players;
      pad.material.color.set(TEAM_COLORS[team]);
    });
    this.teamMaterials = Array.from({ length: game.players }, (_, team) => this.horseMaterials(team));
    this.views = game.pieces.map((piece) => this.makeHorse(piece));
    for (const stick of this.sticks) {
      stick.plan = null;
      if (stick.mark) stick.mark.visible = backdo;
    }
    this.setPreview(null);
    this.sync();
    this.placeSticks();
    this.cameraDirty = true;
  }

  /** 편 색으로 칠한 말 재질들(원래 재질 이름 → 재질) */
  horseMaterials(team) {
    const color = new THREE.Color(TEAM_COLORS[team]);
    const materials = new Map();
    this.horse.scene.traverse((o) => {
      if (!o.isMesh || materials.has(o.material.name)) return;
      const material = o.material.clone();
      const name = material.name;
      if (name === 'Main') material.color.copy(color).multiplyScalar(0.78);
      else if (name === 'Main_Light') material.color.copy(color).lerp(new THREE.Color(0xffffff), 0.45);
      else if (name === 'Main_Dark') material.color.copy(color).multiplyScalar(0.45);
      material.roughness = Math.max(0.55, material.roughness ?? 0.7);
      materials.set(name, material);
    });
    return materials;
  }

  makeHorse(piece) {
    const model = SkeletonUtils.clone(this.horse.scene);
    const materials = this.teamMaterials[piece.team];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = materials.get(o.material.name) ?? o.material;
      o.castShadow = true;
      o.frustumCulled = false; // 뼈로 움직이는 메시의 경계가 원래 자세 기준이라 잘못 잘리지 않게
    });
    // 크기·발 높이를 맞춘다(스킨 메시의 경계 상자는 뼈 위치로 계산하므로 월드 행렬부터 갱신)
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    const scale = HORSE_LEN / Math.max(size.x, size.z);
    model.scale.setScalar(scale);
    model.position.set(
      -((box.min.x + box.max.x) / 2) * scale,
      -box.min.y * scale,
      -((box.min.z + box.max.z) / 2) * scale,
    );
    const root = new THREE.Group();
    root.add(model);
    this.scene.add(root);
    this.stackHeight = size.y * scale * 0.58; // 업힌 말이 앉는 높이(등)

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const clip of this.horse.animations) actions[clip.name.split('|').pop()] = mixer.clipAction(clip);
    const view = {
      id: piece.id,
      team: piece.team,
      root,
      mixer,
      actions,
      active: null,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      scale: 1,
      track: [],
      awake: 0,
    };
    this.play(view, 'Idle');
    mixer.update(Math.random() * 2);
    return view;
  }

  play(view, name, { once = false, fade = 0.15 } = {}) {
    const next = view.actions[name];
    if (!next || view.active === next) return;
    next.reset();
    next.loop = once ? THREE.LoopOnce : THREE.LoopRepeat;
    next.clampWhenFinished = once;
    next.play();
    if (view.active) view.active.crossFadeTo(next, fade, false);
    view.active = next;
  }

  /**
   * 지금 게임 상태대로 말이 서 있어야 할 자리 id → { x, y, z, heading, visible }.
   * 한 자리에 업힌 말은 원래 있던 말이 아래, riders(지금 와서 업힌 말)가 위다.
   */
  targets(riders = new Set()) {
    const result = new Map();
    const pieces = this.game.pieces;
    const byStation = new Map();
    for (const piece of pieces) {
      if (piece.pos === WAIT) {
        const slot = stableSlot(piece.team, piece.index);
        result.set(piece.id, { ...slot, y: TOP, heading: 0, visible: true });
      } else if (piece.pos === HOME) {
        result.set(piece.id, { ...EXIT, y: TOP, heading: Math.PI * 0.75, visible: false });
      } else {
        const list = byStation.get(piece.pos) ?? [];
        list.push(piece);
        byStation.set(piece.pos, list);
      }
    }
    const order = (piece) => (riders.has(piece.id) ? 100 : 0) + (this.views[piece.id]?.y ?? 0);
    for (const [station, list] of byStation) {
      list.sort((a, b) => order(a) - order(b));
      const at = STATIONS[station];
      const next = forwardPath(station, 1)[0];
      const ahead = next === HOME ? EXIT : STATIONS[next];
      const heading = angleTo(at, ahead);
      list.forEach((piece, level) => {
        result.set(piece.id, { x: at.x, z: at.z, y: TOP + level * this.stackHeight, heading, visible: true });
      });
    }
    return result;
  }

  /** 애니메이션 없이 모든 말을 제자리에 놓는다 */
  sync() {
    if (!this.game) return;
    const targets = this.targets();
    for (const view of this.views) {
      const target = targets.get(view.id);
      view.track = [];
      Object.assign(view, {
        x: target.x,
        y: target.y,
        z: target.z,
        heading: target.heading,
      });
      view.scale = target.visible ? 1 : 0;
      this.placeView(view);
    }
  }

  placeView(view) {
    view.root.position.set(view.x, view.y, view.z);
    view.root.rotation.y = view.heading;
    view.root.scale.setScalar(Math.max(0.0001, view.scale));
    view.root.visible = view.scale > 0.001;
  }

  // ---------- 사건 ----------

  /** game.drain() 으로 나온 사건을 화면에 옮긴다 */
  handle(event) {
    switch (event.type) {
      case 'throw':
        this.toss(event.sticks);
        break;
      case 'move':
        this.animateMove(event);
        break;
      case 'turn':
        this.setTurn(event.team);
        break;
    }
  }

  /** 말이 길을 따라 한 칸씩 뛰어간다. 잡힌 말은 튕겨서 마구간으로, 난 말은 판 밖으로 빠져나가 사라진다 */
  animateMove(event) {
    const targets = this.targets(new Set(event.pieces));
    const movers = event.pieces.map((id) => this.views[id]).sort((a, b) => a.y - b.y);
    const base = movers[0].y;
    const hop = HOP_TIME;
    let time = 0;
    movers.forEach((view, rider) => {
      view.track = [];
      const offset = view.y - base;
      const stations = event.path.map((s) => (s === HOME ? EXIT : STATIONS[s]));
      stations.forEach((point, i) => {
        const last = i === stations.length - 1;
        const home = event.path[i] === HOME;
        const final = targets.get(view.id);
        const to = last && !home ? { x: final.x, y: final.y, z: final.z } : { x: point.x, y: TOP + offset, z: point.z };
        view.track.push({
          type: 'hop',
          to,
          dur: hop,
          height: 0.55 + offset * 0.1,
          onStart: () => this.play(view, 'Gallop', { fade: 0.08 }),
          onEnd: rider === 0 ? () => this.onSound?.('step', { strength: last ? 1 : 0.6, pan: point.x / 12 }) : null,
        });
      });
      if (event.home) view.track.push({ type: 'vanish', dur: 0.35 });
      view.track.push({
        type: 'settle',
        heading: targets.get(view.id).heading,
        dur: 0.25,
        onStart: () => this.play(view, 'Idle', { fade: 0.25 }),
      });
      time = event.path.length * hop;
    });
    if (event.capture.length) {
      const at = STATIONS[event.to];
      for (const id of event.capture) {
        const view = this.views[id];
        const target = targets.get(id);
        view.track = [
          { type: 'wait', dur: time - hop * 0.25 },
          {
            type: 'fly',
            to: { x: target.x, y: target.y, z: target.z },
            dur: 0.75,
            height: 2.6,
            spin: Math.PI * 4,
            onStart: () => {
              this.play(view, 'Idle_HitReact_Left', { once: true, fade: 0.05 });
              this.onSound?.('capture', { strength: 1, pan: at.x / 12 });
            },
          },
          { type: 'settle', heading: target.heading, dur: 0.3, onStart: () => this.play(view, 'Idle', { fade: 0.3 }) },
        ];
      }
    } else if (event.stack.length) {
      movers[0].track.at(-1).onEnd = () => this.onSound?.('stack', { strength: 1 });
    }
    if (event.home) movers[0].track.at(-1).onEnd = () => this.onSound?.('home', { strength: 1 });
  }

  /** 말 하나의 애니메이션을 한 프레임 진행한다. 움직였으면 true */
  stepView(view, dt) {
    const segment = view.track[0];
    if (!segment) return false;
    if (!segment.started) {
      segment.started = true;
      segment.t = 0;
      segment.from = { x: view.x, y: view.y, z: view.z, heading: view.heading, scale: view.scale };
      segment.onStart?.();
    }
    segment.t += dt;
    const k = Math.min(1, segment.t / segment.dur);
    const { from, to } = segment;
    switch (segment.type) {
      case 'hop':
      case 'fly': {
        const e = segment.type === 'fly' ? easeOut(k) : k;
        view.x = lerp(from.x, to.x, e);
        view.z = lerp(from.z, to.z, e);
        view.y = lerp(from.y, to.y, e) + Math.sin(Math.PI * k) * segment.height;
        if (Math.hypot(to.x - from.x, to.z - from.z) > 0.01) {
          const facing = angleTo(from, to);
          if (segment.type === 'fly') view.heading = facing + Math.PI + segment.spin * (1 - easeOut(k));
          else view.heading += angleDiff(view.heading, facing) * damp(18, dt);
        }
        break;
      }
      case 'vanish':
        view.scale = 1 - smooth(k);
        break;
      case 'settle':
        view.heading = from.heading + angleDiff(from.heading, segment.heading) * smooth(k);
        break;
      case 'wait':
        break;
    }
    view.awake = 0.8;
    if (k >= 1) {
      view.track.shift();
      segment.onEnd?.();
    }
    return true;
  }

  // ---------- 윷 ----------

  /** 담요 좌표 → 판 좌표 */
  matToWorld(x, z) {
    const yaw = this.mat.rotation.y;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return { x: this.mat.position.x + x * c + z * s, z: this.mat.position.z - x * s + z * c };
  }

  /** 가락이 멎은 자세(판 좌표의 위치·회전) */
  restPose(rest) {
    const { x, z } = this.matToWorld(rest.x, rest.z);
    const quaternion = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), rest.yaw + this.mat.rotation.y)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rest.flat ? 0 : Math.PI));
    const y = MAT_T + stickClearance(quaternion);
    return { position: new THREE.Vector3(x, y, z), quaternion };
  }

  /** 던지지 않을 때 가락을 담요 위 제자리에 둔다 */
  placeSticks() {
    for (const stick of this.sticks) {
      if (stick.plan) continue;
      const { position, quaternion } = this.restPose(stick.rest);
      stick.mesh.position.copy(position);
      stick.mesh.quaternion.copy(quaternion);
    }
  }

  /**
   * 윷을 던진다. flats[i] 가 true 면 i 번 가락이 배를 위로 하고 멎는다.
   * 손에서 떠나 공중에서 길이 방향으로 구르고 재주를 넘다가, 담요에 떨어져 두어 번 튀고 구르며 멎는다.
   */
  toss(flats) {
    this.onSound?.('whoosh', { strength: 1 });
    const slots = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    this.sticks.forEach((stick, i) => {
      const r = () => Math.random();
      stick.rest = {
        x: (slots[i] - 1.5) * 1.62 + (r() - 0.5) * 0.4,
        z: (r() - 0.5) * 0.8,
        yaw: Math.PI / 2 + (r() - 0.5) * 0.5,
        flat: flats[i],
      };
      const end = this.restPose(stick.rest);
      // 손: 담요의 카메라 쪽 바깥, 조금 위
      const handZ = this.mat.position.z + (this.layout === 'side' ? MAT_W : MAT_D) / 2 + 1.6;
      const start = new THREE.Vector3(this.mat.position.x + (i - 1.5) * 0.35, 1.4 + r() * 0.3, handZ);
      const land = 0.68 + r() * 0.14; // 처음 바닥에 닿는 때
      const slide = new THREE.Vector3().subVectors(end.position, start).setY(0).normalize().multiplyScalar(-0.5);
      const touch = end.position.clone().add(slide); // 처음 닿는 곳(조금 미끄러져 멎는다)
      const g = 24;
      const v = (MAT_T + 0.2 - start.y + 0.5 * g * land * land) / land;
      const yawEnd = stick.rest.yaw + this.mat.rotation.y;
      stick.plan = {
        t: -0.2 - i * 0.03, // 집어 드는 때를 빼고 0 에서 손을 떠난다
        pickFrom: { position: stick.mesh.position.clone(), quaternion: stick.mesh.quaternion.clone() },
        start,
        touch,
        end,
        land,
        v,
        g,
        bounces: [
          { dur: 0.24 + r() * 0.06, height: 0.3 + r() * 0.2 },
          { dur: 0.13, height: 0.07 + r() * 0.05 },
        ],
        settle: 0.3,
        yawStart: yawEnd + (r() - 0.5) * 2.4,
        yawEnd,
        pitch: (r() < 0.5 ? -1 : 1) * (Math.PI * 2 * Math.round(r() * 1)), // 재주넘기(0 또는 한 바퀴)
        pitchWobble: (r() - 0.5) * 0.5,
        roll: (flats[i] ? 0 : Math.PI) + (r() < 0.5 ? -1 : 1) * Math.PI * 2 * (2 + Math.floor(r() * 2)),
        rollEnd: flats[i] ? 0 : Math.PI,
        sounded: 0,
        pan: Math.max(-1, Math.min(1, end.position.x / 10)),
      };
    });
  }

  /** 가락 하나를 한 프레임 굴린다. 아직 움직이면 true */
  stepStick(stick, dt) {
    const plan = stick.plan;
    if (!plan) return false;
    plan.t += dt;
    const t = plan.t;
    const mesh = stick.mesh;
    if (t < 0) {
      // 담요에서 집어 들어 손으로
      const k = smooth(Math.min(1, (t + 0.2) / 0.2));
      mesh.position.lerpVectors(plan.pickFrom.position, plan.start, k);
      mesh.quaternion.slerpQuaternions(
        plan.pickFrom.quaternion,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), plan.yawStart),
        k,
      );
      return true;
    }
    const [b1, b2] = plan.bounces;
    const total = plan.land + b1.dur + b2.dur + plan.settle;
    const after = t - plan.land; // 처음 닿은 뒤
    // 위치: 날아가는 동안은 포물선, 닿은 뒤에는 튀면서 멎을 자리로 미끄러진다
    const position = new THREE.Vector3();
    let lift = 0;
    if (after < 0) {
      const k = t / plan.land;
      position.lerpVectors(plan.start, plan.touch, k);
      position.y = plan.start.y + plan.v * t - 0.5 * plan.g * t * t;
    } else {
      const k = easeOut(Math.min(1, after / (b1.dur + b2.dur + plan.settle * 0.5)));
      position.lerpVectors(plan.touch, plan.end.position, k);
      if (after < b1.dur) lift = b1.height * 4 * (after / b1.dur) * (1 - after / b1.dur);
      else if (after < b1.dur + b2.dur) {
        const s = (after - b1.dur) / b2.dur;
        lift = b2.height * 4 * s * (1 - s);
      }
    }
    // 회전: 길이 방향 구르기(roll)는 첫 튐이 끝날 무렵 결과 면에 닿고, 재주넘기(pitch)는 처음 닿을 때 멎는다
    const rollK = Math.min(1, t / (plan.land + b1.dur * 0.8));
    const roll = lerp(plan.roll, plan.rollEnd, 1 - (1 - rollK) ** 2);
    const pitchK = Math.min(1, t / plan.land);
    let pitch = plan.pitch * (1 - easeOut(pitchK));
    if (after > 0) pitch += plan.pitchWobble * Math.exp(-after * 7) * Math.sin(after * 26);
    const yaw = lerp(plan.yawStart, plan.yawEnd, easeOut(Math.min(1, t / (total * 0.8))));
    const quaternion = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
    const floor = MAT_T + stickClearance(quaternion);
    if (after >= 0) position.y = floor + lift;
    position.y = Math.max(position.y, floor);
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);

    // 닿을 때마다 딱 소리
    const hits = [plan.land, plan.land + b1.dur, plan.land + b1.dur + b2.dur];
    while (plan.sounded < hits.length && t >= hits[plan.sounded]) {
      this.onSound?.('clack', { strength: [1, 0.5, 0.22][plan.sounded], pan: plan.pan });
      plan.sounded++;
    }
    if (t >= total) {
      mesh.position.copy(plan.end.position);
      mesh.quaternion.copy(plan.end.quaternion);
      stick.plan = null;
      return true;
    }
    return true;
  }

  /** 윷가락·말 중에 아직 움직이는 것이 있나 */
  get busy() {
    return this.sticks.some((s) => s.plan) || this.views.some((v) => v.track.length > 0);
  }

  /** 다 멎을 때까지 기다리지 않고 바로 끝낸다(새 판·메뉴로 나갈 때) */
  finish() {
    for (const stick of this.sticks) {
      if (!stick.plan) continue;
      stick.plan = null;
    }
    this.placeSticks();
    this.sync();
  }

  // ---------- 고르기 표시 ----------

  /** 차례인 편의 마구간을 밝힌다. -1 이면 끈다 */
  setTurn(team) {
    this.turn = team;
  }

  /**
   * 고른 결과로 옮길 수 있는 말과 갈 자리를 보여 준다.
   * preview: { team, focus, options: [{ from, to, path, pieces, label }] } 또는 null
   */
  setPreview(preview) {
    if (this.markers) {
      this.scene.remove(this.markers);
      // 도형과 글씨 표는 같이 쓰므로 남기고, 고리마다 만든 재질만 버린다
      this.markers.traverse((o) => {
        if (o.isMesh) o.material.dispose();
      });
    }
    this.markers = null;
    this.preview = preview;
    if (!preview || !this.game) return;
    this.markerGeometry ??= {
      ring: new THREE.RingGeometry(0.62, 0.8, 40).rotateX(-Math.PI / 2),
      source: new THREE.RingGeometry(0.5, 0.64, 40).rotateX(-Math.PI / 2),
      dot: new THREE.CircleGeometry(0.13, 16).rotateX(-Math.PI / 2),
      beam: new THREE.CylinderGeometry(0.55, 0.62, 1.4, 24, 1, true).translate(0, 0.7, 0),
    };
    this.labels ??= new Map();
    const color = new THREE.Color(TEAM_COLORS[preview.team]);
    const group = new THREE.Group();
    const mat = (opacity, tint = color) =>
      new THREE.MeshBasicMaterial({
        color: tint,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    preview.options.forEach((option, index) => {
      const focused = index === preview.focus;
      const lead = this.views[option.pieces[0]];
      // 움직일 말 밑의 고리
      const source = new THREE.Mesh(this.markerGeometry.source, mat(focused ? 0.95 : 0.7, new THREE.Color(0xffffff)));
      source.position.set(lead.x, TOP + 0.012, lead.z);
      source.userData.pulse = { base: 1, amount: 0.08, phase: index };
      group.add(source);
      // 길: 지나가는 자리마다 점
      const points = option.path.map((s) => (s === HOME ? EXIT : STATIONS[s]));
      points.slice(0, -1).forEach((p) => {
        const dot = new THREE.Mesh(this.markerGeometry.dot, mat(focused ? 0.95 : 0.55));
        dot.position.set(p.x, TOP + 0.014, p.z);
        dot.scale.setScalar(focused ? 1.25 : 1);
        group.add(dot);
      });
      // 도착: 고리와 빛기둥
      const to = points.at(-1);
      const ring = new THREE.Mesh(this.markerGeometry.ring, mat(focused ? 1 : 0.8));
      ring.position.set(to.x, TOP + 0.016, to.z);
      ring.userData.pulse = { base: focused ? 1.12 : 1, amount: 0.1, phase: index + 0.5 };
      group.add(ring);
      const beam = new THREE.Mesh(this.markerGeometry.beam, mat(focused ? 0.32 : 0.16));
      beam.position.set(to.x, TOP, to.z);
      group.add(beam);
      if (option.label) {
        const sprite = new THREE.Sprite(this.labelMaterial(option.label, option.tone ?? preview.team));
        const height = this.game.pieces.filter((p) => p.pos === option.to && option.to !== HOME).length;
        sprite.position.set(to.x, TOP + 1.7 + height * this.stackHeight, to.z);
        sprite.scale.set(1.9, 0.62, 1);
        sprite.renderOrder = 10;
        group.add(sprite);
      }
    });
    this.markers = group;
    this.scene.add(group);
  }

  /** '잡기'·'업기'·'나기' 같은 짧은 글씨 표 */
  labelMaterial(text, tone) {
    const key = `${text}|${tone}`;
    let material = this.labels.get(key);
    if (material) return material;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 84;
    const g = canvas.getContext('2d');
    const fill = tone === 'capture' ? '#d8322a' : (TEAM_COLORS[tone] ?? '#333');
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(6, 6, 244, 72, 36);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.stroke();
    g.fillStyle = '#fff';
    g.font = "700 40px 'Pretendard', 'Noto Sans KR', system-ui, sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 44);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    this.labels.set(key, material);
    return material;
  }

  // ---------- 입력 ----------

  /**
   * 화면 좌표가 가리키는 것. 없으면 null.
   * 말이 서 있는 자리는 말 무더기 기둥으로, 빈 자리는 판 위에서 가장 가까운 자리로 찾는다.
   * 그래서 카메라 쪽 자리의 말이 뒷자리를 가리지 않는 한 뒷자리도 그대로 누를 수 있다.
   */
  pick(clientX, clientY) {
    if (!this.game) return null;
    this.placeCamera();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray;

    const counts = new Map();
    for (const piece of this.game.pieces) {
      if (piece.pos !== WAIT && piece.pos !== HOME) counts.set(piece.pos, (counts.get(piece.pos) ?? 0) + 1);
    }
    const occupied = [];
    this.towers.forEach((tower, id) => {
      const count = counts.get(id);
      if (!count) return;
      tower.scale.set(1, (count + 0.75) * this.stackHeight, 1);
      tower.updateMatrixWorld();
      occupied.push(tower);
    });
    const ground = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP), new THREE.Vector3());
    const groundDistance = ground ? ray.origin.distanceTo(ground) : Infinity;
    const [column] = this.raycaster.intersectObjects(occupied, false);
    if (column && column.distance < groundDistance) return column.object.userData.target;
    if (ground) {
      let best = null;
      STATIONS.forEach(({ x, z }, id) => {
        const d = Math.hypot(ground.x - x, ground.z - z);
        if (d < (BIG.has(id) ? 0.9 : 0.75) && (!best || d < best.d)) best = { id, d };
      });
      if (best) return { type: 'station', id: best.id };
    }
    for (const hit of this.raycaster.intersectObjects(this.proxies, false)) {
      const target = hit.object.userData.target;
      if (target.type === 'stable' && target.team >= this.game.players) continue;
      return target;
    }
    return null;
  }

  /** 누른 자리에서 그대로 떼어야 탭이다. 끌거나 두 손가락을 대면 무시한다 */
  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (down || (e.pointerType === 'mouse' && e.button !== 0)) {
        down = null;
        return;
      }
      down = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const { x, y } = down;
      down = null;
      if (Math.hypot(e.clientX - x, e.clientY - y) > TAP_SLOP) return;
      const target = this.pick(e.clientX, e.clientY);
      if (target) this.onPick?.(target);
    });
    el.addEventListener('pointercancel', () => {
      down = null;
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.onHover?.(this.pick(e.clientX, e.clientY));
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.onHover?.(null);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
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

  /** 담요를 놓을 자리. 'below' 는 판 아래(카메라 쪽), 'side' 는 오른쪽 */
  setLayout(layout) {
    if (this.layout === layout) return;
    this.layout = layout;
    const below = layout === 'below';
    const offset = CLOTH_HALF + MAT_GAP + MAT_D / 2;
    this.mat.position.set(below ? 0 : offset, 0, below ? offset : 0);
    this.mat.rotation.y = below ? 0 : Math.PI / 2;
    this.placeSticks();
    // 그림자 상자: 판과 담요를 다 덮는다
    const box = this.bounds();
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 1;
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -r;
    s.right = s.top = r;
    s.near = 1;
    s.far = r * 6;
    s.updateProjectionMatrix();
    this.sun.position.set(cx - r * 0.55, r * 2.2, cz - r * 0.2);
    this.sun.target.position.set(cx, 0, cz);
  }

  /** 판과 담요를 감싸는 상자(바닥 기준) */
  bounds() {
    const box = new THREE.Box3(
      new THREE.Vector3(-CLOTH_HALF, 0, -CLOTH_HALF),
      new THREE.Vector3(CLOTH_HALF, 0, CLOTH_HALF),
    );
    const below = this.layout === 'below';
    const hw = (below ? MAT_W : MAT_D) / 2;
    const hd = (below ? MAT_D : MAT_W) / 2;
    box.expandByPoint(new THREE.Vector3(this.mat.position.x - hw, 0, this.mat.position.z - hd));
    box.expandByPoint(new THREE.Vector3(this.mat.position.x + hw, 0, this.mat.position.z + hd));
    return box;
  }

  /** layout 으로 놓았을 때 HUD 에 가리지 않는 영역에 다 들어가는 카메라 거리와 화면 위아래 치우침 */
  fit(layout, availW, availH, w, h) {
    this.setLayout(layout);
    const box = this.bounds();
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const camera = this.camera;
    const corner = new THREE.Vector3();
    const extent = (distance) => {
      camera.position.set(cx, Math.cos(TILT) * distance, cz + Math.sin(TILT) * distance);
      camera.lookAt(cx, 0, cz);
      camera.updateMatrixWorld();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const x of [box.min.x, box.max.x]) {
        for (const z of [box.min.z, box.max.z]) {
          for (const y of [0, 1.1]) {
            corner.set(x, y, z).project(camera);
            minX = Math.min(minX, corner.x);
            maxX = Math.max(maxX, corner.x);
            minY = Math.min(minY, corner.y);
            maxY = Math.max(maxY, corner.y);
          }
        }
      }
      return { minX, maxX, minY, maxY };
    };
    const fits = (distance) => {
      const { minX, maxX, minY, maxY } = extent(distance);
      return (maxX - minX) / 2 <= availW / w && (maxY - minY) / 2 <= availH / h;
    };
    let near = 5;
    let far = 400;
    for (let i = 0; i < 28; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    const { minX, maxX, minY, maxY } = extent(far);
    return { distance: far, cx, cz, midX: (minX + maxX) / 2, midY: (minY + maxY) / 2 };
  }

  /** 판과 담요가 HUD 에 가리지 않는 영역에 꽉 차게 카메라를 놓는다. 판이 더 크게 보이는 쪽에 담요를 둔다 */
  placeCamera() {
    if (!this.cameraDirty || !this.game) return;
    this.cameraDirty = false;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const margin = Math.min(w, h) < 500 ? 4 : 14;
    const availW = Math.max(60, w - left - right - margin * 2);
    const availH = Math.max(60, h - top - bottom - margin * 2);
    const camera = this.camera;
    camera.clearViewOffset();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const below = this.fit('below', availW, availH, w, h);
    const side = this.fit('side', availW, availH, w, h);
    const best = side.distance < below.distance * 0.97 ? 'side' : 'below';
    // fit 은 맞춘 거리에 카메라를 두고 끝난다
    const { midX, midY } = this.fit(best, availW, availH, w, h);
    const sx = (left + (w - right)) / 2;
    const sy = (top + (h - bottom)) / 2;
    camera.setViewOffset(w, h, w / 2 - sx + (midX * w) / 2, h / 2 - sy - (midY * h) / 2, w, h);
  }

  // ---------- 프레임 ----------

  frame(now) {
    const raw = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.onFrame?.(raw);
    const dt = raw * this.speed;
    this.time += raw;
    let lively = false;
    if (this.game) {
      this.placeCamera();
      lively = this.animate(dt);
    }
    if (this.loop.due(now, lively)) this.renderer.render(this.scene, this.camera);
  }

  /** 말·윷을 움직인다. 움직인 것이 있으면 true */
  animate(dt) {
    let moving = false;
    for (const stick of this.sticks) moving = this.stepStick(stick, dt) || moving;
    for (const view of this.views) {
      if (this.stepView(view, dt)) {
        moving = true;
        this.placeView(view);
      }
      if (view.awake > 0) {
        view.awake -= dt;
        view.mixer.update(dt);
        moving = true;
      }
    }
    // 차례인 편의 마구간이 밝아진다
    this.stablePads.forEach((pad, team) => {
      const want = team === this.turn ? 0.62 : 0.24;
      if (Math.abs(pad.material.opacity - want) > 0.005) {
        pad.material.opacity += (want - pad.material.opacity) * damp(8, dt);
        moving = true;
      }
    });
    // 고를 수 있는 것들이 숨 쉬듯 커졌다 작아진다(잔잔한 움직임이라 초당 30 번이면 된다)
    if (this.markers) {
      for (const o of this.markers.children) {
        const pulse = o.userData.pulse;
        if (pulse) o.scale.setScalar(pulse.base + Math.sin(this.time * 5 + pulse.phase) * pulse.amount);
      }
    }
    return moving;
  }
}
