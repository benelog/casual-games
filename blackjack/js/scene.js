// Three.js 블랙잭 테이블 씬. 게임 규칙은 모르고, main.js 가 시키는 대로 카드와 칩을 움직인다.
// 카드·칩·테이블 재질과 딜러 캐릭터는 poker/js/scene.js 의 것을 가져와 반달 모양 테이블에 맞게 고쳤다.
// 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createRenderer } from '../../shared/gpu.js';
import { cardId } from './cards.js';
import { formatNumber } from '../../shared/i18n.js';
import { t } from './i18n.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const CARD_W = 0.9;
const CARD_H = 1.3;
const CARD_Y = 0.012;
const TABLE_R = 6; // 반달 테이블 반지름
const TABLE_Z = -3; // 딜러 쪽 직선 가장자리. 원의 중심이기도 하다
const FLOOR_Y = -3;
const DEALER_HEIGHT = 5.3;
const CHIP_R = 0.2;
const CHIP_H = 0.05;
const MAX_HANDS = 4;
const DISCARD_STEP = 0.0016; // 버린 카드 한 장의 두께

const v = (x, z, y = 0) => new THREE.Vector3(x, y, z);
const POS = {
  shoe: v(4.4, -1.7),
  discard: v(-4.4, -1.7),
  rack: v(0, -2.55),
  stack: v(-4.1, -0.2),
  insurance: v(-1.75, 0.05),
  dealerZ: -1.5,
  cardZ: 0.9, // 플레이어 핸드의 첫 카드
  betZ: 2.0,
};
const DEALER_SPACING = 0.72; // 딜러 카드는 조금씩 겹쳐 놓는다
const FAN = { x: 0.3, z: -0.17 }; // 플레이어 카드는 딜러 쪽으로 비스듬히 쌓는다

const DENOMS = [
  { value: 500, image: 'chipGreenWhite', side: '#2f9e5c' },
  { value: 100, image: 'chipBlackWhite', side: '#2b2b2e' },
  { value: 50, image: 'chipBlueWhite', side: '#2d6fd1' },
  { value: 10, image: 'chipRedWhite', side: '#c8362e' },
];

const RANK_FILE = { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' };
const SUIT_FILE = ['spades', 'hearts', 'diamonds', 'clubs'];
const cardFile = (card) => `cards/${RANK_FILE[card.rank] ?? card.rank}_of_${SUIT_FILE[card.suit]}.png`;

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const fmt = formatNumber;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('imageFailed', { url })));
    img.src = url;
  });
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

