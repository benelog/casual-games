// Three.js 볼링장 씬. 물리(physics.js)가 굴린 공과 핀의 자세를 받아 그린다.
// 길이 단위는 미터이고 좌표계는 lane.js 와 같다. 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import {
  LANE_WIDTH,
  GUTTER_WIDTH,
  HEAD_PIN_Z,
  PIT_Z,
  PIN_SPOTS,
  PIN_HEIGHT,
  PIN_COM,
  BALL_RADIUS,
  BALL_START_Z,
  predictX,
} from './lane.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { LanePhysics } from './physics.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const BOARD_TILE = LANE_WIDTH; // 텍스처 한 장(판재 약 40줄)이 레인 폭에 오게 한다 — 볼링 레인은 39장
const APPROACH = 4.6; // 파울 라인 뒤 어프로치 길이
const LANE_PITCH = LANE_WIDTH + 2 * GUTTER_WIDTH + 0.12; // 옆 레인까지의 간격
const NEIGHBORS = [-3, -2, -1, 1, 2, 3];
const PLAYER_COLORS = [0xd8362c, 0x2d6fd1];
const GUIDE_DOTS = 46;

// 핀 모델의 빨간 띠 두 줄 (높이 비율). 모델의 정점 링과 맞닿아 있다
const PIN_STRIPES = [
  [0.617, 0.679],
  [0.729, 0.784],
];

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const clampAbs = (v, max) => Math.max(-max, Math.min(max, v));

/** FBX 안의 메시 하나를 꺼내 변환을 굽고, 법선만 남긴 비인덱스 지오메트리로 만든다 */
function bakeMesh(group) {
  group.updateMatrixWorld(true);
  let mesh = null;
  group.traverse((o) => {
    if (o.isMesh && !mesh) mesh = o;
  });
  let geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  if (geometry.index) geometry = geometry.toNonIndexed();
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
  }
  return geometry;
}

/** 면마다 색을 칠한다. pick(삼각형의 세 꼭짓점) 이 돌려준 색을 그 면에 쓴다 */
function paintFaces(geometry, pick) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, i + k);
    const color = pick(v);
    for (let k = 0; k < 3; k++) color.toArray(colors, (i + k) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** 핀 모델: 바닥 가운데가 원점, 높이 PIN_HEIGHT. 원본 텍스처가 배포본에 없어 띠는 면 색으로 칠한다 */
function pinGeometry(fbx) {
  const geometry = bakeMesh(fbx);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const height = box.max.y - box.min.y;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.scale(PIN_HEIGHT / height, PIN_HEIGHT / height, PIN_HEIGHT / height);
  const white = new THREE.Color(0xf6f3ec);
  const red = new THREE.Color(0xc4161c);
  return paintFaces(geometry, (v) => {
    const h = (v[0].y + v[1].y + v[2].y) / 3 / PIN_HEIGHT;
    return PIN_STRIPES.some(([a, b]) => h > a && h < b) ? red : white;
  });
}

/** 공 모델: 중심이 원점, 반지름 BALL_RADIUS. 손가락 구멍(살짝 들어간 면)만 어둡게 칠한다 */
function ballGeometry(fbx) {
  const geometry = bakeMesh(fbx);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  const radius = (box.max.x - box.min.x) / 2;
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(BALL_RADIUS / radius, BALL_RADIUS / radius, BALL_RADIUS / radius);
  const shell = new THREE.Color(1, 1, 1);
  const hole = new THREE.Color(0.05, 0.05, 0.05);
  return paintFaces(geometry, (v) => (v.some((p) => p.length() < BALL_RADIUS * 0.99) ? hole : shell));
}

/** 판재 줄이 레인 방향(z)으로 가도록 UV 를 직접 매긴 바닥 */
function boardGeometry(width, zNear, zFar, x = 0) {
  const geometry = new THREE.PlaneGeometry(width, zNear - zFar)
    .rotateX(-Math.PI / 2)
    .translate(x, 0, (zNear + zFar) / 2);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getZ(i) / BOARD_TILE, (pos.getX(i) - x) / BOARD_TILE + 0.5);
  return geometry;
}

