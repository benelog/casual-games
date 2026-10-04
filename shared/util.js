// 여러 게임이 같이 쓰는 작은 순수 함수. DOM 이나 Three.js 에 의존하지 않아 node 에서 그대로 테스트한다.

/** 시드로 재현되는 난수 (mulberry32). 0 이상 1 미만. 테스트에서 같은 판을 다시 만들 때 쓴다 */
export function createRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 배열을 제자리에서 섞고 그 배열을 돌려준다 (Fisher–Yates) */
export function shuffle(list, rng = Math.random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** 초 → 'm:ss' (한 시간이 넘으면 'h:mm:ss') */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 프레임 길이와 상관없이 같은 빠르기로 목표에 다가가게 하는 보간 비율. k 가 클수록 빠르다 */
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
