// Three.js 바둑판 씬. 규칙(game.js)의 판(칸마다 흑·백·빈칸)을 받아 돌을 그리고, 놓을 자리 미리보기·
// 마지막 차례 표시·이긴 줄을 보여 준다. 확대와 시점(비스듬히·위에서)을 바꿀 수 있다.
// 길이 단위는 미터. 천원이 원점이고 x 는 오른쪽, z 는 화면 아래(흑 쪽)가 +, 판 윗면이 y=0 이다.
//
// 바둑판과 바둑돌은 알까기(alkkagi/js/scene.js)와 같은 방식으로 만든다. 다리가 달린 두꺼운 판에
// 나뭇결 텍스처를 깔고 19줄·화점을 캔버스로 그려 입히며, 돌은 위아래가 볼록한 납작한 타원체다.
// 돌은 편마다 InstancedMesh 하나로 그려 361개가 다 차도 가볍다. 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { SIZE, CELLS, EMPTY, rowOf, colOf, indexOf } from './game.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';

/** 플레이어 색 (흑 1P, 백 2P). style.css 의 --p0, --p1 과 같다 */
export const PLAYER_COLORS = ['#4db8ff', '#ffd23f'];

// 실제 바둑판과 바둑돌 규격 (판 42.4×45.5cm, 줄 간격 2.2×2.37cm). 돌은 이웃 돌과 살짝 떨어지게 조금 작게
export const GRID_X = 0.022;
export const GRID_Z = 0.0237;
export const HALF_X = 0.212;
export const HALF_Z = 0.2275;
const STONE_RADIUS = 0.0106;
const STONE_HEIGHT = 0.0092; // 돌 두께 (한가운데)
const STONE_Y = STONE_HEIGHT / 2; // 판 위에 놓인 돌의 중심 높이
const STONE_TOP = STONE_HEIGHT + 0.0004; // 돌 위에 얹는 표시의 높이

