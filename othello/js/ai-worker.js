// 컴퓨터의 수를 화면 스레드 밖에서 고르는 웹 워커 (모듈 워커). 어려움은 1초 가까이 읽으므로 화면이 멈추지 않게 여기서 돌린다.
// 받는 메시지: { id, board(64칸 배열), player, level } → 보내는 메시지: { id, move }

import { chooseMove } from './ai.js';

self.onmessage = (event) => {
  const { id, board, player, level } = event.data;
  const move = chooseMove(Int8Array.from(board), player, level);
  self.postMessage({ id, move });
};
