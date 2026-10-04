// Three.js 컬링장 씬. 물리(physics.js)의 시트 위 스톤 자리를 받아 그린다.
// 길이 단위는 미터이고 좌표계는 physics.js 와 같다 (버튼이 원점, 던지는 사람 쪽이 +z).
// 화면 구석의 작은 창에는 하우스를 위에서 내려다본 모습을 함께 그린다.
// 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import {
  STONE_RADIUS,
  RING_RADII,
  HALF_WIDTH,
  HOG_Z,
  BACK_Z,
  HACK_Z,
  NEAR_HOG_Z,
  NEAR_TEE_Z,
  RELEASE_Z,
  END_Z,
  clamp,
} from './physics.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

export const TEAM_COLORS = [0xd8362c, 0xf2c230]; // 손잡이 색. style.css 의 --p0, --p1 과 같다
export const TIME_SCALE = 2.6; // 실제 시간보다 이만큼 빠르게 보여 준다 (드로 한 번이 약 11초)

const STONE_HEIGHT = 0.114;
const SHEET_PITCH = HALF_WIDTH * 2 + 0.3; // 옆 시트까지의 간격
const NEIGHBORS = [-2, -1, 1, 2];
const FAR_END = HACK_Z - 1.0; // 먼 쪽 보드
const GUIDE_DOTS = 40;
const HALF = Math.PI / 2;
const INSET_LAYER = 1;
// 하우스 창이 보여 주는 범위: 백 보드에서 호그 라인 조금 앞까지
const INSET_Z = [HACK_Z + 0.4, HOG_Z + 0.9];

/** 스톤의 옆모습 (반지름, 높이). 아래가 좁고 가운데 띠가 가장 넓은 화강암 몸통 */
const STONE_PROFILE = [
  [0, 0.004],
  [0.062, 0.004],
  [0.066, 0],
  [0.075, 0],
  [0.1, 0.012],
  [0.128, 0.028],
  [0.141, 0.045],
  [0.145, 0.057],
  [0.141, 0.07],
  [0.128, 0.088],
  [0.104, 0.103],
  [0.075, 0.111],
  [0, 0.114],
];

