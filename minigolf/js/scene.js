// Three.js 미니 골프 씬. 코스(physics.js 의 Green)를 지형·벽·장애물로 그리고, 굴러가는 공과 조준 표시를 보여 준다.
// 길이 단위는 미터이고 좌표계는 physics.js 와 같다 (x 오른쪽, z 티 쪽이 +, y 위).
//
// 잔디는 코스 범위의 격자를 높이 함수대로 올린 것이고, 테두리 안의 칸만 남긴다. 벽은 지형을 따라 오르내리는 띠 상자다.
// 모래·물은 지형 위에 살짝 띄운 판, 블록·풍차·기둥·컵·깃발은 단순한 도형이라 코드로 만든다.
// 카메라는 홀 전체 보기와 공 따라가기 두 가지이고, 긴 홀이 가로 화면에 꽉 차도록 홀 전체 보기는 90° 돌려 보기도 한다.
// 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { BALL_R, CUP_R, WALL_HALF, MILL, direction, blockAt, bladeAngle, bladeZ, segmentDistance } from './physics.js';
import { createRenderer, startLoop } from '../../shared/gpu.js';
import { damp } from '../../shared/util.js';

/** 플레이어 색. style.css 의 --p0 ~ --p3 과 같다 */
export const PLAYER_COLORS = ['#4db8ff', '#ffd23f', '#ff7a6b', '#7be08a'];

