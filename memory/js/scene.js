// Three.js 카드 판. 게임 상태(game.js)를 읽어 그리기만 하고 규칙은 건드리지 않는다.
// 카드는 펠트 위에 가로 cols × 세로 rows 로 놓인다. 몇 줄로 놓을지는 화면 비율에 맞춰 여기서 정하고
// (세로 화면이면 세로로 길게), 화면이 돌면 카드가 새 자리로 미끄러져 간다.
// 카메라는 살짝 기울여 내려다보는 자리에 고정한다.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { layoutFor } from './game.js';
import { damp } from '../../shared/util.js';

/** 플레이어 색. style.css 의 --p0, --p1 과 같다 */
export const PLAYER_COLORS = ['#4db8ff', '#ffd23f'];

const HALF = Math.PI / 2;
const TILT = 0.24; // 수직에서 기운 각도(라디안)
const CARD_W = 1;
const CARD_H = 1.357; // 카드 뒷면 그림(140×190)의 비율
const CARD_T = 0.03;
const CARD_R = 0.075;
const GAP = 0.16;
const CELL_W = CARD_W + GAP;
const CELL_H = CARD_H + GAP;
const PAD = 0.22; // 카드 바깥으로 남기는 펠트
const RAIL = 0.17; // 펠트를 두른 테두리 너비
const FLIP_TIME = 0.3; // 카드 한 장이 뒤집히는 시간(초)
const TAP_SLOP = 12; // 누른 자리에서 이만큼(픽셀) 넘게 움직이면 탭이 아니다
const FACE_PX = [256, 348];

const SOLO_COLOR = new THREE.Color('#e8c36a');
const RAIL_COLOR = new THREE.Color('#4a3524');

const smooth = (k) => k * k * (3 - 2 * k);

function roundedRect(w, h, r) {
  const x = w / 2;
  const y = h / 2;
  return new THREE.Shape()
    .moveTo(-x + r, -y)
    .lineTo(x - r, -y)
    .quadraticCurveTo(x, -y, x, -y + r)
    .lineTo(x, y - r)
    .quadraticCurveTo(x, y, x - r, y)
    .lineTo(-x + r, y)
    .quadraticCurveTo(-x, y, -x, y - r)
    .lineTo(-x, -y + r)
    .quadraticCurveTo(-x, -y, -x + r, -y);
}

/** 카드 한 면. 그림이 면 전체에 꽉 차게 UV 를 편다 */
function faceGeometry() {
  const geometry = new THREE.ShapeGeometry(roundedRect(CARD_W, CARD_H, CARD_R), 6);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, position.getX(i) / CARD_W + 0.5, position.getY(i) / CARD_H + 0.5);
  }
  return geometry;
}

/** 바닥에 눕힌 둥근 사각 테. grow 만큼 카드보다 크고 width 만큼 두껍다(0 이면 속이 찬 판) */
function frameGeometry(grow, width) {
  const shape = roundedRect(CARD_W + grow * 2, CARD_H + grow * 2, CARD_R + grow);
  if (width > 0) {
    const inner = grow - width;
    shape.holes.push(roundedRect(CARD_W + inner * 2, CARD_H + inner * 2, CARD_R + Math.max(0, inner)));
  }
  return new THREE.ShapeGeometry(shape, 6).rotateX(-HALF);
}

export class MemoryScene {
  constructor(container, assetUrl) {
    this.container = container;
    this.assetUrl = assetUrl;
    this.renderer = createRenderer(THREE, { antialias: true, alpha: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    this.buildLights();
    this.buildShared();

    this.insets = { top: 0, bottom: 0, left: 0, right: 0 }; // HUD 가 가리는 화면 가장자리 픽셀
    this.cameraDirty = true;
    this.cards = [];
    this.cols = 0;
    this.rows = 0;
    this.cursor = -1;
    this.turn = -1; // 테두리에 색을 비출 플레이어. -1 이면 끈다
    this.game = null;
    this.onFrame = null; // (dt) => void, 프레임마다 그리기 전에 불린다
    this.onTap = null; // (index) => void
    this.onHover = null; // (index) => void, 마우스가 가리키는 카드(-1 이면 없음)

    this.raycaster = new THREE.Raycaster();
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CARD_T);
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff6e6, 0x2a2a30, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  /** 모든 판이 같이 쓰는 도형·재질. 텍스처는 늦게 와도 되고, 오기 전에는 단색으로 그린다 */
  buildShared() {
    const loader = new THREE.TextureLoader();
    const back = loader.load(new URL('cards/back.png', this.assetUrl).href);
    back.colorSpace = THREE.SRGBColorSpace;
    back.anisotropy = 4;
    const felt = loader.load(new URL('textures/velour_velvet_normal.jpg', this.assetUrl).href);
    felt.wrapS = felt.wrapT = THREE.RepeatWrapping;
    this.feltNormal = felt;

    const outline = roundedRect(CARD_W, CARD_H, CARD_R);
    this.geometry = {
      face: faceGeometry(),
      body: new THREE.ExtrudeGeometry(outline, { depth: CARD_T, bevelEnabled: false, curveSegments: 6 }).translate(
        0,
        0,
        -CARD_T / 2,
      ),
      owner: frameGeometry(0.055, 0),
      cursor: frameGeometry(0.075, 0.05),
    };
    this.material = {
      back: new THREE.MeshStandardMaterial({ map: back, roughness: 0.55 }),
      body: new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.7 }),
      felt: new THREE.MeshStandardMaterial({ color: 0x1f7350, normalMap: felt, roughness: 1 }),
      rail: new THREE.MeshStandardMaterial({ color: RAIL_COLOR, roughness: 0.55, emissive: RAIL_COLOR, emissiveIntensity: 0 }),
      cursor: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    };
    this.faces = new Map(); // 그림 이름 → 앞면 재질
  }

