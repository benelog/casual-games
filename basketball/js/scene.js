// Three.js 농구 코트 씬. 물리(physics.js)의 공·골대 자리를 받아 그린다.
// 길이 단위는 미터이고 좌표계는 physics.js 와 같다 (림 바로 아래 바닥이 원점, 던지는 사람 쪽이 +z).
// 림·그물·공 모양은 CC0 모델(assets/models/hoop.glb)에서 가져와 규격에 맞춰 다듬고,
// 백보드·기둥·코트 선은 단순한 도형이라 코드로 만든다. 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  BALL_RADIUS,
  RIM_Y,
  RIM_INNER,
  RIM_TUBE,
  RIM_RADIUS,
  BOARD_Z,
  BOARD_THICK,
  BOARD_HALF_W,
  BOARD_BOTTOM,
  BOARD_TOP,
  NET_DEPTH,
  RELEASE_Y,
  releasePoint,
  clamp,
} from './physics.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const HALF = Math.PI / 2;
const BASELINE_Z = BOARD_Z - 1.2; // 백보드 앞면은 엔드 라인에서 1.2m 안쪽
const COURT_HALF_W = 7.5;
const HALF_COURT_Z = BASELINE_Z + 14;
const PIXELS_PER_M = 64;
const CAMERA_BACK = 1.7; // 카메라: 공을 놓는 자리에서 이만큼 뒤
const CAMERA_Y = 1.95;
export const PLAYER_COLORS = [0x3d8bff, 0xffc233]; // style.css 의 --p0, --p1 과 같다

