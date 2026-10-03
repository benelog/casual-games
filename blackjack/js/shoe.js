// 여러 덱을 섞어 담은 슈. 컷 카드(penetration) 위치까지 나가면 다음 라운드 전에 다시 섞는다.

import { createDeck, shuffle } from './cards.js';

export class Shoe {
  constructor({ decks = 6, penetration = 0.75, rng = Math.random } = {}) {
    if (!(decks >= 1) || !Number.isInteger(decks)) throw new Error('덱 수는 1 이상의 정수여야 합니다');
    if (!(penetration > 0 && penetration <= 1)) throw new Error('컷 카드 위치는 0 초과 1 이하여야 합니다');
    this.decks = decks;
    this.penetration = penetration;
    this.rng = rng;
    this.size = decks * 52;
    this.shuffleCount = 0;
    this.shuffle();
  }

  shuffle() {
    const cards = [];
    for (let i = 0; i < this.decks; i++) cards.push(...createDeck());
    this.cards = shuffle(cards, this.rng);
    this.shuffleCount++;
  }

  get remaining() {
    return this.cards.length;
  }

  get dealt() {
    return this.size - this.cards.length;
  }

  /** 컷 카드가 나왔는지. 라운드 도중에는 섞지 않고, 다음 라운드를 시작할 때 확인한다. */
  get needsShuffle() {
    return this.dealt >= Math.floor(this.size * this.penetration);
  }

  draw() {
    // 컷 카드 뒤에도 카드가 충분히 남으므로 실제로는 일어나지 않지만, 덱이 아주 적을 때를 대비해
    // 바닥나면 새로 섞어 이어 간다 (테이블 위의 카드와 겹칠 수 있다)
    if (this.cards.length === 0) this.shuffle();
    return this.cards.pop();
  }
}
