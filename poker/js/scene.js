// Three.js 테이블 씬. 게임 규칙은 모르고, main.js 가 시키는 대로 카드와 칩을 움직인다.
// 사용한 오픈소스 에셋의 출처는 assets/CREDITS.md 참고.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { cardId } from './cards.js';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const CARD_W = 0.9;
const CARD_H = 1.3;
const CARD_Y = 0.012;
const TABLE_R = 4;
const TABLE_STRETCH = 1.55; // x 방향으로 늘려 타원형으로
const FLOOR_Y = -3;
const OPPONENT_HEIGHT = 5.3;
const DECK_HEIGHT = 0.22;
const CHIP_R = 0.2;
const CHIP_H = 0.05;
const MY_CARD_SCALE = 1.25;

const v = (x, z, y = 0) => new THREE.Vector3(x, y, z);
const POS = {
  deck: v(4.3, -0.2),
  board: (i) => v((i - 2) * 1.05, -0.2),
  bet: [v(0, 0.85), v(0, -1.5)],
  stack: [v(3.9, 2.1), v(-3.8, -2.2)],
  pot: v(-3.9, -0.2),
  button: [v(-3.2, 2.3), v(3.0, -2.6)],
};
// 각자의 카드 줄. forward 는 상대에게 공개된 카드를 테이블 중앙 쪽으로 내미는 거리
const HOLE = [
  { z: 2.2, spacing: 1.22, forward: -0.3 },
  { z: -2.7, spacing: 1.0, forward: 0.3 },
];
const HOLE_SPAN = 4.2; // 카드가 많아지면 이 폭 안에서 겹쳐 놓는다
const SELECT_SHIFT = 0.45;

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
const fmt = (n) => n.toLocaleString('ko-KR');

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${url}`));
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

/** 금액을 칩 개수로 나눈다. 큰 칩 한두 개만 남지 않도록 일부를 작은 칩으로 바꾼다. */
function chipBreakdown(amount) {
  const counts = DENOMS.map((d) => {
    const n = Math.floor(amount / d.value);
    amount -= n * d.value;
    return n;
  });
  if (amount > 0) counts[counts.length - 1]++;
  for (let i = 0; i < DENOMS.length - 1; i++) {
    if (counts[i] > 0 && counts[i + 1] < 4) {
      counts[i]--;
      counts[i + 1] += DENOMS[i].value / DENOMS[i + 1].value;
    }
  }
  return counts;
}

export class TableScene {
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
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);

    this.tweens = new Set();
    this.cards = { hole: [[], []], board: [] };
    this.chipGroups = {};
    this.snap = { chips: [0, 0], bets: [0, 0], pot: 0 };
    this.names = ['나', '컴퓨터'];
    this.opponentRevealed = false;

    this.anchors = [];
    this.labels = {
      pot: this.addLabel('pot', POS.pot, 0.9),
      bets: POS.bet.map((p) => this.addLabel('bet', v(p.x + 0.5, p.z), 0.1)),
      stacks: POS.stack.map((p) => this.addLabel('stack', p, 0.9)),
      bubble: this.addLabel('bubble', v(1.0, -5.6, 1.7), 0),
    };

    this.selecting = null;
    this.raycaster = new THREE.Raycaster();
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));

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

    const [env, felt, leather, wood, floorWood, opponent, chair, backImage, chipImages, cardImages] = await Promise.all([
      new RGBELoader().loadAsync(asset('hdri/warm_bar_1k.hdr')),
      loadPbr(textures, 'velour_velvet', null, 7, 7),
      loadPbr(textures, 'brown_leather', 'albedo', 14, 1),
      loadPbr(textures, 'dark_wood', 'diff', 3, 1),
      loadPbr(textures, 'dark_wood', 'diff', 10, 10),
      gltf.loadAsync(asset('models/BusinessMan.glb')),
      gltf.loadAsync(asset('models/dining_chair_02/dining_chair_02_1k.gltf')),
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

    this.buildLights();
    this.buildRoom({ felt, leather, wood, floorWood }, chair.scene);
    this.buildOpponent(opponent);
    this.buildCardAssets(backImage);
    this.buildChipAssets(chipImages);
    this.buildDealerButton();

    this.last = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  // ---------- 씬 구성 ----------

  buildLights() {
    const spot = new THREE.SpotLight(0xffe2b8, 520, 40, 0.62, 0.55, 2);
    spot.position.set(0, 10, 2.5);
    spot.target.position.set(0, 0, -0.5);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.bias = -0.0005;
    spot.shadow.radius = 4;
    this.scene.add(spot, spot.target);

    const rim = new THREE.PointLight(0x7aa2ff, 60, 30);
    rim.position.set(-4, 4, -9);
    this.scene.add(rim);
  }

  buildRoom({ felt, leather, wood, floorWood }, chairModel) {
    const table = new THREE.Group();
    table.scale.x = TABLE_STRETCH;

    const feltMaterial = new THREE.MeshPhysicalMaterial({
      ...felt,
      color: 0x14693f,
      roughness: 1,
      sheen: 0.6,
      sheenColor: new THREE.Color(0x4fd18c),
      sheenRoughness: 0.6,
    });
    const woodMaterial = new THREE.MeshStandardMaterial({ ...wood });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.3, 96), [
      woodMaterial,
      feltMaterial,
      woodMaterial,
    ]);
    top.position.y = -0.15;
    top.receiveShadow = true;

    // 베팅 라인
    const line = new THREE.Mesh(
      new THREE.RingGeometry(TABLE_R * 0.8, TABLE_R * 0.8 + 0.025, 128),
      new THREE.MeshBasicMaterial({ color: 0xe7d9a8, transparent: true, opacity: 0.35 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.002;

    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE_R + 0.08, 0.3, 24, 128),
      new THREE.MeshStandardMaterial({ ...leather, color: 0x9a7a66 }),
    );
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.03;
    rail.castShadow = rail.receiveShadow = true;

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE_R * 0.55, TABLE_R * 0.4, -FLOOR_Y - 0.3, 48),
      woodMaterial,
    );
    pedestal.position.y = (FLOOR_Y - 0.3) / 2;
    table.add(top, line, rail, pedestal);
    this.scene.add(table);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ ...floorWood, color: 0x8a8a8a }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // glTF 는 미터 단위. 테이블 높이(3) ≈ 0.75m 에 맞춘다
    for (const side of [-1, 1]) {
      const chair = chairModel.clone();
      chair.scale.setScalar(4);
      chair.position.set(side * 7.6, FLOOR_Y, -3.2);
      chair.rotation.y = -side * 1.15;
      chair.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      this.scene.add(chair);
    }
  }

  buildOpponent(gltf) {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const scale = OPPONENT_HEIGHT / (box.max.y - box.min.y);
    model.scale.setScalar(scale);
    model.position.set(0, FLOOR_Y - box.min.y * scale, -5.6);
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
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.actions.Death) this.playAction('Idle');
    });
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

  /** mood: 'neutral' | 'hello' | 'act' | 'happy' | 'sad' | 'dead' */
  setMood(mood) {
    const clips = { neutral: 'Idle', hello: 'Wave', act: 'Interact', happy: 'Wave', sad: 'HitRecieve', dead: 'Death' };
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

    const paper = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.7 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, DECK_HEIGHT, CARD_H), [
      paper,
      paper,
      this.backMaterial,
      paper,
      paper,
      paper,
    ]);
    deck.position.copy(POS.deck).setY(DECK_HEIGHT / 2);
    deck.castShadow = true;
    this.scene.add(deck);
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

  buildDealerButton() {
    const face = canvasTexture(128, 128, (g) => {
      g.fillStyle = '#f7f3e8';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#1b1b1f';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(64, 64, 52, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#1b1b1f';
      g.font = 'bold 70px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('D', 64, 68);
    });
    const side = new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.4 });
    const top = new THREE.MeshStandardMaterial({ map: face, roughness: 0.4 });
    this.dealerButton = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.07, 32), [side, top, side]);
    this.dealerButton.position.copy(POS.button[0]).setY(0.035);
    this.dealerButton.rotation.y = Math.PI / 2; // 'D' 가 플레이어 쪽에서 바로 보이도록
    this.dealerButton.castShadow = true;
    this.scene.add(this.dealerButton);
  }

  // ---------- 프레임 / 레이아웃 ----------

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 세로로 긴 화면에서는 테이블 전체가 보이도록 뒤로 물러난다
    const distance = Math.max(1, 1.5 / this.camera.aspect);
    const target = new THREE.Vector3(0, 0, -0.3);
    this.camera.position.set(0, 8.2, 8.6).sub(target).multiplyScalar(distance).add(target);
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

  move(object, to, duration, { lift = 0, rotZ } = {}) {
    const from = object.position.clone();
    const startZ = object.rotation.z;
    return this.tween(duration, (k) => {
      object.position.lerpVectors(from, to, k);
      object.position.y += Math.sin(Math.PI * k) * lift;
      if (rotZ !== undefined) object.rotation.z = startZ + (rotZ - startZ) * k;
    });
  }

  addLabel(className, position, height) {
    const el = document.createElement('div');
    el.className = `label ${className}`;
    el.hidden = true;
    this.labelLayer.appendChild(el);
    this.anchors.push({ el, position: position.clone().setY(position.y + height) });
    return el;
  }

  setLabel(el, text) {
    el.textContent = text;
    el.hidden = !text;
  }

  updateLabels() {
    const { clientWidth: w, clientHeight: h } = this.container;
    const p = new THREE.Vector3();
    for (const { el, position } of this.anchors) {
      if (el.hidden) continue;
      p.copy(position).project(this.camera);
      el.style.left = `${((p.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - p.y) / 2) * h}px`;
    }
  }

  say(text) {
    this.setLabel(this.labels.bubble, text);
  }

  // ---------- 칩 ----------

  buildChips(amount) {
    const group = new THREE.Group();
    const counts = chipBreakdown(amount);
    const piles = counts.map((count, i) => ({ count, i })).filter((p) => p.count > 0);
    piles.forEach(({ count, i }, pileIndex) => {
      for (let n = 0; n < count; n++) {
        const chip = new THREE.Mesh(this.chipGeometry, this.chipMaterials[i]);
        chip.position.set((pileIndex - (piles.length - 1) / 2) * 0.47, CHIP_H / 2 + n * CHIP_H, 0);
        chip.rotation.y = (n * 1.7 + i) % (Math.PI * 2);
        chip.castShadow = chip.receiveShadow = true;
        group.add(chip);
      }
    });
    return group;
  }

  placeChips(key, amount, position) {
    if (this.chipGroups[key]) this.scene.remove(this.chipGroups[key]);
    const group = this.buildChips(amount);
    group.position.copy(position);
    this.scene.add(group);
    this.chipGroups[key] = group;
  }

  setChips(snap) {
    this.snap = snap;
    for (const i of [0, 1]) {
      this.placeChips(`stack${i}`, snap.chips[i], POS.stack[i]);
      this.placeChips(`bet${i}`, snap.bets[i], POS.bet[i]);
      this.setLabel(this.labels.stacks[i], `${this.names[i]} ${fmt(snap.chips[i])}`);
      this.setLabel(this.labels.bets[i], snap.bets[i] ? fmt(snap.bets[i]) : '');
    }
    this.placeChips('pot', snap.pot, POS.pot);
    this.setLabel(this.labels.pot, snap.pot ? `팟 ${fmt(snap.pot)}` : '');
  }

  async flyChips(amount, from, to) {
    const group = this.buildChips(amount);
    group.position.copy(from);
    this.scene.add(group);
    await this.move(group, to, 380, { lift: 0.6 });
    this.scene.remove(group);
  }

  async animateBet(player, snap) {
    const amount = snap.bets[player] - this.snap.bets[player];
    if (amount > 0) {
      this.placeChips(`stack${player}`, snap.chips[player], POS.stack[player]);
      await this.flyChips(amount, POS.stack[player], POS.bet[player]);
    }
    this.setChips(snap);
  }

  async collectBets(snap) {
    const moves = [0, 1]
      .filter((i) => this.snap.bets[i] > 0)
      .map((i) => this.move(this.chipGroups[`bet${i}`], POS.pot, 420, { lift: 0.4 }));
    for (const el of this.labels.bets) this.setLabel(el, '');
    await Promise.all(moves);
    this.setChips(snap);
  }

  async awardPot(amounts, snap) {
    this.placeChips('pot', 0, POS.pot);
    this.setLabel(this.labels.pot, '');
    await Promise.all(
      [0, 1].filter((i) => amounts[i] > 0).map((i) => this.flyChips(amounts[i], POS.pot, POS.stack[i])),
    );
    this.setChips(snap);
  }

  setDealer(player) {
    return this.move(this.dealerButton, POS.button[player].clone().setY(0.035), 500, { lift: 0.3 });
  }

  // ---------- 카드 ----------

  makeCard(card) {
    const texture = canvasTexture(240, 347, (g, w, h) => {
      g.fillStyle = '#fbf8f0';
      g.fillRect(0, 0, w, h);
      g.drawImage(this.cardImages.get(cardId(card)), 9, 12, w - 18, h - 24);
    });
    const faceMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55 });
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
    group.position.copy(POS.deck).setY(DECK_HEIGHT + CARD_Y);
    group.userData = { id: cardId(card), faceMaterial };
    this.scene.add(group);
    return group;
  }

  allCards() {
    return [...this.cards.hole[0], ...this.cards.hole[1], ...this.cards.board];
  }

  clearCards() {
    for (const card of this.allCards()) this.disposeCard(card);
    this.cards = { hole: [[], []], board: [] };
    this.opponentRevealed = false;
  }

  disposeCard(card) {
    this.scene.remove(card);
    card.userData.faceMaterial.map.dispose();
    card.userData.faceMaterial.dispose();
  }

  flip(card) {
    return this.move(card, card.position.clone(), 360, { lift: 0.6, rotZ: 0 });
  }

  holeSlot(player, index, count, up) {
    const row = HOLE[player];
    const spacing = count > 1 ? Math.min(row.spacing, HOLE_SPAN / (count - 1)) : row.spacing;
    // 겹칠 때 오른쪽 카드가 위로 오도록 조금씩 높인다
    return v((index - (count - 1) / 2) * spacing, row.z + (up ? row.forward : 0), CARD_Y + index * 0.004);
  }

  showsFace(player, card) {
    return player === 0 || card.userData.up || this.opponentRevealed;
  }

  /** entries: [{ player, card, up }] — up 은 상대에게 공개되는 카드 */
  async dealCards(entries) {
    const fresh = entries.map(({ player, card, up }) => {
      const mesh = this.makeCard(card);
      mesh.userData.up = up;
      if (player === 0) mesh.scale.setScalar(MY_CARD_SCALE);
      this.cards.hole[player].push(mesh);
      return { player, mesh };
    });
    const isFresh = new Set(fresh.map((f) => f.mesh));
    const slotOf = (player, mesh) => {
      const row = this.cards.hole[player];
      return this.holeSlot(player, row.indexOf(mesh), row.length, mesh.userData.up);
    };

    // 이미 놓인 카드는 새 간격에 맞춰 옮긴다
    const moves = [];
    for (const player of [0, 1]) {
      for (const mesh of this.cards.hole[player]) {
        if (!isFresh.has(mesh)) moves.push(this.move(mesh, slotOf(player, mesh), 300));
      }
    }
    for (const { player, mesh } of fresh) {
      moves.push(
        this.move(mesh, slotOf(player, mesh), 380, { lift: 0.5 }).then(
          () => this.showsFace(player, mesh) && this.flip(mesh),
        ),
      );
      await this.wait(110);
    }
    await Promise.all(moves);
  }

  /** 드로우: indices 자리의 카드를 버리고 새 카드로 바꾼다 */
  async replaceCards(player, indices, cards) {
    const row = this.cards.hole[player];
    const discarded = indices.map((i) => row[i]);
    const muckTo = POS.deck.clone().setY(DECK_HEIGHT + CARD_Y);
    await Promise.all(discarded.map((mesh) => this.move(mesh, muckTo, 380, { lift: 0.5, rotZ: Math.PI })));
    for (const mesh of discarded) this.disposeCard(mesh);

    const moves = [];
    for (let k = 0; k < indices.length; k++) {
      const mesh = this.makeCard(cards[k]);
      mesh.userData.up = false;
      if (player === 0) mesh.scale.setScalar(MY_CARD_SCALE);
      row[indices[k]] = mesh;
      const slot = this.holeSlot(player, indices[k], row.length, false);
      moves.push(
        this.move(mesh, slot, 380, { lift: 0.5 }).then(() => this.showsFace(player, mesh) && this.flip(mesh)),
      );
      await this.wait(110);
    }
    await Promise.all(moves);
  }

  // ---------- 내 카드 선택 (드로우) ----------

  /** 내 카드를 클릭해 고를 수 있게 한다. onChange 는 선택이 바뀔 때마다 인덱스 목록으로 호출된다 */
  enableSelection(onChange) {
    this.selecting = onChange;
    this.renderer.domElement.style.cursor = 'pointer';
  }

  disableSelection() {
    this.selecting = null;
    this.renderer.domElement.style.cursor = '';
    this.cards.hole[0].forEach((mesh, i) => {
      if (mesh.userData.selected) this.toggleCard(i, true);
    });
  }

  selection() {
    return this.cards.hole[0].flatMap((mesh, i) => (mesh.userData.selected ? [i] : []));
  }

  toggleCard(index, force = false) {
    const mesh = this.cards.hole[0][index];
    if (!mesh || (!this.selecting && !force)) return;
    mesh.userData.selected = !mesh.userData.selected;
    mesh.position.z += mesh.userData.selected ? -SELECT_SHIFT : SELECT_SHIFT;
    this.selecting?.(this.selection());
  }

  onPointerDown(event) {
    if (!this.selecting) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.cards.hole[0], true)[0];
    if (hit) this.toggleCard(this.cards.hole[0].indexOf(hit.object.parent));
  }

  async dealBoard(cards) {
    const moves = [];
    for (const data of cards) {
      const card = this.makeCard(data);
      const slot = this.cards.board.length;
      this.cards.board.push(card);
      moves.push(
        this.move(card, POS.board(slot).setY(CARD_Y), 380, { lift: 0.5 }).then(() => this.flip(card)),
      );
      await this.wait(160);
    }
    await Promise.all(moves);
  }

  async revealOpponent() {
    if (this.opponentRevealed) return;
    this.opponentRevealed = true;
    const hidden = this.cards.hole[1].filter((card) => card.rotation.z > 1);
    await Promise.all(hidden.map((card) => this.flip(card)));
  }

  async muck(player) {
    const cards = this.cards.hole[player];
    this.cards.hole[player] = [];
    const to = POS.deck.clone().setY(DECK_HEIGHT + CARD_Y);
    await Promise.all(cards.map((card) => this.move(card, to, 420, { lift: 0.5, rotZ: Math.PI })));
    for (const card of cards) this.disposeCard(card);
  }

  /** 승리 패에 쓰인 카드만 밝게 남기고 나머지는 어둡게 한다 */
  highlight(cards) {
    const ids = new Set(cards.map(cardId));
    for (const card of this.allCards()) {
      if (ids.has(card.userData.id)) card.position.y += 0.08;
      else card.userData.faceMaterial.color.set(0x5a5a5a);
    }
  }
}