  /** 흰 카드에 동물 그림을 얹은 앞면. 그림 파일이 오면 다시 그린다 */
  faceMaterial(name) {
    let material = this.faces.get(name);
    if (material) return material;
    const [w, h] = FACE_PX;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    const paint = (image) => {
      g.fillStyle = '#efe6d2';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d9ccae';
      g.lineWidth = 5;
      g.beginPath();
      g.roundRect(15, 15, w - 30, h - 30, 14);
      g.stroke();
      if (!image) return;
      const scale = Math.min((w * 0.74) / image.width, (h * 0.6) / image.height);
      const iw = image.width * scale;
      const ih = image.height * scale;
      g.imageSmoothingQuality = 'high';
      g.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih);
    };
    paint(null);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const image = new Image();
    image.onload = () => {
      paint(image);
      texture.needsUpdate = true;
      this.redraw();
    };
    image.src = new URL(`animals/${name}.png`, this.assetUrl).href;
    material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 });
    this.faces.set(name, material);
    return material;
  }

  /** 다음 프레임을 꼭 그리게 한다(startLoop 가 frame 밖에서 불린 메서드를 보고 알아챈다) */
  redraw() {}

  // ---------- 판 ----------

  /** 새 판마다 카드를 다시 놓는다. deal 이 참이면 한 장씩 나타난다 */
  setup(game, { deal = true } = {}) {
    if (this.board) {
      this.scene.remove(this.board);
      this.dispose(this.board);
    }
    this.game = game;
    this.cursor = -1;
    this.board = new THREE.Group();
    this.scene.add(this.board);
    this.table = null;

    this.cursorMesh = new THREE.Mesh(this.geometry.cursor, this.material.cursor);
    this.cursorMesh.visible = false;
    this.board.add(this.cursorMesh);

    this.cards = game.cards.map((card, index) => {
      const pivot = new THREE.Group();
      const tilt = new THREE.Group();
      tilt.rotation.x = -HALF; // 카드를 눕힌다. 뒷면이 위, 그림의 위쪽이 화면 위쪽(-z)
      const body = new THREE.Mesh(this.geometry.body, this.material.body);
      body.castShadow = true;
      const back = new THREE.Mesh(this.geometry.face, this.material.back);
      back.position.z = CARD_T / 2 + 0.001;
      const face = new THREE.Mesh(this.geometry.face, this.faceMaterial(card.face));
      face.position.z = -CARD_T / 2 - 0.001;
      face.rotation.y = Math.PI;
      tilt.add(body, back, face);
      pivot.add(tilt);

      const owner = new THREE.Mesh(this.geometry.owner, new THREE.MeshBasicMaterial({ color: SOLO_COLOR }));
      owner.position.y = 0.004;
      owner.visible = false;
      this.board.add(pivot, owner);

      const shown = card.state === 'down' ? 0 : 1;
      const entry = {
        pivot,
        owner,
        x: 0,
        z: 0,
        tx: 0,
        tz: 0,
        flip: shown,
        target: shown,
        hover: 0,
        scale: deal ? 0 : 1,
        dealDelay: deal ? 0.15 + index * 0.025 : 0,
        shake: 0,
        shakeDelay: 0,
        hop: 0,
        hopDelay: 0,
      };
      if (card.state === 'matched') this.mark(entry, card.owner);
      return entry;
    });

    this.cols = 0;
    this.cameraDirty = true;
    this.placeCamera();
  }

  /** 맞춘 카드 밑에 맞춘 사람 색 테를 깐다 */
  mark(entry, player) {
    entry.owner.material.color.set(this.game.players > 1 ? PLAYER_COLORS[player] : SOLO_COLOR);
    entry.owner.visible = true;
  }

  /** 카드 자리와 펠트를 cols × rows 에 맞춘다. snap 이면 미끄러지지 않고 바로 놓는다 */
  relayout(cols, rows, snap) {
    this.cols = cols;
    this.rows = rows;
    this.cards.forEach((card, index) => {
      const col = index % cols;
      const row = (index - col) / cols;
      card.tx = (col - (cols - 1) / 2) * CELL_W;
      card.tz = (row - (rows - 1) / 2) * CELL_H;
      if (snap) {
        card.x = card.tx;
        card.z = card.tz;
      }
    });

    if (this.table) {
      this.board.remove(this.table);
      this.table.traverse((o) => o.geometry?.dispose());
    }
    const w = cols * CELL_W - GAP + PAD * 2;
    const d = rows * CELL_H - GAP + PAD * 2;
    this.half = { x: w / 2 + RAIL, z: d / 2 + RAIL };
    this.table = new THREE.Group();
    const felt = new THREE.Mesh(new RoundedBoxGeometry(w, 0.2, d, 3, 0.09), this.material.felt);
    felt.position.y = -0.1;
    felt.receiveShadow = true;
    const rail = new THREE.Mesh(new RoundedBoxGeometry(w + RAIL * 2, 0.24, d + RAIL * 2, 3, 0.12), this.material.rail);
    rail.position.y = -0.15;
    rail.receiveShadow = true;
    this.table.add(felt, rail);
    this.board.add(this.table);
    this.feltNormal.repeat.set(w / 2.5, d / 2.5);

    const s = this.sun.shadow.camera;
    const r = Math.max(this.half.x, this.half.z) * 1.15;
    s.left = s.bottom = -r;
    s.right = s.top = r;
    s.near = 1;
    s.far = r * 6;
    s.updateProjectionMatrix();
    this.sun.position.set(-r * 0.5, r * 2, r * 0.35);
    this.sun.target.position.set(0, 0, 0);
  }

  dispose(root) {
    const shared = new Set(Object.values(this.geometry));
    const kept = new Set([...Object.values(this.material), ...this.faces.values()]);
    root.traverse((o) => {
      if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      if (o.material && !kept.has(o.material)) o.material.dispose();
    });
  }

  // ---------- 사건 ----------

  /** game.drain() 으로 나온 사건을 화면에 옮긴다 */
  handle(event) {
    switch (event.type) {
      case 'flip':
        this.cards[event.index].target = 1;
        break;
      case 'hide':
        this.cards[event.a].target = 0;
        this.cards[event.b].target = 0;
        break;
      case 'miss':
        // 다 뒤집힌 다음에 고개를 젓는다
        for (const index of [event.a, event.b]) {
          this.cards[index].shake = 1;
          this.cards[index].shakeDelay = FLIP_TIME;
        }
        break;
      case 'match':
        for (const index of [event.a, event.b]) {
          const card = this.cards[index];
          this.mark(card, event.player);
          card.hop = 1;
          card.hopDelay = FLIP_TIME;
        }
        break;
      case 'done':
        // 다 맞추면 카드가 차례로 들썩인다
        this.cards.forEach((card, index) => {
          card.hop = 1;
          card.hopDelay = 0.75 + index * 0.035;
        });
        break;
    }
  }

  setCursor(index) {
    this.cursor = index;
  }

  /** 펠트 테두리에 지금 차례인 사람의 색을 비춘다. -1 이면 끈다 */
  setTurn(player) {
    this.turn = player;
  }

  // ---------- 입력 ----------

  /** 화면 좌표가 가리키는 카드 번호. 카드 밖이면 -1 */
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
    const col = Math.floor(hit.x / CELL_W + this.cols / 2);
    const row = Math.floor(hit.z / CELL_H + this.rows / 2);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  /** 누른 카드에서 그대로 떼어야 탭이다. 끌거나 두 손가락을 대면 무시한다 */
  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (down || (e.pointerType === 'mouse' && e.button !== 0)) {
        down = null; // 두 번째 손가락: 탭 취소
        return;
      }
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, index: this.pick(e.clientX, e.clientY) };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const { x, y, index } = down;
      down = null;
      if (index < 0 || Math.hypot(e.clientX - x, e.clientY - y) > TAP_SLOP) return;
      if (this.pick(e.clientX, e.clientY) !== index) return;
      this.onTap?.(index);
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

  /** HUD 에 가리지 않는 영역에 카드가 가장 크게 들어가는 줄 수를 고르고, 판 전체가 꽉 차게 카메라를 놓는다 */
  placeCamera() {
    if (!this.cameraDirty || !this.game) return;
    this.cameraDirty = false;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const margin = Math.min(w, h) < 500 ? 4 : 16;
    const availW = Math.max(60, w - left - right - margin * 2);
    const availH = Math.max(60, h - top - bottom - margin * 2);

    // 기울여 보므로 세로는 cos(TILT) 만큼 짧아 보인다
    const { cols, rows } = layoutFor(this.cards.length, availW / availH, CELL_W / (CELL_H * Math.cos(TILT)));
    if (cols !== this.cols) this.relayout(cols, rows, this.cols === 0);

    const camera = this.camera;
    camera.clearViewOffset();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // 판을 감싸는 상자의 여덟 꼭짓점이 화면에서 차지하는 범위
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
          for (const y of [-0.27, 0.1]) {
            corner.set(sx * this.half.x, y, sz * this.half.z).project(camera);
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
    const size = Math.max(this.half.x, this.half.z);
    let near = size * 0.5;
    let far = size * 80;
    for (let i = 0; i < 26; i++) {
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
    this.onFrame?.(dt);
    let lively = false;
    if (this.game) {
      this.placeCamera();
      lively = this.animate(dt);
    }
    if (this.loop.due(now, lively)) this.renderer.render(this.scene, this.camera);
  }

  /** 카드를 움직인다. 움직인 것이 있으면 true */
  animate(dt) {
    let moving = false;
    const slide = damp(10, dt);
    const lift = damp(16, dt);

    this.cards.forEach((card, index) => {
      if (card.dealDelay > 0) {
        card.dealDelay -= dt;
        moving = true;
      } else if (card.scale < 1) {
        card.scale = Math.min(1, card.scale + (1.02 - card.scale) * damp(9, dt));
        moving = true;
      }

      if (Math.abs(card.tx - card.x) + Math.abs(card.tz - card.z) > 0.001) {
        card.x += (card.tx - card.x) * slide;
        card.z += (card.tz - card.z) * slide;
        moving = true;
      }

      if (card.flip !== card.target) {
        const step = dt / FLIP_TIME;
        card.flip = card.target > card.flip ? Math.min(1, card.flip + step) : Math.max(0, card.flip - step);
        moving = true;
      }

      const hover = index === this.cursor && this.game.canFlip(index) ? 1 : 0;
      if (Math.abs(hover - card.hover) > 0.005) {
        card.hover += (hover - card.hover) * lift;
        moving = true;
      }

      let sway = 0;
      if (card.shake > 0) {
        if (card.shakeDelay > 0) card.shakeDelay -= dt;
        else {
          card.shake = Math.max(0, card.shake - dt / 0.45);
          sway = Math.sin(card.shake * Math.PI * 5) * 0.045 * card.shake;
        }
        moving = true;
      }

      let hop = 0;
      if (card.hop > 0) {
        if (card.hopDelay > 0) card.hopDelay -= dt;
        else {
          card.hop = Math.max(0, card.hop - dt / 0.42);
          hop = Math.sin(card.hop * Math.PI);
        }
        moving = true;
      }

      const angle = smooth(card.flip) * Math.PI;
      // 뒤집히는 동안 가장자리가 펠트를 뚫지 않게 들어 올린다
      const y = CARD_T / 2 + 0.003 + Math.sin(angle) * (CARD_W / 2 + 0.03) + card.hover * 0.07 + hop * 0.22;
      card.pivot.position.set(card.x + sway, y, card.z);
      card.pivot.rotation.z = angle;
      card.pivot.scale.setScalar(Math.max(0.0001, card.scale) * (1 + hop * 0.06));
      card.owner.position.set(card.x, 0.004, card.z);
    });

    // 차례인 사람의 색이 테두리에 번진다
    const rail = this.material.rail;
    const versus = this.turn >= 0;
    const wanted = versus ? new THREE.Color(PLAYER_COLORS[this.turn]) : RAIL_COLOR;
    const glow = versus ? 0.18 : 0;
    if (!rail.color.equals(wanted) || rail.emissiveIntensity !== glow) {
      const k = damp(8, dt);
      rail.color.lerp(wanted, k);
      rail.emissive.copy(rail.color);
      rail.emissiveIntensity += (glow - rail.emissiveIntensity) * k;
      const close = Math.abs(rail.color.r - wanted.r) + Math.abs(rail.color.g - wanted.g) + Math.abs(rail.color.b - wanted.b);
      if (close < 0.004) {
        rail.color.copy(wanted);
        rail.emissiveIntensity = glow;
      }
      moving = true;
    }

    const visible = this.cursor >= 0 && this.cursor < this.cards.length && this.game.canFlip(this.cursor);
    this.cursorMesh.visible = visible;
    if (visible) {
      const card = this.cards[this.cursor];
      this.cursorMesh.position.set(card.x, 0.006, card.z);
    }
    return moving;
  }
}
