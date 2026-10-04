// Three.js 투호 마당. 물리(physics.js)의 화살·항아리 자리를 받아 그린다.
// 길이 단위는 미터이고 좌표계는 physics.js 와 같다 (항아리 바닥 가운데가 원점, 던지는 사람 쪽이 +z).
//
// 흙 마당에 둥근 멍석을 깔고 그 위에 놋쇠 투호 항아리를 세운다. 항아리와 귀는 physics.js 의 벽 중심선을
// 두께만큼 안팎으로 벌려 LatheGeometry 로 돌려 만들므로, 보이는 모양과 부딪히는 모양이 똑같다.
// 화살은 가는 원기둥에 붉게 칠한 촉과 사람 색의 깃을 단다. 배경은 동양식 정원 HDRI(assets/CREDITS.md).
// 던진 뒤에는 카메라가 화살을 따라가고, 화살이 항아리에 다다르면 잠깐 느리게 보여 준다.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import {
  POT_PROFILE,
  EAR_PROFILE,
  HALF_WALL,
  MOUTH_Y,
  EAR_X,
  EAR_R,
  EAR_TOP,
  ARROW_TIP,
  ARROW_TAIL,
  ARROW_RADIUS,
  SWAY_YAW,
  releasePoint,
  baseline,
  tipOf,
  clamp,
} from './physics.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

/** 사람 색. style.css 의 --p0 … --p3 과 같다 */
export const PLAYER_COLORS = ['#e5533d', '#3a86e8', '#f0c02f', '#3fae6a'];

const HALF = Math.PI / 2;
const UP = new THREE.Vector3(0, 1, 0);
const MAT_RADIUS = 0.95; // 멍석 반지름
const CAMERA_BACK = 1.7; // 카메라: 줄에서 이만큼 뒤
const CAMERA_Y = 1.62;
const SLOW = 0.28; // 화살이 항아리에 다다를 때의 느린 화면 배율
const SLOW_TIME = 0.75; // 느린 화면을 보여 주는 실제 시간 (초)
const SLOW_NEAR = 0.55; // 촉이 입에서 이만큼 가까워지면 느려진다 (m)
const LINE_IDS = ['near', 'middle', 'far'];

function loadTexture(loader, path, { srgb = false, repeat = 1 } = {}) {
  return loader.loadAsync(asset(path)).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/**
 * 벽 중심선(꺾은선)을 두께만큼 안팎으로 벌려 닫힌 단면을 만든다: 바깥면을 따라 올라가 입술에서 둥글게 돌아
 * 안쪽면으로 내려온다. LatheGeometry 로 돌리면 두께가 있는 그릇이 된다.
 */
function shellProfile(profile, half) {
  const normals = profile.map((_, i) => {
    const a = profile[Math.max(0, i - 1)];
    const b = profile[Math.min(profile.length - 1, i + 1)];
    const dh = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dh, dy) || 1;
    return [dy / len, -dh / len]; // 꺾은선을 따라 걸을 때 오른쪽(바깥)
  });
  const outer = profile.map(([h, y], i) => new THREE.Vector2(Math.max(0, h + normals[i][0] * half), y + normals[i][1] * half));
  const inner = profile.map(([h, y], i) => new THREE.Vector2(Math.max(0, h - normals[i][0] * half), y - normals[i][1] * half));
  // 입술: 마지막 점 둘레의 반원
  const [lh, ly] = profile[profile.length - 1];
  const [nh, ny] = normals[normals.length - 1];
  const start = Math.atan2(ny, nh);
  const lip = [];
  for (let k = 1; k < 8; k++) {
    const a = start + (Math.PI * k) / 8;
    lip.push(new THREE.Vector2(lh + Math.cos(a) * half, ly + Math.sin(a) * half));
  }
  return [...outer, ...lip, ...inner.reverse()];
}

/** 둥근 끝 원기둥 막대 (아래 y=0 에서 위 y=length) */
function rod(radius, length, segments = 8) {
  return new THREE.CylinderGeometry(radius, radius, length, segments, 1).translate(0, length / 2, 0);
}