function loadTexture(loader, path, { srgb = false, repeat = 1 } = {}) {
  return loader.loadAsync(asset(path)).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

/** 바닥에 눕힌 직사각형 (선·얼음) */
const flat = (w, l, x, z, y = 0) => new THREE.PlaneGeometry(w, l).rotateX(-HALF).translate(x, y, z);
const flatRing = (inner, outer, x, z, y) =>
  new THREE.RingGeometry(inner, outer, 96, 1).rotateX(-HALF).translate(x, y, z);

export class CurlingScene {
  /** container: 캔버스를 넣을 곳, insetFrame: 하우스를 내려다볼 작은 화면의 자리(DOM 요소) */
  constructor(container, insetFrame) {
    this.container = container;
    this.insetFrame = insetFrame;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 120);
    this.insetCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    this.insetCam.up.set(0, 0, -1); // 하우스 쪽이 위로 오게
    this.insetCam.layers.enable(INSET_LAYER); // 하우스 창에서만 보이는 스톤 표시도 그린다
    this.insetCam.position.set(0, 10, (INSET_Z[0] + INSET_Z[1]) / 2);
    this.insetCam.lookAt(0, 0, (INSET_Z[0] + INSET_Z[1]) / 2);

    this.mode = 'overview'; // overview(메뉴) · aim(조준) · run(스톤이 가는 중) · house(멈춘 뒤 하우스 보기)
    this.sheet = null;
    this.meshes = new Map(); // 스톤 id → 그룹
    this.fading = new Map(); // 빠진 스톤 id → 남은 시간
    this.sweep = 0; // 지금 쓰는 세기 (main.js 가 정한다)
    this.timeScale = TIME_SCALE; // ?debug 에서 시험할 때 더 빠르게 돌릴 수 있다
    this.sweepPhase = 0;
    this.broom = null; // 스킵 브룸 x (없으면 null)
    this.aimTeam = 0;
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.onFrame = null; // (dt) => boolean, 매 프레임 main.js 가 조준 게이지·스위핑을 처리한다. 움직이는 것이 있으면 true
    this.onEvent = null; // (event) => void, 물리에서 일어난 일 (부딪힘·아웃·멈춤)
    this.onPointer = null; // (type, event) => void

    const canvas = this.renderer.domElement;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      canvas.addEventListener(type, (e) => this.onPointer?.(type, e));
    }
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load() {
    const textures = new THREE.TextureLoader();
    const [env, iceNormal, iceRough, graniteMap, graniteNormal, graniteRough] = await Promise.all([
      new RGBELoader().loadAsync(asset('hdri/events_hall_interior_1k.hdr')),
      loadTexture(textures, 'textures/snow014_normal_gl_1k.jpg'),
      loadTexture(textures, 'textures/snow014_rough_1k.jpg'),
      loadTexture(textures, 'textures/granite002a_color_512.jpg', { srgb: true }),
      loadTexture(textures, 'textures/granite002a_normal_gl_512.jpg'),
      loadTexture(textures, 'textures/granite002a_rough_512.jpg'),
    ]);

    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    // 경기장 분위기만 나도록 흐리고 어둡게 배경에 깐다
    this.scene.background = env;
    this.scene.backgroundBlurriness = 0.35;
    this.scene.backgroundIntensity = 0.28;

    this.buildArena({ normalMap: iceNormal, roughnessMap: iceRough });
    this.buildStoneParts({ map: graniteMap, normalMap: graniteNormal, roughnessMap: graniteRough });
    this.buildMarkers();
    this.buildLights();

    this.last = performance.now();
    this.placeCamera(1);
    this.loop = startLoop(this.renderer, this);
  }

  // ---------- 경기장 ----------

  buildArena(iceTextures) {
    // 얼음: 흰 바탕에 페블(작은 물방울 얼음)이 살짝 비치도록 눈 텍스처의 노멀·러프니스를 약하게 쓴다
    const tile = 1.6; // 텍스처 한 장이 덮는 길이 (m)
    const ice = new THREE.MeshPhysicalMaterial({
      ...iceTextures,
      color: 0xf2f6fa,
      roughness: 0.42,
      normalScale: new THREE.Vector2(0.18, 0.18),
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
    });
    const length = END_Z - FAR_END;
    for (const map of [iceTextures.normalMap, iceTextures.roughnessMap]) map.repeat.set((HALF_WIDTH * 2) / tile, length / tile);

    const add = (geometry, material, { receive = true, cast = false } = {}) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = receive;
      mesh.castShadow = cast;
      this.scene.add(mesh);
      return mesh;
    };
    const paint = (color, opacity = 0.92) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
    const blue = paint(0x1f5fbf);
    const red = paint(0xc8242b);
    const line = paint(0x1b2433, 0.85);
    const hog = paint(0xc8242b, 0.9);
    const bumper = new THREE.MeshStandardMaterial({ color: 0x24324a, roughness: 0.6 });
    const board = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.7 });
    const hack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

    for (const offset of [0, ...NEIGHBORS.map((n) => n * SHEET_PITCH)]) {
      add(flat(HALF_WIDTH * 2, length, offset, (FAR_END + END_Z) / 2), ice);
      // 양쪽 하우스 (먼 쪽이 과녁, 가까운 쪽은 출발하는 쪽 장식)
      for (const tee of [0, NEAR_TEE_Z]) {
        add(flatRing(RING_RADII[1], RING_RADII[0], offset, tee, 0.002), blue);
        add(flatRing(RING_RADII[3], RING_RADII[2], offset, tee, 0.002), red);
      }
      // 선: 티 라인, 백 라인, 호그 라인, 가운데 선, 핵 라인
      const y = 0.003;
      for (const z of [0, NEAR_TEE_Z]) add(flat(HALF_WIDTH * 2, 0.016, offset, z, y), line);
      for (const z of [BACK_Z, NEAR_TEE_Z - BACK_Z]) add(flat(HALF_WIDTH * 2, 0.016, offset, z, y), line);
      for (const z of [HOG_Z, NEAR_HOG_Z]) add(flat(HALF_WIDTH * 2, 0.1, offset, z, y), hog);
      for (const z of [HACK_Z, NEAR_TEE_Z - HACK_Z]) add(flat(0.46, 0.016, offset, z, y), line);
      add(flat(0.016, NEAR_TEE_Z - 2 * HACK_Z, offset, NEAR_TEE_Z / 2, y), line);
      // 핵(발 받침) 고무
      for (const z of [HACK_Z, NEAR_TEE_Z - HACK_Z]) {
        for (const side of [-1, 1]) {
          const mesh = add(new THREE.BoxGeometry(0.1, 0.03, 0.2), hack, { cast: true });
          mesh.position.set(offset + side * 0.08, 0.015, z + (z < 0 ? -0.08 : 0.08));
        }
      }
      // 시트 사이의 고무 범퍼
      for (const side of [-1, 1]) {
        const bump = add(new THREE.BoxGeometry(0.1, 0.09, length), bumper, { cast: true });
        bump.position.set(offset + side * (HALF_WIDTH + 0.05), 0.045, (FAR_END + END_Z) / 2);
      }
    }
    // 시트 끝의 보드와 바닥, 먼 벽
    const width = SHEET_PITCH * (NEIGHBORS.length + 1) + 6;
    const farBoard = add(new THREE.BoxGeometry(width, 0.5, 0.12), board, { cast: true });
    farBoard.position.set(0, 0.25, FAR_END - 0.06);
    const floor = add(new THREE.PlaneGeometry(width + 20, 120).rotateX(-HALF), new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.9 }));
    floor.position.set(0, -0.01, 20);
    const wall = add(new THREE.PlaneGeometry(width + 20, 9), new THREE.MeshStandardMaterial({ color: 0x2a3446, roughness: 0.8 }));
    wall.position.set(0, 4.5, FAR_END - 4);
    // 벽의 광고판 자리 같은 밝은 띠
    const band = add(new THREE.PlaneGeometry(width + 20, 0.7), new THREE.MeshBasicMaterial({ color: 0x3b6fb6 }), { receive: false });
    band.position.set(0, 1.2, FAR_END - 3.98);
  }

  /** 스톤 몸통·손잡이 도형과 재질. 스톤은 meshFor 로 하나씩 만든다 */
  buildStoneParts(graniteTextures) {
    const profile = STONE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
    this.stoneGeometry = new THREE.LatheGeometry(profile, 40);
    this.stoneMaterial = new THREE.MeshPhysicalMaterial({
      ...graniteTextures,
      color: 0xb8bcc2,
      roughness: 0.55,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25,
    });
    // 손잡이: 윗면의 둥근 받침 + 뒤쪽 기둥 + 앞으로 뻗은 손잡이 막대
    const cap = new THREE.CylinderGeometry(0.058, 0.064, 0.014, 32).translate(0, STONE_HEIGHT + 0.004, 0);
    const post = new THREE.BoxGeometry(0.034, 0.05, 0.04).translate(0, STONE_HEIGHT + 0.03, 0.045);
    const grip = new THREE.CapsuleGeometry(0.017, 0.12, 4, 12).rotateX(HALF).translate(0, STONE_HEIGHT + 0.058, -0.005);
    const ring = new THREE.TorusGeometry(STONE_RADIUS * 1.32, 0.012, 8, 48).rotateX(HALF).translate(0, 0.006, 0);
    this.handleParts = [cap, post, grip];
    this.handleMaterials = TEAM_COLORS.map(
      (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
    );
    this.badgeGeometry = new THREE.CircleGeometry(STONE_RADIUS * 1.25, 24).rotateX(-HALF).translate(0, 0.2, 0);
    this.badgeMaterials = TEAM_COLORS.map((color) => new THREE.MeshBasicMaterial({ color }));
    // 점수가 되는 스톤 밑에 까는 빛나는 테
    this.countRing = ring;
    this.countMaterials = TEAM_COLORS.map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  }

  meshFor(stone) {
    let group = this.meshes.get(stone.id);
    if (group) return group;
    group = new THREE.Group();
    const body = new THREE.Mesh(this.stoneGeometry, this.stoneMaterial);
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    const material = this.handleMaterials[stone.team].clone(); // 빠질 때 따로 흐려지도록
    for (const part of this.handleParts) {
      const mesh = new THREE.Mesh(part, material);
      mesh.castShadow = true;
      group.add(mesh);
    }
    // 하우스 창은 멀리서 내려다봐 스톤이 작으니, 그 창에만 보이는 팀 색 원판을 위에 얹는다
    const badge = new THREE.Mesh(this.badgeGeometry, this.badgeMaterials[stone.team]);
    badge.layers.set(INSET_LAYER);
    group.add(badge);
    const count = new THREE.Mesh(this.countRing, this.countMaterials[stone.team]);
    count.visible = false;
    count.name = 'count';
    group.add(count);
    group.userData.handle = material;
    this.scene.add(group);
    this.meshes.set(stone.id, group);
    return group;
  }

  buildMarkers() {
    // 스킵이 대 주는 브룸: 티 라인 위의 기둥과 얼음 위 고리
    const broom = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 1.3, 10).translate(0, 0.65, 0),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.5 }),
    );
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.05, 0.09).translate(0, 0.025, 0),
      new THREE.MeshStandardMaterial({ color: 0x20252e, roughness: 0.9 }),
    );
    this.broomRing = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 40).rotateX(-HALF),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.broomRing.position.y = 0.006;
    pole.castShadow = head.castShadow = true;
    broom.add(pole, head, this.broomRing);
    broom.visible = false;
    this.broomMarker = broom;
    this.scene.add(broom);

    // 조준선: 놓는 자리에서 브룸까지 곧게 찍는 점 (실제로는 회전 방향으로 휜다)
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    this.guide = new THREE.InstancedMesh(new THREE.CircleGeometry(0.035, 12).rotateX(-HALF), material, GUIDE_DOTS);
    const color = new THREE.Color();
    for (let i = 0; i < GUIDE_DOTS; i++) {
      color.setRGB(1, 0.88, 0.5).multiplyScalar(0.95 - (0.75 * i) / GUIDE_DOTS);
      this.guide.setColorAt(i, color);
    }
    this.guide.frustumCulled = false;
    this.guide.visible = false;
    this.scene.add(this.guide);

    // 회전 방향 화살표: 놓을 스톤 위에 떠 있는 반원 화살표
    const arc = new THREE.TorusGeometry(0.2, 0.014, 6, 32, Math.PI * 1.2).rotateX(HALF);
    // 화살촉은 호의 시작(+x 쪽)에서 먼 쪽(-z)을 향한다: 오른쪽이 앞으로 나가니 위에서 보면 반시계 방향
    const tip = new THREE.ConeGeometry(0.04, 0.09, 12).rotateX(-HALF).translate(0.2, 0, 0);
    this.spinArrow = new THREE.Group();
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffe08a });
    this.spinArrow.add(new THREE.Mesh(arc, arrowMaterial), new THREE.Mesh(tip, arrowMaterial));
    this.spinArrow.visible = false;
    this.scene.add(this.spinArrow);
    this.spin = 1;

    // 스위퍼의 브러시 두 개
    const brushHead = new THREE.BoxGeometry(0.24, 0.035, 0.075).translate(0, 0.018, 0);
    // 막대는 스위퍼가 서 있는 옆쪽(-x)으로 기운다. 오른쪽 브러시는 좌우를 뒤집어 쓴다
    const brushPole = new THREE.CylinderGeometry(0.014, 0.014, 1.0, 8).translate(0, 0.5, 0).rotateZ(0.7);
    const padMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.9 });
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.35 });
    this.brushes = [0, 1].map((i) => {
      const group = new THREE.Group();
      const pad = new THREE.Mesh(brushHead, padMaterial);
      const stick = new THREE.Mesh(brushPole, poleMaterial);
      stick.scale.x = i === 0 ? 1 : -1;
      pad.castShadow = stick.castShadow = true;
      group.add(pad, stick);
      group.visible = false;
      this.scene.add(group);
      return group;
    });
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xeef4ff, 0x30343c, 0.7));
    // 움직이는 스톤 둘레에 그림자를 만드는 조명 (천장 조명 쪽)
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -3.2;
    s.right = s.top = 3.2;
    s.near = 0.5;
    s.far = 16;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.01;
    this.scene.add(this.sun, this.sun.target);
  }

  // ---------- 진행 ----------

  /** 시트의 스톤을 화면에 맞춘다. 시트가 바뀌면(새 엔드) 예전 스톤을 치운다 */
  setSheet(sheet) {
    this.sheet = sheet;
    const ids = new Set(sheet.stones.map((s) => s.id));
    for (const [id, group] of this.meshes) {
      if (id !== 'aim' && !ids.has(id)) this.dropMesh(id, group);
    }
    this.fading.clear();
    this.syncStones();
  }

  dropMesh(id, group) {
    this.scene.remove(group);
    group.userData.handle.dispose();
    this.meshes.delete(id);
  }

  syncStones() {
    if (!this.sheet) return;
    for (const stone of this.sheet.stones) {
      const group = this.meshFor(stone);
      if (!stone.inPlay && !this.fading.has(stone.id)) {
        if (group.visible) this.fading.set(stone.id, 0.6);
        continue;
      }
      group.position.set(stone.x, 0, stone.z);
      group.rotation.y = stone.angle;
    }
  }

  /** 점수가 되는 스톤 밑에 테를 깐다 (빈 목록이면 지운다) */
  setCounting(stones) {
    const ids = new Set(stones.map((s) => s.id));
    for (const [id, group] of this.meshes) group.getObjectByName('count').visible = ids.has(id);
  }

  /** 조준 중: team 의 스톤을 놓는 자리에 두고 브룸·조준선·회전 화살표를 보인다 */
  aim(team, broom, spin) {
    this.mode = 'aim';
    this.aimTeam = team;
    if (!this.aimStone) this.aimStone = { id: 'aim', team, x: 0, z: RELEASE_Z, angle: 0 };
    if (this.aimStone.team !== team) {
      const old = this.meshes.get('aim');
      if (old) this.dropMesh('aim', old);
      this.aimStone.team = team;
    }
    const group = this.meshFor(this.aimStone);
    group.visible = true;
    group.position.set(0, 0, RELEASE_Z);
    group.rotation.y = 0;
    this.setBroom(broom, spin);
  }

  /** 브룸 자리와 회전 방향. broom 이 null 이면 감춘다 */
  setBroom(broom, spin = this.spin) {
    this.broom = broom;
    this.spin = spin;
    const visible = broom !== null;
    this.broomMarker.visible = this.guide.visible = this.spinArrow.visible = visible;
    if (!visible) return;
    this.broomMarker.position.set(broom, 0, 0);
    const m = new THREE.Matrix4();
    const zFrom = RELEASE_Z - 0.5;
    const zTo = 0.4;
    for (let i = 0; i < GUIDE_DOTS; i++) {
      const z = zFrom + ((zTo - zFrom) * i) / (GUIDE_DOTS - 1);
      m.makeTranslation((broom * (RELEASE_Z - z)) / RELEASE_Z, 0.004, z);
      this.guide.setMatrixAt(i, m);
    }
    this.guide.instanceMatrix.needsUpdate = true;
    // 화살표: 시계 방향(+1)이면 위에서 볼 때 시계 방향으로 돈다
    this.spinArrow.position.set(0, STONE_HEIGHT + 0.12, RELEASE_Z);
    this.spinArrow.scale.set(spin > 0 ? -1 : 1, 1, 1);
  }

  /** 시트에서 방금 던진 스톤을 굴린다. 모두 멈추면 끝난다 */
  run(sheet) {
    const aim = this.meshes.get('aim');
    if (aim) aim.visible = false;
    this.setBroom(null);
    this.sheet = sheet;
    this.sweep = 0;
    this.mode = 'run';
    this.cut = true; // 하우스 쪽 조준 화면에서 스톤 뒤로 장면을 바로 바꾼다
    this.syncStones();
    return new Promise((resolve) => {
      this.runDone = resolve;
    });
  }

  /** 하우스를 내려다보는 자리로 (엔드가 끝났을 때, 메뉴) */
  showHouse(mode = 'house') {
    this.mode = mode;
    this.setBroom(null);
    const aim = this.meshes.get('aim');
    if (aim) aim.visible = false;
    for (const brush of this.brushes) brush.visible = false;
  }

  /** 포인터가 가리키는 얼음 위의 점 (못 찾으면 null) */
  groundPoint(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    return hit && hit.z < RELEASE_Z - 1 ? { x: hit.x, z: hit.z } : null;
  }

  /** 하우스 창 안의 점 (clientX, clientY) 이 가리키는 얼음 위의 점 */
  insetPoint(clientX, clientY) {
    const rect = this.insetFrame.getBoundingClientRect();
    const u = (clientX - rect.left) / rect.width - 0.5;
    const v = (clientY - rect.top) / rect.height - 0.5;
    const c = this.insetCam;
    return { x: u * (c.right - c.left), z: (INSET_Z[0] + INSET_Z[1]) / 2 + v * (c.top - c.bottom) };
  }

  // ---------- 프레임 ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 세로 화면에서는 시야를 넓혀 시트 폭이 잘리지 않게 한다
    this.camera.fov = this.camera.aspect < 1 ? 46 : 34;
    this.camera.updateProjectionMatrix();
    this.placeCamera(1);
  }

  /** 지금 상태에 맞는 카메라 자리로 k(0~1) 만큼 다가간다 */
  placeCamera(k) {
    const portrait = this.camera.aspect < 1;
    const target = new THREE.Vector3();
    const look = new THREE.Vector3();
    // 하우스를 위에서 비스듬히 내려다보는 자리
    const housePos = new THREE.Vector3(0, portrait ? 7.8 : 5.6, portrait ? 6.6 : 6.2);
    const houseLook = new THREE.Vector3(0, 0, portrait ? 0.4 : 0.1);
    if (this.mode === 'aim') {
      // 조준할 때는 하우스 쪽을 크게 본다 (34m 떨어진 하우스는 뒤에서 보면 너무 작다). 조준선이 아래에서 올라온다
      const b = this.broom ?? 0;
      target.set(b * 0.08, portrait ? 7.4 : 6, portrait ? 14.5 : 13.5);
      look.set(b * 0.3, 0, portrait ? 2.2 : 1.2);
    } else if (this.mode === 'run' && this.sheet?.shooter) {
      // 던진 스톤을 뒤따라가다가 하우스에 가까워지면 하우스를 내려다보는 자리로 옮겨 간다
      const s = this.sheet.shooter;
      const follow = new THREE.Vector3(s.x * 0.5, 1.9, s.z + 5.5);
      const followLook = new THREE.Vector3(s.x * 0.6, 0, s.z - 9);
      const blend = clamp((15 - s.z) / 9, 0, 1);
      target.lerpVectors(follow, housePos, blend);
      look.lerpVectors(followLook, houseLook, blend);
    } else if (this.mode === 'overview') {
      target.set(0, portrait ? 9 : 6.5, portrait ? 9.5 : 9);
      look.set(0, 0, portrait ? 1.5 : 1);
    } else {
      target.copy(housePos);
      look.copy(houseLook);
    }
    this.camera.position.lerp(target, k);
    this.camLook.lerp(look, k);
    this.camera.lookAt(this.camLook);
  }

  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let lively = !!this.onFrame?.(dt);
    const running = this.mode === 'run' && this.sheet;
    let casters = running;

    if (running) {
      this.sheet.sweeping = this.sheet.shooter?.moving ? this.sweep : 0;
      this.sheet.step(dt * this.timeScale);
      for (const event of this.sheet.drain()) {
        this.onEvent?.(event);
        if (event.type === 'stop') {
          this.mode = 'house';
          this.runDone?.();
        }
      }
      this.syncStones();
      lively = true;
    }
    if (this.updateBrushes(dt)) lively = casters = true;
    if (this.fadeStones(dt)) lively = true;

    const from = this.camera.position.clone();
    this.placeCamera(this.cut ? 1 : damp(this.mode === 'run' ? 5 : 3.5, dt));
    this.cut = false;
    if (from.distanceToSquared(this.camera.position) > 1e-7) lively = true;

    // 그림자 조명은 지금 보는 곳을 따라간다
    const focus = this.mode === 'run' && this.sheet?.shooter ? this.sheet.shooter : this.mode === 'aim' ? { x: 0, z: RELEASE_Z } : { x: 0, z: 0.5 };
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.position.set(focus.x + 1.5, 7, focus.z + 2);

    if (!this.loop.due(now, lively, casters)) return;
    this.renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
    this.renderer.render(this.scene, this.camera);
    this.renderInset();
  }

  /** 던진 스톤 앞에서 쓰는 브러시. 쓰는 중이면 좌우로 빠르게 움직인다. 움직였으면 true */
  updateBrushes(dt) {
    const s = this.mode === 'run' ? this.sheet?.shooter : null;
    const show = !!s && s.inPlay && s.moving;
    for (const brush of this.brushes) brush.visible = show;
    if (!show) return false;
    this.sweepPhase += dt * (this.sweep > 0 ? 14 : 0);
    const speed = Math.hypot(s.vx, s.vz) || 1;
    const dx = s.vx / speed;
    const dz = s.vz / speed;
    const heading = Math.atan2(-dx, -dz);
    this.brushes.forEach((brush, i) => {
      const side = i === 0 ? -1 : 1;
      const wobble = this.sweep > 0 ? Math.sin(this.sweepPhase + i * Math.PI) * 0.1 : 0;
      const ahead = 0.42 + i * 0.22;
      brush.position.set(s.x + dx * ahead - dz * (side * 0.1 + wobble), this.sweep > 0 ? 0 : 0.06, s.z + dz * ahead + dx * (side * 0.1 + wobble));
      brush.rotation.set(0, heading, 0);
    });
    return true;
  }

  /** 빠진 스톤을 흐리게 하다가 감춘다. 흐려지는 중이면 true */
  fadeStones(dt) {
    if (!this.fading.size) return false;
    for (const [id, left] of this.fading) {
      const group = this.meshes.get(id);
      const next = left - dt;
      if (!group || next <= 0) {
        if (group) group.visible = false;
        this.fading.set(id, 0);
        continue;
      }
      this.fading.set(id, next);
      group.position.y = -0.02 * (1 - next / 0.6);
      group.scale.setScalar(0.6 + (0.4 * next) / 0.6);
    }
    // 다 사라진 것은 목록에 0 으로 남겨 다시 흐리지 않게 한다
    return [...this.fading.values()].some((v) => v > 0);
  }

  /** 하우스 창: 하우스와 가드 자리를 위에서 내려다본다. 창의 자리와 크기는 CSS 가 정한다 */
  renderInset() {
    const frame = this.insetFrame;
    if (!frame || frame.hidden || frame.offsetParent === null) return;
    const rect = frame.getBoundingClientRect();
    const canvas = this.renderer.domElement.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const x = rect.left - canvas.left;
    const y = canvas.bottom - rect.bottom;
    const c = this.insetCam;
    const halfH = (INSET_Z[1] - INSET_Z[0]) / 2;
    const halfW = Math.max(HALF_WIDTH + 0.1, (halfH * rect.width) / rect.height);
    c.left = -halfW;
    c.right = halfW;
    c.top = (halfW * rect.height) / rect.width;
    c.bottom = -c.top;
    c.updateProjectionMatrix();
    const r = this.renderer;
    const background = this.scene.background;
    this.scene.background = null;
    r.setScissorTest(true);
    r.setScissor(x, y, rect.width, rect.height);
    r.setViewport(x, y, rect.width, rect.height);
    r.render(this.scene, c);
    r.setScissorTest(false);
    this.scene.background = background;
  }
}