async function loadPbr(loader, name, diffuse, repeatX, repeatY) {
  const load = async (suffix, srgb) => {
    const texture = await loader.loadAsync(asset(`textures/${name}_${suffix}_1k.jpg`));
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const [map, normalMap, roughnessMap] = await Promise.all([
    diffuse ? load(diffuse, true) : null,
    load('nor_gl'),
    load('rough'),
  ]);
  return { map, normalMap, roughnessMap };
}

function roundedRect(w, h, r) {
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** 금액을 액면가별 칩 개수로 나눈다. 큰 칩 한두 개만 남지 않도록 일부를 작은 칩으로 바꾼다. */
function chipBreakdown(amount, { spread = true } = {}) {
  const counts = DENOMS.map((d) => {
    const n = Math.floor(amount / d.value);
    amount -= n * d.value;
    return n;
  });
  if (amount > 0) counts[counts.length - 1]++; // 10 미만 끝수는 가장 작은 칩 하나로 보여 준다
  if (!spread) return counts;
  for (let i = 0; i < DENOMS.length - 1; i++) {
    if (counts[i] > 0 && counts[i + 1] < 4) {
      counts[i]--;
      counts[i + 1] += DENOMS[i].value / DENOMS[i + 1].value;
    }
  }
  return counts;
}

/** 원호를 따라 글자를 쓴다. 각도는 캔버스 기준 (y 가 아래), 가운데가 아래쪽인 미소 모양 */
function arcText(g, text, cx, cy, radius) {
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let angle = Math.PI / 2 + total / radius / 2;
  [...text].forEach((ch, i) => {
    const half = widths[i] / radius / 2;
    angle -= half;
    g.save();
    g.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    g.rotate(angle - Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
    angle -= half;
  });
}

export class TableScene {
  constructor(container) {
    this.container = container;
    this.renderer = createRenderer(THREE, { antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels';
    container.appendChild(this.labelLayer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d12);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);

    this.tweens = new Set();
    this.hands = []; // { cards: [mesh], chips: Group | null, bet }
    this.dealerCards = [];
    this.chipGroups = {};
    this.stack = 0;
    this.insurance = 0;
    this.discarded = 0;

    this.anchors = [];
    this.labels = {
      stack: this.addLabel('stack', POS.stack, 0.5),
      insurance: this.addLabel('insurance', POS.insurance, 0.3),
      dealer: this.addLabel('dealer', v(0, POS.dealerZ), 0.05),
      hands: Array.from({ length: MAX_HANDS }, () => this.addLabel('hand', v(0, POS.betZ + 0.3), 0)),
      bubble: this.addLabel('bubble', v(1.0, -4.6, 1.7), 0),
    };

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  async load() {
    const textures = new THREE.TextureLoader();
    const gltf = new GLTFLoader();
    const cardFiles = [];
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 2; rank <= 14; rank++) cardFiles.push({ rank, suit });
    }

    const [env, felt, leather, wood, floorWood, dealer, backImage, chipImages, cardImages] = await Promise.all([
      new RGBELoader().loadAsync(asset('hdri/warm_bar_1k.hdr')),
      loadPbr(textures, 'velour_velvet', null, 0.9, 0.9),
      loadPbr(textures, 'brown_leather', 'albedo', 14, 1),
      loadPbr(textures, 'dark_wood', 'diff', 1, 1),
      loadPbr(textures, 'dark_wood', 'diff', 10, 10),
      gltf.loadAsync(asset('models/BusinessMan.glb')),
      loadImage(asset('cards/back.png')),
      Promise.all(DENOMS.map((d) => loadImage(asset(`chips/${d.image}.png`)))),
      Promise.all(cardFiles.map((card) => loadImage(asset(cardFile(card))))),
    ]);

    this.cardImages = new Map(cardFiles.map((card, i) => [cardId(card), cardImages[i]]));

    env.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.6;
    this.scene.background = env;
    this.scene.backgroundBlurriness = 0.35;
    this.scene.backgroundIntensity = 0.3;

    this.woodMaterial = new THREE.MeshStandardMaterial({ ...wood });
    this.buildLights();
    this.buildRoom({ felt, leather, floorWood });
    this.buildDealer(dealer);
    this.buildCardAssets(backImage);
    this.buildChipAssets(chipImages);
    this.buildShoe();
    this.buildRack();

    this.last = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  // ---------- 씬 구성 ----------

  buildLights() {
    const spot = new THREE.SpotLight(0xffe2b8, 520, 40, 0.62, 0.55, 2);
    spot.position.set(0, 10, 2.2);
    spot.target.position.set(0, 0, -0.6);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.bias = -0.0005;
    spot.shadow.radius = 4;
    this.scene.add(spot, spot.target);

    const rim = new THREE.PointLight(0x7aa2ff, 60, 30);
    rim.position.set(-4, 4, -9);
    this.scene.add(rim);
  }

  buildRoom({ felt, leather, floorWood }) {
    // 테이블 로컬 좌표: 원의 중심이 원점, 플레이어 쪽이 +z 인 반원
    const table = new THREE.Group();
    table.position.z = TABLE_Z;

    const feltMaterial = new THREE.MeshPhysicalMaterial({
      ...felt,
      color: 0x14693f,
      roughness: 1,
      sheen: 0.6,
      sheenColor: new THREE.Color(0x4fd18c),
      sheenRoughness: 0.6,
    });

    // 반원을 위로 밀어 올려 상판을 만든다. 윗면(캡)은 펠트, 옆면은 목재
    const half = new THREE.Shape();
    half.moveTo(-TABLE_R, 0);
    half.absarc(0, 0, TABLE_R, Math.PI, Math.PI * 2, false);
    half.lineTo(-TABLE_R, 0);
    const top = new THREE.Mesh(
      new THREE.ExtrudeGeometry(half, { depth: 0.3, bevelEnabled: false, curveSegments: 96 }),
      [feltMaterial, this.woodMaterial],
    );
    top.rotation.x = -Math.PI / 2; // 모양의 -y 쪽이 +z (플레이어 쪽)
    top.position.y = -0.3;
    top.receiveShadow = true;

    // 플레이어 쪽 둥근 가장자리의 가죽 레일. 양 끝은 공으로 막는다
    const leatherMaterial = new THREE.MeshStandardMaterial({ ...leather, color: 0x9a7a66 });
    const rail = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R, 0.3, 24, 128, Math.PI), leatherMaterial);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.03;
    rail.castShadow = rail.receiveShadow = true;
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), leatherMaterial);
      cap.position.set(side * TABLE_R, 0.03, 0);
      cap.castShadow = true;
      table.add(cap);
    }

    // 딜러 쪽 직선 가장자리
    const edge = new THREE.Mesh(new THREE.BoxGeometry(TABLE_R * 2 + 0.6, 0.4, 0.3), this.woodMaterial);
    edge.position.set(0, -0.1, -0.15);
    edge.castShadow = edge.receiveShadow = true;

    const base = new THREE.Mesh(new THREE.BoxGeometry(TABLE_R * 1.1, -FLOOR_Y - 0.3, TABLE_R * 0.4), this.woodMaterial);
    base.position.set(0, (FLOOR_Y - 0.3) / 2, TABLE_R * 0.3);

    table.add(top, rail, edge, base, this.buildFeltPrint());
    this.scene.add(table);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ ...floorWood, color: 0x8a8a8a }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /** 펠트에 인쇄된 문구와 베팅 원. 테이블 로컬 좌표의 x -R..R, z 0..R 을 덮는 투명 평면 */
  buildFeltPrint() {
    const scale = 2048 / (TABLE_R * 2); // 단위당 픽셀
    const texture = canvasTexture(2048, 1024, (g) => {
      const cx = 1024;
      const cy = 0; // 캔버스 위쪽 가장자리가 딜러 쪽 직선
      g.textAlign = 'center';
      g.textBaseline = 'middle';

      // 딜러 카드(반지름 2.3 안쪽)와 플레이어 카드(3.2 바깥쪽) 사이에 들어가도록
      g.fillStyle = '#e8c56d';
      g.font = `bold ${0.32 * scale}px Georgia, serif`;
      arcText(g, 'BLACKJACK PAYS 3 TO 2', cx, cy, 2.52 * scale);

      g.fillStyle = 'rgba(243, 236, 220, 0.85)';
      g.font = `${0.16 * scale}px Georgia, serif`;
      arcText(g, 'DEALER MUST DRAW TO 16 AND STAND ON ALL 17s', cx, cy, 2.84 * scale);

      g.strokeStyle = 'rgba(231, 217, 168, 0.5)';
      g.lineWidth = 0.02 * scale;
      for (const r of [2.97, 3.27]) {
        g.beginPath();
        g.arc(cx, cy, r * scale, Math.PI * 0.1, Math.PI * 0.9);
        g.stroke();
      }
      g.fillStyle = 'rgba(243, 236, 220, 0.75)';
      g.font = `${0.15 * scale}px Georgia, serif`;
      arcText(g, 'INSURANCE PAYS 2 TO 1', cx, cy, 3.12 * scale);

      // 베팅 원
      g.strokeStyle = 'rgba(231, 217, 168, 0.6)';
      g.lineWidth = 0.03 * scale;
      g.beginPath();
      g.arc(cx, (POS.betZ - TABLE_Z) * scale, 0.42 * scale, 0, Math.PI * 2);
      g.stroke();
    });
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE_R * 2, TABLE_R),
      new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 1, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2; // 캔버스 위쪽이 -z
    plane.position.set(0, 0.002, TABLE_R / 2);
    plane.receiveShadow = true;
    return plane;
  }

  buildDealer(gltf) {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const scale = DEALER_HEIGHT / (box.max.y - box.min.y);
    model.scale.setScalar(scale);
    model.position.set(0, FLOOR_Y - box.min.y * scale, -4.6);
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.scene.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const name = clip.name.split('|').pop(); // 'CharacterArmature|Idle' -> 'Idle'
      const action = this.mixer.clipAction(clip);
      if (name !== 'Idle') {
        action.loop = THREE.LoopOnce;
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    }
    this.mixer.addEventListener('finished', () => this.playAction('Idle'));
    this.playAction('Idle');
  }

  playAction(name) {
    const next = this.actions[name];
    if (!next) return;
    if (next === this.activeAction && next.loop !== THREE.LoopOnce) return;
    if (this.activeAction && this.activeAction !== next) this.activeAction.fadeOut(0.3);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.3).play();
    this.activeAction = next;
  }

  /** mood: 'neutral' | 'hello' | 'act' | 'happy' | 'sad' */
  setMood(mood) {
    const clips = { neutral: 'Idle', hello: 'Wave', act: 'Interact', happy: 'Wave', sad: 'HitRecieve' };
    this.playAction(clips[mood]);
  }

  buildCardAssets(backImage) {
    const geometry = new THREE.ShapeGeometry(roundedRect(CARD_W, CARD_H, 0.06), 6);
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) / CARD_W + 0.5, pos.getY(i) / CARD_H + 0.5);
    }
    this.cardGeometry = geometry;

    // 회색조 무늬 이미지를 붉은 바탕에 곱해 뒷면을 만든다
    const backTexture = canvasTexture(256, 370, (g, w, h) => {
      g.fillStyle = '#f4efe4';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#a3201f';
      g.fillRect(12, 12, w - 24, h - 24);
      g.globalCompositeOperation = 'multiply';
      g.drawImage(backImage, 12, 12, w - 24, h - 24);
      g.drawImage(backImage, 12, 12, w - 24, h - 24);
    });
    this.backMaterial = new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.55 });
    this.paperMaterial = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.7 });
  }

  /** 카드 더미 상자. 윗면이 카드 뒷면 */
  cardBlock(height) {
    const p = this.paperMaterial;
    const block = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, height, CARD_H), [p, p, this.backMaterial, p, p, p]);
    block.castShadow = block.receiveShadow = true;
    return block;
  }

  /** 딜러 오른쪽(화면 오른쪽)의 카드 슈와 왼쪽의 버린 카드 더미 */
  buildShoe() {
    const shoe = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.42, 1.6), this.woodMaterial);
    box.position.y = 0.21;
    box.castShadow = box.receiveShadow = true;
    const cards = this.cardBlock(0.06);
    cards.position.set(0, 0.42, 0.05);
    shoe.add(box, cards);
    shoe.position.copy(POS.shoe);
    shoe.rotation.y = 0.45;
    this.scene.add(shoe);
    this.shoeTop = POS.shoe.clone().setY(0.5);

    const tray = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 1.55), this.woodMaterial);
    base.position.y = 0.025;
    base.castShadow = base.receiveShadow = true;
    this.discardPile = this.cardBlock(1);
    this.discardPile.visible = false;
    tray.add(base, this.discardPile);
    tray.position.copy(POS.discard);
    tray.rotation.y = -0.45;
    this.scene.add(tray);
  }

  buildChipAssets(images) {
    this.chipGeometry = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 28);
    this.chipMaterials = DENOMS.map((denom, i) => {
      const face = canvasTexture(128, 128, (g) => {
        g.fillStyle = '#f4f1ea';
        g.fillRect(0, 0, 128, 128);
        g.drawImage(images[i], 0, 0, 128, 128);
        g.fillStyle = '#ffffff';
        g.font = `bold ${denom.value >= 100 ? 30 : 36}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(denom.value), 64, 66);
      });
      const edge = canvasTexture(128, 16, (g) => {
        g.fillStyle = denom.side;
        g.fillRect(0, 0, 128, 16);
        g.fillStyle = '#f4f1ea';
        for (let x = 0; x < 128; x += 32) g.fillRect(x, 3, 12, 10);
      });
      edge.wrapS = THREE.RepeatWrapping;
      edge.repeat.x = 2;
      const top = new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 });
      return [new THREE.MeshStandardMaterial({ map: edge, roughness: 0.5 }), top, top];
    });
  }

  /** 딜러 앞의 칩 트레이. 진 베팅은 여기로 가고, 이긴 금액은 여기서 나온다 */
  buildRack() {
    const rack = new THREE.Group();
    const tubes = 8;
    const pitch = 0.46;
    const tray = new THREE.Mesh(new THREE.BoxGeometry(tubes * pitch + 0.2, 0.12, 0.75), this.woodMaterial);
    tray.position.y = 0.06;
    tray.castShadow = tray.receiveShadow = true;
    rack.add(tray);
    for (let t = 0; t < tubes; t++) {
      const material = this.chipMaterials[Math.floor(t / 2)];
      for (let n = 0; n < 12; n++) {
        const chip = new THREE.Mesh(this.chipGeometry, material);
        chip.rotation.x = Math.PI / 2; // 눕혀서 앞뒤로 줄지어 놓는다
        chip.rotation.y = n * 0.9;
        chip.position.set((t - (tubes - 1) / 2) * pitch, 0.12 + CHIP_R * 0.55, (n - 5.5) * CHIP_H * 1.05);
        chip.castShadow = true;
        rack.add(chip);
      }
    }
    rack.position.copy(POS.rack);
    this.scene.add(rack);
  }

  // ---------- 프레임 / 레이아웃 ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 세로로 긴 화면에서는 테이블 전체가 보이도록 뒤로 물러난다
    const distance = Math.max(1, 1.5 / this.camera.aspect);
    const target = new THREE.Vector3(0, 0, -0.5);
    this.camera.position.set(0, 8.6, 7.9).sub(target).multiplyScalar(distance).add(target);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    for (const t of this.tweens) {
      t.elapsed += dt * 1000;
      const k = Math.min(1, t.elapsed / t.duration);
      t.update(easeInOut(k));
      if (k === 1) {
        this.tweens.delete(t);
        t.resolve();
      }
    }
    this.mixer?.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  tween(duration, update) {
    return new Promise((resolve) => this.tweens.add({ elapsed: 0, duration, update, resolve }));
  }

  wait(ms) {
    return this.tween(ms, () => {});
  }

  move(object, to, duration, { lift = 0, rotZ, rotY } = {}) {
    const from = object.position.clone();
    const startZ = object.rotation.z;
    const startY = object.rotation.y;
    return this.tween(duration, (k) => {
      object.position.lerpVectors(from, to, k);
      object.position.y += Math.sin(Math.PI * k) * lift;
      if (rotZ !== undefined) object.rotation.z = startZ + (rotZ - startZ) * k;
      if (rotY !== undefined) object.rotation.y = startY + (rotY - startY) * k;
    });
  }

  addLabel(className, position, height) {
    const el = document.createElement('div');
    el.className = `label ${className}`;
    el.hidden = true;
    el.anchor = position.clone().setY(position.y + height);
    this.labelLayer.appendChild(el);
    this.anchors.push(el);
    return el;
  }

  setLabel(el, text) {
    el.textContent = text;
    el.hidden = !text;
  }

  updateLabels() {
    const { clientWidth: w, clientHeight: h } = this.container;
    const p = new THREE.Vector3();
    for (const el of this.anchors) {
      if (el.hidden) continue;
      p.copy(el.anchor).project(this.camera);
      el.style.left = `${((p.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - p.y) / 2) * h}px`;
    }
  }

  say(text) {
    this.setLabel(this.labels.bubble, text);
  }

  // ---------- 자리 계산 ----------

  /** 핸드가 count 개일 때 index 번째 핸드의 가로 위치 */
  handX(index, count = this.hands.length) {
    // 핸드가 많아지면 레일 안쪽에 들어오도록 간격을 줄인다
    const spacing = count > 1 ? Math.min(2.3, 4.8 / (count - 1)) : 0;
    return (index - (count - 1) / 2) * spacing;
  }

  betSpot(index, count) {
    return v(this.handX(index, count), POS.betZ);
  }

  cardSlot(index, k, sideways) {
    const x = this.handX(index) + (k - 0.5) * FAN.x;
    const z = POS.cardZ + k * FAN.z;
    // 더블로 받은 카드는 옆으로 눕혀 조금 더 비켜 놓는다
    return sideways ? v(x + 0.22, z - 0.1, CARD_Y + k * 0.004) : v(x, z, CARD_Y + k * 0.004);
  }

  dealerSlot(k, count) {
    return v((k - (count - 1) / 2) * DEALER_SPACING, POS.dealerZ, CARD_Y + k * 0.004);
  }

  // ---------- 칩 ----------

  /** layout: 'tower' 는 한 줄로 쌓기 (베팅), 'grid' 는 액면가별 2×2 더미 (가진 칩) */
  buildChips(amount, layout = 'tower') {
    const group = new THREE.Group();
    const counts = chipBreakdown(amount, { spread: layout !== 'tower' });
    const add = (denom, x, y, z, n) => {
      const chip = new THREE.Mesh(this.chipGeometry, this.chipMaterials[denom]);
      chip.position.set(x, y, z);
      chip.rotation.y = (n * 1.7 + denom) % (Math.PI * 2);
      chip.castShadow = chip.receiveShadow = true;
      group.add(chip);
    };
    if (layout === 'tower') {
      let n = 0;
      counts.forEach((count, denom) => {
        for (let c = 0; c < count; c++, n++) add(denom, 0, CHIP_H / 2 + n * CHIP_H, 0, n);
      });
    } else {
      counts.forEach((count, denom) => {
        const x = ((denom % 2) - 0.5) * 0.44;
        const z = (Math.floor(denom / 2) - 0.5) * 0.44;
        for (let n = 0; n < count; n++) add(denom, x, CHIP_H / 2 + n * CHIP_H, z, n);
      });
    }
    return group;
  }

  placeChips(key, amount, position, layout) {
    if (this.chipGroups[key]) this.scene.remove(this.chipGroups[key]);
    this.chipGroups[key] = null;
    if (!amount) return null;
    const group = this.buildChips(amount, layout);
    group.position.copy(position);
    this.scene.add(group);
    this.chipGroups[key] = group;
    return group;
  }

  setStack(amount) {
    this.stack = amount;
    this.placeChips('stack', amount, POS.stack, 'grid');
    this.setLabel(this.labels.stack, t('chips', { amount: fmt(amount) }));
  }

  setInsurance(amount) {
    this.insurance = amount;
    this.placeChips('insurance', amount, POS.insurance);
    this.setLabel(this.labels.insurance, amount ? t('insurance', { amount: fmt(amount) }) : '');
  }

  setHandBet(index, amount) {
    const hand = this.hands[index];
    if (hand.chips) this.scene.remove(hand.chips);
    hand.chips = null;
    hand.bet = amount;
    if (!amount) return;
    hand.chips = this.buildChips(amount);
    hand.chips.position.copy(this.betSpot(index, this.hands.length));
    this.scene.add(hand.chips);
  }

  ensureHand(index) {
    while (this.hands.length <= index) this.hands.push({ cards: [], chips: null, bet: 0 });
    return this.hands[index];
  }

  /** snap: { chips, bets: [핸드별 베팅], insurance } */
  setChips(snap) {
    this.placeChips('preview', 0);
    this.setStack(snap.chips);
    snap.bets.forEach((amount, i) => {
      this.ensureHand(i);
      this.setHandBet(i, amount);
    });
    this.setInsurance(snap.insurance);
  }

  /** 베팅 단계에서 고르는 중인 금액을 베팅 원에 보여 준다 */
  previewBet(amount, chips) {
    this.setStack(chips - amount);
    this.placeChips('preview', amount, this.betSpot(0, 1));
  }

  async flyChips(amount, from, to, duration = 380) {
    const group = this.buildChips(amount);
    group.position.copy(from);
    this.scene.add(group);
    await this.move(group, to, duration, { lift: 0.6 });
    this.scene.remove(group);
  }

  /** 늘어난 베팅(첫 베팅, 더블, 스플릿, 인슈어런스)만큼 가진 칩에서 날려 보낸다 */
  async animateBet(snap) {
    this.setStack(snap.chips);
    const flights = [];
    snap.bets.forEach((amount, i) => {
      const diff = amount - (this.hands[i]?.bet ?? 0);
      if (diff > 0) flights.push(this.flyChips(diff, POS.stack, this.betSpot(i, snap.bets.length)));
    });
    if (snap.insurance > this.insurance) {
      flights.push(this.flyChips(snap.insurance - this.insurance, POS.stack, POS.insurance));
    }
    await Promise.all(flights);
    this.setChips(snap);
  }

  /** 진 칩을 딜러 트레이로 거둬 간다 */
  async takeChips(group) {
    if (!group) return;
    await this.move(group, POS.rack.clone().setY(0.2), 420, { lift: 0.5 });
    this.scene.remove(group);
  }

  /** 이긴 금액을 트레이에서 가져와 원금과 함께 가진 칩으로 옮긴다 */
  async payChips(group, spot, winnings) {
    if (winnings > 0) {
      const beside = spot.clone().add(v(0.42, 0));
      await this.flyChips(winnings, POS.rack.clone().setY(0.2), beside, 420);
      const prize = this.buildChips(winnings);
      prize.position.copy(beside);
      this.scene.add(prize);
      await this.wait(250);
      await Promise.all([this.move(group, POS.stack, 420, { lift: 0.5 }), this.move(prize, POS.stack, 420, { lift: 0.5 })]);
      this.scene.remove(prize);
    } else {
      await this.move(group, POS.stack, 420, { lift: 0.5 });
    }
    this.scene.remove(group);
  }

  async insuranceResult(ev, snap) {
    const group = this.chipGroups.insurance;
    this.chipGroups.insurance = null;
    this.setLabel(this.labels.insurance, '');
    if (ev.won) await this.payChips(group, POS.insurance, ev.payout - ev.amount);
    else await this.takeChips(group);
    this.insurance = 0;
    this.setStack(snap.chips);
  }

  /** 버스트한 핸드의 베팅은 바로 거둬 간다 */
  async loseHand(index) {
    const hand = this.hands[index];
    this.dimHand(index);
    const group = hand.chips;
    hand.chips = null;
    hand.bet = 0;
    await this.takeChips(group);
  }

  /** results: [{ hand, outcome, bet, payout }] */
  async settle(results, snap) {
    await Promise.all(
      results.map(async (r, k) => {
        const hand = this.hands[r.hand];
        const group = hand.chips;
        hand.chips = null;
        hand.bet = 0;
        await this.wait(k * 160);
        if (r.payout === 0) {
          this.dimHand(r.hand);
          await this.takeChips(group);
        } else if (group) {
          await this.payChips(group, this.betSpot(r.hand, this.hands.length), r.payout - r.bet);
        }
      }),
    );
    this.setStack(snap.chips);
  }

  // ---------- 카드 ----------

  makeCard(card) {
    const faceMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55 });
    const front = new THREE.Mesh(this.cardGeometry, faceMaterial);
    front.rotation.x = -Math.PI / 2;
    front.position.y = 0.004;
    const back = new THREE.Mesh(this.cardGeometry, this.backMaterial);
    back.rotation.x = Math.PI / 2;
    back.position.y = -0.004;
    front.castShadow = back.castShadow = true;

    const group = new THREE.Group();
    group.add(front, back);
    group.rotation.z = Math.PI; // 뒷면이 위
    group.position.copy(this.shoeTop);
    group.userData = { faceMaterial };
    if (card) this.setCardFace(group, card);
    this.scene.add(group);
    return group;
  }

  /** 홀 카드는 무엇인지 모르는 채로 놓았다가 공개할 때 앞면을 입힌다 */
  setCardFace(mesh, card) {
    const texture = canvasTexture(240, 347, (g, w, h) => {
      g.fillStyle = '#fbf8f0';
      g.fillRect(0, 0, w, h);
      g.drawImage(this.cardImages.get(cardId(card)), 9, 12, w - 18, h - 24);
    });
    const material = mesh.userData.faceMaterial;
    material.map?.dispose();
    material.map = texture;
    material.needsUpdate = true;
  }

  disposeCard(card) {
    this.scene.remove(card);
    card.userData.faceMaterial.map?.dispose();
    card.userData.faceMaterial.dispose();
  }

  flip(card) {
    return this.move(card, card.position.clone(), 300, { lift: 0.5, rotZ: 0 });
  }

  dimHand(index) {
    for (const card of this.hands[index]?.cards ?? []) card.userData.faceMaterial.color.set(0x6a6a6a);
  }

  /** { to: 'player' | 'dealer', hand, card, faceDown, sideways } */
  async dealCard({ to, hand: index, card, faceDown, sideways }) {
    const mesh = this.makeCard(card);
    let slot;
    let relayout = [];
    if (to === 'dealer') {
      this.dealerCards.push(mesh);
      relayout = this.layoutDealer(mesh);
      slot = this.dealerSlot(this.dealerCards.length - 1, this.dealerCards.length);
    } else {
      const hand = this.ensureHand(index);
      hand.cards.push(mesh);
      mesh.userData.sideways = !!sideways;
      slot = this.cardSlot(index, hand.cards.length - 1, sideways);
    }
    await Promise.all([
      this.move(mesh, slot, 340, { lift: 0.5, rotY: sideways ? Math.PI / 2 : undefined }),
      ...relayout,
    ]);
    if (!faceDown) await this.flip(mesh);
  }

  /** 딜러 카드를 새 장수에 맞춰 가운데로 다시 놓는다 */
  layoutDealer(except) {
    const count = this.dealerCards.length;
    const moves = this.dealerCards
      .map((mesh, k) => (mesh === except ? null : this.move(mesh, this.dealerSlot(k, count), 280)))
      .filter(Boolean);
    const right = this.dealerSlot(count - 1, count).x + CARD_W / 2 + 0.15;
    this.labels.dealer.anchor.set(right, 0.05, POS.dealerZ);
    return moves;
  }

  /** 딜러가 홀 카드 귀퉁이를 들어 블랙잭인지 확인한다 */
  async peek() {
    const mesh = this.dealerCards[1];
    if (!mesh) return;
    const rest = mesh.position.clone();
    const tilt = mesh.rotation.x;
    await this.tween(260, (k) => {
      mesh.position.y = rest.y + 0.12 * k;
      mesh.rotation.x = tilt - 0.35 * k;
    });
    await this.wait(250);
    await this.tween(260, (k) => {
      mesh.position.y = rest.y + 0.12 * (1 - k);
      mesh.rotation.x = tilt - 0.35 * (1 - k);
    });
  }

  async revealHole(card) {
    const mesh = this.dealerCards[1];
    if (!mesh) return;
    this.setCardFace(mesh, card);
    await this.flip(mesh);
  }

  /** 스플릿: index 번째 핸드의 두 번째 카드를 새 핸드로 옮기고 핸드들을 다시 배치한다 */
  async splitHand(index) {
    const hand = this.hands[index];
    const moved = hand.cards.pop();
    this.hands.splice(index + 1, 0, { cards: [moved], chips: null, bet: 0 });
    await this.layoutHands();
  }

  layoutHands() {
    const moves = [];
    this.hands.forEach((hand, i) => {
      hand.cards.forEach((mesh, k) => moves.push(this.move(mesh, this.cardSlot(i, k, mesh.userData.sideways), 360)));
      if (hand.chips) moves.push(this.move(hand.chips, this.betSpot(i, this.hands.length), 360));
    });
    this.updateHandAnchors();
    return Promise.all(moves);
  }

  updateHandAnchors() {
    this.labels.hands.forEach((el, i) => el.anchor.set(this.handX(i), 0, POS.betZ + 0.32));
    if (this.activeIndex !== null && this.activeIndex !== undefined) this.setActive(this.activeIndex);
  }

  /** 지금 행동할 핸드를 표시한다. null 이면 표시하지 않는다 */
  setActive(index) {
    this.activeIndex = index;
    this.labels.hands.forEach((el, i) => el.classList.toggle('active', i === index && this.hands.length > 1));
  }

  /** text 가 빈 문자열이면 숨긴다. tone: 'win' | 'lose' | 'push' | undefined */
  setHandLabel(index, text, tone) {
    const el = this.labels.hands[index];
    if (!el) return;
    this.updateHandAnchors();
    this.setLabel(el, text);
    if (tone) el.dataset.tone = tone;
    else delete el.dataset.tone;
  }

  setDealerLabel(text) {
    this.setLabel(this.labels.dealer, text);
  }

  /** 라운드가 끝난 카드를 모두 버린 카드 더미로 치운다 */
  async clearTable() {
    const cards = [...this.dealerCards, ...this.hands.flatMap((h) => h.cards)];
    for (const hand of this.hands) if (hand.chips) this.scene.remove(hand.chips);
    this.hands = [];
    this.dealerCards = [];
    this.setActive(null);
    for (const el of this.labels.hands) this.setLabel(el, '');
    this.setDealerLabel('');
    if (cards.length === 0) return;
    const to = POS.discard.clone().setY(0.08 + this.discarded * DISCARD_STEP);
    await Promise.all(
      cards.map((card, k) =>
        this.wait(k * 30).then(() => this.move(card, to, 420, { lift: 0.5, rotZ: Math.PI, rotY: -0.45 })),
      ),
    );
    for (const card of cards) this.disposeCard(card);
    this.setDiscarded(this.discarded + cards.length);
  }

  setDiscarded(count) {
    this.discarded = count;
    const height = Math.max(0.01, count * DISCARD_STEP);
    this.discardPile.visible = count > 0;
    this.discardPile.scale.y = height;
    this.discardPile.position.y = 0.05 + height / 2;
  }

  /** 슈를 다시 섞는다: 버린 카드 더미를 슈로 돌려보낸다 */
  async shuffle() {
    if (this.discarded === 0) return;
    const pile = this.cardBlock(this.discarded * DISCARD_STEP);
    pile.position.copy(POS.discard).setY(0.05 + (this.discarded * DISCARD_STEP) / 2);
    pile.rotation.y = -0.45;
    this.scene.add(pile);
    this.setDiscarded(0);
    await this.move(pile, this.shoeTop, 700, { lift: 1.2, rotY: 0.45 });
    this.scene.remove(pile);
  }
}
