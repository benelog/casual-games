// 입력을 게임 동작으로 바꾸는 순수 함수들. 키보드 배치와 스와이프 판정.

/** KeyboardEvent.code → 동작. 방향은 game.js 의 DIRS 이름과 같다 */
export const KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyZ: 'undo',
  KeyU: 'undo',
  Backspace: 'undo',
  KeyR: 'restart',
};

export const SWIPE_STEP = 34; // 이만큼(px) 끌 때마다 한 칸

/**
 * 끈 거리(dx 오른쪽, dy 아래쪽)를 방향으로. step 보다 짧으면 null.
 * 대각선으로 끌면 더 많이 간 축을 따른다.
 */
export function swipeDirection(dx, dy, step = SWIPE_STEP) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < step) return null;
  if (ax >= ay) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
