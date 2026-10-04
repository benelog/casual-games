// 오늘의 퍼즐을 만드는 일꾼(Web Worker). 만드는 데 0.5초쯤 걸려 화면이 멈추지 않도록 따로 돌린다.
// 날짜('YYYY-MM-DD')를 받아 { board, moves } 를 돌려준다.

import { dailyPuzzle } from './generator.js';

self.onmessage = (e) => {
  self.postMessage(dailyPuzzle(e.data));
};
