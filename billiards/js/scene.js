// Three.js 당구장. 물리(physics.js)가 굴린 공의 자리와 회전을 받아 그리고, 큐·보조선·카메라를 다룬다.
// 규칙은 건드리지 않는다. 당구대 평면 좌표 (x, y) 는 화면의 (x, -z) 로, 높이는 y 로 옮긴다 (거울 뒤집기가 없는 회전이라
// 위에서 본 대가 평면 좌표 그대로 보이고, 오른쪽 회전이 화면에서도 오른쪽이다).
// 텍스처·HDRI 는 오픈소스(CC0) 에셋이고 출처는 assets/CREDITS.md 에 있다. 대·쿠션·큐는 규격에 맞춰 코드로 만든다.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';
import { CUSHION_WIDTH, RAIL_WIDTH, diamonds } from './table.js';

const ASSETS = new URL('../assets/', import.meta.url);
const SHARED = new URL('../../shared/assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;
const shared = (path) => new URL(path, SHARED).href;

const TABLE_HEIGHT = 0.78; // 바닥에서 천까지
const CUE_TILT = (5 * Math.PI) / 180; // 큐 뒤쪽을 들어 올린 각도
const STRIKE_TIME = 0.07; // 큐가 앞으로 나가 공을 치기까지(초)
const DROP_TIME = 0.22; // 포켓에 빠지는 공이 사라지기까지(초)

export const FELT_COLORS = { fourball: 0x1f5fb5, threecushion: 0x2457a8, eightball: 0x1b7a4c };
const CAROM_COLORS = ['#f4f1e6', '#f4c21c', '#c8102e', '#c8102e'];
const POOL_COLORS = ['#f6f3ea', '#f2c40f', '#1d4fbf', '#d4251c', '#5b2a86', '#f07b16', '#14864a', '#7d1d1d', '#141414'];

/** 공 표면 그림 (정방형 원통 도법). 숫자 원은 적도의 앞뒤 두 곳에, 회전이 보이도록 캐롬 공에는 작은 점을 찍는다 */
function ballCanvas(kind, id) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const dot = (color, r = 9) => {
    g.fillStyle = color;
    for (const x of [0, 128, 256, 384, 512]) {
      g.beginPath();
      g.arc(x, 128, r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillRect(0, 0, 512, r * 0.9);
    g.fillRect(0, 256 - r * 0.9, 512, r * 0.9);
  };
  if (kind === 'carom') {
    g.fillStyle = CAROM_COLORS[id];
    g.fillRect(0, 0, 512, 256);
    if (id < 2) dot('#b3122a');
    else dot('rgba(80, 0, 10, 0.45)', 7);
    return canvas;
  }
  if (id === 0) {
    g.fillStyle = POOL_COLORS[0];
    g.fillRect(0, 0, 512, 256);
    dot('#c0262d', 7);
    return canvas;
  }
  const color = POOL_COLORS[id > 8 ? id - 8 : id];
  if (id > 8) {
    g.fillStyle = POOL_COLORS[0];
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = color;
    g.fillRect(0, 74, 512, 108);
  } else {
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 256);
  }
  for (const x of [128, 384]) {
    g.fillStyle = '#f8f5ec';
    g.beginPath();
    g.arc(x, 128, 38, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#151515';
    g.font = `bold ${id > 9 ? 40 : 46}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(id), x, 131);
    if (id === 6 || id === 9) g.fillRect(x - 12, 152, 24, 4); // 6 과 9 를 구별하는 밑줄
  }
  return canvas;
}

/**
 * 가운데가 원점이고 반폭 a, b 인 직사각형의 테두리를 원들로 깎거나(difference) 넓힌(union) 다각형.
 * 원은 테두리를 두 번 가로질러야 한다. 포켓 구멍이 난 천과 레일 안쪽 선을 만든다.
 */
function bitten(a, b, circles, union) {
  const poly = [
    [-a, 0],
    [-a, -b],
    [a, -b],
    [a, b],
    [-a, b],
    [-a, 0],
  ];
  const cuts = [];
  for (const c of circles) {
    const hits = [];
    for (let i = 0; i < 5; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const fx = ax - c.x;
      const fy = ay - c.y;
      const A = dx * dx + dy * dy;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - c.r * c.r;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      for (const sign of [-1, 1]) {
        const t = (-B + sign * Math.sqrt(disc)) / (2 * A);
        if (t >= 0 && t <= 1) hits.push({ s: i + t, x: ax + dx * t, y: ay + dy * t });
      }
    }
    hits.sort((p, q) => p.s - q.s);
    if (hits.length >= 2) cuts.push({ c, from: hits[0], to: hits[hits.length - 1] });
  }
  cuts.sort((p, q) => p.from.s - q.from.s);
  const out = [poly[0]];
  let cursor = 0;
  for (const { c, from, to } of cuts) {
    for (let k = Math.floor(cursor) + 1; k < from.s; k++) out.push(poly[k]);
    let t1 = Math.atan2(from.y - c.y, from.x - c.x);
    let t2 = Math.atan2(to.y - c.y, to.x - c.x);
    if (union) while (t2 < t1) t2 += Math.PI * 2;
    else while (t2 > t1) t2 -= Math.PI * 2;
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const t = t1 + ((t2 - t1) * i) / n;
      out.push([c.x + Math.cos(t) * c.r, c.y + Math.sin(t) * c.r]);
    }
    cursor = to.s;
  }
  for (let k = Math.floor(cursor) + 1; k < 5; k++) out.push(poly[k]);
  return out;
}

/** 평면 좌표 [x, y] 목록을 Shape 로. 눕히면(slab) shape 의 y 가 화면의 -z 가 되어 평면 좌표와 맞는다 */
const toShape = (points) => new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
const toPath = (points) => new THREE.Path(points.map(([x, y]) => new THREE.Vector2(x, y)));

/** 둥근 직사각형 꼭짓점 */
function roundedRect(a, b, r, n = 6) {
  const out = [];
  for (const [cx, cy, start] of [
    [a - r, -b + r, -Math.PI / 2],
    [a - r, b - r, 0],
    [-a + r, b - r, Math.PI / 2],
    [-a + r, -b + r, Math.PI],
  ]) {
    for (let i = 0; i <= n; i++) {
      const t = start + (Math.PI / 2) * (i / n);
      out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
  }
  return out;
}

/** 바닥에 눕혀 위로 height 만큼 세운 도형 */
function slab(shape, height, bevel = 0) {
  return new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  }).rotateX(-Math.PI / 2);
}

/** 쿠션 사슬을 바깥으로 width 만큼 밀어 만든 다각형 (쿠션 코가 사슬 위에 온다) */
function cushionPolygon(chain, width) {
  const normals = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const dx = chain[i + 1][0] - chain[i][0];
    const dy = chain[i + 1][1] - chain[i][1];
    const l = Math.hypot(dx, dy);
    normals.push([dy / l, -dx / l]); // 오른쪽 = 바깥
  }
  const outer = chain.map((p, i) => {
    const a = normals[Math.max(0, i - 1)];
    const b = normals[Math.min(normals.length - 1, i)];
    const k = width / (1 + a[0] * b[0] + a[1] * b[1]);
    return [p[0] + (a[0] + b[0]) * k, p[1] + (a[1] + b[1]) * k];
  });
  return [...chain, ...outer.reverse()];
}

/** 꺾은선을 바닥에 눕힌 띠로 */
function ribbon(points, width, y) {
  const pos = [];
  const half = width / 2;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 1e-6) continue;
    const nx = (-(bz - az) / l) * half;
    const nz = ((bx - ax) / l) * half;
    pos.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz);
    pos.push(bx + nx, y, bz + nz, ax - nx, y, az - nz, bx - nx, y, bz - nz);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geometry;
}

function loadTexture(loader, url, { srgb = false, repeat = 1 } = {}) {
  const texture = loader.load(url);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class BilliardsScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0d0c);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.02, 60);
    this.camera.position.set(0, 5, 0);
    this.view = { pos: new THREE.Vector3(0, 5, 0), look: new THREE.Vector3(), up: new THREE.Vector3(0, 0, -1), fov: 32 };
    this.cameraMode = 'top';
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };

    this.variant = null;
    this.table = null;
    this.balls = []; // 공 메시 (번호 순)
    this.cueBall = 0;
    this.aim = { angle: 0, power: 0, side: 0, vert: 0, visible: false };
    this.strikeT = -1; // 큐가 앞으로 나가는 중이면 0 이상
    this.cueFade = 0;
    this.sim = null;
    this.pending = null; // 큐가 공에 닿으면 시작할 시뮬레이션
    this.speed = 1;
    this.drops = []; // 포켓에 빠지는 중인 공
    this.dirty = true;

    this.onFrame = null; // (dt) => boolean, 매 프레임 그리기 전에 불린다. 움직이는 HUD 가 있으면 true
    this.onPointer = null; // (type, event) => void
    this.onEvents = null; // (events) => void, 시뮬레이션에서 새로 생긴 사건
    this.onShotEnd = null; // (sim) => void, 공이 모두 멈췄을 때

    this.raycaster = new THREE.Raycaster();
    const canvas = this.renderer.domElement;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      canvas.addEventListener(type, (e) => {
        // 손가락이 캔버스 밖으로 나가도 떼는 순간을 받는다
        if (type === 'pointerdown') canvas.setPointerCapture?.(e.pointerId);
        this.onPointer?.(type, e);
      });
    }
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(container);
  }

  async load() {
    const loader = new THREE.TextureLoader();
    this.textures = {
      feltNormal: loadTexture(loader, shared('textures/velour_velvet_nor_gl_1k.jpg'), { repeat: 3 }),
      feltRough: loadTexture(loader, shared('textures/velour_velvet_rough_1k.jpg'), { repeat: 3 }),
      wood: loadTexture(loader, shared('textures/dark_wood_diff_1k.jpg'), { srgb: true }),
      woodNormal: loadTexture(loader, shared('textures/dark_wood_nor_gl_1k.jpg')),
      woodRough: loadTexture(loader, shared('textures/dark_wood_rough_1k.jpg')),
      leather: loadTexture(loader, shared('textures/brown_leather_albedo_1k.jpg'), { srgb: true, repeat: 0.5 }),
      floor: loadTexture(loader, asset('textures/herringbone_parquet_diff_512.jpg'), { srgb: true, repeat: 5 }),
      floorNormal: loadTexture(loader, asset('textures/herringbone_parquet_nor_gl_512.jpg'), { repeat: 5 }),
      shaft: loadTexture(loader, asset('textures/ash_veneer_diff_512.jpg'), { srgb: true }),
    };
    this.textures.shaft.repeat.set(4, 0.05);
    for (const key of ['wood', 'woodNormal', 'woodRough']) this.textures[key].repeat.set(2, 2);

    const env = await new RGBELoader().loadAsync(asset('hdri/billiard_hall_1k.hdr'));
    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = env;
    this.scene.backgroundBlurriness = 0.25;
    this.scene.backgroundIntensity = 0.3;

    this.buildLights();
    this.buildRoom();
    this.buildCue();
    this.buildGuide();
    this.resize();
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff3e0, 0x2a2420, 0.55));
    // 당구대 위 등: 공 그림자를 바로 아래로 떨어뜨린다
    const lamp = new THREE.DirectionalLight(0xfff1dc, 2.1);
    lamp.position.set(0.25, 4, 0.35);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 1024);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.normalBias = 0.01;
    const s = lamp.shadow.camera;
    s.left = -1.8;
    s.right = 1.8;
    s.top = 1.05;
    s.bottom = -1.05;
    s.near = 1;
    s.far = 6;
    this.scene.add(lamp, lamp.target);
  }

  /** 바닥 */
  buildRoom() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: this.textures.floor, normalMap: this.textures.floorNormal, roughness: 0.55 }),
    );
    floor.position.y = -TABLE_HEIGHT;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /** 큐: 끝(팁)이 원점, 손잡이가 -x 쪽 */
  buildCue() {
    const parts = [
      // [길이, 앞쪽 반지름, 뒤쪽 반지름, 재질]
      [0.012, 0.0061, 0.0062, new THREE.MeshStandardMaterial({ color: 0x2f6db5, roughness: 0.9 })],
      [0.024, 0.0062, 0.0063, new THREE.MeshStandardMaterial({ color: 0xf3efe4, roughness: 0.35 })],
      [0.7, 0.0063, 0.0098, new THREE.MeshStandardMaterial({ map: this.textures.shaft, color: 0xf0dcb8, roughness: 0.4 })],
      [0.018, 0.0098, 0.01, new THREE.MeshStandardMaterial({ color: 0xc9b27a, metalness: 0.8, roughness: 0.3 })],
      [0.5, 0.01, 0.0135, new THREE.MeshStandardMaterial({ map: this.textures.wood, color: 0x8a5a3a, roughness: 0.35 })],
      [0.17, 0.0135, 0.0145, new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.7 })],
      [0.026, 0.0145, 0.0145, new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.5 })],
    ];
    const cue = new THREE.Group();
    let x = 0;
    for (const [length, front, back, material] of parts) {
      const geometry = new THREE.CylinderGeometry(front, back, length, 20).rotateZ(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = x - length / 2;
      mesh.castShadow = true;
      cue.add(mesh);
      x -= length;
    }
    this.cueStick = new THREE.Group(); // 방향
    this.cuePitch = new THREE.Group(); // 기울기
    this.cuePitch.rotation.z = -CUE_TILT;
    this.cuePitch.add(cue);
    this.cueStick.add(this.cuePitch);
    this.cueStick.visible = false;
    this.cueMaterials = parts.map((p) => p[3]);
    this.scene.add(this.cueStick);
  }

  buildGuide() {
    this.guideGroup = new THREE.Group();
    this.scene.add(this.guideGroup);
    this.guideMaterials = {
      cue: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
      deflect: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
      object: new THREE.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
      ghost: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.placeRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.25, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x8fe0b0, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.placeRing.visible = false;
    this.scene.add(this.placeRing);
  }

  // ---------- 당구대 ----------

  /** 종목이 바뀌면 대와 공을 새로 만든다 */
  setVariant(variant) {
    if (this.variant === variant) return;
    this.variant = variant;
    if (this.tableGroup) {
      this.scene.remove(this.tableGroup);
      this.tableGroup.traverse((o) => {
        o.geometry?.dispose();
        if (o.material?.map?.isCanvasTexture) o.material.map.dispose(); // 공 그림
        o.material?.dispose();
      });
    }
    this.table = variant.table;
    this.tableGroup = new THREE.Group();
    this.scene.add(this.tableGroup);
    this.buildTable(variant);
    this.buildBalls(variant);
    this.cameraDirty = true;
    this.dirty = true;
  }

  buildTable(variant) {
    const t = this.table;
    const R = t.ballRadius;
    const X = t.length / 2;
    const Y = t.width / 2;
    const top = R * 1.45; // 레일 윗면 높이
    const add = (geometry, material, { cast = false, receive = true } = {}) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      this.tableGroup.add(mesh);
      return mesh;
    };
    const feltColor = new THREE.Color(FELT_COLORS[variant.id]);
    const felt = new THREE.MeshStandardMaterial({
      color: feltColor,
      normalMap: this.textures.feltNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: this.textures.feltRough,
      roughness: 1,
    });
    const cushion = felt.clone();
    cushion.color = feltColor.clone().multiplyScalar(0.86);
    const wood = new THREE.MeshPhysicalMaterial({
      map: this.textures.wood,
      normalMap: this.textures.woodNormal,
      roughnessMap: this.textures.woodRough,
      roughness: 0.6,
      clearcoat: 0.7,
      clearcoatRoughness: 0.15,
    });
    const leather = new THREE.MeshStandardMaterial({ map: this.textures.leather, color: 0x5a4030, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, side: THREE.DoubleSide });
    // 구멍 안쪽 벽만 그린다 (바깥 면이 천 밑으로 비쳐 보이지 않게)
    const pocketWall = new THREE.MeshStandardMaterial({ color: 0x080706, roughness: 0.9, side: THREE.BackSide });

    const ca = X + CUSHION_WIDTH;
    const cb = Y + CUSHION_WIDTH;
    const ra = ca + RAIL_WIDTH;
    const rb = cb + RAIL_WIDTH;
    const outer = roundedRect(ra, rb, 0.05);
    const pocketCircles = t.pockets.map((p) => ({ x: p.cx, y: p.cy, r: p.r }));

    // 천: 쿠션 밑까지 깔고 포켓 자리는 뚫는다
    const bedPoints = pocketCircles.length ? bitten(ca, cb, pocketCircles, false) : roundedRect(ca, cb, 0.001, 1);
    const bed = add(slab(toShape(bedPoints), 0.02), felt);
    bed.position.y = -0.02;

    // 쿠션 고무 (천을 씌운 색)
    for (const chain of t.chains) {
      if (t.closed) {
        const shape = toShape(roundedRect(ca, cb, 0.001, 1));
        shape.holes.push(toPath(roundedRect(X, Y, 0.001, 1)));
        add(slab(shape, top, 0), cushion, { cast: false });
        break;
      }
      add(slab(toShape(cushionPolygon(chain, CUSHION_WIDTH)), top, 0), cushion);
    }

    // 나무 레일: 바깥은 둥근 사각형, 안쪽은 쿠션 뒤 선을 포켓 구멍만큼 넓힌 것
    const rail = toShape(outer);
    rail.holes.push(toPath(pocketCircles.length ? bitten(ca, cb, pocketCircles, true) : roundedRect(ca, cb, 0.001, 1)));
    // 레일은 포켓 구멍 깊이보다 조금 더 내려와 구멍 밑으로 몸통 윗면이 보이지 않게 한다
    const railMesh = add(slab(rail, top + 0.16, 0.006), wood, { cast: true });
    railMesh.position.y = -0.16;

    // 다이아몬드
    const pearl = new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.25, metalness: 0.15 });
    const diamondGeometry = new THREE.CircleGeometry(0.0075, 16).rotateX(-Math.PI / 2);
    for (const d of diamonds(t)) {
      const mesh = add(diamondGeometry, pearl, { receive: false });
      const off = CUSHION_WIDTH + RAIL_WIDTH * 0.5;
      const x = d.side === 'long' ? d.x : d.x + Math.sign(d.x) * off;
      const y = d.side === 'long' ? d.y + Math.sign(d.y) * off : d.y;
      mesh.position.set(x, top + 0.0075, -y);
    }

    // 포켓: 가죽 테와 어두운 구멍
    for (const p of t.pockets) {
      const hole = add(new THREE.CylinderGeometry(p.r, p.r * 0.92, 0.16, 28, 1, true), pocketWall, { receive: false });
      hole.position.set(p.cx, top - 0.08 + 0.004, -p.cy);
      const bottom = add(new THREE.CircleGeometry(p.r, 24).rotateX(-Math.PI / 2), dark, { receive: false });
      bottom.position.set(p.cx, top - 0.15, -p.cy);
      const rim = add(new THREE.RingGeometry(p.r, p.r + 0.016, 32).rotateX(-Math.PI / 2), leather);
      rim.position.set(p.cx, top + 0.0045, -p.cy);
    }

    // 몸통과 다리
    const apron = add(slab(toShape(roundedRect(ra - 0.03, rb - 0.03, 0.04)), 0.2), wood, { cast: true });
    apron.position.y = -0.36;
    const legGeometry = new THREE.BoxGeometry(0.12, TABLE_HEIGHT - 0.36, 0.12);
    for (const sx of [-1, 0, 1]) {
      if (sx === 0 && t.length < 2.6) continue;
      for (const sy of [-1, 1]) {
        const leg = add(legGeometry, wood, { cast: true });
        leg.position.set(sx * (ra - 0.18), -0.36 - (TABLE_HEIGHT - 0.36) / 2, sy * (rb - 0.16));
      }
    }

    this.railTop = top;
    this.extent = { x: ra, y: rb };
  }

  buildBalls(variant) {
    const R = this.table.ballRadius;
    const geometry = new THREE.SphereGeometry(R, 40, 24);
    this.balls = [];
    for (let id = 0; id < variant.balls; id++) {
      const texture = new THREE.CanvasTexture(ballCanvas(variant.kind, id));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const material = new THREE.MeshPhysicalMaterial({ map: texture, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      // 숫자가 위를 보도록 처음 자세를 잡는다
      mesh.rotation.set(Math.PI / 2, 0, Math.random() * 0.6 - 0.3);
      this.tableGroup.add(mesh);
      this.balls.push(mesh);
    }
  }

  /** 게임의 공 배치를 그대로 놓는다 */
  setBalls(balls) {
    const R = this.table.ballRadius;
    this.drops = [];
    balls.forEach((b, i) => {
      const mesh = this.balls[i];
      if (!mesh) return;
      mesh.visible = b.on;
      mesh.position.set(b.x, R, -b.y);
    });
    this.dirty = true;
  }

  // ---------- 조준 ----------

  /** 큐를 수구 뒤에 놓는다. power(0~1) 만큼 뒤로 당기고, side·vert 는 큐 끝이 닿는 자리 */
  setAim({ cue = this.cueBall, angle, power = 0, side = 0, vert = 0, visible = true }) {
    this.cueBall = cue;
    this.aim = { angle, power, side, vert, visible };
    if (visible) {
      this.strikeT = -1;
      this.cueFade = 1;
    }
    this.cameraDirty = true;
  }

  /** 보조선 { lines: [{ kind, points }], ghost } 또는 null */
  setGuide(guide) {
    for (const child of [...this.guideGroup.children]) {
      child.geometry.dispose();
      this.guideGroup.remove(child);
    }
    if (!guide) return;
    const R = this.table.ballRadius;
    const widths = { cue: R * 0.18, deflect: R * 0.14, object: R * 0.18 };
    for (const line of guide.lines) {
      if (line.points.length < 2) continue;
      const points = line.points.map(([x, y]) => [x, -y]);
      const mesh = new THREE.Mesh(ribbon(points, widths[line.kind] ?? R * 0.15, 0.0015), this.guideMaterials[line.kind]);
      mesh.renderOrder = 2;
      this.guideGroup.add(mesh);
    }
    if (guide.ghost) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R, 40).rotateX(-Math.PI / 2), this.guideMaterials.ghost);
      ring.position.set(guide.ghost.x, 0.002, -guide.ghost.y);
      ring.renderOrder = 2;
      this.guideGroup.add(ring);
    }
  }

  /** 볼 인 핸드: 수구 밑에 고리를 띄운다. valid 가 거짓이면 붉게 */
  setPlacement(place) {
    this.placeRing.visible = !!place;
    if (!place) return;
    const R = this.table.ballRadius;
    this.placeRing.scale.setScalar(R * 1.25);
    this.placeRing.position.set(place.x, 0.003, -place.y);
    this.placeRing.material.color.set(place.valid ? 0x8fe0b0 : 0xff6b5a);
  }

  // ---------- 치기 ----------

  /**
   * 큐가 앞으로 나가 공을 친 뒤 sim 을 실시간으로 돌린다. 공이 모두 멈추면 onShotEnd(sim) 을 부른다.
   */
  shoot(sim) {
    this.pending = sim;
    this.strikeT = 0;
    this.speed = 1;
    this.setGuide(null);
    this.setPlacement(null);
  }

  /** 구르는 중인 샷을 바로 끝까지 돌리고 onShotEnd 를 부른다 (메뉴를 열 때) */
  finishNow() {
    if (this.pending) {
      this.sim = this.pending;
      this.pending = null;
    }
    if (!this.sim) return;
    const sim = this.sim;
    sim.run();
    this.sim = null;
    this.drops = [];
    this.strikeT = -1;
    this.aim.visible = false;
    this.setBalls(sim.snapshot());
    this.onShotEnd?.(sim);
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  get rolling() {
    return !!this.sim || !!this.pending;
  }

  // ---------- 화면 좌표 ----------

  /** 포인터가 가리키는 당구대 위 점 (공 중심 높이). 대 밖 허공이면 null */
  toTable(clientX, clientY) {
    if (!this.table) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.table.ballRadius);
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    return { x: hit.x, y: -hit.z };
  }

  /** 당구대 위 점의 화면 좌표(px) */
  toScreen(x, y) {
    const v = new THREE.Vector3(x, this.table?.ballRadius ?? 0, -y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** 화면에서 공 하나가 차지하는 반지름(px) */
  ballPixels() {
    const a = this.toScreen(0, 0);
    const b = this.toScreen(this.table.ballRadius, 0);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  // ---------- 카메라 ----------

  setCamera(mode) {
    this.cameraMode = mode;
    this.cameraDirty = true;
  }

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
    this.camera.aspect = w / h;
    this.cameraDirty = true;
    this.dirty = true;
  }

  /** 지금 모드에서 카메라가 있어야 할 자리 { pos, look, up, fov } */
  cameraGoal() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const availW = Math.max(80, w - left - right);
    const availH = Math.max(80, h - top - bottom);
    const portrait = availH > availW * 1.05;
    const cueMesh = this.balls[this.cueBall];
    const ball = cueMesh ? cueMesh.position : new THREE.Vector3();
    const dir = new THREE.Vector3(Math.cos(this.aim.angle), 0, -Math.sin(this.aim.angle));

    if (this.cameraMode === 'cue' && !this.rolling) {
      // 큐 뒤에서 수구 너머를 본다
      const back = portrait ? 0.85 : 0.68;
      const pos = ball.clone().addScaledVector(dir, -back).add(new THREE.Vector3(0, portrait ? 0.58 : 0.3, 0));
      const look = ball.clone().addScaledVector(dir, portrait ? 0.55 : 0.6);
      look.y = 0;
      return { pos, look, up: new THREE.Vector3(0, 1, 0), fov: portrait ? 60 : 46 };
    }
    if (this.cameraMode === 'cue') {
      // 공이 구르는 동안: 친 방향 뒤쪽 높은 곳에서 수구를 따라간다
      const look = ball.clone().lerp(new THREE.Vector3(), 0.45);
      look.y = 0;
      const pos = look.clone().addScaledVector(dir, portrait ? -1.0 : -1.2).add(new THREE.Vector3(0, portrait ? 2.0 : 1.5, 0));
      return { pos, look, up: new THREE.Vector3(0, 1, 0), fov: portrait ? 62 : 48 };
    }
    // 위에서 내려다본다. 세로 화면이면 긴 쪽이 세로가 되게 돌리고, 브레이크 쪽(-x)이 아래로 온다
    const fov = 30;
    const ex = this.extent ?? { x: 1.5, y: 0.8 };
    const along = portrait ? ex.y * 2 : ex.x * 2; // 화면 가로로 놓이는 길이
    const across = portrait ? ex.x * 2 : ex.y * 2;
    const tan = Math.tan(((fov / 2) * Math.PI) / 180);
    const worldH = Math.max((across * h) / availH, (along * h) / availW) * 1.02;
    const height = worldH / (2 * tan) + 0.05;
    return {
      pos: new THREE.Vector3(0, height, 0.0001),
      look: new THREE.Vector3(0, 0, 0),
      up: portrait ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1),
      fov,
    };
  }

  /** 카메라를 목표로 k 만큼 옮긴다. 움직였으면 true */
  placeCamera(k) {
    const goal = this.cameraGoal();
    const v = this.view;
    const before = v.pos.clone();
    v.pos.lerp(goal.pos, k);
    v.look.lerp(goal.look, k);
    v.up.lerp(goal.up, k).normalize();
    v.fov += (goal.fov - v.fov) * k;
    const cam = this.camera;
    cam.position.copy(v.pos);
    cam.up.copy(v.up);
    cam.lookAt(v.look);
    cam.fov = v.fov;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const cx = (left + (w - right)) / 2;
    const cy = (top + (h - bottom)) / 2;
    cam.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    cam.updateProjectionMatrix();
    const moved = before.distanceToSquared(v.pos) > 1e-9 || Math.abs(goal.fov - v.fov) > 0.01 || v.up.distanceToSquared(goal.up) > 1e-8;
    return moved;
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let lively = !!this.onFrame?.(dt);
    let casters = false;
    if (!this.table) {
      if (this.loop.due(now, false)) this.renderer.render(this.scene, this.camera);
      return;
    }

    // 큐가 앞으로 나가 공을 친다
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      lively = casters = true;
      if (this.strikeT >= STRIKE_TIME && this.pending) {
        this.sim = this.pending;
        this.pending = null;
        this.cameraDirty = true;
      }
    }
    if (this.sim) {
      const events = this.sim.advance(dt * this.speed);
      this.syncBalls(dt * this.speed);
      if (events.length) this.handleEvents(events);
      lively = casters = true;
      if (this.sim.done && !this.drops.length) {
        const sim = this.sim;
        this.sim = null;
        this.cameraDirty = true;
        this.onShotEnd?.(sim);
      }
    }
    if (this.drops.length) {
      this.animateDrops(dt);
      lively = casters = true;
    }
    if (this.updateCue()) lively = casters = true;
    if (this.placeCamera(this.cameraSnap ? 1 : damp(this.cameraMode === 'cue' ? 5 : 7, dt))) lively = true;
    this.cameraSnap = false;
    if (this.dirty) {
      lively = casters = true;
      this.dirty = false;
    }
    if (this.loop.due(now, lively, casters)) this.renderer.render(this.scene, this.camera);
  }

  /** 시뮬레이션의 공 자리를 메시에 옮기고 각속도만큼 굴린다 */
  syncBalls(simDt) {
    const R = this.table.ballRadius;
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    for (const b of this.sim.balls) {
      const mesh = this.balls[b.id];
      if (!mesh || !b.on) continue;
      mesh.position.set(b.x, R, -b.y);
      // 평면 (x, y, z위) → 화면 (x, z, -y) 로 각속도도 같이 옮긴다
      axis.set(b.wx, b.wz, -b.wy);
      const w = axis.length();
      if (w > 1e-6) {
        q.setFromAxisAngle(axis.divideScalar(w), w * simDt);
        mesh.quaternion.premultiply(q);
      }
    }
  }

  handleEvents(events) {
    for (const e of events) {
      if (e.type !== 'pocket') continue;
      const mesh = this.balls[e.ball];
      const p = this.table.pockets[e.pocket];
      this.drops.push({ mesh, from: mesh.position.clone(), to: new THREE.Vector3(p.cx, -0.05, -p.cy), t: 0 });
    }
    this.onEvents?.(events);
  }

  animateDrops(dt) {
    this.drops = this.drops.filter((d) => {
      d.t += dt;
      const k = Math.min(1, d.t / DROP_TIME);
      d.mesh.position.lerpVectors(d.from, d.to, k);
      d.mesh.position.y = d.from.y + (d.to.y - d.from.y) * k * k;
      if (k >= 1) {
        d.mesh.visible = false;
        return false;
      }
      return true;
    });
  }

  /** 큐 자리. 움직였으면 true */
  updateCue() {
    const stick = this.cueStick;
    const show = this.aim.visible || this.strikeT >= 0;
    if (!show && !stick.visible) return false;
    if (!this.aim.visible && this.strikeT < 0) {
      stick.visible = false;
      return true;
    }
    const mesh = this.balls[this.cueBall];
    if (!mesh) return false;
    const R = this.table.ballRadius;
    const { angle, power, side, vert } = this.aim;
    let gap = 0.012 + power * 0.22;
    if (this.strikeT >= 0) {
      // 앞으로 밀고 나갔다가 공이 떠나면 서서히 사라진다
      const k = Math.min(1, this.strikeT / STRIKE_TIME);
      gap = gap * (1 - k) - 0.03 * k * k;
      if (this.strikeT > STRIKE_TIME + 0.35) {
        this.strikeT = -1;
        this.aim.visible = false;
        stick.visible = false;
        return true;
      }
    }
    const dir = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const right = new THREE.Vector3(-dir.z, 0, dir.x); // 평면에서 치는 방향의 오른쪽 (dy, -dx) 를 화면 (x, -z) 로
    const offset = 0.5 * R; // MAX_TIP
    const tip = mesh.position
      .clone()
      .addScaledVector(dir, -(R * Math.cos(Math.asin(Math.min(0.9, Math.hypot(side, vert) * 0.5))) + gap))
      .addScaledVector(right, side * offset)
      .add(new THREE.Vector3(0, vert * offset, 0));
    // 자리가 그대로면 다시 그릴 필요가 없다 (startLoop 가 초당 30번으로 줄인다)
    const moved = !stick.visible || stick.position.distanceToSquared(tip) > 1e-10 || stick.rotation.y !== angle;
    stick.position.copy(tip);
    stick.rotation.set(0, angle, 0);
    stick.visible = true;
    return moved;
  }
}
