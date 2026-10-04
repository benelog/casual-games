// 카드 크게 보기. 휴대폰에서는 3D 테이블의 카드가 작아 알아보기 어려워, 카드 근처를 누르면
// 테이블의 카드를 줄(상대·공용·내 카드 등)별로 크게 펼쳐 보여 준다. 아무 곳이나 누르면 닫힌다.
//
//   showCardZoom([
//     { label: '나', cards: [{ src, dim, selected }], pick: (i) => 새 selected },
//   ]);
// src 가 없는 카드는 뒷면(backSrc, 테두리까지 그린 그림)으로 그리고, 앞면이 하나도 없는 줄은
// 보여 주지 않는다. pick 이 있는 줄은 카드를 눌러 고를 수 있다.

import { createT } from './i18n.js';

const t = createT({
  ko: { close: '아무 곳이나 누르면 닫힙니다', pick: '바꿀 카드를 누르세요 · 빈 곳을 누르면 닫힙니다' },
  en: { close: 'Tap anywhere to close', pick: 'Tap cards to swap · tap elsewhere to close' },
});

const CSS = `
.card-zoom {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: max(16px, env(safe-area-inset-top)) 12px max(16px, env(safe-area-inset-bottom));
  background: rgba(6, 8, 12, 0.86);
  backdrop-filter: blur(3px);
  color: #f3ecdc;
  font: 14px/1.4 system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
  overflow-y: auto;
  animation: card-zoom-in 0.16s ease-out;
}
@keyframes card-zoom-in {
  from { opacity: 0; transform: scale(0.97); }
}
.card-zoom[hidden] { display: none; }
.card-zoom-row { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: 100%; }
.card-zoom-label { font-weight: 600; color: #d9b46a; letter-spacing: 0.02em; }
.card-zoom-cards { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; width: 100%; }
.card-zoom-card {
  flex: none;
  width: var(--card-w);
  aspect-ratio: 240 / 347;
  padding: 3.5% 4%;
  box-sizing: border-box;
  border-radius: 7%/5%;
  background: #fbf8f0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  transition: transform 0.12s, box-shadow 0.12s;
}
.card-zoom-card img { display: block; width: 100%; height: 100%; object-fit: contain; }
.card-zoom-card.back { padding: 0; overflow: hidden; }
.card-zoom-card.dim { filter: brightness(0.45); }
.card-zoom-card.pickable { cursor: pointer; }
.card-zoom-card.selected { transform: translateY(-10px); box-shadow: 0 0 0 3px #d9b46a, 0 10px 22px rgba(0, 0, 0, 0.5); }
.card-zoom-hint { color: #b9b09c; font-size: 13px; }
`;

let overlay;

function ensureOverlay() {
  if (overlay) return overlay;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  overlay = document.createElement('div');
  overlay.className = 'card-zoom';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.addEventListener('click', (e) => {
    if (!e.target.closest('.pickable')) hideCardZoom();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) hideCardZoom();
  });
  document.body.appendChild(overlay);
  return overlay;
}

const GAP = 8;
const ASPECT = 347 / 240; // 카드 세로 / 가로

/**
 * 화면에 다 들어가는 가장 큰 카드 폭을 구한다. 세로가 넉넉한 휴대폰에서는 카드를 한 줄에
 * 다 놓기보다 두 줄로 나누는 편이 크게 보이므로, 한 줄에 놓을 장수를 바꿔 가며 비교한다.
 */
function cardWidth(rows) {
  const width = Math.min(document.documentElement.clientWidth, 900) - 24;
  // 위아래 여백·안내 문구, 줄마다 이름표 몫을 뺀 높이
  const height = window.innerHeight - 70 - rows.length * 40;
  const most = Math.max(...rows.map((row) => row.cards.length));
  let best = 0;
  for (let perLine = most; perLine >= 1; perLine--) {
    const lines = rows.reduce((sum, row) => sum + Math.ceil(row.cards.length / perLine), 0);
    const byWidth = (width - GAP * (perLine - 1)) / perLine;
    const byHeight = (height - GAP * (lines - rows.length)) / lines / ASPECT;
    best = Math.max(best, Math.min(byWidth, byHeight));
  }
  return Math.floor(Math.max(40, Math.min(best, 170)));
}

export function showCardZoom(rows, { backSrc } = {}) {
  // 모두 뒷면인 줄은 알려 주는 것이 없으니 빼서 앞면 카드를 더 크게 보인다
  rows = rows.filter((row) => row.cards.some((card) => card.src));
  if (rows.length === 0) return;
  const el = ensureOverlay();
  el.replaceChildren();
  el.style.setProperty('--card-w', `${cardWidth(rows)}px`);

  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'card-zoom-row';
    if (row.label) {
      const label = document.createElement('div');
      label.className = 'card-zoom-label';
      label.textContent = row.label;
      rowEl.appendChild(label);
    }
    const cardsEl = document.createElement('div');
    cardsEl.className = 'card-zoom-cards';
    row.cards.forEach((card, i) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card-zoom-card';
      cardEl.classList.toggle('back', !card.src);
      cardEl.classList.toggle('dim', !!card.dim);
      cardEl.classList.toggle('selected', !!card.selected);
      const img = document.createElement('img');
      img.src = card.src ?? backSrc;
      img.alt = '';
      img.draggable = false;
      cardEl.appendChild(img);
      if (row.pick && card.src) {
        cardEl.classList.add('pickable');
        cardEl.addEventListener('click', () => cardEl.classList.toggle('selected', row.pick(i)));
      }
      cardsEl.appendChild(cardEl);
    });
    rowEl.appendChild(cardsEl);
    el.appendChild(rowEl);
  }

  const hint = document.createElement('div');
  hint.className = 'card-zoom-hint';
  hint.textContent = rows.some((row) => row.pick) ? t('pick') : t('close');
  el.appendChild(hint);
  el.hidden = false;
}

export function hideCardZoom() {
  if (overlay) overlay.hidden = true;
}

/**
 * 누른 자리에 카드가 있는지 본다. 카드가 작으면 정확히 맞히기 어려워, 카드 위가 아니어도
 * 화면에서 카드 중심과 slop 픽셀 안이면 맞힌 것으로 친다. 맞힌 카드 Object3D 를 돌려준다.
 */
export function pickCard(THREE, { event, canvas, camera, raycaster, cards, slop = 44 }) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const pointer = new THREE.Vector2((x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(cards, true)[0];
  if (hit) return cards.find((card) => card === hit.object || card === hit.object.parent) ?? null;

  let best = null;
  let bestDist = slop;
  const p = new THREE.Vector3();
  for (const card of cards) {
    card.getWorldPosition(p).project(camera);
    const dist = Math.hypot(((p.x + 1) / 2) * rect.width - x, ((1 - p.y) / 2) * rect.height - y);
    if (dist < bestDist) {
      best = card;
      bestDist = dist;
    }
  }
  return best;
}

/** 카드 그룹이 앞면을 위로 하고 있는지. 뒤집힌 카드는 rotation.z 가 π 다 */
export function isFaceUp(card) {
  return Math.cos(card.rotation.z) > 0;
}
