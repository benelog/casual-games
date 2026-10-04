// Three.js 바둑판 씬. 물리(physics.js)의 판 위 돌 자리를 받아 그리고, 떨어지는 돌과 조준 표시를 보여 준다.
// 길이 단위는 미터이고 좌표계는 physics.js 와 같다 (천원이 원점, 흑 쪽이 +z, 판 윗면이 y=0).
//
// 바둑판은 다리가 달린 두꺼운 판으로, 나뭇결 텍스처 위에 19줄과 화점을 캔버스로 그려 입힌다.
// 판 밖으로 나간 돌은 물리에서는 바로 빠지지만, 화면에서는 기울며 바닥(마루)으로 떨어져 튀고 흐려진다.
// 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import {
  STONE_RADIUS,
  STONE_HEIGHT,
  HALF_X,
  HALF_Z,
  LINES,
  GRID_X,
  GRID_Z,
  direction,
  firstContact,
  distanceToEdge,
  slideDistance,
  speedOfPower,
} from './physics.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';

/** 플레이어 색 (흑 1P, 백 2P). style.css 의 --p0, --p1 과 같다 */
export const PLAYER_COLORS = ['#4db8ff', '#ffd23f'];

const ASSETS = new URL('../assets/', import.meta.url);
const SHARED_ASSETS = new URL('../../shared/assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;
const sharedAsset = (path) => new URL(path, SHARED_ASSETS).href;

const BOARD_T = 0.075; // 판 두께
const LEG_H = 0.05; // 다리 높이
const FLOOR_Y = -(BOARD_T + LEG_H);
const STONE_Y = STONE_HEIGHT / 2; // 판 위에 놓인 돌의 중심 높이
const TILT = 0.4; // 카메라가 수직에서 흑 쪽으로 기운 각도 (라디안)
const FOV = 30;
const GRAVITY = 9.8;
const GUIDE_DOTS = 40;
const GUIDE_SPACING = 0.009;
const FALL_FADE_AT = 1.5; // 떨어진 돌이 이만큼(초) 뒤부터 흐려진다
const FALL_FADE = 0.6;
const HALF = Math.PI / 2;

const flatRing = (inner, outer, segments = 40) => new THREE.RingGeometry(inner, outer, segments).rotateX(-HALF);
const flatCircle = (radius, segments = 12) => new THREE.CircleGeometry(radius, segments).rotateX(-HALF);

function loadTexture(loader, url, { srgb = false, repeat = 1 } = {}) {
  return loader.loadAsync(url).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** 세기(0~1)에 따른 화살표 색: 초록 → 노랑 → 빨강 */
function powerColor(power, target = new THREE.Color()) {
  const a = new THREE.Color(0x3fe08a);
  const b = new THREE.Color(0xffc531);
  const c = new THREE.Color(0xff4436);
  return power < 0.55 ? target.copy(a).lerp(b, power / 0.55) : target.copy(b).lerp(c, (power - 0.55) / 0.45);
}

export class AlkkagiScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0c0a);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.02, 20);
    this.fitCam = new THREE.PerspectiveCamera(FOV, 1, 0.02, 20); // 카메라 자리를 계산할 때만 쓴다
    this.view = { pos: new THREE.Vector3(0, 1.2, 0.5), look: new THREE.Vector3() };
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };
    this.cameraDirty = true;
    this.cameraSnap = true;

    this.board = null;
    this.running = false;
    this.meshes = new Map(); // 돌 id → 메시
    this.falls = []; // 떨어지는 돌의 움직임
    this.selectedId = null;
    this.selectable = null; // 고를 수 있는 돌의 편 (없으면 null)
    this.pulse = 0;
    this.onFrame = null; // (dt) => boolean, 매 프레임 main.js 가 세기 막대 등을 처리한다. 움직이는 것이 있으면 true
    this.onEvent = null; // (event) => void, 물리에서 일어난 일과 떨어진 돌이 바닥에 닿은 일
    this.onPointer = null; // (type, event) => void

    const canvas = this.renderer.domElement;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      canvas.addEventListener(type, (e) => this.onPointer?.(type, e));
    }
    this.raycaster = new THREE.Raycaster();
    this.stonePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -STONE_Y);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load() {
    const textures = new THREE.TextureLoader();
    const [env, woodImage, woodNormal, floorMap, floorNormal, floorRough] = await Promise.all([
      new RGBELoader().loadAsync(sharedAsset('hdri/warm_bar_1k.hdr')),
      new THREE.ImageLoader().loadAsync(asset('textures/okoume_veneer_diff.jpg')),
      loadTexture(textures, asset('textures/okoume_veneer_nor_gl.jpg')),
      loadTexture(textures, sharedAsset('textures/dark_wood_diff_1k.jpg'), { srgb: true, repeat: 3 }),
      loadTexture(textures, sharedAsset('textures/dark_wood_nor_gl_1k.jpg'), { repeat: 3 }),
      loadTexture(textures, sharedAsset('textures/dark_wood_rough_1k.jpg'), { repeat: 3 }),
    ]);
    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;

    this.buildBoard(woodImage, woodNormal);
    this.buildFloor({ map: floorMap, normalMap: floorNormal, roughnessMap: floorRough });
    this.buildStoneParts();
    this.buildMarkers();
    this.buildLights();

    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  // ---------- 바둑판 ----------

  /** 나뭇결 위에 19줄과 화점을 그린 윗면 텍스처 */
  boardFace(woodImage) {
    const width = 1024;
    const height = Math.round((width * HALF_Z) / HALF_X);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // 비자나무 판처럼 밝은 노란빛을 더한다
    ctx.drawImage(woodImage, 0, 0, width, height);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#ffe7bb';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    const px = (x) => ((x + HALF_X) / (2 * HALF_X)) * width;
    const pz = (z) => ((z + HALF_Z) / (2 * HALF_Z)) * height;
    const half = (LINES - 1) / 2;
    ctx.strokeStyle = 'rgba(28, 18, 8, 0.86)';
    ctx.lineCap = 'square';
    for (let i = -half; i <= half; i++) {
      ctx.lineWidth = Math.abs(i) === half ? 3.4 : 2.2; // 바깥 줄은 조금 굵게
      ctx.beginPath();
      ctx.moveTo(px(i * GRID_X), pz(-half * GRID_Z));
      ctx.lineTo(px(i * GRID_X), pz(half * GRID_Z));
      ctx.moveTo(px(-half * GRID_X), pz(i * GRID_Z));
      ctx.lineTo(px(half * GRID_X), pz(i * GRID_Z));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(28, 18, 8, 0.92)';
    for (const col of [-6, 0, 6]) {
      for (const row of [-6, 0, 6]) {
        ctx.beginPath();
        ctx.arc(px(col * GRID_X), pz(row * GRID_Z), 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  buildBoard(woodImage, woodNormal) {
    const sideMap = new THREE.Texture(woodImage);
    sideMap.colorSpace = THREE.SRGBColorSpace;
    sideMap.wrapS = sideMap.wrapT = THREE.RepeatWrapping;
    sideMap.needsUpdate = true;
    const side = new THREE.MeshStandardMaterial({
      map: sideMap,
      normalMap: woodNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      color: 0xf0cf92,
      roughness: 0.5,
    });
    const top = new THREE.MeshStandardMaterial({
      map: this.boardFace(woodImage),
      normalMap: woodNormal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.38,
    });
    // BoxGeometry 의 면 순서: +x, -x, +y(윗면), -y, +z, -z
    const board = new THREE.Mesh(new THREE.BoxGeometry(HALF_X * 2, BOARD_T, HALF_Z * 2).translate(0, -BOARD_T / 2, 0), [
      side,
      side,
      top,
      side,
      side,
      side,
    ]);
    board.receiveShadow = true;
    board.castShadow = true;
    this.scene.add(board);
    // 네 모서리 아래의 짧은 다리
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.55, map: sideMap });
    const leg = new THREE.CylinderGeometry(0.03, 0.036, LEG_H, 24);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const mesh = new THREE.Mesh(leg, legMaterial);
        mesh.position.set(sx * (HALF_X - 0.06), -BOARD_T - LEG_H / 2, sz * (HALF_Z - 0.06));
        mesh.castShadow = true;
        this.scene.add(mesh);
      }
    }
  }

  buildFloor(maps) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4).rotateX(-HALF),
      new THREE.MeshStandardMaterial({ ...maps, color: 0xb59a84, roughness: 0.8 }),
    );
    for (const map of Object.values(maps)) map.repeat.set(4, 4);
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /** 바둑돌: 위아래가 볼록한 납작한 타원체. 흑은 무광에 가까운 점판암, 백은 윤이 나는 조개 */
  buildStoneParts() {
    this.stoneGeometry = new THREE.SphereGeometry(STONE_RADIUS, 40, 20).scale(1, STONE_HEIGHT / (2 * STONE_RADIUS), 1);
    this.stoneMaterials = [
      new THREE.MeshPhysicalMaterial({ color: 0x17181b, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
      new THREE.MeshPhysicalMaterial({ color: 0xf3efe4, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
    ];
  }

  meshFor(stone) {
    let mesh = this.meshes.get(stone.id);
    if (mesh) return mesh;
    mesh = new THREE.Mesh(this.stoneGeometry, this.stoneMaterials[stone.team]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.team = stone.team;
    this.scene.add(mesh);
    this.meshes.set(stone.id, mesh);
    return mesh;
  }

  buildMarkers() {
    const overlay = (color, opacity) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    // 고른 돌 밑의 테
    this.selectRing = new THREE.Mesh(flatRing(STONE_RADIUS * 1.15, STONE_RADIUS * 1.55), overlay(0xffffff, 0.95));
    this.selectRing.position.y = 0.0004;
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);
    // 고를 수 있는 돌 밑의 옅은 테
    this.hintMaterial = overlay(0xffffff, 0.45);
    this.hintGeometry = flatRing(STONE_RADIUS * 1.1, STONE_RADIUS * 1.3);
    this.hintRings = [];

    // 튕길 방향 화살표 (지역 좌표에서 -z 쪽을 가리킨다). 나뭇결 위에서도 잘 보이도록 어두운 테두리를 깐다
    this.arrowMaterial = overlay(0x3fe08a, 1);
    const outlineMaterial = overlay(0x000000, 0.45);
    const shaftGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-HALF).translate(0, 0, -0.5);
    const headShape = new THREE.Shape();
    headShape.moveTo(-1, 0);
    headShape.lineTo(1, 0);
    headShape.lineTo(0, 1.6);
    headShape.closePath();
    const headGeometry = new THREE.ShapeGeometry(headShape).rotateX(-HALF); // 뾰족한 끝이 -z
    const part = (geometry, material, order) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = order;
      return mesh;
    };
    this.arrow = new THREE.Group();
    this.arrow.userData = {
      shaft: part(shaftGeometry, this.arrowMaterial, 2),
      head: part(headGeometry, this.arrowMaterial, 2),
      shaftLine: part(shaftGeometry, outlineMaterial, 1),
      headLine: part(headGeometry, outlineMaterial, 1),
    };
    this.arrow.add(...Object.values(this.arrow.userData));
    this.arrow.position.y = 0.0006;
    this.arrow.visible = false;
    this.scene.add(this.arrow);

    // 당긴 고무줄: 돌에서 당긴 쪽(+z)으로 뻗는 옅은 띠
    this.band = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-HALF).translate(0, 0, 0.5), overlay(0xffffff, 0.28));
    this.band.position.y = 0.0005;
    this.band.visible = false;
    this.scene.add(this.band);

    // 조준선: 처음 닿는 곳(또는 멈출 곳)까지 찍는 점과, 닿는 순간의 돌 자리
    this.guide = new THREE.InstancedMesh(flatCircle(0.0016), overlay(0xffffff, 0.75), GUIDE_DOTS);
    this.guide.frustumCulled = false;
    this.guide.visible = false;
    this.guide.position.y = 0.0005;
    this.scene.add(this.guide);
    this.ghost = new THREE.Mesh(flatRing(STONE_RADIUS * 0.86, STONE_RADIUS, 36), overlay(0xffffff, 0.7));
    this.ghost.position.y = 0.0007;
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 0.45));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    this.sun.position.set(0.35, 1.3, 0.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -0.45;
    s.right = s.top = 0.45;
    s.near = 0.4;
    s.far = 3;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.0015;
    this.scene.add(this.sun, this.sun.target);
  }

  // ---------- 진행 ----------

  /** 판의 돌을 화면에 맞춘다. 판이 바뀌면(새 판) 예전 돌과 떨어지던 돌을 치운다 */
  setBoard(board) {
    this.board = board;
    this.running = false;
    const ids = new Set(board.stones.map((s) => s.id));
    for (const [id, mesh] of this.meshes) {
      if (ids.has(id)) continue;
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
    for (const fall of this.falls) this.endFall(fall);
    this.falls = [];
    for (const stone of board.stones) {
      const mesh = this.meshFor(stone);
      mesh.visible = stone.inPlay;
      mesh.material = this.stoneMaterials[stone.team];
      mesh.quaternion.identity();
    }
    this.syncStones();
    this.select(null);
    this.setSelectable(null);
    this.setAim(null);
  }

  syncStones() {
    if (!this.board) return;
    for (const stone of this.board.stones) {
      if (!stone.inPlay) continue;
      const mesh = this.meshFor(stone);
      mesh.position.set(stone.x, STONE_Y, stone.z);
      mesh.rotation.set(0, stone.turn, 0);
    }
    if (this.selectedId !== null) {
      const s = this.board.byId(this.selectedId);
      if (s?.inPlay) this.selectRing.position.set(s.x, 0.0004, s.z);
    }
    this.placeHints();
  }

  /** 지금 판에서 튕긴 돌을 굴린다. 모두 멈추면 끝난다 */
  run(board) {
    this.board = board;
    this.running = true;
    this.setAim(null);
    this.setSelectable(null);
    return new Promise((resolve) => {
      this.runDone = resolve;
    });
  }

  /** 고른 돌 (없으면 null) */
  select(id, team = 0) {
    this.selectedId = id;
    const s = id !== null ? this.board?.byId(id) : null;
    this.selectRing.visible = !!s?.inPlay;
    if (!s) return;
    this.selectRing.material.color.set(PLAYER_COLORS[team]);
    this.selectRing.position.set(s.x, 0.0004, s.z);
  }

  /** team 의 돌 밑에 고를 수 있다는 테를 깐다 (null 이면 치운다) */
  setSelectable(team) {
    this.selectable = team;
    if (team !== null) this.hintMaterial.color.set(PLAYER_COLORS[team]);
    this.placeHints();
  }

  placeHints() {
    const stones = this.selectable === null || !this.board ? [] : this.board.stonesOf(this.selectable);
    while (this.hintRings.length < stones.length) {
      const ring = new THREE.Mesh(this.hintGeometry, this.hintMaterial);
      this.scene.add(ring);
      this.hintRings.push(ring);
    }
    this.hintRings.forEach((ring, i) => {
      const s = stones[i];
      ring.visible = !!s && s.id !== this.selectedId;
      if (s) ring.position.set(s.x, 0.0003, s.z);
    });
  }

  /**
   * 조준 표시. aim: { id, angle, power, pull, team } 또는 null.
   * pull 은 당긴 길이(m, 고무줄 표시용, 없으면 감춤)
   */
  setAim(aim) {
    const s = aim ? this.board?.byId(aim.id) : null;
    const show = !!s?.inPlay && aim.power > 0;
    this.arrow.visible = this.guide.visible = show;
    this.band.visible = show && aim.pull > 0;
    this.ghost.visible = false;
    if (!show) return;
    const d = direction(aim.angle);
    const rot = -aim.angle;
    // 화살표: 돌 가장자리에서 세기만큼
    const start = STONE_RADIUS * 1.35;
    const length = 0.012 + aim.power * 0.075;
    const { shaft, head, shaftLine, headLine } = this.arrow.userData;
    const width = STONE_RADIUS * 0.6;
    const border = 0.0012;
    shaft.scale.set(width, 1, length);
    shaft.position.z = -start;
    head.scale.setScalar(STONE_RADIUS * 0.8);
    head.position.z = -(start + length);
    shaftLine.scale.set(width + border * 2, 1, length + border);
    shaftLine.position.z = -start + border / 2;
    headLine.scale.setScalar(STONE_RADIUS * 0.8 + border * 1.6);
    headLine.position.z = -(start + length) + border;
    this.arrow.position.set(s.x, 0.0006, s.z);
    this.arrow.rotation.y = rot;
    powerColor(aim.power, this.arrowMaterial.color);
    // 고무줄
    if (aim.pull > 0) {
      this.band.scale.set(STONE_RADIUS * 0.35, 1, aim.pull);
      this.band.position.set(s.x, 0.0005, s.z);
      this.band.rotation.y = rot;
    }
    // 조준선: 처음 닿는 돌, 빈 판에서 멈출 곳, 판 가장자리 중 가까운 곳까지
    const contact = firstContact(s, aim.angle, this.board.inPlay);
    const slide = slideDistance(speedOfPower(aim.power));
    const edge = distanceToEdge(s.x, s.z, aim.angle) + STONE_RADIUS;
    const reach = Math.min(contact ? contact.distance : Infinity, slide, edge);
    const m = new THREE.Matrix4();
    let count = 0;
    for (let k = start + length + 0.012; k < reach && count < GUIDE_DOTS; k += GUIDE_SPACING) {
      m.makeTranslation(s.x + d.x * k, 0, s.z + d.z * k);
      this.guide.setMatrixAt(count++, m);
    }
    this.guide.count = count;
    this.guide.instanceMatrix.needsUpdate = true;
    if (contact && contact.distance <= Math.min(slide, edge)) {
      this.ghost.visible = true;
      this.ghost.position.set(contact.x, 0.0007, contact.z);
    }
  }

  // ---------- 떨어지는 돌 ----------

  /** 판 밖으로 나간 돌이 기울며 바닥으로 떨어지기 시작한다 */
  startFall(event) {
    const mesh = this.meshes.get(event.stone.id);
    if (!mesh) return;
    // 판 밖으로 나가는 돌만 빠지므로 속도가 곧 나간 쪽이다. 느리게 걸쳐 나간 돌도 판 밖으로는 넘어가게 한다
    const speed = Math.hypot(event.vx, event.vz);
    let out = speed > 1e-4 ? { x: event.vx / speed, z: event.vz / speed } : null;
    if (!out) {
      // 밀려서 멈춘 채 걸쳐 나간 돌: 넘어간 가장자리 쪽
      const ox = Math.abs(event.x) > HALF_X ? Math.sign(event.x) : 0;
      const oz = ox ? 0 : Math.sign(event.z) || 1;
      out = { x: ox, z: oz };
    }
    const material = mesh.material.clone(); // 따로 흐려지도록
    material.transparent = true;
    mesh.material = material;
    this.falls.push({
      mesh,
      material,
      x: event.x,
      y: STONE_Y,
      z: event.z,
      vx: out.x * Math.max(speed, 0.12),
      vy: 0,
      vz: out.z * Math.max(speed, 0.12),
      axis: new THREE.Vector3(out.z, 0, -out.x).normalize(),
      tilt: 0,
      tiltSpeed: 7 + speed * 6,
      spin: event.stone.turn,
      landed: false,
      t: 0,
    });
  }

  /** 떨어지는 돌을 움직인다. 움직이는 돌이 있으면 true */
  updateFalls(dt) {
    if (!this.falls.length) return false;
    const q = new THREE.Quaternion();
    const turn = new THREE.Quaternion();
    for (const f of this.falls) {
      f.t += dt;
      f.vy -= GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      const floor = FLOOR_Y + STONE_Y;
      if (f.y <= floor) {
        f.y = floor;
        if (!f.landed) {
          f.landed = true;
          this.onEvent?.({ type: 'land', stone: f.mesh, x: f.x, speed: -f.vy });
        }
        f.vy = Math.abs(f.vy) > 0.25 ? -f.vy * 0.25 : 0;
        f.vx *= 0.6;
        f.vz *= 0.6;
      }
      if (f.landed) {
        // 바닥에서 미끄러지다 눕는다
        const keep = Math.max(0, 1 - 5 * dt);
        f.vx *= keep;
        f.vz *= keep;
        const flat = Math.round(f.tilt / Math.PI) * Math.PI;
        f.tilt += (flat - f.tilt) * damp(10, dt);
      } else {
        f.tilt += f.tiltSpeed * dt;
      }
      q.setFromAxisAngle(f.axis, f.tilt);
      turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, f.spin);
      f.mesh.quaternion.copy(q).multiply(turn);
      f.mesh.position.set(f.x, f.y, f.z);
      if (f.t > FALL_FADE_AT) {
        f.material.opacity = Math.max(0, 1 - (f.t - FALL_FADE_AT) / FALL_FADE);
        if (f.material.opacity <= 0) this.endFall(f);
      }
    }
    this.falls = this.falls.filter((f) => !f.done);
    return true;
  }

  endFall(fall) {
    fall.done = true;
    fall.mesh.visible = false;
    fall.material.dispose();
  }

  // ---------- 화면 좌표 ----------

  /** 포인터 위치 → 정규화 장치 좌표 */
  pointerNdc(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
  }

  /** 포인터가 가리키는 판 위(돌 중심 높이)의 점. 못 찾으면 null */
  groundPoint(event) {
    this.raycaster.setFromCamera(this.pointerNdc(event), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.stonePlane, new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** 판 위의 점 → 화면 픽셀 (캔버스 왼쪽 위 기준) */
  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** 포인터 근처의 team 돌 id (손가락으로 누르기 쉽도록 넉넉하게 찾는다). 없으면 null */
  stoneAt(event, team) {
    if (!this.board) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const s of this.board.stonesOf(team)) {
      const c = this.toScreen(s.x, STONE_Y, s.z);
      const e = this.toScreen(s.x + STONE_RADIUS, STONE_Y, s.z);
      const radius = Math.hypot(e.x - c.x, e.y - c.y);
      const reach = Math.max(24, radius * 2);
      const d = Math.hypot(event.clientX - c.x, event.clientY - c.y);
      if (d < reach && d < bestDistance) {
        best = s.id;
        bestDistance = d;
      }
    }
    return best;
  }

  // ---------- 카메라 ----------

  /** 화면 가장자리를 가리는 HUD 크기 (픽셀). 판이 그 사이에 오도록 한다 */
  setInsets(insets) {
    this.insets = { ...this.insets, ...insets };
    this.cameraDirty = true;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.cameraDirty = true;
    this.cameraSnap = true;
  }

  /** 판 전체가 HUD 사이의 빈 곳에 꽉 차게 보이는 카메라 자리 { pos, look } */
  cameraGoal() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const limitX = Math.max(60, w - left - right) / w;
    const limitY = Math.max(60, h - top - bottom) / h;
    const margin = 0.012;
    const points = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) points.push(new THREE.Vector3(sx * (HALF_X + margin), 0, sz * (HALF_Z + margin)));
      points.push(new THREE.Vector3(sx * (HALF_X + margin), -BOARD_T, HALF_Z + margin)); // 앞쪽 옆면
    }
    const back = new THREE.Vector3(0, Math.cos(TILT), Math.sin(TILT));
    const cam = this.fitCam;
    cam.aspect = w / h;
    cam.fov = FOV;
    cam.updateProjectionMatrix();
    const look = new THREE.Vector3();
    let dist = 1;
    const v = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      cam.position.copy(look).addScaledVector(back, dist);
      cam.lookAt(look);
      cam.updateMatrixWorld();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        v.copy(p).project(cam);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
      const k = Math.max(Math.max(-minX, maxX) / limitX, (maxY - minY) / 2 / limitY);
      // 위아래가 고르게 오도록 보는 곳을 옮긴다
      const halfH = dist * Math.tan(((FOV / 2) * Math.PI) / 180);
      look.z -= (((minY + maxY) / 2) * halfH) / Math.cos(TILT);
      dist *= k;
    }
    return { pos: look.clone().addScaledVector(back, dist), look };
  }

  /** 카메라를 목표로 k 만큼 옮긴다. 움직였으면 true */
  placeCamera(k) {
    if (this.cameraDirty) {
      this.goal = this.cameraGoal();
      this.cameraDirty = false;
    }
    const v = this.view;
    const before = v.pos.clone();
    v.pos.lerp(this.goal.pos, k);
    v.look.lerp(this.goal.look, k);
    const cam = this.camera;
    cam.position.copy(v.pos);
    cam.lookAt(v.look);
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const cx = (left + (w - right)) / 2;
    const cy = (top + (h - bottom)) / 2;
    cam.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    cam.updateProjectionMatrix();
    return before.distanceToSquared(v.pos) > 1e-10;
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let lively = !!this.onFrame?.(dt);
    let casters = false;

    if (this.running && this.board) {
      this.board.advance(dt);
      for (const event of this.board.drain()) {
        if (event.type === 'out') this.startFall(event);
        this.onEvent?.(event);
        if (event.type === 'stop') {
          this.running = false;
          this.runDone?.();
        }
      }
      this.syncStones();
      lively = casters = true;
    }
    if (this.updateFalls(dt)) lively = casters = true;

    // 고른 돌의 테가 천천히 숨 쉰다 (초당 30 번만 그려도 충분하다)
    if (this.selectRing.visible) {
      this.pulse += dt;
      const k = 1 + Math.sin(this.pulse * 4) * 0.08;
      this.selectRing.scale.set(k, 1, k);
    }

    if (this.placeCamera(this.cameraSnap ? 1 : damp(6, dt))) lively = true;
    this.cameraSnap = false;

    if (!this.loop.due(now, lively, casters)) return;
    this.renderer.render(this.scene, this.camera);
  }
}
