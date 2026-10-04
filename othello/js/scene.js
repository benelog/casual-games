// Three.js 오델로 판 씬. 규칙(game.js)의 판을 받아 돌을 그리고, 돌을 놓고 뒤집는 움직임과 놓을 곳·커서 표시를 보여 준다.
// 길이 단위는 미터. 판 가운데가 원점이고 판 윗면(초록 천)이 y=0, row 0(1줄)이 먼 쪽(-z), col 0(a열)이 왼쪽(-x)이다.
//
// 판은 나무 틀 위에 초록 천을 깐 모양으로, 천에는 8×8 줄과 네 점을, 틀에는 a~h·1~8 좌표를 캔버스로 그려 입힌다.
// 돌은 위가 흑, 아래가 백인 납작한 원판이다. 놓은 돌은 위에서 떨어져 내려앉고, 사이에 낀 돌은
// 놓은 돌에서 가까운 것부터 차례로 들렸다가 놓은 쪽에서 먼 쪽으로 넘어가듯 축을 따라 반 바퀴 돈다.
// 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { SIZE, CELLS, EMPTY, BLACK, rowOf, colOf } from './game.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';

/** 플레이어 색 (흑 1P, 백 2P). style.css 의 --p0, --p1 과 같다 */
export const PLAYER_COLORS = ['#4db8ff', '#ffd23f'];