export class TuhoScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a3326);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.05, 150);
    this.camLook = new THREE.Vector3(0, 0.6, 0);

    this.yard = null; // physics Yard (main.js 가 정한다)
    this.distance = 2.5; // 지금 줄까지 거리
    this.lineIndex = 0;
    this.meshes = new Map(); // 화살 id → 메시
    this.hand = null; // 손에 든(던지기 전) 화살
    this.handPop = 1;
    this.handPlayer = 0;
    this.aim = { yaw: 0, sway: { x: 0, y: 0 }, line: false };
    this.followed = null; // 카메라가 따라가는 화살
    this.followTime = 0;
    this.slow = 0; // 남은 느린 화면 시간
    this.slowDone = false;
    this.flashes = [];
    this.timeScale = 1; // ?debug 에서 느리게·빠르게 볼 수 있다
    this.onFrame = null; // (dt) => boolean, 매 프레임 main.js 가 조준 흔들림 등을 처리한다. 움직이는 것이 있으면 true
    this.onEvent = null; // (event) => void, 물리에서 일어난 일
    this.onPointer = null; // (type, event) => void

    const canvas = this.renderer.domElement;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      canvas.addEventListener(type, (e) => this.onPointer?.(type, e));
    }

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load() {
    const textures = new THREE.TextureLoader();
    const [env, dirt, dirtNormal, mat, matNormal, wood] = await Promise.all([
      new RGBELoader().loadAsync(asset('hdri/chinese_garden_1k.hdr')),
      loadTexture(textures, 'textures/dirt_floor_diff.jpg', { srgb: true, repeat: 40 }),
      loadTexture(textures, 'textures/dirt_floor_nor_gl.jpg', { repeat: 40 }),
      loadTexture(textures, 'textures/tatami_mat_diff.jpg', { srgb: true, repeat: 2.2 }),
      loadTexture(textures, 'textures/tatami_mat_nor_gl.jpg', { repeat: 2.2 }),
      loadTexture(textures, 'textures/okoume_veneer_diff.jpg', { srgb: true }),
    ]);

    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.75;
    // 밝은 정원 나무가 항아리 뒤로 오게 돌린다
    this.scene.background = env;
    this.scene.backgroundBlurriness = 0.04;
    this.scene.backgroundIntensity = 0.85;
    this.scene.backgroundRotation.set(0, -0.45, 0);
    this.scene.environmentRotation.set(0, -0.45, 0);

    this.buildYard({ dirt, dirtNormal, mat, matNormal, wood });
    this.buildPot();
    this.buildArrowParts(wood);
    this.buildAim();
    this.buildLights();

    this.hand = this.newArrowMesh(0);
    this.hand.visible = false;

    this.last = performance.now();
    this.placeCamera(1, 0);
    this.loop = startLoop(this.renderer, this);
  }

  // ---------- 마당 ----------

  buildYard({ dirt, dirtNormal, mat, matNormal, wood }) {
    // 흙 마당
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(36, 48).rotateX(-HALF),
      new THREE.MeshStandardMaterial({ map: dirt, normalMap: dirtNormal, color: 0xb9ab95, roughness: 0.95, normalScale: new THREE.Vector2(0.6, 0.6) }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 항아리 밑에 깐 둥근 멍석: 가장자리를 짚으로 둘러 감은 것처럼 도톰한 고리를 두른다
    const matMaterial = new THREE.MeshStandardMaterial({ map: mat, normalMap: matNormal, color: 0xe8d5a6, roughness: 0.9 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(MAT_RADIUS, MAT_RADIUS, 0.006, 64), matMaterial);
    disc.position.y = 0.003;
    disc.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(MAT_RADIUS, 0.012, 8, 96).rotateX(HALF), new THREE.MeshStandardMaterial({ color: 0xb59a68, roughness: 0.95 }));
    rim.position.y = 0.008;
    rim.receiveShadow = rim.castShadow = true;
    this.scene.add(disc, rim);

    // 던지는 줄: 땅에 놓은 나무 막대 셋. 지금 줄만 밝게 칠한다
    this.lineBars = LINE_IDS.map(() => {
      const material = new THREE.MeshStandardMaterial({ map: wood, color: 0x8a6a48, roughness: 0.7 });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.025, 0.04), material);
      bar.castShadow = bar.receiveShadow = true;
      this.scene.add(bar);
      return bar;
    });
  }

  /** 줄 막대의 자리와 밝기 */
  placeLines(distances) {
    this.lineBars.forEach((bar, i) => {
      bar.position.set(0, 0.0125, distances[i]);
      const on = i === this.lineIndex;
      bar.material.color.set(on ? 0xd8b06a : 0x6d5238);
      bar.material.emissive.set(on ? 0x3a2408 : 0x000000);
    });
  }

  // ---------- 항아리 ----------

  buildPot() {
    const pot = new THREE.Group();
    this.pot = pot;
    this.scene.add(pot);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc8995a, metalness: 0.92, roughness: 0.32 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x6e4a26, metalness: 0.85, roughness: 0.42 });
    this.brass = brass;

    const body = new THREE.Mesh(new THREE.LatheGeometry(shellProfile(POT_PROFILE, HALF_WALL), 72), brass);
    body.castShadow = body.receiveShadow = true;
    pot.add(body);

    // 몸통과 목에 두른 검은 띠, 굽 테두리 (무늬 대신)
    const band = (radius, y, tube) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 72).rotateX(HALF), dark);
      ring.position.y = y;
      ring.castShadow = true;
      pot.add(ring);
    };
    band(0.165 + HALF_WALL, 0.18, 0.0035);
    band(0.157 + HALF_WALL, 0.235, 0.0025);
    band(0.055 + HALF_WALL, 0.45, 0.003);
    band(0.1 + HALF_WALL, 0.022, 0.003);

    // 양옆 귀: 같은 방식으로 만든 작은 통을 목에 붙이고, 목과 잇는 고리를 단다
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.LatheGeometry(shellProfile(EAR_PROFILE, HALF_WALL), 36), brass);
      ear.position.x = side * EAR_X;
      ear.castShadow = ear.receiveShadow = true;
      pot.add(ear);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(EAR_R + HALF_WALL, 0.0028, 6, 36).rotateX(HALF), dark);
      collar.position.set(side * EAR_X, EAR_TOP - 0.025, 0);
      pot.add(collar);
    }
  }

  // ---------- 화살 ----------

  /** 화살 조각: 무게 중심이 원점, 촉이 +y. 대는 나무, 촉 끝은 붉은 칠, 꽁무니에 깃 셋 */
  buildArrowParts(wood) {
    const length = ARROW_TIP + ARROW_TAIL;
    this.arrowShaft = rod(ARROW_RADIUS, length, 10).translate(0, -ARROW_TAIL, 0);
    this.arrowTip = rod(ARROW_RADIUS * 1.12, 0.07, 10).translate(0, ARROW_TIP - 0.07, 0);
    const cap = new THREE.SphereGeometry(ARROW_RADIUS * 1.12, 10, 6, 0, Math.PI * 2, 0, HALF).translate(0, ARROW_TIP, 0);
    this.arrowCap = cap;
    this.arrowBand = rod(ARROW_RADIUS * 1.15, 0.012, 10).translate(0, -ARROW_TAIL + 0.115, 0);
    // 깃: 꽁무니 쪽으로 넓어지는 사다리꼴 날개
    const shape = new THREE.Shape()
      .moveTo(0, 0)
      .lineTo(0.022, 0.012)
      .lineTo(0.02, 0.085)
      .quadraticCurveTo(0.01, 0.1, 0, 0.1)
      .lineTo(0, 0);
    const vane = new THREE.ShapeGeometry(shape).translate(ARROW_RADIUS * 0.6, -ARROW_TAIL + 0.008, 0);
    this.arrowVanes = [0, 1, 2].map((k) => vane.clone().rotateY((k * Math.PI * 2) / 3));
    this.shaftMaterial = new THREE.MeshStandardMaterial({ map: wood, color: 0xe7c690, roughness: 0.55 });
    this.tipMaterial = new THREE.MeshStandardMaterial({ color: 0x9e1f16, roughness: 0.35, metalness: 0.1 });
    this.vaneMaterials = PLAYER_COLORS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide }));
  }

  /** player 색 깃을 단 화살 메시 */
  newArrowMesh(player) {
    const group = new THREE.Group();
    const vane = this.vaneMaterials[player % this.vaneMaterials.length];
    const parts = [
      [this.arrowShaft, this.shaftMaterial],
      [this.arrowTip, this.tipMaterial],
      [this.arrowCap, this.tipMaterial],
      [this.arrowBand, vane],
      ...this.arrowVanes.map((g) => [g, vane]),
    ];
    for (const [geometry, material] of parts) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      group.add(mesh);
    }
    group.userData.player = player;
    this.scene.add(group);
    return group;
  }

  /** 조준선: 줄에서 항아리 쪽으로 땅 위에 그린 점선. 좌우 방향과 손 흔들림을 보여 준다 */
  buildAim() {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 16, 128);
    g.fillStyle = 'rgba(255, 236, 170, 0.95)';
    for (let y = 0; y < 128; y += 32) g.fillRect(3, y + 4, 10, 18);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.aimTexture = texture;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.8 });
    // 길이 1 짜리 띠: 원점에서 -z 로 뻗는다. 줄까지 거리에 맞춰 늘인다
    const geometry = new THREE.PlaneGeometry(0.035, 1).rotateX(-HALF).translate(0, 0, -0.5);
    this.aimLine = new THREE.Mesh(geometry, material);
    this.aimLine.position.y = 0.012;
    this.aimLine.renderOrder = 2;
    this.aimLine.visible = false;
    this.scene.add(this.aimLine);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff6e2, 0x6b5636, 0.5));
    // 오후 햇빛: 항아리 그림자가 비스듬히 멍석에 드리운다
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -2.2;
    s.right = s.top = 2.2;
    s.near = 1;
    s.far = 25;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.015;
    this.sun.position.set(-3.5, 7, -2.5);
    this.sun.target.position.set(0, 0, 0.6);
    this.scene.add(this.sun, this.sun.target);
  }

  // ---------- 진행 ----------

  /** 던지는 줄을 바꾼다. distances 는 세 줄의 거리, index 는 지금 줄. cut 이면 카메라를 바로 옮긴다 */
  setLine(distances, index, { cut = false } = {}) {
    this.distances = distances;
    this.lineIndex = index;
    this.distance = distances[index] ?? distances[1];
    this.placeLines(distances);
    if (cut) this.cut = true;
  }

  /** player 의 화살을 손에 든다 (null 이면 내려놓는다). line 이면 조준선을 보여 준다 */
  showHand(player, { line = false } = {}) {
    if (!this.hand) return;
    if (player === null) {
      this.hand.visible = false;
      this.aimLine.visible = false;
      return;
    }
    if (this.handPlayer !== player) {
      this.scene.remove(this.hand);
      this.hand = this.newArrowMesh(player);
      this.handPlayer = player;
    }
    if (!this.hand.visible) this.handPop = 0;
    this.hand.visible = true;
    this.aim = { yaw: 0, sway: { x: 0, y: 0 }, line };
  }

  /** 손에 든 화살의 방향 (yaw, 라디안)과 흔들림 sway({ x, y }, 폭을 곱한 것) */
  setAim(yaw, sway) {
    this.aim.yaw = yaw;
    this.aim.sway = sway;
  }

  /** 던진 화살을 카메라가 따라간다 */
  follow(arrow) {
    this.followed = arrow;
    this.followTime = 0;
    this.slow = 0;
    this.slowDone = false;
  }

  /** 카메라를 던지는 자리로 되돌린다 */
  home() {
    this.followed = null;
    this.slow = 0;
  }

  /** 구멍에 들어간 자리에 금빛 고리가 퍼진다. hole: 'mouth' | 'ear', x: 귀 쪽 */
  flash(hole, x = 0) {
    const radius = hole === 'ear' ? EAR_R : 0.075;
    const y = hole === 'ear' ? EAR_TOP : MOUTH_Y;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.006, 8, 48).rotateX(HALF),
      new THREE.MeshBasicMaterial({ color: hole === 'ear' ? 0xfff0a0 : 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    ring.position.set(hole === 'ear' ? Math.sign(x || 1) * EAR_X : 0, y + 0.01, 0);
    this.scene.add(ring);
    this.flashes.push({ mesh: ring, t: 0 });
  }

  /** 물리 화살에 맞춰 메시를 만들고 옮긴다. 물리에서 빠진 화살의 메시는 치운다 */
  syncArrows() {
    const ids = new Set();
    const u = new THREE.Vector3();
    for (const arrow of this.yard?.arrows ?? []) {
      ids.add(arrow.id);
      let mesh = this.meshes.get(arrow.id);
      if (!mesh) {
        mesh = this.newArrowMesh(arrow.player ?? 0);
        this.meshes.set(arrow.id, mesh);
      }
      mesh.position.set(arrow.x, arrow.y, arrow.z);
      mesh.quaternion.setFromUnitVectors(UP, u.set(arrow.ux, arrow.uy, arrow.uz));
    }
    for (const [id, mesh] of this.meshes) {
      if (ids.has(id)) continue;
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
  }

  // ---------- 프레임 ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 세로 화면에서는 시야를 넓혀 항아리와 손에 든 화살이 함께 들어오게 한다
    this.camera.fov = this.camera.aspect < 0.8 ? 44 : 31;
    this.camera.updateProjectionMatrix();
    this.placeCamera(1, 0);
  }

  /** 카메라가 있어야 할 자리로 k(0~1) 만큼 다가간다 */
  placeCamera(k, dt) {
    const portrait = this.camera.aspect < 0.8;
    const back = this.distance + CAMERA_BACK + (portrait ? 0.25 : 0);
    const target = new THREE.Vector3(0, CAMERA_Y, back);
    // 항아리 입이 화면 가운데보다 조금 아래에 오게 본다. 위쪽에는 정원이, 오른쪽 아래에는 손에 든 화살이 보인다
    const look = new THREE.Vector3(0, MOUTH_Y + (portrait ? 0.22 : 0.36), 0);

    const arrow = this.followed;
    if (arrow) {
      // 따라가기: 화살과 항아리 사이를 보며 항아리 쪽으로 다가간다
      this.followTime += dt;
      const reach = clamp(1 - arrow.z / Math.max(0.5, this.distance), 0, 1);
      const near = new THREE.Vector3(0.35, 1.05, 1.35);
      target.lerp(near, 0.15 + 0.55 * reach);
      const p = new THREE.Vector3(arrow.x, arrow.y, arrow.z);
      const mouth = new THREE.Vector3(0, MOUTH_Y, 0);
      look.copy(mouth).lerp(p, arrow.result ? 0.2 : 0.55 - 0.3 * reach);
    }
    this.camera.position.lerp(target, k);
    this.camLook.lerp(look, k);
    this.camera.lookAt(this.camLook);
  }

  frame(now) {
    const realDt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let lively = !!this.onFrame?.(realDt);
    let casters = false;

    // 느린 화면: 따라가는 화살의 촉이 입에 다가가면 잠깐 느려진다
    const arrow = this.followed;
    if (arrow && !this.slowDone && !arrow.result) {
      const tip = tipOf(arrow);
      if (arrow.vy < 0 && Math.hypot(tip.x, tip.y - MOUTH_Y, tip.z) < SLOW_NEAR) {
        this.slow = SLOW_TIME;
        this.slowDone = true;
      }
    }
    let scale = this.timeScale;
    if (this.slow > 0) {
      this.slow -= realDt;
      // 들어갈 때와 나올 때 부드럽게
      const k = clamp(Math.min(SLOW_TIME - this.slow, this.slow) / 0.15, 0, 1);
      scale *= 1 - (1 - SLOW) * k;
      lively = true;
    }
    const dt = realDt * scale;

    if (this.yard) {
      this.yard.step(dt);
      for (const event of this.yard.drain()) this.onEvent?.(event);
      if (this.yard.arrows.some((a) => !a.resting)) lively = casters = true;
    }
    this.syncArrows();
    if (this.updateHand(realDt)) lively = true;
    if (this.updateFlashes(realDt)) lively = true;

    const from = this.camera.position.clone();
    const look = this.camLook.clone();
    this.placeCamera(this.cut ? 1 : damp(this.followed ? 2.4 : 3, realDt), dt);
    this.cut = false;
    if (from.distanceToSquared(this.camera.position) > 1e-7 || look.distanceToSquared(this.camLook) > 1e-7) lively = true;

    if (!this.loop.due(now, lively, casters)) return;
    this.renderer.render(this.scene, this.camera);
  }

  /** 손에 든 화살: 처음 나타날 때 살짝 솟고, 흔들림만큼 촉이 좌우·위아래로 떨린다. 움직였으면 true */
  updateHand(dt) {
    if (!this.hand?.visible) {
      this.aimLine.visible = false;
      return false;
    }
    const p = releasePoint(this.distance);
    this.handPop = Math.min(1, this.handPop + dt * 4);
    const ease = 1 - (1 - this.handPop) ** 3;
    const { yaw, sway, line } = this.aim;
    const { elevation, heading: base } = baseline(this.distance);
    const heading = base + yaw + sway.x * SWAY_YAW * 1.6; // 눈에 잘 띄게 조금 키운다
    const tilt = elevation + sway.y * 0.12;
    const u = new THREE.Vector3(Math.cos(tilt) * Math.sin(heading), Math.sin(tilt), -Math.cos(tilt) * Math.cos(heading));
    this.hand.position.set(p.x, p.y - 0.25 * (1 - ease), p.z);
    this.hand.quaternion.setFromUnitVectors(UP, u);
    this.aimLine.visible = line;
    if (line) {
      const length = Math.max(0.4, Math.hypot(p.x, p.z) - 0.25);
      this.aimLine.position.set(p.x, 0.012, p.z);
      this.aimLine.rotation.y = -heading;
      this.aimLine.scale.set(1, 1, length);
      this.aimTexture.repeat.set(1, length * 4);
    }
    return true;
  }

  updateFlashes(dt) {
    for (const flash of this.flashes) {
      flash.t += dt;
      const k = flash.t / 0.9;
      flash.mesh.scale.setScalar(1 + k * 1.8);
      flash.mesh.material.opacity = Math.max(0, 0.95 * (1 - k));
    }
    const done = this.flashes.filter((f) => f.t >= 0.9);
    for (const f of done) {
      this.scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      f.mesh.material.dispose();
    }
    this.flashes = this.flashes.filter((f) => f.t < 0.9);
    return this.flashes.length > 0;
  }
}