/** 거터: 반원통을 납작하게 눌러 레인 양옆에 붙인다 */
function gutterGeometry(x, zNear, zFar) {
  const r = GUTTER_WIDTH / 2;
  return new THREE.CylinderGeometry(r, r, zNear - zFar, 18, 1, true, -Math.PI / 2, Math.PI)
    .rotateX(Math.PI / 2)
    .scale(1, 0.06 / r, 1)
    .translate(x, 0, (zNear + zFar) / 2);
}

function loadTexture(loader, name, suffix, srgb) {
  return loader.loadAsync(asset(`textures/${name}_${suffix}_1k.jpg`)).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

export class BowlingScene {
  /** container: 캔버스를 넣을 곳, pinCamFrame: 핀 덱을 비춰 줄 작은 화면의 자리(DOM 요소) */
  constructor(container, pinCamFrame) {
    this.container = container;
    this.pinCamFrame = pinCamFrame;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d12);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 80);
    this.pinCam = new THREE.PerspectiveCamera(30, 4 / 3, 0.05, 20);
    this.pinCam.position.set(0, 1.05, HEAD_PIN_Z + 2.3);
    this.pinCam.lookAt(0, 0.12, HEAD_PIN_Z - 0.45);

    this.physics = new LanePhysics();
    this.mode = 'aim'; // aim(공을 들고 있음) · roll(굴러가는 중) · result(멈춘 뒤)
    this.ballX = 0;
    this.camLook = new THREE.Vector3();
    this.onFrame = null; // (dt) => boolean, 매 프레임 main.js 가 조준 게이지를 움직인다. 게이지가 움직이는 중이면 true 를 돌려준다
    this.onPointer = null; // (type, event) => void

    const canvas = this.renderer.domElement;
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      canvas.addEventListener(type, (e) => this.onPointer?.(type, e));
    }
    this.raycaster = new THREE.Raycaster();
    this.startPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -BALL_START_Z);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load() {
    const textures = new THREE.TextureLoader();
    // 핀·공 FBX 는 원본 텍스처 파일을 가리키지만 배포본에 들어 있지 않다. 요청을 빈 이미지로 돌려 404 를 막는다
    const manager = new THREE.LoadingManager();
    const blank = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    manager.setURLModifier((url) => (/\.(png|jpe?g)$/i.test(url) ? blank : url));
    const fbx = new FBXLoader(manager);

    const [env, laneMap, laneNormal, laneRough, pinFbx, ballFbx] = await Promise.all([
      new RGBELoader().loadAsync(asset('hdri/warm_bar_1k.hdr')),
      loadTexture(textures, 'laminate_floor', 'diff', true),
      loadTexture(textures, 'laminate_floor', 'nor_gl', false),
      loadTexture(textures, 'laminate_floor', 'rough', false),
      fbx.loadAsync(asset('models/SM_Bowling_Pin.fbx')),
      fbx.loadAsync(asset('models/SM_Bowling_Ball.fbx')),
    ]);

    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.45;

    this.buildAlley({ map: laneMap, normalMap: laneNormal, roughnessMap: laneRough });
    this.buildPins(pinGeometry(pinFbx));
    this.buildBall(ballGeometry(ballFbx));
    this.buildGuide();
    this.buildLights();

    this.rack();
    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  // ---------- 볼링장 ----------

  buildAlley(textures) {
    const wood = new THREE.MeshPhysicalMaterial({
      ...textures,
      color: 0xffffff,
      roughness: 0.6,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
    const gutterMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b9099,
      metalness: 0.6,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.7 });
    const add = (geometry, material, { receive = true, cast = false } = {}) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = receive;
      mesh.castShadow = cast;
      this.scene.add(mesh);
      return mesh;
    };

    const near = APPROACH;
    const gx = LANE_WIDTH / 2 + GUTTER_WIDTH / 2;
    for (const offset of [0, ...NEIGHBORS.map((n) => n * LANE_PITCH)]) {
      // 핏 앞까지의 레인 + 어프로치
      add(boardGeometry(LANE_WIDTH, near, PIT_Z, offset), wood);
      add(gutterGeometry(offset - gx, near, PIT_Z), gutterMaterial);
      add(gutterGeometry(offset + gx, near, PIT_Z), gutterMaterial);
      // 레인 사이 칸막이. 물리의 칸막이는 튄 핀이 넘어가지 않게 이보다 높다
      const divider = new THREE.BoxGeometry(0.06, 0.18, near - PIT_Z);
      for (const side of [-1, 1]) {
        const x = offset + side * (LANE_WIDTH / 2 + GUTTER_WIDTH + 0.03);
        add(divider.clone().translate(x, -0.01, (near + PIT_Z) / 2), dark);
      }
    }
    // 옆 레인 사이의 빈틈을 덮는 바닥과 어프로치 뒤 바닥
    const floor = add(new THREE.PlaneGeometry(40, 60).rotateX(-Math.PI / 2), dark);
    floor.position.set(0, -0.12, -10);

    // 파울 라인과 겨냥용 화살표 (5장마다, 가운데가 가장 멀다)
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0x7a1414 });
    add(new THREE.PlaneGeometry(LANE_WIDTH, 0.012).rotateX(-Math.PI / 2).translate(0, 0.001, 0), lineMaterial, {
      receive: false,
    });
    const arrow = new THREE.Shape();
    arrow.moveTo(-0.014, 0);
    arrow.lineTo(0.014, 0);
    arrow.lineTo(0, -0.16);
    const arrowGeometry = new THREE.ShapeGeometry(arrow).rotateX(-Math.PI / 2);
    const arrowMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.4 });
    const board = LANE_WIDTH / 39;
    for (let i = -3; i <= 3; i++) {
      const mesh = add(arrowGeometry, arrowMaterial);
      mesh.position.set(i * 5 * board, 0.001, -4.3 - (3 - Math.abs(i)) * 0.11);
    }

    // 핏과 그 뒤 벽, 핀 덱 위를 가리는 마스킹 패널
    const pit = add(new THREE.BoxGeometry(LANE_PITCH * 7, 0.1, 1.4), dark);
    pit.position.set(0, -0.4, PIT_Z - 0.7);
    const back = add(new THREE.PlaneGeometry(LANE_PITCH * 9, 4), dark);
    back.position.set(0, 1.2, PIT_Z - 1.15);
    const hoodMaterial = new THREE.MeshStandardMaterial({ color: 0x141a2c, roughness: 0.6 });
    const hood = add(new THREE.BoxGeometry(LANE_PITCH * 9, 1.6, 0.2), hoodMaterial);
    hood.position.set(0, 0.95 + 0.8, HEAD_PIN_Z + 0.35);
    // 마스킹 패널 아래 가장자리의 조명 띠
    const glow = new THREE.MeshBasicMaterial({ color: 0x5f86ff });
    const strip = add(new THREE.BoxGeometry(LANE_PITCH * 9, 0.025, 0.02), glow, { receive: false });
    strip.position.set(0, 0.96, HEAD_PIN_Z + 0.46);
  }

  buildPins(geometry) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28 });
    // 물리 바디의 원점은 무게중심이므로, 메시를 그만큼 내려 그룹에 넣는다
    this.pins = PIN_SPOTS.map(() => {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = -PIN_COM;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      this.scene.add(group);
      return group;
    });
    // 옆 레인은 장식으로 핀만 세워 둔다
    const decor = new THREE.InstancedMesh(geometry, material, NEIGHBORS.length * PIN_SPOTS.length);
    const m = new THREE.Matrix4();
    let i = 0;
    for (const n of NEIGHBORS) {
      for (const spot of PIN_SPOTS) decor.setMatrixAt(i++, m.makeTranslation(spot.x + n * LANE_PITCH, 0, spot.z));
    }
    this.scene.add(decor);
  }

  buildBall(geometry) {
    this.ballMaterials = PLAYER_COLORS.map(
      (color) => new THREE.MeshPhysicalMaterial({ color, vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),
    );
    this.ball = new THREE.Mesh(geometry, this.ballMaterials[0]);
    this.ball.castShadow = true;
    this.scene.add(this.ball);
  }

  /** 조준선: 레인 위에 점을 찍어 공이 굴러갈 길을 보여 준다 (먼 곳일수록 흐리게) */
  buildGuide() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.guide = new THREE.InstancedMesh(new THREE.CircleGeometry(0.022, 14).rotateX(-Math.PI / 2), material, GUIDE_DOTS);
    const color = new THREE.Color();
    for (let i = 0; i < GUIDE_DOTS; i++) {
      color.setRGB(1, 0.85, 0.4).multiplyScalar(0.9 * (1 - i / GUIDE_DOTS) + 0.1);
      this.guide.setColorAt(i, color);
    }
    this.guide.frustumCulled = false;
    this.guide.visible = false;
    this.scene.add(this.guide);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x202330, 0.6));

    // 핀 덱을 밝게 비추는 조명. 실제 볼링장처럼 마스킹 패널 바로 아래에 숨겨 두고 핀 그림자를 만든다
    const deck = new THREE.SpotLight(0xffffff, 14, 5, 0.9, 0.6, 1.2);
    deck.position.set(0, 0.9, HEAD_PIN_Z + 0.75);
    deck.target.position.set(0, 0, HEAD_PIN_Z - 0.5);
    deck.castShadow = true;
    deck.shadow.mapSize.set(1024, 1024);
    deck.shadow.bias = -0.0004;
    this.scene.add(deck, deck.target);

    // 공을 따라다니며 공 그림자를 만드는 조명
    this.sun = new THREE.DirectionalLight(0xfff0dc, 1.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -1.2;
    s.right = s.top = 1.2;
    s.near = 0.1;
    s.far = 8;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
  }

  // ---------- 진행 ----------

  /** 서 있는 핀 번호 목록 */
  standing() {
    return this.physics.standing();
  }

  /** 핀 10개를 새로 세운다 */
  rack() {
    this.physics.rack();
    this.afterReset();
  }

  /** 쓰러진 핀을 치우고 서 있는 핀만 남긴다 */
  sweep() {
    this.physics.sweep();
    this.afterReset();
  }

  afterReset() {
    this.mode = 'aim';
    this.syncPins();
    this.placeBall(this.player ?? 0, this.ballX);
    // 핀 덱에서 파울 라인까지 20m 를 날아오지 않고 바로 장면을 바꾼다
    this.placeCamera(1);
  }

  /** 공을 들고 출발 위치에 선다 */
  placeBall(player, x) {
    this.player = player;
    this.ballX = x;
    this.ball.material = this.ballMaterials[player];
    this.ball.visible = true;
    this.ball.position.set(x, BALL_RADIUS, BALL_START_Z);
    this.ball.quaternion.identity();
  }

  /** 조준선을 보여 준다. shot = { startX, angle, speed, spin } 또는 null */
  setGuide(shot) {
    this.guide.visible = !!shot;
    if (!shot) return;
    const m = new THREE.Matrix4();
    const zFrom = BALL_START_Z - 0.35;
    const zTo = HEAD_PIN_Z + 0.25;
    for (let i = 0; i < GUIDE_DOTS; i++) {
      const z = zFrom + ((zTo - zFrom) * i) / (GUIDE_DOTS - 1);
      m.makeTranslation(predictX(shot, z), 0.003, z);
      this.guide.setMatrixAt(i, m);
    }
    this.guide.instanceMatrix.needsUpdate = true;
  }

  /** 공을 굴리고, 핀이 다 멈추면 { standing, gutter } 로 끝난다 */
  roll(player, shot) {
    this.placeBall(player, shot.startX);
    this.setGuide(null);
    this.physics.launch(shot);
    this.mode = 'roll';
    return new Promise((resolve) => {
      this.rollDone = resolve;
    });
  }

  /** 포인터가 가리키는 출발선 위의 x */
  laneX(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.startPlane, new THREE.Vector3());
    return hit ? hit.x : this.ballX;
  }

  // ---------- 프레임 ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 세로 화면에서는 시야를 넓혀 레인 폭이 잘리지 않게 한다
    this.camera.fov = this.camera.aspect < 1 ? 58 : 42;
    this.camera.updateProjectionMatrix();
    this.placeCamera(1);
  }

  /** 지금 상태에 맞는 카메라 자리로 k(0~1) 만큼 다가간다 */
  placeCamera(k) {
    const portrait = this.camera.aspect < 1;
    const target = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (this.mode === 'aim') {
      // 공이 아래쪽 조작부에 가리지 않도록 조금 높은 곳에서 내려다본다
      target.set(this.ballX * 0.35, portrait ? 1.7 : 1.5, portrait ? 3.6 : 3.2);
      look.set(this.ballX * 0.2, 0, portrait ? -7 : -6);
    } else {
      // 공을 뒤따라가다가 핀 덱 앞에서 멈춘다. 핀 덱에 가까워지면 레인 가운데로 돌아온다
      const b = this.ball.position;
      const z = Math.max(b.z + 2.6, HEAD_PIN_Z + 3.2);
      const x = this.ball.visible && b.z > HEAD_PIN_Z + 4 ? clampAbs(b.x * 0.5, 0.3) : 0;
      target.set(x, portrait ? 1.0 : 0.85, z);
      look.set(x * 0.5, 0.15, Math.min(z - 7, HEAD_PIN_Z - 0.4));
    }
    this.camera.position.lerp(target, k);
    this.camLook.lerp(look, k);
    this.camera.lookAt(this.camLook);
  }

  syncPins() {
    this.physics.pins.forEach((body, i) => {
      const pose = this.physics.pinPose(i);
      const pin = this.pins[i];
      pin.visible = !!pose;
      if (pose) {
        pin.position.copy(pose.position);
        pin.quaternion.copy(pose.quaternion);
      }
    });
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const rolling = this.mode === 'roll';
    let lively = !!this.onFrame?.(dt) || rolling;

    if (this.mode === 'roll') {
      this.physics.step(dt);
      this.syncPins();
      const ball = this.physics.ball;
      this.ball.visible = this.physics.ballInPlay;
      this.ball.position.copy(ball.position);
      this.ball.quaternion.copy(ball.quaternion);
      if (this.physics.finished) {
        this.mode = 'result';
        this.rollDone?.({ standing: this.physics.standing(), gutter: this.physics.rolling.gutter });
      }
    }

    const from = this.camera.position.clone();
    this.placeCamera(damp(this.mode === 'aim' ? 6 : 4, dt));
    if (from.distanceToSquared(this.camera.position) > 1e-8) lively = true;
    const focus = this.ball.position;
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.position.set(focus.x + 1.2, 4, focus.z + 1.5);

    // 조준 게이지가 움직이는 동안에도 그림자는 그대로다
    if (!this.loop.due(now, lively, rolling)) return;
    this.renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
    this.renderer.render(this.scene, this.camera);
    this.renderPinCam();
  }

  /** 조준하는 동안 화면 구석의 작은 창에 핀 덱을 비춘다. 창의 자리와 크기는 CSS 가 정한다 */
  renderPinCam() {
    const frame = this.pinCamFrame;
    if (!frame || frame.hidden || frame.offsetParent === null) return;
    const rect = frame.getBoundingClientRect();
    const canvas = this.renderer.domElement.getBoundingClientRect();
    const x = rect.left - canvas.left;
    const y = canvas.bottom - rect.bottom;
    if (rect.width < 2 || rect.height < 2) return;
    this.pinCam.aspect = rect.width / rect.height;
    this.pinCam.updateProjectionMatrix();
    const r = this.renderer;
    r.setScissorTest(true);
    r.setScissor(x, y, rect.width, rect.height);
    r.setViewport(x, y, rect.width, rect.height);
    r.render(this.scene, this.pinCam);
    r.setScissorTest(false);
  }
}
