// 컴퓨터의 수를 계산하는 Web Worker. 어려움은 위협을 몰아붙이는 길까지 찾느라 가끔 수십~백 밀리초가 걸려,
// 화면(돌이 떨어지는 연출·버튼)이 멈추지 않도록 따로 계산한다. main.js 가 { id, cells, team, count, level } 를 보내면
// 둘 칸들을 { id, moves } 로 돌려준다.

import { chooseTurn } from './ai.js';

self.onmessage = ({ data }) => {
  const { id, cells, team, count, level } = data;
  self.postMessage({ id, moves: chooseTurn(Int8Array.from(cells), team, count, level) });
};