const ASSETS = new URL('../assets/', import.meta.url);
const SHARED_ASSETS = new URL('../../shared/assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;
const sharedAsset = (path) => new URL(path, SHARED_ASSETS).href;

const BOARD_T = 0.075; // 판 두께
const LEG_H = 0.05; // 다리 높이
const FLOOR_Y = -(BOARD_T + LEG_H);
const TILTS = { tilt: 0.42, top: 0.06 }; // 카메라가 수직에서 흑 쪽으로 기운 각도 (라디안)
const FOV = 30;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
const DROP_HEIGHT = 0.045; // 돌이 이만큼 위에서 떨어진다
const DROP_TIME = 0.14; // 떨어지는 시간 (초)
const SETTLE_TIME = 0.16; // 닿은 뒤 납작해졌다 돌아오는 시간
const RIPPLE_TIME = 0.45;
const HALF = Math.PI / 2;

const flatRing = (inner, outer, segments = 40) => new THREE.RingGeometry(inner, outer, segments).rotateX(-HALF);
const flatCircle = (radius, segments = 24) => new THREE.CircleGeometry(radius, segments).rotateX(-HALF);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/** 칸 → 판 위의 점 */
export const cellPoint = (index) => ({ x: (colOf(index) - (SIZE - 1) / 2) * GRID_X, z: (rowOf(index) - (SIZE - 1) / 2) * GRID_Z });

function loadTexture(loader, url, { srgb = false, repeat = 1 } = {}) {
  return loader.loadAsync(url).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

export class Connect6Scene {
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
    this.tilt = TILTS.tilt;
    this.zoom = ZOOM_MIN;
    this.focus = new THREE.Vector2(); // 확대했을 때 가운데로 볼 판 위의 점 (x, z)
    this.cameraDirty = true;
    this.cameraSnap = true;

    this.cells = new Int8Array(CELLS).fill(EMPTY); // 화면에 그린 판
    this.slots = [new Map(), new Map()]; // 편마다 칸 → 인스턴스 번호
    this.slotCells = [[], []]; // 편마다 인스턴스 번호 → 칸
    this.drops = new Map(); // 떨어지는 중인 돌: 칸 → { team, t, landed }
    this.ripples = [];
    this.preview = null; // { index, team, armed }
    this.winTeam = null;
    this.pulse = 0;
    this.onFrame = null; // (dt) => boolean, 매 프레임 main.js 가 알림 등을 처리한다. 움직이는 것이 있으면 true
    this.onEvent = null; // (event) => void, { type: 'land', index, x } 떨어진 돌이 판에 닿았다
    this.onPointer = null; // (type, event) => void
    this.onWheel = null; // (event) => void

    const canvas = this.renderer.domElement;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']) {
      canvas.addEventListener(type, (e) => this.onPointer?.(type, e));
    }
    canvas.addEventListener('wheel', (e) => this.onWheel?.(e), { passive: false });
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
    this.buildStones();
    this.buildMarkers();
    this.buildLights();

    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  // ---------- 바둑판 ----------

  /** 나뭇결 위에 19줄과 화점을 그린 윗면 텍스처 */
  boardFace(woodImage) {
    const width = 2048; // 육목은 줄 위에 정확히 두어야 하므로 알까기보다 선명하게 그린다
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
    const half = (SIZE - 1) / 2;
    ctx.strokeStyle = 'rgba(28, 18, 8, 0.88)';
    ctx.lineCap = 'square';
    for (let i = -half; i <= half; i++) {
      ctx.lineWidth = Math.abs(i) === half ? 6 : 3.6; // 바깥 줄은 조금 굵게
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
        ctx.arc(px(col * GRID_X), pz(row * GRID_Z), 12, 0, Math.PI * 2);
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

  // ---------- 돌 ----------

  /** 바둑돌: 위아래가 볼록한 납작한 타원체. 흑은 무광에 가까운 점판암, 백은 윤이 나는 조개. 편마다 InstancedMesh 하나 */
  buildStones() {
    this.stoneGeometry = new THREE.SphereGeometry(STONE_RADIUS, 32, 16).scale(1, STONE_HEIGHT / (2 * STONE_RADIUS), 1);
    this.stoneMaterials = [
      new THREE.MeshPhysicalMaterial({ color: 0x17181b, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
      new THREE.MeshPhysicalMaterial({ color: 0xf3efe4, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
    ];
    this.stoneMeshes = this.stoneMaterials.map((material) => {
      const mesh = new THREE.InstancedMesh(this.stoneGeometry, material, Math.ceil(CELLS / 2));
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    });
    // 미리보기 돌: 반투명
    this.ghostMaterials = this.stoneMaterials.map((m) => {
      const ghost = m.clone();
      ghost.transparent = true;
      ghost.opacity = 0.55;
      ghost.depthWrite = false;
      return ghost;
    });
    this.ghost = new THREE.Mesh(this.stoneGeometry, this.ghostMaterials[0]);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  /** 칸의 돌 하나를 그린다. lift: 판에서 띄운 높이, squash: 납작해진 정도 */
  setStoneMatrix(index, team, { lift = 0, squash = 0 } = {}) {
    const slot = this.slots[team].get(index);
    if (slot === undefined) return;
    const p = cellPoint(index);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x, STONE_Y + lift - (STONE_HEIGHT * squash) / 2, p.z),
      new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (index * 2.399) % (Math.PI * 2)), // 돌마다 결이 다르게
      new THREE.Vector3(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5),
    );
    this.stoneMeshes[team].setMatrixAt(slot, m);
    this.stoneMeshes[team].instanceMatrix.needsUpdate = true;
  }

  addInstance(index, team) {
    const mesh = this.stoneMeshes[team];
    const slot = mesh.count++;
    this.slots[team].set(index, slot);
    this.slotCells[team][slot] = index;
    this.cells[index] = team;
  }

  removeInstance(index) {
    const team = this.cells[index];
    if (team === EMPTY) return;
    const mesh = this.stoneMeshes[team];
    const slot = this.slots[team].get(index);
    const lastSlot = mesh.count - 1;
    // 마지막 인스턴스를 빈 자리로 옮긴다
    if (slot !== lastSlot) {
      const moved = this.slotCells[team][lastSlot];
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(lastSlot, m);
      mesh.setMatrixAt(slot, m);
      this.slots[team].set(moved, slot);
      this.slotCells[team][slot] = moved;
    }
    mesh.count--;
    mesh.instanceMatrix.needsUpdate = true;
    this.slots[team].delete(index);
    this.cells[index] = EMPTY;
    this.drops.delete(index);
  }

  /** 판 전체를 그대로 그린다 (새 판·무르기). 떨어지던 돌은 바로 내려놓는다 */
  setBoard(cells) {
    for (let i = 0; i < CELLS; i++) {
      if (this.cells[i] === cells[i]) continue;
      if (this.cells[i] !== EMPTY) {
        this.addRipple(i, 0.6);
        this.removeInstance(i);
      }
      if (cells[i] !== EMPTY) {
        this.addInstance(i, cells[i]);
        this.setStoneMatrix(i, cells[i]);
      }
    }
    for (const [index, drop] of this.drops) this.setStoneMatrix(index, drop.team);
    this.drops.clear();
  }

  /** 돌 하나를 위에서 떨어뜨려 놓는다. 판에 닿을 때 onEvent({ type: 'land' }) 를 부른다 */
  addStone(index, team) {
    if (this.cells[index] !== EMPTY) this.removeInstance(index);
    this.addInstance(index, team);
    this.drops.set(index, { team, t: 0, landed: false });
    this.setStoneMatrix(index, team, { lift: DROP_HEIGHT });
  }

  updateDrops(dt) {
    if (!this.drops.size) return false;
    for (const [index, d] of this.drops) {
      d.t += dt;
      if (d.t < DROP_TIME) {
        const k = d.t / DROP_TIME;
        this.setStoneMatrix(index, d.team, { lift: DROP_HEIGHT * (1 - k * k) });
        continue;
      }
      if (!d.landed) {
        d.landed = true;
        this.addRipple(index, 1);
        this.onEvent?.({ type: 'land', index, team: d.team, x: cellPoint(index).x });
      }
      const s = (d.t - DROP_TIME) / SETTLE_TIME;
      if (s >= 1) {
        this.setStoneMatrix(index, d.team);
        this.drops.delete(index);
      } else {
        // 닿는 순간 살짝 납작해졌다가 튀어 오르며 돌아온다
        this.setStoneMatrix(index, d.team, { squash: 0.22 * Math.sin(Math.PI * s) * (1 - s), lift: 0.0025 * Math.sin(Math.PI * s) ** 2 });
      }
    }
    return true;
  }

  // ---------- 표시 ----------

  buildMarkers() {
    const overlay = (color, opacity, extra = {}) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        ...extra,
      });
    // 놓을 자리를 가리키는 가로·세로 줄 (작은 화면에서도 어느 줄인지 보이게)
    this.guideMaterial = overlay(PLAYER_COLORS[0], 0.5);
    this.guideRow = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2 - GRID_X, 0.0016).rotateX(-HALF), this.guideMaterial);
    this.guideCol = new THREE.Mesh(new THREE.PlaneGeometry(0.0016, HALF_Z * 2 - GRID_Z).rotateX(-HALF), this.guideMaterial);
    this.previewRing = new THREE.Mesh(flatRing(STONE_RADIUS * 1.12, STONE_RADIUS * 1.42), overlay(PLAYER_COLORS[0], 0.95));
    for (const mesh of [this.guideRow, this.guideCol, this.previewRing]) {
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
    }
    this.guideRow.position.y = this.guideCol.position.y = 0.0004;
    this.previewRing.position.y = 0.0005;

    // 마지막 차례에 둔 돌 위의 점 (빨강), 이번 차례에 이미 둔 돌 위의 점 (금색)
    const dot = flatCircle(STONE_RADIUS * 0.3);
    this.marks = ['#ff5a3c', '#ffd23f'].map((color) => {
      const mesh = new THREE.InstancedMesh(dot, overlay(color, 0.95), 2);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      return mesh;
    });

    // 이긴 줄: 돌 위를 지나는 빛나는 띠와 돌마다 테
    this.winBar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-HALF), overlay('#ffe9a8', 0.6, { depthTest: false }));
    this.winBar.renderOrder = 4;
    this.winBar.visible = false;
    this.scene.add(this.winBar);
    this.winRings = new THREE.InstancedMesh(flatRing(STONE_RADIUS * 0.62, STONE_RADIUS * 0.92, 32), overlay('#ffcf4a', 1, { depthTest: false }), CELLS);
    this.winRings.count = 0;
    this.winRings.frustumCulled = false;
    this.winRings.renderOrder = 5;
    this.scene.add(this.winRings);

    // 돌이 닿을 때 퍼지는 물결
    this.rippleGeometry = flatRing(STONE_RADIUS * 0.95, STONE_RADIUS * 1.15);
    this.rippleMaterial = overlay(0xffffff, 0.6);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 0.45));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    this.sun.position.set(0.35, 1.3, 0.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -0.32;
    s.right = s.top = 0.32;
    s.near = 0.4;
    s.far = 3;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.0012;
    this.scene.add(this.sun, this.sun.target);
  }

  addRipple(index, strength) {
    const mesh = new THREE.Mesh(this.rippleGeometry, this.rippleMaterial.clone());
    const p = cellPoint(index);
    mesh.position.set(p.x, 0.0006, p.z);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.ripples.push({ mesh, t: 0, strength });
  }

  updateRipples(dt) {
    if (!this.ripples.length) return false;
    for (const r of this.ripples) {
      r.t += dt;
      const k = Math.min(1, r.t / RIPPLE_TIME);
      const s = 1 + k * 1.6;
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 0.6 * r.strength * (1 - k) ** 1.5;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        r.done = true;
      }
    }
    this.ripples = this.ripples.filter((r) => !r.done);
    return true;
  }

  /**
   * 놓을 자리 미리보기. preview: { index, team, armed } 또는 null. armed 면 한 번 더 누르면 놓이는 상태.
   * 돌이 있는 자리(키보드 커서)면 반투명 돌 없이 테와 가로·세로 줄만 보인다
   */
  setPreview(preview) {
    this.preview = preview && preview.index !== null ? preview : null;
    const show = !!this.preview;
    this.guideRow.visible = this.guideCol.visible = this.previewRing.visible = show;
    this.ghost.visible = show && this.cells[this.preview.index] === EMPTY;
    if (!show) return;
    const { index, team } = this.preview;
    const p = cellPoint(index);
    this.ghost.material = this.ghostMaterials[team];
    this.ghost.position.set(p.x, STONE_Y, p.z);
    this.guideMaterial.color.set(PLAYER_COLORS[team]);
    this.previewRing.material.color.set(PLAYER_COLORS[team]);
    this.guideRow.position.set(0, 0.0004, p.z);
    this.guideCol.position.set(p.x, 0.0004, 0);
    this.previewRing.position.set(p.x, this.ghost.visible ? 0.0005 : STONE_TOP, p.z);
  }

  /** 마지막 차례에 둔 돌(last)과 이번 차례에 이미 둔 돌(current) 위에 점을 찍는다 */
  setMarks({ last = [], current = [] } = {}) {
    [last, current].forEach((cells, k) => {
      const mesh = this.marks[k];
      mesh.count = cells.length;
      const m = new THREE.Matrix4();
      cells.forEach((index, i) => {
        const p = cellPoint(index);
        mesh.setMatrixAt(i, m.makeTranslation(p.x, STONE_TOP, p.z));
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /** 이긴 줄 (칸들, 한쪽 끝부터 차례로). null 이면 치운다 */
  setWinLine(cells) {
    this.winBar.visible = !!cells?.length;
    this.winRings.count = cells?.length ?? 0;
    if (!cells?.length) return;
    const a = cellPoint(cells[0]);
    const b = cellPoint(cells.at(-1));
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    this.winBar.position.set((a.x + b.x) / 2, STONE_TOP + 0.0002, (a.z + b.z) / 2);
    this.winBar.rotation.y = Math.atan2(-dz, dx);
    this.winBar.scale.set(length + STONE_RADIUS * 2.2, 1, STONE_RADIUS * 0.7);
    const m = new THREE.Matrix4();
    cells.forEach((index, i) => {
      const p = cellPoint(index);
      this.winRings.setMatrixAt(i, m.makeTranslation(p.x, STONE_TOP + 0.0003, p.z));
    });
    this.winRings.instanceMatrix.needsUpdate = true;
  }

  // ---------- 화면 좌표 ----------

  /** 포인터 위치 → 정규화 장치 좌표 */
  pointerNdc(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
  }

  /** 화면 점(clientX, clientY)이 가리키는 판 위(돌 중심 높이)의 점. 못 찾으면 null */
  groundPoint(event) {
    this.raycaster.setFromCamera(this.pointerNdc(event), this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.stonePlane, new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** 포인터가 가리키는 칸. 판의 줄 바깥으로 반 칸 넘게 벗어나면 null */
  cellAt(event) {
    const p = this.groundPoint(event);
    if (!p) return null;
    const half = (SIZE - 1) / 2;
    const col = Math.round(p.x / GRID_X + half);
    const row = Math.round(p.z / GRID_Z + half);
    if (Math.abs(p.x / GRID_X + half - clamp(col, 0, SIZE - 1)) > 0.75) return null;
    if (Math.abs(p.z / GRID_Z + half - clamp(row, 0, SIZE - 1)) > 0.75) return null;
    return indexOf(clamp(row, 0, SIZE - 1), clamp(col, 0, SIZE - 1));
  }

  /** 지금 화면에서 한 칸 너비 (픽셀) */
  cellPixels() {
    const a = this.toScreen(-GRID_X / 2, 0, 0);
    const b = this.toScreen(GRID_X / 2, 0, 0);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /** 판 위의 점 → 화면 픽셀 */
  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  // ---------- 카메라 ----------

  /** 화면 가장자리를 가리는 HUD 크기 (픽셀). 판이 그 사이에 오도록 한다 */
  setInsets(insets) {
    this.insets = { ...this.insets, ...insets };
    this.cameraDirty = true;
  }

  /** 시점: 'tilt' 비스듬히, 'top' 위에서 */
  setView(view) {
    this.tilt = TILTS[view] ?? TILTS.tilt;
    this.cameraDirty = true;
  }

  /** 확대 배율 (1 이면 판 전체). focus 를 주면 그 점(판 위 x, z)을 가운데로 */
  setZoom(zoom, focus = null) {
    this.zoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    if (focus) this.focus.set(focus.x, focus.z);
    this.clampFocus();
    this.cameraDirty = true;
  }

  /** 확대했을 때 가운데로 볼 점을 옮긴다. snap 이면 카메라를 바로 옮긴다 (손가락으로 끌 때) */
  setFocus(x, z, snap = false) {
    this.focus.set(x, z);
    this.clampFocus();
    this.cameraDirty = true;
    if (snap) this.cameraSnap = true;
  }

  /** 확대한 만큼만 옮길 수 있게 해 판 밖이 보이지 않게 한다 */
  clampFocus() {
    const k = 1 - 1 / this.zoom;
    this.focus.x = clamp(this.focus.x, -HALF_X * k, HALF_X * k);
    this.focus.y = clamp(this.focus.y, -HALF_Z * k, HALF_Z * k);
  }

  /** 화면 점 screen 아래에 판 위의 점 anchor 가 오도록 보는 곳을 옮기고 카메라를 바로 옮긴다 (손가락으로 끌 때) */
  keepPoint(anchor, screen) {
    this.cameraDirty = true;
    this.placeCamera(1);
    const p = this.groundPoint(screen);
    if (!p) return;
    this.setFocus(this.focus.x + anchor.x - p.x, this.focus.y + anchor.z - p.z, true);
    this.placeCamera(1);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.cameraDirty = true;
    this.cameraSnap = true;
  }

  /** 판 전체가 HUD 사이의 빈 곳에 꽉 차게 보이는 카메라 자리 { look, dist, back } */
  fitBoard() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const limitX = Math.max(60, w - left - right) / w;
    const limitY = Math.max(60, h - top - bottom) / h;
    const margin = 0.008;
    const points = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) points.push(new THREE.Vector3(sx * (HALF_X + margin), 0, sz * (HALF_Z + margin)));
      points.push(new THREE.Vector3(sx * (HALF_X + margin), -BOARD_T, HALF_Z + margin)); // 앞쪽 옆면
    }
    const back = new THREE.Vector3(0, Math.cos(this.tilt), Math.sin(this.tilt));
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
      look.z -= (((minY + maxY) / 2) * halfH) / Math.cos(this.tilt);
      dist *= k;
    }
    return { look, dist, back };
  }

  /** 확대·보는 곳까지 더한 카메라 목표 { pos, look } */
  cameraGoal() {
    const fit = this.fitBoard();
    const look = fit.look.clone();
    look.x += this.focus.x;
    look.z += this.focus.y;
    return { pos: look.clone().addScaledVector(fit.back, fit.dist / this.zoom), look };
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
    return before.distanceToSquared(v.pos) > 1e-12;
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let lively = !!this.onFrame?.(dt);
    let casters = false;

    if (this.updateDrops(dt)) lively = casters = true;
    if (this.updateRipples(dt)) lively = true;

    // 미리보기 테와 이긴 줄이 천천히 숨 쉰다 (초당 30 번만 그려도 충분하다)
    this.pulse += dt;
    if (this.previewRing.visible) {
      const k = 1 + Math.sin(this.pulse * (this.preview?.armed ? 9 : 4)) * (this.preview?.armed ? 0.14 : 0.07);
      this.previewRing.scale.set(k, 1, k);
    }
    if (this.winBar.visible) this.winBar.material.opacity = 0.45 + Math.sin(this.pulse * 4) * 0.2;

    if (this.placeCamera(this.cameraSnap ? 1 : damp(7, dt))) lively = true;
    this.cameraSnap = false;

    if (!this.loop.due(now, lively, casters)) return;
    this.renderer.render(this.scene, this.camera);
  }
}