const ASSETS = new URL('../assets/', import.meta.url);
const SHARED_ASSETS = new URL('../../shared/assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;
const sharedAsset = (path) => new URL(path, SHARED_ASSETS).href;

const CELL = 0.05; // 잔디 격자 한 칸
const WALL_H = 0.075; // 잔디 위 벽 높이
const BASE_DROP = 0.14; // 코스 바닥판이 잔디밭 위로 올라온 높이
const BLOCK_H = 0.09;
const POST_H = 0.1;
const MILL_H = 0.62; // 풍차 건물 높이
const TUNNEL_H = 0.11; // 굴 높이
const TOWER_W = 0.62; // 풍차 탑 너비
const TILT = 0.5; // 카메라가 수직에서 기운 각도 (라디안)
const FOV = 36;
const FOLLOW_SPAN = 2.6; // 공 따라가기에서 화면 짧은 쪽에 보이는 길이 (m)
const GUIDE_DOTS = 14;
const HALF = Math.PI / 2;
const SKY = 0x9fd3f0;

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

/** 모래 무늬: 밝은 모래색 위에 굵기가 다른 알갱이를 뿌린다 */
function sandTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cfae72';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const light = Math.random() < 0.5;
    ctx.fillStyle = light ? `rgba(255, 246, 220, ${0.25 + Math.random() * 0.3})` : `rgba(120, 92, 50, ${0.15 + Math.random() * 0.25})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** 삼각형 목록으로 만드는 도형 (면마다 법선이 따로라 모서리가 또렷하다) */
class Builder {
  constructor() {
    this.positions = [];
    this.uvs = [];
  }

  /** 네 점(반시계, 바깥에서 보아) 사각형 */
  quad(a, b, c, d, uv = [0, 0, 1, 0, 1, 1, 0, 1]) {
    for (const [p, i] of [
      [a, 0],
      [b, 1],
      [c, 2],
      [a, 0],
      [c, 2],
      [d, 3],
    ]) {
      this.positions.push(p[0], p[1], p[2]);
      this.uvs.push(uv[i * 2], uv[i * 2 + 1]);
    }
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }
}

export class GolfScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 14, 45);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 80);
    this.fitCam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 80); // 카메라 자리를 계산할 때만 쓴다
    this.view = { pos: new THREE.Vector3(0, 6, 4), look: new THREE.Vector3() };
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };
    this.cameraMode = 'overview';
    this.cameraDirty = true;
    this.cameraSnap = true;
    this.yaw = 0;

    this.green = null;
    this.course = null; // 홀마다 새로 만드는 메시 묶음
    this.clock = 0; // 홀의 시계 (움직이는 장애물의 시각)
    this.putt = null;
    this.running = false;
    this.ballPos = { x: 0, z: 0 };
    this.ballDrop = 0;
    this.sink = null; // 공이 컵·물에 들어가는 마무리 움직임
    this.flagLift = 0;
    this.pulse = 0;
    this.onFrame = null; // (dt) => boolean, 매 프레임 main.js 가 세기 막대 등을 처리한다
    this.onEvent = null; // (event) => void, 물리에서 일어난 일
    this.onPointer = null; // (type, event) => void

    const canvas = this.renderer.domElement;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      canvas.addEventListener(type, (e) => this.onPointer?.(type, e));
    }
    this.raycaster = new THREE.Raycaster();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load() {
    const textures = new THREE.TextureLoader();
    const [env, grassMap, grassNormal, grassRough, turfNormal, woodNormal] = await Promise.all([
      new RGBELoader().loadAsync(asset('hdri/orlando_stadium_1k.hdr')),
      loadTexture(textures, asset('textures/grass005_color_512.jpg'), { srgb: true, repeat: 30 }),
      loadTexture(textures, asset('textures/grass005_normal_512.jpg'), { repeat: 30 }),
      loadTexture(textures, asset('textures/grass005_roughness_512.jpg'), { repeat: 30 }),
      loadTexture(textures, sharedAsset('textures/velour_velvet_nor_gl_1k.jpg')),
      loadTexture(textures, sharedAsset('textures/dark_wood_nor_gl_1k.jpg')),
    ]);
    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.7;

    this.materials = {
      turf: new THREE.MeshStandardMaterial({ color: 0x23762f, normalMap: turfNormal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92 }),
      wall: new THREE.MeshStandardMaterial({ normalMap: woodNormal, color: 0xece4d2, roughness: 0.55 }), // 흰 칠을 한 나무
      sand: new THREE.MeshStandardMaterial({
        map: sandTexture(),
        color: 0xd2b98c,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
      water: new THREE.MeshStandardMaterial({
        color: 0x14548f,
        normalMap: turfNormal.clone(),
        normalScale: new THREE.Vector2(0.3, 0.3),
        roughness: 0.12,
        metalness: 0.2,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      }),
      tee: new THREE.MeshStandardMaterial({ color: 0x2c6d34, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }),
      cup: new THREE.MeshBasicMaterial({ color: 0x050605, polygonOffset: true, polygonOffsetFactor: -4 }),
      rim: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.45 }),
      red: new THREE.MeshStandardMaterial({ color: 0xd8483c, roughness: 0.5 }),
      block: new THREE.MeshStandardMaterial({ color: 0xe0a028, roughness: 0.45 }),
      mill: new THREE.MeshStandardMaterial({ color: 0xc94f3f, roughness: 0.7 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x3d4250, roughness: 0.6 }),
      blade: new THREE.MeshStandardMaterial({ color: 0xf6f1e4, roughness: 0.5 }),
      flag: new THREE.MeshStandardMaterial({ color: 0xff3b2f, roughness: 0.6, side: THREE.DoubleSide, transparent: true }),
      pole: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, transparent: true }),
    };
    this.water = this.materials.water.normalMap;
    this.water.repeat.set(2, 2);

    this.buildLawn({ map: grassMap, normalMap: grassNormal, roughnessMap: grassRough });
    this.buildBall();
    this.buildMarkers();
    this.buildLights();

    this.last = performance.now();
    this.loop = startLoop(this.renderer, this);
  }

  // ---------- 바탕 ----------

  buildLawn(maps) {
    this.lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80).rotateX(-HALF),
      new THREE.MeshStandardMaterial({ ...maps, color: 0xb8d8a0, roughness: 1 }),
    );
    this.lawn.receiveShadow = true;
    this.scene.add(this.lawn);
  }

  buildBall() {
    // 딤플 대신 옅은 점무늬 텍스처로 공이 구르는 것이 보이게 한다
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 4; y < 64; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < 128; x += 8) ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 30, 128, 4); // 줄 하나
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    this.ballMaterial = new THREE.MeshPhysicalMaterial({ map, color: 0xffffff, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 16), this.ballMaterial);
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.scene.add(this.ball);
  }

  buildMarkers() {
    const overlay = (color, opacity) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false });
    // 공 밑의 차례 테
    this.ring = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 1.5, BALL_R * 2.1, 40).rotateX(-HALF), overlay(0xffffff, 0.9));
    this.ring.renderOrder = 3;
    this.ring.visible = false;
    this.scene.add(this.ring);

    // 칠 방향 화살표 (지역 좌표에서 -z 쪽을 가리킨다). 잔디 위에서도 잘 보이도록 어두운 테두리를 깐다
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
      shaftLine: part(shaftGeometry, outlineMaterial, 4),
      headLine: part(headGeometry, outlineMaterial, 4),
      shaft: part(shaftGeometry, this.arrowMaterial, 5),
      head: part(headGeometry, this.arrowMaterial, 5),
    };
    this.arrow.add(...Object.values(this.arrow.userData));
    this.arrow.visible = false;
    this.scene.add(this.arrow);

    // 당긴 고무줄: 공에서 당긴 쪽(+z)으로 뻗는 옅은 띠
    this.band = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-HALF).translate(0, 0, 0.5), overlay(0xffffff, 0.35));
    this.band.renderOrder = 3;
    this.band.visible = false;
    this.scene.add(this.band);

    // 짧은 방향 점선 (벽 반사는 보여 주지 않는다)
    this.guide = new THREE.InstancedMesh(new THREE.CircleGeometry(0.006, 10).rotateX(-HALF), overlay(0xffffff, 0.8), GUIDE_DOTS);
    this.guide.renderOrder = 3;
    this.guide.frustumCulled = false;
    this.guide.visible = false;
    this.scene.add(this.guide);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x4a6a3a, 0.7));
    this.sun = new THREE.DirectionalLight(0xfff3df, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.01;
    this.scene.add(this.sun, this.sun.target);
  }

  // ---------- 홀 ----------

  /** 홀을 새로 그린다. 앞 홀의 메시는 치운다 */
  setHole(green) {
    if (this.course) {
      this.scene.remove(this.course);
      this.course.traverse((o) => o.geometry?.dispose());
    }
    this.green = green;
    this.clock = 0;
    this.putt = null;
    this.running = false;
    this.sink = null;
    this.course = new THREE.Group();
    this.movers = [];
    this.blades = [];

    const { x0, x1, z0, z1 } = green.bounds;
    // 지형의 가장 낮은 곳 아래로 바닥판을 내린다
    let low = Infinity;
    for (let x = x0; x <= x1 + 1e-9; x += 0.1) for (let z = z0; z <= z1 + 1e-9; z += 0.1) low = Math.min(low, green.heightAt(x, z));
    this.floor = low - BASE_DROP;
    this.lawn.position.y = this.floor;

    this.buildTurf();
    for (const region of green.sand) this.course.add(this.regionMesh(region, this.materials.sand, 0.004));
    for (const region of green.water) this.course.add(this.regionMesh(region, this.materials.water, 0.006));
    this.buildWalls();
    this.buildObstacles();
    this.buildCup();
    this.buildTee();
    this.scene.add(this.course);

    // 그림자를 코스에 맞춘다
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const span = Math.max(x1 - x0, z1 - z0) / 2 + 0.6;
    this.sun.position.set(cx + 2.5, 6, cz + 3);
    this.sun.target.position.set(cx, 0, cz);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -span;
    s.right = s.top = span;
    s.near = 1;
    s.far = 16;
    s.updateProjectionMatrix();

    this.updateMovers();
    this.chooseYaw();
    this.cameraDirty = true;
    this.cameraSnap = true;
  }

  /** 테두리 안 격자 칸만 남긴 잔디. 칸 꼭짓점을 높이 함수대로 올린다 */
  buildTurf() {
    const green = this.green;
    const { x0, x1, z0, z1 } = green.bounds;
    const nx = Math.round((x1 - x0) / CELL);
    const nz = Math.round((z1 - z0) / CELL);
    const positions = [];
    const uvs = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * CELL;
        const z = z0 + j * CELL;
        positions.push(x, green.heightAt(x, z), z);
        uvs.push(x * 1.5, -z * 1.5);
      }
    }
    const index = [];
    const at = (i, j) => j * (nx + 1) + i;
    const inside = (x, z) => green.inside(x, z);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = x0 + i * CELL;
        const cz = z0 + j * CELL;
        const corners = [inside(cx, cz), inside(cx, cz + CELL), inside(cx + CELL, cz), inside(cx + CELL, cz + CELL)];
        if (corners.every(Boolean)) {
          index.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
          continue;
        }
        if (!corners.some(Boolean)) continue;
        // 비스듬한 테두리에 걸친 칸: 테두리 변으로 잘라 계단 없이 벽에 붙인다
        const clipped = this.clipCell(cx, cz);
        if (clipped.length < 3) continue;
        const base = positions.length / 3;
        for (const [x, z] of clipped) {
          positions.push(x, green.heightAt(x, z), z);
          uvs.push(x * 1.5, -z * 1.5);
        }
        for (let k = 1; k + 1 < clipped.length; k++) index.push(base, base + k + 1, base + k);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const turf = new THREE.Mesh(geometry, this.materials.turf);
    turf.receiveShadow = true;
    this.course.add(turf);
  }

  /**
   * 격자 칸 (x, z)~(x + CELL, z + CELL) 을 근처 테두리 변의 안쪽 반평면으로 잘라 낸 다각형 [[x, z], …].
   * 꺾인 곳이 격자 위에 오는 코스에서는 테두리에 걸친 칸이 비스듬한 변 근처에만 생기므로 반평면으로 잘라도 된다
   */
  clipCell(x, z) {
    let poly = [
      [x, z],
      [x + CELL, z],
      [x + CELL, z + CELL],
      [x, z + CELL],
    ];
    const outline = this.green.outline;
    const cx = x + CELL / 2;
    const cz = z + CELL / 2;
    for (let i = 0; i < outline.length && poly.length; i++) {
      const [ax, az] = outline[i];
      const [bx, bz] = outline[(i + 1) % outline.length];
      const seg = { ax, az, bx, bz };
      if (segmentDistance(seg, cx, cz) > CELL) continue;
      // 변의 법선 중 코스 안쪽
      const len = Math.hypot(bx - ax, bz - az);
      let nx = -(bz - az) / len;
      let nz = (bx - ax) / len;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (!this.green.inside(mx + nx * 1e-3, mz + nz * 1e-3)) {
        nx = -nx;
        nz = -nz;
      }
      const side = (p) => (p[0] - ax) * nx + (p[1] - az) * nz;
      const next = [];
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k];
        const q = poly[(k + 1) % poly.length];
        const sp = side(p);
        const sq = side(q);
        if (sp >= 0) next.push(p);
        if (sp >= 0 !== sq >= 0) {
          const t = sp / (sp - sq);
          next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
      poly = next;
    }
    return poly;
  }

  /** 모래·물 영역을 지형 위에 lift 만큼 띄운 판 */
  regionMesh(region, material, lift) {
    const green = this.green;
    let geometry;
    if (region.rect) {
      const [ax, az, bx, bz] = region.rect;
      const w = Math.abs(bx - ax);
      const d = Math.abs(bz - az);
      geometry = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / CELL)), Math.max(1, Math.round(d / CELL))).rotateX(-HALF);
      geometry.translate((ax + bx) / 2, 0, (az + bz) / 2);
    } else {
      const [cx, cz, rx, rz = rx] = region.circle;
      // 가운데에서 바깥으로 고리를 나눠 지형을 따라가게 한다
      geometry = new THREE.RingGeometry(0.0001, 1, 48, 8).rotateX(-HALF);
      geometry.scale(rx, 1, rz);
      geometry.translate(cx, 0, cz);
    }
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, green.heightAt(x, z) + lift);
      uv.setXY(i, x * 1.2, -z * 1.2);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.userData.region = region;
    return mesh;
  }

  /** 지형을 따라 오르내리는 벽 하나 (선분을 따라 잘게 나눈 띠 상자) */
  wallGeometry(builder, seg) {
    const green = this.green;
    let dx = seg.bx - seg.ax;
    let dz = seg.bz - seg.az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    dx /= len;
    dz /= len;
    const nx = -dz * WALL_HALF;
    const nz = dx * WALL_HALF;
    const ax = seg.ax - dx * WALL_HALF;
    const az = seg.az - dz * WALL_HALF;
    const total = len + 2 * WALL_HALF;
    const n = Math.max(1, Math.ceil(total / 0.1));
    const bottom = this.floor;
    const point = (i) => {
      const k = (i / n) * total;
      const x = ax + dx * k;
      const z = az + dz * k;
      const top = green.heightAt(x, z) + WALL_H;
      return { x, z, top, u: k / 0.4 };
    };
    let p = point(0);
    const cap = (q, sign) => {
      const l = [q.x + nx, q.z + nz];
      const r = [q.x - nx, q.z - nz];
      const a = sign > 0 ? l : r;
      const b = sign > 0 ? r : l;
      builder.quad([a[0], bottom, a[1]], [b[0], bottom, b[1]], [b[0], q.top, b[1]], [a[0], q.top, a[1]]);
    };
    cap(p, -1);
    for (let i = 1; i <= n; i++) {
      const q = point(i);
      // 윗면
      builder.quad([p.x + nx, p.top, p.z + nz], [p.x - nx, p.top, p.z - nz], [q.x - nx, q.top, q.z - nz], [q.x + nx, q.top, q.z + nz], [
        p.u, 0, p.u, 0.15, q.u, 0.15, q.u, 0,
      ]);
      // 왼쪽(+n)과 오른쪽(-n) 옆면
      builder.quad([q.x + nx, bottom, q.z + nz], [p.x + nx, bottom, p.z + nz], [p.x + nx, p.top, p.z + nz], [q.x + nx, q.top, q.z + nz], [
        q.u, 0, p.u, 0, p.u, (p.top - this.floor) / 0.4, q.u, (q.top - this.floor) / 0.4,
      ]);
      builder.quad([p.x - nx, bottom, p.z - nz], [q.x - nx, bottom, q.z - nz], [q.x - nx, q.top, q.z - nz], [p.x - nx, p.top, p.z - nz], [
        p.u, 0, q.u, 0, q.u, (q.top - this.floor) / 0.4, p.u, (p.top - this.floor) / 0.4,
      ]);
      p = q;
    }
    cap(p, 1);
  }

  buildWalls() {
    const builder = new Builder();
    for (const seg of this.green.segments) this.wallGeometry(builder, seg);
    const walls = new THREE.Mesh(builder.build(), this.materials.wall);
    walls.castShadow = walls.receiveShadow = true;
    this.course.add(walls);

  }

  buildObstacles() {
    const green = this.green;
    const m = this.materials;
    for (const p of green.posts) {
      const h = green.heightAt(p.x, p.z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, POST_H + 0.1, 24), m.white);
      post.position.set(p.x, h + (POST_H - 0.1) / 2, p.z);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.04, p.r * 1.04, 0.025, 24), m.red);
      cap.position.set(p.x, h + POST_H - 0.0125, p.z);
      for (const mesh of [post, cap]) {
        mesh.castShadow = mesh.receiveShadow = true;
        this.course.add(mesh);
      }
    }
    for (const block of green.blocks) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.w, BLOCK_H + 0.06, block.d), block.move ? m.block : m.white);
      // 가운데 흰 띠
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(block.w * 1.002, 0.02, block.d * 1.002), block.move ? m.white : m.red);
      stripe.position.y = 0.01;
      mesh.add(stripe);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.block = block;
      this.course.add(mesh);
      this.movers.push(mesh);
    }
    for (const mill of green.mills) this.buildMill(mill);
  }

  /**
   * 풍차: 가운데 탑(굴이 뚫린 몸통과 네모뿔 지붕), 탑 양옆을 코스 끝까지 막는 낮은 담, 앞면 축에서 도는 날개 4장.
   * 부딪치는 자리는 physics.js 의 millBoxes 와 같다 (탑과 담의 바닥 넓이가 같다).
   */
  buildMill(mill) {
    const m = this.materials;
    const h = this.green.heightAt(mill.x, mill.z);
    const group = new THREE.Group();
    group.position.set(mill.x, h, mill.z);
    const tower = Math.min(mill.width, Math.max(mill.gap + 0.3, TOWER_W));
    const towerSide = (tower - mill.gap) / 2;
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(towerSide, MILL_H, mill.depth), m.mill);
      wall.position.set(sx * (mill.gap / 2 + towerSide / 2), MILL_H / 2, 0);
      group.add(wall);
      // 탑 옆의 낮은 담
      const rest = (mill.width - tower) / 2;
      if (rest > 0.001) {
        const low = new THREE.Mesh(new THREE.BoxGeometry(rest, WALL_H * 1.6, mill.depth), m.wall);
        low.position.set(sx * (tower / 2 + rest / 2), (WALL_H * 1.6) / 2, 0);
        group.add(low);
      }
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(mill.gap + 0.002, MILL_H - TUNNEL_H, mill.depth), m.mill);
    lintel.position.set(0, TUNNEL_H + (MILL_H - TUNNEL_H) / 2, 0);
    group.add(lintel);
    // 네모뿔 지붕: 밑면이 탑보다 조금 넓다
    const span = Math.max(tower, mill.depth) + 0.08;
    // 꼭짓점이 축 위에 오는 4각 원뿔을 45° 돌려 밑면을 코스와 나란히 한 뒤 늘인다
    const roof = new THREE.Mesh(new THREE.ConeGeometry(span / Math.SQRT2, 0.34, 4, 1).rotateY(Math.PI / 4), m.roof);
    roof.scale.set(tower / span + 0.08 / span, 1, mill.depth / span + 0.08 / span);
    roof.position.y = MILL_H + 0.17;
    group.add(roof);
    // 굴 입구와 창
    const door = new THREE.Mesh(new THREE.PlaneGeometry(mill.gap * 0.9, TUNNEL_H * 0.9), new THREE.MeshBasicMaterial({ color: 0x1d120c }));
    door.position.set(0, TUNNEL_H * 0.45, mill.depth / 2 + 0.001);
    group.add(door);
    const glass = new THREE.MeshStandardMaterial({ color: 0xfff1b8, roughness: 0.4 });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.11), glass);
    pane.position.set(0, MILL_H * 0.42, mill.depth / 2 + 0.001);
    group.add(pane);
    // 축과 날개
    const hub = new THREE.Group();
    hub.position.set(0, MILL.hub, bladeZ(mill) - mill.z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 20).rotateX(HALF), m.roof);
    hub.add(cap);
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k * Math.PI) / 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(MILL.bladeWidth, MILL.blade - 0.05, MILL.bladeDepth), m.blade);
      blade.position.y = -(MILL.blade + 0.05) / 2;
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.014, MILL.blade, 0.014), m.roof);
      spar.position.set(0, -MILL.blade / 2, MILL.bladeDepth / 2 + 0.007);
      arm.add(blade, spar);
      hub.add(arm);
    }
    group.add(hub);
    group.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    door.castShadow = false;
    this.course.add(group);
    this.blades.push({ mill, hub });
  }

  buildCup() {
    const { cup } = this.green;
    const h = this.green.heightAt(cup.x, cup.z);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 40).rotateX(-HALF), this.materials.cup);
    hole.position.set(cup.x, h + 0.0015, cup.z);
    const rim = new THREE.Mesh(new THREE.RingGeometry(CUP_R, CUP_R + 0.006, 40).rotateX(-HALF), this.materials.rim);
    rim.position.set(cup.x, h + 0.0016, cup.z);
    this.course.add(hole, rim);
    // 깃발: 공이 컵 가까이 굴러오면 뽑아 올린다
    this.flag = new THREE.Group();
    this.flag.position.set(cup.x, h, cup.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.62, 12), this.materials.pole);
    pole.position.y = 0.31;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.2, -0.065);
    shape.lineTo(0, -0.13);
    shape.closePath();
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.materials.flag);
    cloth.position.set(0.004, 0.6, 0);
    this.flag.add(pole, cloth);
    this.flag.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.flagLift = 0;
    this.course.add(this.flag);
  }

  buildTee() {
    const { tee } = this.green;
    const mat = this.regionMesh({ rect: [tee.x - 0.13, tee.z - 0.13, tee.x + 0.13, tee.z + 0.13] }, this.materials.tee, 0.002);
    this.course.add(mat);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16).rotateX(-HALF), this.materials.white);
    spot.position.set(tee.x, this.green.heightAt(tee.x, tee.z) + 0.0035, tee.z);
    this.course.add(spot);
  }

  /** 움직이는 블록과 풍차 날개를 지금 시계에 맞춘다 */
  updateMovers() {
    const green = this.green;
    if (!green) return;
    for (const mesh of this.movers) {
      const box = blockAt(mesh.userData.block, this.clock);
      mesh.position.set(box.x, green.heightAt(box.x, box.z) + (BLOCK_H - 0.06) / 2, box.z);
    }
    for (const { mill, hub } of this.blades) hub.rotation.z = bladeAngle(mill, 0, this.clock);
    // 물결
    this.water.offset.set(this.clock * 0.03, this.clock * 0.02);
  }

  // ---------- 공 ----------

  /** 멈춘 공 자리. color 는 차례인 사람 색 (혼자서는 null) */
  setBall(pos, color = null) {
    this.ballPos = { x: pos.x, z: pos.z };
    this.ballDrop = 0;
    this.sink = null;
    this.putt = null;
    this.ball.visible = true;
    this.ball.scale.setScalar(1);
    this.ballMaterial.color.set(color ? new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55) : 0xffffff);
    this.ring.material.color.set(color ?? '#ffffff');
    this.placeBall();
    if (this.cameraMode === 'follow') this.cameraDirty = true;
  }

  hideBall() {
    this.ball.visible = false;
    this.ring.visible = false;
    this.setAim(null);
  }

  placeBall() {
    const { x, z } = this.ballPos;
    const h = this.green ? this.green.heightAt(x, z) : 0;
    this.ball.position.set(x, h + BALL_R - this.ballDrop, z);
    this.ring.position.set(x, h + 0.002, z);
  }

  /** 지금 홀에서 친 공을 굴린다. 다 멈추고 (컵·물에 들어가는 모습까지) 끝나면 풀린다 */
  run(putt) {
    this.putt = putt;
    this.running = true;
    this.ring.visible = false;
    this.setAim(null);
    return new Promise((resolve) => {
      this.runDone = resolve;
    });
  }

  /** 공을 굴린 만큼 돌린다 */
  rollBall(dx, dz) {
    const d = Math.hypot(dx, dz);
    if (d < 1e-7) return;
    const axis = new THREE.Vector3(-dz / d, 0, dx / d);
    const q = new THREE.Quaternion().setFromAxisAngle(axis, d / BALL_R);
    this.ball.quaternion.premultiply(q);
  }

  // ---------- 조준 ----------

  /** 조준 표시. aim: { angle, power, pull } 또는 null. pull 은 당긴 길이(m, 고무줄 표시용) */
  setAim(aim) {
    const show = !!aim && this.ball.visible;
    this.ring.visible = show || (!!aim && this.ball.visible);
    const on = show && aim.power > 0;
    this.arrow.visible = this.guide.visible = on;
    this.band.visible = on && aim.pull > 0;
    if (!show) return;
    this.ring.visible = true;
    if (!on) return;
    const { x, z } = this.ballPos;
    const h = this.green.heightAt(x, z);
    const d = direction(aim.angle);
    const rot = -aim.angle;
    const start = BALL_R * 2.4;
    const length = 0.03 + aim.power * 0.22;
    const width = BALL_R * 0.9;
    const border = 0.004;
    const { shaft, head, shaftLine, headLine } = this.arrow.userData;
    shaft.scale.set(width, 1, length);
    shaft.position.z = -start;
    head.scale.setScalar(BALL_R * 1.2);
    head.position.z = -(start + length);
    shaftLine.scale.set(width + border * 2, 1, length + border);
    shaftLine.position.z = -start + border / 2;
    headLine.scale.setScalar(BALL_R * 1.2 + border * 1.6);
    headLine.position.z = -(start + length) + border;
    this.arrow.position.set(x, h + 0.004, z);
    this.arrow.rotation.y = rot;
    powerColor(aim.power, this.arrowMaterial.color);
    if (aim.pull > 0) {
      this.band.scale.set(BALL_R * 0.7, 1, aim.pull);
      this.band.position.set(x, h + 0.003, z);
      this.band.rotation.y = rot;
    }
    // 짧은 점선: 화살표 끝에서 세기에 따라 조금 더
    const m = new THREE.Matrix4();
    let count = 0;
    const reach = start + length + 0.08 + aim.power * 0.5;
    for (let k = start + length + 0.06; k < reach && count < GUIDE_DOTS; k += 0.045) {
      const px = x + d.x * k;
      const pz = z + d.z * k;
      if (!this.green.inside(px, pz)) break;
      m.makeTranslation(px, this.green.heightAt(px, pz) + 0.004, pz);
      this.guide.setMatrixAt(count++, m);
    }
    this.guide.count = count;
    this.guide.instanceMatrix.needsUpdate = true;
  }

  // ---------- 화면 좌표 ----------

  /** 포인터 위치 → 정규화 장치 좌표 */
  pointerNdc(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
  }

  /** 포인터가 가리키는, 공 높이의 수평면 위의 점. 못 찾으면 null */
  groundPoint(event) {
    const h = this.green ? this.green.heightAt(this.ballPos.x, this.ballPos.z) + BALL_R : 0;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
    this.raycaster.setFromCamera(this.pointerNdc(event), this.camera);
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** 땅 위의 점 → 화면 픽셀 */
  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** 공의 화면 위치 */
  ballScreen() {
    return this.toScreen(this.ball.position.x, this.ball.position.y, this.ball.position.z);
  }

  // ---------- 카메라 ----------

  /** 화면 가장자리를 가리는 HUD 크기 (픽셀). 코스가 그 사이에 오도록 한다 */
  setInsets(insets) {
    this.insets = { ...this.insets, ...insets };
    this.cameraDirty = true;
    this.chooseYaw();
  }

  /** 'overview' (홀 전체) 또는 'follow' (공 따라가기) */
  setCameraMode(mode) {
    this.cameraMode = mode;
    this.cameraDirty = true;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.cameraDirty = true;
    this.cameraSnap = true;
    this.chooseYaw();
  }

  /** 카메라가 보는 방향 (수평). yaw 0 이면 -z 쪽을 본다 */
  axes(yaw = this.yaw) {
    return {
      back: new THREE.Vector3(Math.sin(TILT) * Math.sin(yaw), Math.cos(TILT), Math.sin(TILT) * Math.cos(yaw)),
      up: new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), // 화면 위쪽의 수평 방향
      right: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
    };
  }

  /**
   * 홀 전체가 더 크게 보이는 쪽으로 돌린다: 그대로, 또는 티에서 컵 쪽이 화면 오른쪽이 되게 90°.
   * 풍차가 있는 홀은 날개가 옆으로 보이지 않도록 늘 티 쪽에서 본다
   */
  chooseYaw() {
    if (!this.green) return;
    if (this.green.mills.length) {
      if (this.yaw !== 0) this.cameraSnap = true;
      this.yaw = 0;
      this.cameraDirty = true;
      return;
    }
    const { tee, cup } = this.green;
    const side = cup.z < tee.z ? HALF : -HALF;
    const straight = this.overviewGoal(0).dist;
    const turned = this.overviewGoal(side).dist;
    const yaw = turned < straight * 0.8 ? side : 0;
    if (yaw !== this.yaw) {
      this.yaw = yaw;
      this.cameraSnap = true;
    }
    this.cameraDirty = true;
  }

  /** 코스가 HUD 사이의 빈 곳에 꽉 차게 보이는 카메라 자리 { pos, look, dist } */
  overviewGoal(yaw = this.yaw) {
    const green = this.green;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const limitX = Math.max(60, w - left - right) / w;
    const limitY = Math.max(60, h - top - bottom) / h;
    const margin = WALL_HALF + 0.02;
    const points = [];
    const { x0, x1, z0, z1 } = green.bounds;
    for (const [x, z] of [
      [x0 - margin, z0 - margin],
      [x1 + margin, z0 - margin],
      [x0 - margin, z1 + margin],
      [x1 + margin, z1 + margin],
    ]) {
      points.push(new THREE.Vector3(x, green.heightAt(x, z) + WALL_H, z));
      points.push(new THREE.Vector3(x, this.floor ?? -0.1, z));
    }
    for (const mill of green.mills) points.push(new THREE.Vector3(mill.x, MILL_H + 0.4, mill.z));
    return this.fit(points, yaw, limitX, limitY, new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2));
  }

  /** points 가 화면의 limitX·limitY 비율 안에 꽉 차도록 하는 카메라 자리 */
  fit(points, yaw, limitX, limitY, look) {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { back, up, right } = this.axes(yaw);
    const cam = this.fitCam;
    cam.aspect = w / h;
    cam.fov = FOV;
    cam.updateProjectionMatrix();
    let dist = 8;
    const v = new THREE.Vector3();
    const tan = Math.tan(((FOV / 2) * Math.PI) / 180);
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
      const k = Math.max((maxX - minX) / 2 / limitX, (maxY - minY) / 2 / limitY);
      // 위아래·좌우가 고르게 오도록 보는 곳을 옮긴다
      const halfH = dist * tan;
      look.addScaledVector(up, (((minY + maxY) / 2) * halfH) / Math.cos(TILT));
      look.addScaledVector(right, ((minX + maxX) / 2) * halfH * cam.aspect);
      dist *= k;
    }
    return { pos: look.clone().addScaledVector(back, dist), look, dist };
  }

  /** 공을 가운데에 두고 FOLLOW_SPAN 이 화면 짧은 쪽에 들어오는 자리. 홀 전체 보기보다 멀어지지는 않는다 */
  followGoal() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { top, bottom, left, right } = this.insets;
    const usableW = Math.max(60, w - left - right);
    const usableH = Math.max(60, h - top - bottom);
    const tan = Math.tan(((FOV / 2) * Math.PI) / 180);
    // 보이는 높이 = 2·dist·tan(fov/2)·(usableH/h). 짧은 쪽에 FOLLOW_SPAN
    const spanH = usableH <= usableW ? FOLLOW_SPAN : (FOLLOW_SPAN * usableH) / usableW;
    let dist = spanH / (2 * tan * (usableH / h));
    const overview = this.overviewGoal();
    dist = Math.min(dist, overview.dist);
    const { x, z } = this.ball.visible ? { x: this.ball.position.x, z: this.ball.position.z } : this.ballPos;
    const look = new THREE.Vector3(x, this.green.heightAt(x, z), z);
    const { back } = this.axes();
    return { pos: look.clone().addScaledVector(back, dist), look, dist };
  }

  /** 카메라를 목표로 k 만큼 옮긴다. 움직였으면 true */
  placeCamera(k) {
    if (!this.green) return false;
    if (this.cameraDirty || this.cameraMode === 'follow') {
      this.goal = this.cameraMode === 'follow' ? this.followGoal() : this.overviewGoal();
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
    return before.distanceToSquared(v.pos) > 1e-9;
  }

  // ---------- 프레임 ----------

  frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let lively = !!this.onFrame?.(dt);
    let casters = false;

    if (this.running && this.putt) {
      const putt = this.putt;
      const before = { ...putt.ball };
      putt.advance(dt);
      this.clock = putt.time;
      for (const event of putt.drain()) this.onEvent?.(event);
      this.ballPos = { x: putt.ball.x, z: putt.ball.z };
      this.ballDrop = putt.ball.drop;
      this.rollBall(putt.ball.x - before.x, putt.ball.z - before.z);
      if (!putt.moving) {
        this.running = false;
        // 컵에 들어가거나 물에 빠지는 마무리
        if (putt.result === 'holed' || putt.result === 'water') this.sink = { kind: putt.result, t: 0 };
        else this.runDone?.();
      }
      this.placeBall();
      lively = casters = true;
    } else {
      this.clock += dt;
    }
    if (this.sink) {
      const s = this.sink;
      s.t += dt;
      if (s.kind === 'holed') {
        this.ballDrop = Math.min(0.07, BALL_R + s.t * 0.25);
        if (s.t > 0.25) this.ball.visible = false;
      } else {
        this.ballDrop = Math.min(BALL_R * 2.2, s.t * 0.09);
        this.ball.scale.setScalar(Math.max(0.01, 1 - s.t * 1.2));
      }
      this.placeBall();
      if (s.t > 0.7) {
        this.sink = null;
        this.ball.visible = false;
        this.runDone?.();
      }
      lively = casters = true;
    }
    if (this.green) {
      this.updateMovers();
      if (this.movers.length || this.blades.length) lively = casters = true;
      // 공이 컵 가까이 굴러오면 깃발을 뽑는다
      const near = this.running && Math.hypot(this.ballPos.x - this.green.cup.x, this.ballPos.z - this.green.cup.z) < 1.1;
      const goal = near || this.sink?.kind === 'holed' ? 1 : 0;
      if (Math.abs(goal - this.flagLift) > 1e-3) {
        this.flagLift += (goal - this.flagLift) * damp(6, dt);
        this.flag.position.y = this.green.heightAt(this.green.cup.x, this.green.cup.z) + this.flagLift * 0.35;
        this.materials.flag.opacity = this.materials.pole.opacity = 1 - this.flagLift * 0.85;
        lively = true;
      }
    }
    // 차례 테가 천천히 숨 쉰다
    if (this.ring.visible) {
      this.pulse += dt;
      const k = 1 + Math.sin(this.pulse * 4) * 0.1;
      this.ring.scale.set(k, 1, k);
    }

    if (this.placeCamera(this.cameraSnap ? 1 : damp(this.running ? 4 : 5, dt))) lively = true;
    this.cameraSnap = false;

    if (!this.loop.due(now, lively, casters)) return;
    this.renderer.render(this.scene, this.camera);
  }
}