const ASSETS = new URL('../assets/', import.meta.url);
const SHARED_ASSETS = new URL('../../shared/assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;
const sharedAsset = (path) => new URL(path, SHARED_ASSETS).href;

const CELL = 0.042; // 한 칸
const GRID_HALF = (CELL * SIZE) / 2;
const FELT_HALF = GRID_HALF + 0.004;
const RIM = 0.006; // 천을 두른 나무 턱의 너비
const RIM_H = 0.004;
const BOARD_HALF = GRID_HALF + 0.034; // 좌표를 적는 틀까지
const BOARD_T = 0.032;
const FLOOR_Y = -BOARD_T;
const DISC_R = 0.0172;
const DISC_H = 0.0058;
const BEVEL = 0.0022;
const DROP = 0.07; // 놓는 돌이 떨어지기 시작하는 높이
const DROP_TIME = 0.2;
const FLIP_TIME = 0.36;
const FLIP_GAP = 0.075; // 한 칸 멀어질 때마다 뒤집기가 늦게 시작하는 시간
const FLIP_LIFT = 0.016;
const TILT = 0.3; // 카메라가 수직에서 앞쪽(+z)으로 기운 각도 (라디안)
const FOV = 30;
const HALF = Math.PI / 2;
const MAX_FLIPS = 24;

const flatCircle = (radius, segments = 24) => new THREE.CircleGeometry(radius, segments).rotateX(-HALF);
const flatRing = (inner, outer, segments = 40, start = 0) =>
  new THREE.RingGeometry(inner, outer, segments, 1, start).rotateX(-HALF);

/** 칸의 가운데 */
export function cellCenter(index) {
  return { x: (colOf(index) + 0.5) * CELL - GRID_HALF, z: (rowOf(index) + 0.5) * CELL - GRID_HALF };
}

function loadTexture(loader, url, { srgb = false, repeat = 1 } = {}) {
  return loader.loadAsync(url).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class OthelloScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0f0c);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.02, 20);
    this.fitCam = new THREE.PerspectiveCamera(FOV, 1, 0.02, 20); // 카메라 자리를 계산할 때만 쓴다
    this.view = { pos: new THREE.Vector3(0, 1.2, 0.4), look: new THREE.Vector3() };
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };
    this.cameraDirty = true;
    this.cameraSnap = true;

    this.discs = new Array(CELLS).fill(null); // 칸마다 돌 메시 (없으면 null)
    this.drop = null; // 떨어지는 돌 { mesh, index, t }
    this.flips = []; // 뒤집히는 돌 [{ mesh, index, axis, from, delay, t, k, done }]
    this.animDone = null;
    this.cursorIndex = null;
    this.pulse = 0;
    this.onFrame = null; // (dt) => boolean, 매 프레임 main.js 가 알림 등을 처리한다. 움직이는 것이 있으면 true
    this.onEvent = null; // (event) => void, 돌이 내려앉음(place)·뒤집힘(flip)
    this.onPointer = null; // (type, event) => void

    const canvas = this.renderer.domElement;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']) {
      canvas.addEventListener(type, (e) => this.onPointer?.(type, e));
    }
    this.raycaster = new THREE.Raycaster();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load() {
    const textures = new THREE.TextureLoader();
    const [env, woodImage, woodNormal, feltNormal, feltRough, floorMap, floorNormal, floorRough] = await Promise.all([
      new RGBELoader().loadAsync(sharedAsset('hdri/warm_bar_1k.hdr')),
      new THREE.ImageLoader().loadAsync(asset('textures/okoume_veneer_diff.jpg')),
      loadTexture(textures, asset('textures/okoume_veneer_nor_gl.jpg')),
      loadTexture(textures, sharedAsset('textures/velour_velvet_nor_gl_1k.jpg'), { repeat: 3 }),
      loadTexture(textures, sharedAsset('textures/velour_velvet_rough_1k.jpg'), { repeat: 3 }),
      loadTexture(textures, sharedAsset('textures/dark_wood_diff_1k.jpg'), { srgb: true, repeat: 4 }),
      loadTexture(textures, sharedAsset('textures/dark_wood_nor_gl_1k.jpg'), { repeat: 4 }),
      loadTexture(textures, sharedAsset('textures/dark_wood_rough_1k.jpg'), { repeat: 4 }),
    ]);
    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;

    this.buildBoard(woodImage, woodNormal, { normalMap: feltNormal, roughnessMap: feltRough });
    this.buildFloor({ map: floorMap, normalMap: floorNormal, roughnessMap: floorRough });
    this.buildDiscParts();
    this.buildMarkers();
    this.buildLights();

    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  // ---------- 판 ----------

  /** 초록 천 무늬: 8×8 줄과 가운데 네 점 */
  feltFace() {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2f8a4c';
    ctx.fillRect(0, 0, size, size);
    const p = (v) => ((v + FELT_HALF) / (2 * FELT_HALF)) * size;
    ctx.strokeStyle = 'rgba(8, 30, 14, 0.85)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= SIZE; i++) {
      const v = i * CELL - GRID_HALF;
      ctx.beginPath();
      ctx.moveTo(p(v), p(-GRID_HALF));
      ctx.lineTo(p(v), p(GRID_HALF));
      ctx.moveTo(p(-GRID_HALF), p(v));
      ctx.lineTo(p(GRID_HALF), p(v));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(8, 30, 14, 0.9)';
    for (const x of [-2, 2]) {
      for (const z of [-2, 2]) {
        ctx.beginPath();
        ctx.arc(p(x * CELL), p(z * CELL), 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  /** 나무 틀 윗면: 나뭇결 위에 a~h·1~8 좌표 */
  frameFace(woodImage) {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(woodImage, 0, 0, size, size);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#c98f55';
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    const p = (v) => ((v + BOARD_HALF) / (2 * BOARD_HALF)) * size;
    const edge = (FELT_HALF + RIM + BOARD_HALF) / 2; // 턱 바깥 틀의 가운데
    ctx.fillStyle = 'rgba(255, 238, 205, 0.85)';
    ctx.font = `600 ${Math.round(size * 0.034)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < SIZE; i++) {
      const v = (i + 0.5) * CELL - GRID_HALF;
      for (const side of [-1, 1]) {
        ctx.fillText('abcdefgh'[i], p(v), p(side * edge));
        ctx.fillText(String(i + 1), p(side * edge), p(v));
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  buildBoard(woodImage, woodNormal, feltMaps) {
    const sideMap = new THREE.Texture(woodImage);
    sideMap.colorSpace = THREE.SRGBColorSpace;
    sideMap.wrapS = sideMap.wrapT = THREE.RepeatWrapping;
    sideMap.needsUpdate = true;
    const side = new THREE.MeshStandardMaterial({
      map: sideMap,
      normalMap: woodNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      color: 0xb87c48,
      roughness: 0.45,
    });
    const top = new THREE.MeshStandardMaterial({
      map: this.frameFace(woodImage),
      normalMap: woodNormal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.4,
    });
    // BoxGeometry 의 면 순서: +x, -x, +y(윗면), -y, +z, -z
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_HALF * 2, BOARD_T, BOARD_HALF * 2).translate(0, -BOARD_T / 2, 0),
      [side, side, top, side, side, side],
    );
    base.receiveShadow = true;
    base.castShadow = true;
    this.scene.add(base);

    // 초록 천 (틀 윗면보다 아주 조금 위)
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(FELT_HALF * 2, FELT_HALF * 2).rotateX(-HALF),
      new THREE.MeshStandardMaterial({ map: this.feltFace(), ...feltMaps, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95 }),
    );
    felt.position.y = 0.0002;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // 천을 두른 나무 턱 네 개
    const rimLong = new THREE.BoxGeometry(FELT_HALF * 2 + RIM * 2, RIM_H, RIM);
    const rimShort = new THREE.BoxGeometry(RIM, RIM_H, FELT_HALF * 2);
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(rimLong, side);
      a.position.set(0, RIM_H / 2, s * (FELT_HALF + RIM / 2));
      const b = new THREE.Mesh(rimShort, side);
      b.position.set(s * (FELT_HALF + RIM / 2), RIM_H / 2, 0);
      for (const m of [a, b]) {
        m.castShadow = m.receiveShadow = true;
        this.scene.add(m);
      }
    }
  }

  buildFloor(maps) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 3).rotateX(-HALF),
      new THREE.MeshStandardMaterial({ ...maps, color: 0x9c8673, roughness: 0.8 }),
    );
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  // ---------- 돌 ----------

  /** 위(흑)와 아래(백) 반쪽. 가장자리가 둥근 원판을 회전체로 만든다 */
  buildDiscParts() {
    const half = (sign) => {
      const points = [];
      // 가운데에서 가장자리로, 둥근 모서리를 따라 가운데 이음매(y=0)까지
      points.push(new THREE.Vector2(0, (sign * DISC_H) / 2));
      points.push(new THREE.Vector2(DISC_R - BEVEL, (sign * DISC_H) / 2));
      for (let k = 1; k <= 6; k++) {
        const a = (k / 6) * HALF;
        points.push(
          new THREE.Vector2(DISC_R - BEVEL + Math.sin(a) * BEVEL, sign * (DISC_H / 2 - BEVEL + Math.cos(a) * BEVEL)),
        );
      }
      points.push(new THREE.Vector2(DISC_R, 0));
      // 회전체의 면이 바깥을 보도록 아래(-y)에서 위로 가는 순서로 둔다
      if (sign > 0) points.reverse();
      return new THREE.LatheGeometry(points, 48);
    };
    this.discGeometry = [half(1), half(-1)]; // [흑 쪽(위), 백 쪽(아래)]
    this.discMaterials = [
      new THREE.MeshPhysicalMaterial({ color: 0x151515, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
      new THREE.MeshPhysicalMaterial({ color: 0xf1eee6, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    ];
    this.ghostMaterials = this.discMaterials.map((m) => {
      const ghost = m.clone();
      ghost.transparent = true;
      ghost.opacity = 0.5;
      ghost.depthWrite = false;
      return ghost;
    });
  }

  /** 흑이 위인 원판 하나 (그룹). ghost 면 반투명 */
  makeDisc(ghost = false) {
    const materials = ghost ? this.ghostMaterials : this.discMaterials;
    const group = new THREE.Group();
    for (const side of [0, 1]) {
      const mesh = new THREE.Mesh(this.discGeometry[side], materials[side]);
      mesh.castShadow = !ghost;
      mesh.receiveShadow = !ghost;
      group.add(mesh);
    }
    return group;
  }

  /** 돌의 놓인 자세: color 가 위로 */
  orient(mesh, color, index) {
    // 칸마다 조금씩 다르게 돌려 둔다 (원판이라 보이지는 않지만 뒤집는 축과 섞이지 않게)
    mesh.quaternion.setFromEuler(new THREE.Euler(color === BLACK ? 0 : Math.PI, (index * 0.7) % (Math.PI * 2), 0));
  }

  discAt(index, color) {
    let mesh = this.discs[index];
    if (!mesh) {
      mesh = this.makeDisc();
      this.scene.add(mesh);
      this.discs[index] = mesh;
    }
    const c = cellCenter(index);
    mesh.position.set(c.x, DISC_H / 2, c.z);
    this.orient(mesh, color, index);
    mesh.visible = true;
    return mesh;
  }

  /** 판(64칸 배열)대로 돌을 바로 놓는다. 하던 움직임은 끝낸다 */
  setBoard(board) {
    this.finishAnimations();
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === EMPTY) {
        if (this.discs[i]) {
          this.scene.remove(this.discs[i]);
          this.discs[i] = null;
        }
      } else this.discAt(i, board[i]);
    }
  }

  finishAnimations() {
    if (this.drop) {
      this.drop.mesh.position.y = DISC_H / 2;
      this.drop = null;
    }
    for (const f of this.flips) this.endFlip(f);
    this.flips = [];
    const done = this.animDone;
    this.animDone = null;
    done?.();
  }

  /**
   * index 에 player 의 돌을 떨어뜨리고, 내려앉으면 flips 의 돌을 차례로 뒤집는다. 모두 끝나면 이행되는 Promise.
   * 떨어진 순간 onEvent({ type: 'place' }), 돌 하나가 뒤집혀 내려앉을 때마다 onEvent({ type: 'flip' }) 를 부른다.
   */
  placeDisc(index, player, flips) {
    this.finishAnimations();
    const mesh = this.discAt(index, player);
    mesh.position.y = DISC_H / 2 + DROP;
    this.drop = { mesh, index, t: 0 };
    this.setLastMove(null);
    const from = cellCenter(index);
    const order = flips
      .map((i) => {
        const c = cellCenter(i);
        const dx = c.x - from.x;
        const dz = c.z - from.z;
        const steps = Math.max(Math.abs(rowOf(i) - rowOf(index)), Math.abs(colOf(i) - colOf(index)));
        // 놓은 돌에서 바깥쪽으로 넘어가도록, 그 방향에 수직인 수평축으로 돈다
        const axis = new THREE.Vector3(dz, 0, -dx).normalize();
        return { index: i, steps, axis };
      })
      .sort((a, b) => a.steps - b.steps);
    this.flips = order.map((f, k) => ({
      ...f,
      mesh: this.discs[f.index],
      color: player,
      delay: DROP_TIME + 0.05 + (f.steps - 1) * FLIP_GAP,
      t: 0,
      k,
      from: null,
      done: false,
    }));
    return new Promise((resolve) => {
      this.animDone = resolve;
    });
  }

  /** 뒤집기를 끝낸 자세로 둔다 */
  endFlip(f) {
    if (f.done || !f.mesh) return;
    f.done = true;
    const c = cellCenter(f.index);
    f.mesh.position.set(c.x, DISC_H / 2, c.z);
    this.orient(f.mesh, f.color, f.index);
  }

  /** 떨어지는 돌과 뒤집히는 돌을 움직인다. 움직이는 것이 있으면 true */
  updateAnimations(dt) {
    if (!this.drop && !this.flips.length) return false;
    if (this.drop) {
      const d = this.drop;
      d.t += dt;
      const k = Math.min(1, d.t / DROP_TIME);
      d.mesh.position.y = DISC_H / 2 + DROP * (1 - k * k);
      if (k >= 1) {
        this.drop = null;
        const c = cellCenter(d.index);
        this.setLastMove(d.index);
        this.onEvent?.({ type: 'place', index: d.index, x: c.x / BOARD_HALF });
      }
    }
    const turn = new THREE.Quaternion();
    for (const f of this.flips) {
      if (f.done) continue;
      f.t += dt;
      const local = (f.t - f.delay) / FLIP_TIME;
      if (local <= 0) continue;
      if (!f.from) f.from = f.mesh.quaternion.clone();
      if (local >= 1) {
        this.endFlip(f);
        const c = cellCenter(f.index);
        this.onEvent?.({ type: 'flip', index: f.index, k: f.k, color: f.color, x: c.x / BOARD_HALF });
        continue;
      }
      const e = easeInOut(local);
      turn.setFromAxisAngle(f.axis, Math.PI * e);
      f.mesh.quaternion.copy(turn).multiply(f.from);
      f.mesh.position.y = DISC_H / 2 + Math.sin(Math.PI * local) * FLIP_LIFT;
    }
    if (!this.drop && this.flips.every((f) => f.done)) {
      this.flips = [];
      const done = this.animDone;
      this.animDone = null;
      done?.();
    }
    return true;
  }

  // ---------- 표시 ----------

  buildMarkers() {
    const overlay = (color, opacity) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    // 놓을 수 있는 칸의 점
    this.hintMaterial = overlay(0x000000, 0.4);
    this.hints = new THREE.InstancedMesh(flatCircle(CELL * 0.12), this.hintMaterial, 32);
    this.hints.count = 0;
    this.hints.frustumCulled = false;
    this.hints.position.y = 0.0006;
    this.scene.add(this.hints);
    // 커서: 칸을 두르는 네모 테
    const corner = (CELL * 0.94) / Math.SQRT2;
    this.cursor = new THREE.Mesh(flatRing(corner - CELL * 0.06, corner, 4, Math.PI / 4), overlay(0xffffff, 0.95));
    this.cursor.position.y = 0.0008;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    // 커서 칸에 둘 수 있으면 반투명 돌을 미리 보이고, 뒤집힐 돌 위에 작은 테를 두른다
    this.ghost = this.makeDisc(true);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.flipMarks = new THREE.InstancedMesh(flatRing(DISC_R * 0.32, DISC_R * 0.48, 28), overlay(0xffffff, 0.85), MAX_FLIPS);
    this.flipMarks.count = 0;
    this.flipMarks.frustumCulled = false;
    this.scene.add(this.flipMarks);
    // 마지막 수: 돌 위의 작은 빨간 점
    this.lastMark = new THREE.Mesh(flatCircle(DISC_R * 0.26, 20), overlay(0xff4a3a, 0.95));
    this.lastMark.visible = false;
    this.scene.add(this.lastMark);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1e2418, 0.5));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
    this.sun.position.set(0.3, 1.2, 0.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -0.32;
    s.right = s.top = 0.32;
    s.near = 0.4;
    s.far = 2.6;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.0012;
    this.scene.add(this.sun, this.sun.target);
  }

  /** 놓을 수 있는 칸들에 player 색의 점을 찍는다 (빈 배열이면 감춘다) */
  setHints(indices, player = BLACK) {
    const m = new THREE.Matrix4();
    indices.slice(0, 32).forEach((index, k) => {
      const c = cellCenter(index);
      m.makeTranslation(c.x, 0, c.z);
      this.hints.setMatrixAt(k, m);
    });
    this.hints.count = Math.min(indices.length, 32);
    this.hints.instanceMatrix.needsUpdate = true;
    this.hintMaterial.color.set(player === BLACK ? 0x0a0a0a : 0xffffff);
    this.hintMaterial.opacity = player === BLACK ? 0.42 : 0.55;
  }

  /**
   * 커서. index 가 null 이면 감춘다. preview: { player, flips } 를 주면 그 칸에 반투명 돌과 뒤집힐 돌 표시를 보인다
   */
  setCursor(index, { player = BLACK, preview = null } = {}) {
    this.cursorIndex = index;
    this.cursor.visible = index !== null;
    this.ghost.visible = false;
    this.flipMarks.count = 0;
    if (index === null) return;
    const c = cellCenter(index);
    this.cursor.position.set(c.x, 0.0008, c.z);
    this.cursor.material.color.set(PLAYER_COLORS[player]);
    if (!preview) return;
    this.ghost.visible = true;
    this.ghost.position.set(c.x, DISC_H / 2, c.z);
    this.orient(this.ghost, preview.player, index);
    const m = new THREE.Matrix4();
    preview.flips.slice(0, MAX_FLIPS).forEach((i, k) => {
      const f = cellCenter(i);
      m.makeTranslation(f.x, DISC_H + 0.0004, f.z);
      this.flipMarks.setMatrixAt(k, m);
    });
    this.flipMarks.count = Math.min(preview.flips.length, MAX_FLIPS);
    this.flipMarks.instanceMatrix.needsUpdate = true;
    this.flipMarks.material.color.set(preview.player === BLACK ? 0x111111 : 0xffffff);
  }

  /** 마지막 수 표시 (index 가 null 이거나 음수면 감춘다) */
  setLastMove(index) {
    const show = index !== null && index >= 0;
    this.lastMark.visible = show;
    if (!show) return;
    const c = cellCenter(index);
    this.lastMark.position.set(c.x, DISC_H + 0.0005, c.z);
  }

  // ---------- 화면 좌표 ----------

  /** 포인터 위치 → 정규화 장치 좌표 */
  pointerNdc(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
  }

  /** 포인터가 가리키는 칸 번호. 판 밖이면 null */
  cellAt(event) {
    this.raycaster.setFromCamera(this.pointerNdc(event), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.boardPlane, new THREE.Vector3());
    if (!hit) return null;
    const col = Math.floor((hit.x + GRID_HALF) / CELL);
    const row = Math.floor((hit.z + GRID_HALF) / CELL);
    if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return null;
    return row * SIZE + col;
  }

  /** 칸 가운데 → 화면 픽셀 (테스트·디버그용) */
  cellToScreen(index) {
    const c = cellCenter(index);
    const v = new THREE.Vector3(c.x, 0, c.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
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
    const margin = 0.004;
    const points = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) points.push(new THREE.Vector3(sx * (BOARD_HALF + margin), 0, sz * (BOARD_HALF + margin)));
      points.push(new THREE.Vector3(sx * (BOARD_HALF + margin), -BOARD_T, BOARD_HALF + margin)); // 앞쪽 옆면
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

    if (this.updateAnimations(dt)) lively = casters = true;

    // 커서 테가 천천히 숨 쉰다 (초당 30 번만 그려도 충분하다)
    if (this.cursor.visible) {
      this.pulse += dt;
      const k = 1 + Math.sin(this.pulse * 4) * 0.035;
      this.cursor.scale.set(k, 1, k);
    }

    if (this.placeCamera(this.cameraSnap ? 1 : damp(6, dt))) lively = true;
    this.cameraSnap = false;

    if (!this.loop.due(now, lively, casters)) return;
    this.renderer.render(this.scene, this.camera);
  }
}