function loadTexture(loader, path, { srgb = false } = {}) {
  return loader.loadAsync(asset(path)).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** 모델 안의 메시 하나를 모델 원점 기준 좌표로 구운 도형 */
function bakedGeometry(root, name) {
  let found = null;
  root.traverse((o) => {
    if (o.isMesh && !found && (o.name === name || o.parent?.name === name)) found = o;
  });
  if (!found) throw new Error(`hoop model: ${name} not found`);
  return { geometry: found.geometry.clone().applyMatrix4(found.matrixWorld), material: found.material };
}

export class BasketballScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14110d);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 120);
    this.camLook = new THREE.Vector3(0, 2, 0);

    this.court = null; // physics Court (main.js 가 정한다)
    this.stage = { distance: 4.22, angle: 0 };
    this.meshes = new Map(); // 공 id → 메시
    this.hand = null; // 손에 든(던지기 전) 공
    this.handPop = 0;
    this.aimYaw = null; // 조준 화살표 방향 (null 이면 감춘다)
    this.net = { sx: 0, sz: 0, vx: 0, vz: 0, stretch: 0, vs: 0, ripple: 0, phase: 0 };
    this.timeScale = 1; // ?debug 에서 느리게·빠르게 볼 수 있다
    this.onFrame = null; // (dt) => boolean, 매 프레임 main.js 가 조준 게이지 등을 처리한다. 움직이는 것이 있으면 true
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
    const [env, woodMap, woodNormal, woodRough, gltf] = await Promise.all([
      new RGBELoader().loadAsync(asset('hdri/school_hall_1k.hdr')),
      loadTexture(textures, 'textures/wood_floor_diff_1k.jpg', { srgb: true }),
      loadTexture(textures, 'textures/wood_floor_nor_gl_512.jpg'),
      loadTexture(textures, 'textures/wood_floor_rough_512.jpg'),
      new GLTFLoader().loadAsync(asset('models/hoop.glb')),
    ]);

    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.6;
    // 체육관 분위기만 나도록 흐리게 배경에 깐다. 무대 커튼 쪽이 아니라 관람석·창 쪽이 골대 뒤로 오게 돌린다
    this.scene.background = env;
    this.scene.backgroundBlurriness = 0.28;
    this.scene.backgroundIntensity = 0.38;
    this.scene.backgroundRotation.set(0, Math.PI, 0);
    this.scene.environmentRotation.set(0, Math.PI, 0);

    this.buildCourt({ map: woodMap, normalMap: woodNormal, roughnessMap: woodRough });
    this.buildHoop(gltf.scene);
    this.buildBall(gltf.scene);
    this.buildAim();
    this.buildLights();

    this.last = performance.now();
    this.placeCamera(1);
    this.loop = startLoop(this.renderer, this);
  }

  // ---------- 코트 ----------

  buildCourt(wood) {
    // 마루: 판자 1.7m 짜리 텍스처를 넓게 깐다
    const size = 40;
    for (const map of [wood.map, wood.normalMap, wood.roughnessMap]) map.repeat.set(size / 1.7, size / 1.7);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-HALF).translate(0, 0, 6),
      new THREE.MeshStandardMaterial({ ...wood, color: 0xf0d2a8, roughness: 0.55, normalScale: new THREE.Vector2(0.5, 0.5) }),
    );
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 코트 선과 페인트 존: 반 코트를 캔버스에 그려 마루 위에 얹는다
    const w = COURT_HALF_W * 2 + 1;
    const l = HALF_COURT_Z - BASELINE_Z + 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * PIXELS_PER_M);
    canvas.height = Math.round(l * PIXELS_PER_M);
    const g = canvas.getContext('2d');
    // 캔버스 (0,0) = 코트 (x=-w/2, z=BASELINE_Z-0.5). 아래로 갈수록 z 가 커진다
    const px = (x) => (x + w / 2) * PIXELS_PER_M;
    const pz = (z) => (z - BASELINE_Z + 0.5) * PIXELS_PER_M;
    const m = PIXELS_PER_M;
    g.clearRect(0, 0, canvas.width, canvas.height);
    // 페인트 존 (폭 4.9m, 자유투 라인까지)
    const ft = BASELINE_Z + 5.8;
    g.fillStyle = 'rgba(176, 52, 38, 0.82)';
    g.fillRect(px(-2.45), pz(BASELINE_Z), 4.9 * m, (ft - BASELINE_Z) * m);
    g.strokeStyle = '#f6f1e6';
    g.lineWidth = 0.05 * m;
    g.strokeRect(px(-2.45), pz(BASELINE_Z), 4.9 * m, (ft - BASELINE_Z) * m);
    // 바깥 선
    g.strokeRect(px(-COURT_HALF_W), pz(BASELINE_Z), COURT_HALF_W * 2 * m, (HALF_COURT_Z - BASELINE_Z) * m);
    // 자유투 원
    g.beginPath();
    g.arc(px(0), pz(ft), 1.8 * m, 0, Math.PI * 2);
    g.stroke();
    // 3점 선: 림 중심에서 6.75m 의 호 + 양쪽 모서리의 곧은 선 (사이드라인에서 0.9m)
    const corner = COURT_HALF_W - 0.9;
    const cornerZ = Math.sqrt(6.75 * 6.75 - corner * corner);
    g.beginPath();
    g.moveTo(px(-corner), pz(BASELINE_Z));
    g.lineTo(px(-corner), pz(cornerZ));
    g.arc(px(0), pz(0), 6.75 * m, Math.PI - Math.atan2(cornerZ, -corner) + Math.PI, Math.atan2(cornerZ, corner), true);
    g.lineTo(px(corner), pz(BASELINE_Z));
    g.stroke();
    // 제한 구역 반원
    g.beginPath();
    g.arc(px(0), pz(0), 1.25 * m, 0, Math.PI);
    g.stroke();
    // 하프 라인의 센터 서클
    g.beginPath();
    g.arc(px(0), pz(HALF_COURT_Z), 1.8 * m, Math.PI, 0);
    g.stroke();
    const lines = new THREE.CanvasTexture(canvas);
    lines.colorSpace = THREE.SRGBColorSpace;
    lines.anisotropy = 8;
    const paint = new THREE.Mesh(
      new THREE.PlaneGeometry(w, l).rotateX(-HALF).translate(0, 0.002, BASELINE_Z - 0.5 + l / 2),
      new THREE.MeshStandardMaterial({
        map: lines,
        transparent: true,
        roughness: 0.45,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    paint.receiveShadow = true;
    this.scene.add(paint);
  }

  /** 백보드·림·그물·기둥. 골대가 좌우로 움직이는 단계에서는 이 묶음이 통째로 움직인다 */
  buildHoop(model) {
    const hoop = new THREE.Group();
    this.hoop = hoop;
    this.scene.add(hoop);
    model.updateMatrixWorld(true);

    // 림: 모델의 원환을 안쪽 반지름 22.86cm, 쇠막대 굵기 RIM_TUBE 로 다듬는다
    const ring = bakedGeometry(model, 'ring');
    ring.geometry.computeBoundingBox();
    const rc = ring.geometry.boundingBox.getCenter(new THREE.Vector3());
    ring.geometry.translate(-rc.x, -rc.y, -rc.z);
    const pos = ring.geometry.attributes.position;
    let rin = Infinity;
    let rout = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      rin = Math.min(rin, r);
      rout = Math.max(rout, r);
    }
    const mid = (rin + rout) / 2;
    const halfWidth = (rout - rin) / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z) || 1;
      const nr = RIM_RADIUS + ((r - mid) / halfWidth) * RIM_TUBE;
      pos.setXYZ(i, (x / r) * nr, (pos.getY(i) / halfWidth) * RIM_TUBE, (z / r) * nr);
    }
    ring.geometry.computeVertexNormals();
    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xe0420f, metalness: 0.55, roughness: 0.35 });
    const rim = new THREE.Mesh(ring.geometry, rimMaterial);
    rim.position.y = RIM_Y;
    rim.castShadow = true;
    hoop.add(rim);

    // 그물: 위쪽을 림 안쪽에 맞추고 길이를 NET_DEPTH 로 늘인다. 흔들 때 쓰려고 원래 자리를 남겨 둔다
    const net = bakedGeometry(model, 'net');
    net.geometry.translate(-rc.x, -rc.y, -rc.z);
    net.geometry.computeBoundingBox();
    const nb = net.geometry.boundingBox;
    const np = net.geometry.attributes.position;
    let top = 0;
    for (let i = 0; i < np.count; i++) if (Math.abs(np.getY(i) - nb.max.y) < 1e-6) top = Math.max(top, Math.hypot(np.getX(i), np.getZ(i)));
    const radial = (RIM_INNER + RIM_TUBE * 0.4) / top;
    const vertical = NET_DEPTH / (nb.max.y - nb.min.y);
    for (let i = 0; i < np.count; i++) {
      np.setXYZ(i, np.getX(i) * radial, (np.getY(i) - nb.max.y) * vertical - RIM_TUBE * 0.5, np.getZ(i) * radial);
    }
    net.geometry.computeVertexNormals();
    this.netBase = Float32Array.from(np.array);
    this.netMesh = new THREE.Mesh(
      net.geometry,
      new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.9, side: THREE.DoubleSide }),
    );
    this.netMesh.position.y = RIM_Y;
    this.netMesh.castShadow = true;
    hoop.add(this.netMesh);

    // 백보드: 투명한 판 + 흰 테두리 + 림 위의 사각형
    const boardH = BOARD_TOP - BOARD_BOTTOM;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_HALF_W * 2, boardH, BOARD_THICK * 0.4),
      new THREE.MeshPhysicalMaterial({
        color: 0xdfeff7,
        roughness: 0.05,
        metalness: 0,
        transparent: true,
        opacity: 0.28,
        clearcoat: 1,
        depthWrite: false,
      }),
    );
    glass.position.set(0, BOARD_BOTTOM + boardH / 2, BOARD_Z - BOARD_THICK * 0.2);
    glass.renderOrder = 1;
    hoop.add(glass);
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.5 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.3 });
    const bar = (w, h, x, y, z = BOARD_Z + 0.001, material = white, d = 0.006) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      hoop.add(mesh);
      return mesh;
    };
    const t = 0.05;
    bar(BOARD_HALF_W * 2, t, 0, BOARD_TOP - t / 2);
    bar(BOARD_HALF_W * 2, t, 0, BOARD_BOTTOM + t / 2);
    bar(t, boardH, -BOARD_HALF_W + t / 2, BOARD_BOTTOM + boardH / 2);
    bar(t, boardH, BOARD_HALF_W - t / 2, BOARD_BOTTOM + boardH / 2);
    // 슈터 사각형: 폭 59cm, 높이 45cm, 아래 선이 림 높이
    const sq = { w: 0.59, h: 0.45, y: RIM_Y + 0.02 };
    bar(sq.w, t, 0, sq.y + sq.h - t / 2);
    bar(sq.w, t, 0, sq.y + t / 2);
    bar(t, sq.h, -sq.w / 2 + t / 2, sq.y + sq.h / 2);
    bar(t, sq.h, sq.w / 2 - t / 2, sq.y + sq.h / 2);
    // 백보드 뒤 철제 틀과 아래쪽 보호 패드
    bar(BOARD_HALF_W * 2 + 0.04, 0.06, 0, BOARD_BOTTOM - 0.03, BOARD_Z - BOARD_THICK * 0.5, new THREE.MeshStandardMaterial({ color: 0x1d3a6b, roughness: 0.8 }), BOARD_THICK + 0.04);
    bar(0.6, 0.6, 0, BOARD_BOTTOM + boardH / 2, BOARD_Z - BOARD_THICK - 0.03, frame, 0.04);
    // 림을 받치는 브래킷
    const bracket = bar(0.12, 0.05, 0, RIM_Y - 0.04, (BOARD_Z + (-RIM_RADIUS + 0.02)) / 2, rimMaterial, -BOARD_Z - RIM_RADIUS + 0.02);
    bracket.castShadow = true;

    // 기둥: 엔드 라인 뒤에 세운 받침대와 백보드로 뻗은 팔
    const padMaterial = new THREE.MeshStandardMaterial({ color: 0x1d3a6b, roughness: 0.85 });
    const poleZ = BASELINE_Z - 1.4;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.6), padMaterial);
    base.position.set(0, 0.45, poleZ - 0.4);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.6, 0.26), padMaterial);
    pole.position.set(0, 2.2, poleZ);
    const armLength = BOARD_Z - BOARD_THICK - 0.06 - poleZ;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, Math.hypot(armLength, 0.6)), frame);
    arm.position.set(0, 3.3, poleZ + armLength / 2);
    arm.rotation.x = Math.atan2(0.6, armLength);
    for (const mesh of [base, pole, arm]) {
      mesh.castShadow = mesh.receiveShadow = true;
      hoop.add(mesh);
    }
  }

  /** 공: 모델의 공을 규격 크기로 줄이고, 매끈하게 보이도록 법선을 구의 바깥 방향으로 바꾼다 */
  buildBall(model) {
    const { geometry, material } = bakedGeometry(model, 'Sphere');
    geometry.computeBoundingBox();
    const c = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-c.x, -c.y, -c.z);
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const s = (BALL_RADIUS * 2) / Math.max(size.x, size.y, size.z);
    geometry.scale(s, s, s);
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    this.ballGeometry = geometry;
    this.ballMaterial = new THREE.MeshStandardMaterial({ map: material.map, roughness: 0.78, metalness: 0 });
    if (this.ballMaterial.map) this.ballMaterial.map.colorSpace = THREE.SRGBColorSpace;
    this.hand = this.newBallMesh();
    this.hand.visible = false;
  }

  newBallMesh() {
    const mesh = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
    mesh.castShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  /** 조준 화살표: 손에 든 공에서 골대 쪽으로 뻗은 짧은 화살표 */
  buildAim() {
    const material = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false });
    // 공 위에 떠서 앞으로 뻗는다 (뒤에서 보면 공에 가려지지 않게)
    const lift = BALL_RADIUS + 0.06;
    const shaft = new THREE.CylinderGeometry(0.014, 0.014, 0.9, 8).rotateX(HALF).translate(0, lift, -0.45);
    const tip = new THREE.ConeGeometry(0.05, 0.14, 12).rotateX(-HALF).translate(0, lift, -0.95);
    this.aimArrow = new THREE.Group();
    this.aimArrow.add(new THREE.Mesh(shaft, material), new THREE.Mesh(tip, material));
    this.aimArrow.visible = false;
    this.scene.add(this.aimArrow);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff3e0, 0x5a4330, 0.55));
    // 천장 조명 쪽에서 공과 골대 그림자를 만든다
    this.sun = new THREE.DirectionalLight(0xfff4e2, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -6;
    s.right = s.top = 6;
    s.near = 1;
    s.far = 30;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
  }

  // ---------- 진행 ----------

  /** 던지는 자리를 바꾼다. cut 이면 카메라를 바로 옮긴다 */
  setStage(stage, { cut = false } = {}) {
    this.stage = stage;
    if (cut) this.cut = true;
  }

  /** 손에 공을 든다 (visible=false 면 내려놓는다) */
  showHand(visible) {
    if (!this.hand) return;
    if (visible && !this.hand.visible) this.handPop = 0;
    this.hand.visible = visible;
    if (!visible) this.setAim(null);
  }

  /** 조준 화살표의 방향 (yaw, 라디안). null 이면 감춘다 */
  setAim(yaw) {
    this.aimYaw = yaw;
  }

  /** 물리 공에 맞춰 메시를 만들고 옮긴다. 물리에서 빠진 공의 메시는 치운다 */
  syncBalls() {
    const ids = new Set();
    for (const ball of this.court?.balls ?? []) {
      ids.add(ball.id);
      let mesh = this.meshes.get(ball.id);
      if (!mesh) {
        mesh = this.newBallMesh();
        this.meshes.set(ball.id, mesh);
      }
      mesh.position.set(ball.x, ball.y, ball.z);
      mesh.quaternion.set(ball.q[0], ball.q[1], ball.q[2], ball.q[3]);
    }
    for (const [id, mesh] of this.meshes) {
      if (ids.has(id)) continue;
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
  }

  /** 공이 그물을 지나거나 림을 맞혀 그물이 흔들린다 */
  shakeNet(ball, strength) {
    const net = this.net;
    const k = clamp(strength, 0, 1.5);
    net.vx += clamp(ball.vx - (this.court?.hoop.vx ?? 0), -4, 4) * 0.5 * k;
    net.vz += clamp(ball.vz, -4, 4) * 0.5 * k;
    net.vs += 1.2 * k;
    net.ripple = Math.max(net.ripple, 0.8 * k);
  }

  // ---------- 화면 좌표 ----------

  /** 지금 자리에서 손에 든 공의 자리 */
  handPosition() {
    return releasePoint(this.stage.distance, this.stage.angle);
  }

  // ---------- 프레임 ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 세로 화면에서는 시야를 넓혀 백보드 위와 손에 든 공이 함께 들어오게 한다
    this.camera.fov = this.camera.aspect < 0.8 ? 62 : 50;
    this.camera.updateProjectionMatrix();
    this.placeCamera(1);
  }

  /** 지금 자리에 맞는 카메라 자리로 k(0~1) 만큼 다가간다 */
  placeCamera(k) {
    const { distance, angle } = this.stage;
    const back = distance + 0.4 + CAMERA_BACK;
    const target = new THREE.Vector3(Math.sin(angle) * back, CAMERA_Y, Math.cos(angle) * back);
    // 위아래로는 손에 든 공(아래)과 림(위)의 가운데를 본다
    const ballAngle = Math.atan2(RELEASE_Y - CAMERA_Y, CAMERA_BACK);
    const rimAngle = Math.atan2(RIM_Y - CAMERA_Y, back);
    const portrait = this.camera.aspect < 0.8;
    const pitch = (ballAngle + rimAngle) / 2 + (portrait ? 0.07 : 0.03);
    const look = new THREE.Vector3(0, CAMERA_Y + Math.tan(pitch) * back, 0);
    // 날아가는 공을 조금 따라본다
    const flying = this.court?.balls.find((b) => b.live && !b.result);
    if (flying) look.lerp(new THREE.Vector3(flying.x, flying.y, flying.z), 0.12);
    this.camera.position.lerp(target, k);
    this.camLook.lerp(look, k);
    this.camera.lookAt(this.camLook);
  }

  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let lively = !!this.onFrame?.(dt);
    let casters = false;

    if (this.court) {
      this.court.step(dt * this.timeScale);
      for (const event of this.court.drain()) {
        if (event.type === 'net') this.shakeNet(event.ball, event.speed / 5);
        if (event.type === 'rim') this.shakeNet(event.ball, event.speed / 12);
        this.onEvent?.(event);
      }
      if (this.court.balls.some((b) => !b.resting) || this.court.hoop.amplitude > 0) lively = casters = true;
      this.hoop.position.x = this.court.hoop.x;
    }
    this.syncBalls();
    if (this.updateNet(dt)) lively = casters = true;
    if (this.updateHand(dt)) lively = true;

    const from = this.camera.position.clone();
    const look = this.camLook.clone();
    this.placeCamera(this.cut ? 1 : damp(3, dt));
    this.cut = false;
    if (from.distanceToSquared(this.camera.position) > 1e-7 || look.distanceToSquared(this.camLook) > 1e-7) lively = true;

    // 그림자 조명은 골대와 던지는 자리 사이를 비춘다
    const focus = new THREE.Vector3(Math.sin(this.stage.angle), 0, Math.cos(this.stage.angle)).multiplyScalar(this.stage.distance * 0.45);
    this.sun.target.position.copy(focus);
    this.sun.position.set(focus.x + 2.5, 11, focus.z + 3.5);

    if (!this.loop.due(now, lively, casters)) return;
    this.renderer.render(this.scene, this.camera);
  }

  /** 손에 든 공: 처음 나타날 때 살짝 튀어 오르고, 조준 화살표를 붙인다. 움직였으면 true */
  updateHand(dt) {
    if (!this.hand?.visible) {
      this.aimArrow.visible = false;
      return false;
    }
    const p = this.handPosition();
    const popping = this.handPop < 1;
    this.handPop = Math.min(1, this.handPop + dt * 4);
    const ease = 1 - (1 - this.handPop) ** 3;
    this.hand.position.set(p.x, p.y - 0.25 * (1 - ease), p.z);
    this.hand.scale.setScalar(0.7 + 0.3 * ease);
    this.aimArrow.visible = this.aimYaw !== null;
    if (this.aimArrow.visible) {
      this.aimArrow.position.copy(this.hand.position);
      this.aimArrow.rotation.set(0, Math.atan2(p.x, p.z) - this.aimYaw, 0);
    }
    return popping;
  }

  /** 그물: 용수철처럼 흔들리다 가라앉는다. 움직였으면 true */
  updateNet(dt) {
    const net = this.net;
    const energy = Math.abs(net.sx) + Math.abs(net.sz) + Math.abs(net.vx) + Math.abs(net.vz) + Math.abs(net.stretch) + Math.abs(net.vs) + net.ripple;
    if (energy < 1e-3) {
      if (net.dirty) this.writeNet(0, 0, 0, 0);
      net.dirty = false;
      return false;
    }
    const step = (x, v, k, c) => {
      const a = -k * x - c * v;
      v += a * dt;
      return [x + v * dt, v];
    };
    [net.sx, net.vx] = step(net.sx, net.vx, 45, 3.5);
    [net.sz, net.vz] = step(net.sz, net.vz, 45, 3.5);
    [net.stretch, net.vs] = step(net.stretch, net.vs, 70, 5);
    net.ripple *= Math.exp(-2.5 * dt);
    net.phase += dt * 18;
    this.writeNet(clamp(net.sx, -0.15, 0.15), clamp(net.sz, -0.15, 0.15), clamp(net.stretch, -0.05, 0.12), net.ripple);
    net.dirty = true;
    return true;
  }

  /** 그물 정점을 옮긴다: 아래로 갈수록 크게 기울고 늘어나며, 물결이 위에서 아래로 내려간다 */
  writeNet(sx, sz, stretch, ripple) {
    const pos = this.netMesh.geometry.attributes.position;
    const base = this.netBase;
    const phase = this.net.phase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const z = base[i * 3 + 2];
      const f = clamp(-y / NET_DEPTH, 0, 1);
      const squeeze = 1 + ripple * 0.12 * Math.sin(phase - f * 7) * f;
      const bend = f * f;
      pos.setXYZ(i, x * squeeze + sx * bend, y - stretch * f, z * squeeze + sz * bend);
    }
    pos.needsUpdate = true;
  }
}
