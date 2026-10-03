// Three.js 다트 씬. 길이 단위는 미터이고 보드 중심이 원점, 보드는 +z 를 향한다.
// 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RADIUS } from './board.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const BOARD_FACE_Z = 0.04; // 모델의 앞면 위치
const BOARD_EDGE = 0.2253; // 숫자 링을 포함한 보드 반지름
const HAND = new THREE.Vector3(0.1, -0.2, 1.0); // 다트가 출발하는 곳
const SWAY = 0.03; // 조준점이 흔들리는 폭
const PLAYER_COLORS = [0xd8362c, 0x2d6fd1];

const easeOut = (k) => 1 - (1 - k) * (1 - k);

function loadTexture(loader, name, suffix, srgb, repeat) {
  return loader.loadAsync(asset(`textures/${name}_${suffix}_1k.jpg`)).then((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

export class DartsScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels';
    container.appendChild(this.labelLayer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d12);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 50);

    this.tweens = new Set();
    this.darts = [];
    this.aim = new THREE.Vector2(0, 0); // 포인터가 가리키는 보드 위 좌표
    this.aiming = false;
    this.onThrow = null; // (point: {x, y}) => void, 미터 단위
    this.time = 0;

    this.raycaster = new THREE.Raycaster();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -BOARD_FACE_Z);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this.pointTo(e));
    canvas.addEventListener('pointermove', (e) => this.pointTo(e));
    canvas.addEventListener('pointerup', (e) => {
      if (!this.aiming) return;
      this.pointTo(e);
      this.onThrow?.(this.reticlePoint());
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load({ debug = false } = {}) {
    const textures = new THREE.TextureLoader();
    const [env, board, wallMap, wallNormal, wallRough] = await Promise.all([
      new RGBELoader().loadAsync(asset('hdri/warm_bar_1k.hdr')),
      new GLTFLoader().loadAsync(asset('models/dartboard/dartboard_1k.gltf')),
      loadTexture(textures, 'wood_plank_wall', 'diff', true, 3),
      loadTexture(textures, 'wood_plank_wall', 'nor_gl', false, 3),
      loadTexture(textures, 'wood_plank_wall', 'rough', false, 3),
    ]);

    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.35;

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshStandardMaterial({ map: wallMap, normalMap: wallNormal, roughnessMap: wallRough, color: 0x9a8f86 }),
    );
    wall.receiveShadow = true;
    this.scene.add(wall);

    board.scene.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.scene.add(board.scene);

    const spot = new THREE.SpotLight(0xfff0d8, 9, 6, 0.5, 0.6, 2);
    spot.position.set(0.25, 0.9, 1.2);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.bias = -0.0003;
    spot.shadow.radius = 5;
    this.scene.add(spot, spot.target);

    this.buildReticle();
    this.buildDartParts();
    if (debug) this.buildCalibration();

    this.last = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  buildReticle() {
    const material = new THREE.MeshBasicMaterial({ color: 0xffe07a, depthTest: false, transparent: true, opacity: 0.95 });
    this.reticle = new THREE.Group();
    this.reticle.add(
      new THREE.Mesh(new THREE.RingGeometry(0.0085, 0.0105, 40), material),
      new THREE.Mesh(new THREE.CircleGeometry(0.0018, 16), material),
    );
    this.reticle.renderOrder = 10;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  // 다트는 맞는 오픈소스 모델이 없어 단순 도형으로 만든다. 끝(팁)이 원점, 몸통은 +z 방향
  buildDartParts() {
    const along = (geometry, z) => geometry.rotateX(Math.PI / 2).translate(0, 0, z);
    const flight = new THREE.Shape();
    flight.moveTo(0, 0);
    flight.lineTo(0.017, 0.012);
    flight.lineTo(0.017, 0.034);
    flight.lineTo(0, 0.04);
    this.dartParts = {
      tip: along(new THREE.CylinderGeometry(0.0009, 0.0002, 0.03, 8), 0.015),
      barrel: along(new THREE.CylinderGeometry(0.0034, 0.0028, 0.05, 16), 0.055),
      shaft: along(new THREE.CylinderGeometry(0.0016, 0.0022, 0.05, 10), 0.105),
      flight: new THREE.ShapeGeometry(flight).rotateX(Math.PI / 2).translate(0, 0, 0.118),
      steel: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.25 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xb08a3c, metalness: 1, roughness: 0.4 }),
      black: new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.5 }),
      flights: PLAYER_COLORS.map(
        (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide }),
      ),
    };
  }

  makeDart(player) {
    const p = this.dartParts;
    const dart = new THREE.Group();
    dart.add(new THREE.Mesh(p.tip, p.steel), new THREE.Mesh(p.barrel, p.brass), new THREE.Mesh(p.shaft, p.black));
    for (let i = 0; i < 4; i++) {
      const wing = new THREE.Mesh(p.flight, p.flights[player]);
      wing.rotation.z = (i * Math.PI) / 2;
      dart.add(wing);
    }
    dart.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    return dart;
  }

  /** ?debug: 점수 계산에 쓰는 규격선을 모델 위에 겹쳐 그려 어긋남이 없는지 본다 */
  buildCalibration() {
    const material = new THREE.LineBasicMaterial({ color: 0x00e5ff, depthTest: false });
    const group = new THREE.Group();
    for (const mm of Object.values(RADIUS)) {
      const points = [];
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(a) * mm, Math.sin(a) * mm, 0));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
    }
    // 20 구역의 양쪽 경계
    for (const side of [-1, 1]) {
      const a = (side * Math.PI) / 20;
      const edge = (mm) => new THREE.Vector3(Math.sin(a) * mm, Math.cos(a) * mm, 0);
      group.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints([edge(RADIUS.outerBull), edge(200)]), material),
      );
    }
    group.scale.setScalar(0.001);
    group.position.z = BOARD_FACE_Z + 0.001;
    group.renderOrder = 9;
    this.scene.add(group);
  }

  // ---------- 프레임 / 입력 ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 세로로 긴 화면에서는 보드 전체가 보이도록 물러난다
    const distance = Math.max(1, 0.85 / this.camera.aspect);
    this.camera.position.set(0, -0.03, BOARD_FACE_Z + 1.05 * distance);
    this.camera.lookAt(0, -0.03, 0);
    this.camera.updateProjectionMatrix();
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    for (const t of this.tweens) {
      t.elapsed += dt * 1000;
      const k = Math.min(1, t.elapsed / t.duration);
      t.update(k);
      if (k === 1) {
        this.tweens.delete(t);
        t.resolve();
      }
    }
    if (this.aiming) {
      const p = this.reticlePoint();
      this.reticle.position.set(p.x, p.y, BOARD_FACE_Z + 0.002);
    }
    this.renderer.render(this.scene, this.camera);
  }

  tween(duration, update) {
    return new Promise((resolve) => this.tweens.add({ elapsed: 0, duration, update, resolve }));
  }

  pointTo(event) {
    if (!this.aiming) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.boardPlane, new THREE.Vector3());
    if (hit) this.aim.set(hit.x, hit.y);
  }

  /** 지금 던지면 꽂힐 곳: 포인터 위치에 손 떨림을 더한 점 */
  reticlePoint() {
    const t = this.time;
    return {
      x: this.aim.x + SWAY * (0.6 * Math.sin(t * 1.9) + 0.4 * Math.sin(t * 3.1 + 1.3)),
      y: this.aim.y + SWAY * (0.6 * Math.sin(t * 2.3 + 0.7) + 0.4 * Math.sin(t * 3.7)),
    };
  }

  setAiming(on) {
    this.aiming = on;
    this.reticle.visible = on;
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
  }

  // ---------- 다트 ----------

  /** point: 보드 평면 위 좌표 {x, y} (미터) */
  async throwDart(player, point) {
    const dart = this.makeDart(player);
    this.scene.add(dart);
    this.darts.push(dart);

    // 보드를 벗어나면 벽에 꽂힌다. 팁은 살짝 박힌다
    const onBoard = Math.hypot(point.x, point.y) <= BOARD_EDGE;
    const to = new THREE.Vector3(point.x, point.y, (onBoard ? BOARD_FACE_Z : 0) - 0.008);
    const behind = new THREE.Vector3();
    const place = (k) => {
      dart.position.lerpVectors(HAND, to, k);
      dart.position.y += Math.sin(Math.PI * k) * 0.07;
    };
    await this.tween(330, (k) => {
      // 팁이 진행 방향을 향하게 한다. lookAt 은 몸통(+z)을 목표로 돌리므로 지나온 쪽을 바라보게 한다
      place(Math.max(0, k - 0.02));
      behind.copy(dart.position);
      place(k);
      if (k > 0) dart.lookAt(behind);
    });
    // 꽂힌 자세: 꼬리가 살짝 들리고 조금씩 다르게 기운다
    dart.rotation.set(-0.12 - Math.random() * 0.1, (Math.random() - 0.5) * 0.2, Math.random() * Math.PI);

    this.popLabel(to);
  }

  clearDarts() {
    for (const dart of this.darts) this.scene.remove(dart);
    this.darts = [];
  }

  /** 꽂힌 자리에 잠깐 떠오르는 점수 라벨. 내용은 setHitText 로 정한다 */
  popLabel(position) {
    if (!this.hitText) return;
    const el = document.createElement('div');
    el.className = 'label hit';
    el.textContent = this.hitText;
    const p = position.clone().project(this.camera);
    el.style.left = `${((p.x + 1) / 2) * this.container.clientWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * this.container.clientHeight}px`;
    this.labelLayer.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  setHitText(text) {
    this.hitText = text;
  }
}
