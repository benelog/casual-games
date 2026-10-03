// 플레이어 1명 vs 딜러 블랙잭 엔진. 렌더링과 무관한 순수 로직이다.
// deal()/insure()/act() 는 UI 가 순서대로 재생할 이벤트 목록을 돌려준다.
// 각 이벤트의 snap 은 그 시점의 칩 상태다.
//
// 진행: 'betting' (베팅액을 골라 deal) → 딜러가 A 를 보이면 'insurance' → 'playing' (핸드마다 행동)
//       → 딜러 진행과 정산 → 다시 'betting', 칩이 최소 베팅보다 적으면 'game-over'

import { Shoe } from './shoe.js';
import {
  RULES,
  cardValue,
  dealerShouldHit,
  handValue,
  insuranceCost,
  isBlackjack,
  isPair,
  settleHand,
} from './rules.js';

export class BlackjackGame {
  #events = [];

  constructor({ startingChips = 1000, rng = Math.random, shoe, ...rules } = {}) {
    this.rules = { ...RULES, ...rules };
    this.shoe = shoe ?? new Shoe({ decks: this.rules.decks, penetration: this.rules.penetration, rng });
    this.chips = startingChips;
    this.round = 0;
    this.phase = 'betting'; // 'insurance' | 'playing' | 'game-over'
    this.hands = []; // { cards, bet, doubled, fromSplit, splitAces, done, result }
    this.dealer = []; // 두 번째 카드가 홀 카드 (공개 전까지 뒷면)
    this.holeRevealed = false;
    this.active = 0;
    this.insurance = 0;
    this.lastBet = 0;
  }

  snapshot() {
    return {
      chips: this.chips,
      bets: this.hands.map((h) => h.bet),
      insurance: this.insurance,
      shoe: this.shoe.remaining,
    };
  }

  get activeHand() {
    return this.phase === 'playing' ? this.hands[this.active] : null;
  }

  /** 딜러의 보이는 카드 (홀 카드는 공개 전까지 제외) */
  get dealerShowing() {
    return this.holeRevealed ? this.dealer : this.dealer.slice(0, 1);
  }

  canBet(amount) {
    return (
      this.phase === 'betting' && Number.isInteger(amount) && amount >= this.rules.minBet && amount <= this.chips
    );
  }

  /** 베팅하고 카드를 나눠 준다 */
  deal(bet) {
    if (this.phase !== 'betting') throw new Error('지금은 베팅할 수 없습니다');
    if (!this.canBet(bet)) throw new Error(`베팅액은 ${this.rules.minBet} 이상, 가진 칩 이하의 정수여야 합니다`);
    this.#events = [];
    if (this.shoe.needsShuffle) {
      this.shoe.shuffle();
      this.#emit({ type: 'shuffle' });
    }

    this.round++;
    this.lastBet = bet;
    this.startChips = this.chips;
    this.dealer = [];
    this.holeRevealed = false;
    this.insurance = 0;
    this.active = 0;
    this.chips -= bet;
    this.hands = [this.#newHand(bet)];
    this.#emit({ type: 'round-start', round: this.round, bet });

    // 플레이어, 딜러(앞면), 플레이어, 딜러(홀 카드) 순서
    this.#dealPlayer(0, { initial: true });
    this.#dealDealer({ initial: true });
    this.#dealPlayer(0, { initial: true });
    this.#dealDealer({ initial: true, faceDown: true });

    const cost = insuranceCost(bet);
    if (this.dealer[0].rank === 14 && cost > 0 && cost <= this.chips) {
      this.phase = 'insurance';
      this.#emit({ type: 'insurance-offer', cost });
      return this.#events;
    }
    this.#afterInsurance();
    return this.#events;
  }

  /** 딜러가 A 를 보일 때 인슈어런스를 들지 정한다 */
  insure(take) {
    if (this.phase !== 'insurance') throw new Error('인슈어런스를 고를 수 없는 상태입니다');
    this.#events = [];
    if (take) {
      const amount = insuranceCost(this.hands[0].bet);
      this.chips -= amount;
      this.insurance = amount;
    }
    this.#emit({ type: 'insurance', taken: !!take, amount: this.insurance });
    this.#afterInsurance();
    return this.#events;
  }

  /** 현재 핸드에서 할 수 있는 행동 */
  legalActions() {
    const hand = this.activeHand;
    if (!hand) return { hit: false, stand: false, double: false, split: false };
    const firstTwo = hand.cards.length === 2;
    return {
      hit: true,
      stand: true,
      double: firstTwo && hand.bet <= this.chips && (!hand.fromSplit || this.rules.doubleAfterSplit),
      split: isPair(hand.cards) && this.hands.length < this.rules.maxHands && hand.bet <= this.chips,
    };
  }

  /** type: 'hit' | 'stand' | 'double' | 'split' */
  act(type) {
    if (this.phase !== 'playing') throw new Error('행동할 수 없는 상태입니다');
    const legal = this.legalActions();
    if (!legal[type]) throw new Error(`지금은 할 수 없는 행동입니다: ${type}`);
    this.#events = [];
    const index = this.active;
    const hand = this.hands[index];
    this.#emit({ type: 'action', hand: index, action: type });

    if (type === 'hit') {
      this.#dealPlayer(index);
      const { total } = handValue(hand.cards);
      if (total > 21) this.#finishHand(index, 'bust');
      else if (total === 21) this.#finishHand(index, '21');
    } else if (type === 'stand') {
      this.#finishHand(index, 'stand');
    } else if (type === 'double') {
      this.chips -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      this.#emit({ type: 'double', hand: index });
      this.#dealPlayer(index, { sideways: true });
      this.#finishHand(index, handValue(hand.cards).total > 21 ? 'bust' : 'double');
    } else {
      this.#split(index);
    }

    if (hand.done) this.#nextHand();
    return this.#events;
  }

  // ---------- 내부 진행 ----------

  #emit(event) {
    this.#events.push({ ...event, snap: this.snapshot() });
  }

  #newHand(bet, cards = []) {
    return { cards, bet, doubled: false, fromSplit: false, splitAces: false, done: false, result: null };
  }

  #dealPlayer(index, extra = {}) {
    const card = this.shoe.draw();
    this.hands[index].cards.push(card);
    this.#emit({ type: 'deal', to: 'player', hand: index, card, ...extra });
  }

  #dealDealer({ faceDown = false, initial = false } = {}) {
    const card = this.shoe.draw();
    this.dealer.push(card);
    this.#emit({ type: 'deal', to: 'dealer', card: faceDown ? null : card, faceDown, initial });
  }

  #finishHand(index, reason) {
    this.hands[index].done = true;
    this.#emit({ type: 'hand-done', hand: index, reason });
  }

  #afterInsurance() {
    // 딜러가 A 나 10 점 카드를 보이면 홀 카드를 확인해 블랙잭이면 바로 끝낸다 (피크)
    if (cardValue(this.dealer[0]) >= 10) {
      const blackjack = isBlackjack(this.dealer);
      this.#emit({ type: 'peek', blackjack });
      if (this.insurance > 0) {
        const payout = blackjack ? this.insurance * 3 : 0; // 2:1 + 원금
        this.chips += payout;
        this.#emit({ type: 'insurance-result', won: blackjack, amount: this.insurance, payout });
        this.insurance = 0;
      }
      if (blackjack) {
        this.#reveal();
        this.#settle();
        return;
      }
    }
    if (isBlackjack(this.hands[0].cards)) {
      this.#finishHand(0, 'blackjack');
      this.#reveal();
      this.#settle();
      return;
    }
    this.phase = 'playing';
    this.active = 0;
    this.#emit({ type: 'turn', hand: 0 });
  }

  #split(index) {
    const hand = this.hands[index];
    const moved = hand.cards.pop();
    const aces = moved.rank === 14;
    const twin = this.#newHand(hand.bet, [moved]);
    hand.fromSplit = twin.fromSplit = true;
    hand.splitAces = twin.splitAces = aces;
    this.chips -= hand.bet;
    this.hands.splice(index + 1, 0, twin);
    this.#emit({ type: 'split', hand: index });

    this.#dealPlayer(index);
    if (aces) {
      // A 를 나누면 한 장씩만 받고 끝난다 (다시 스플릿하거나 더블할 수 없다)
      this.#dealPlayer(index + 1);
      this.#finishHand(index, 'split-aces');
      this.#finishHand(index + 1, 'split-aces');
    } else if (handValue(hand.cards).total === 21) {
      this.#finishHand(index, '21');
    }
  }

  /** 다음 핸드로 넘어간다. 남은 핸드가 없으면 딜러 차례 */
  #nextHand() {
    for (let i = this.active + 1; i < this.hands.length; i++) {
      const hand = this.hands[i];
      if (hand.done) continue;
      this.active = i;
      // 스플릿으로 생긴 핸드는 차례가 올 때 두 번째 카드를 받는다
      if (hand.cards.length === 1) this.#dealPlayer(i);
      if (handValue(hand.cards).total === 21) {
        this.#finishHand(i, '21');
        continue;
      }
      this.#emit({ type: 'turn', hand: i });
      return;
    }
    this.#dealerPlay();
  }

  #reveal() {
    if (this.holeRevealed) return;
    this.holeRevealed = true;
    this.#emit({ type: 'reveal', card: this.dealer[1] });
  }

  #dealerPlay() {
    this.phase = 'dealer';
    this.#reveal();
    // 플레이어 핸드가 모두 버스트했으면 딜러는 더 받지 않는다
    if (this.hands.some((h) => handValue(h.cards).total <= 21)) {
      while (dealerShouldHit(this.dealer, { hitSoft17: this.rules.dealerHitsSoft17 })) this.#dealDealer();
    }
    const { total } = handValue(this.dealer);
    this.#emit({ type: 'dealer-done', total, bust: total > 21 });
    this.#settle();
  }

  #settle() {
    const results = this.hands.map((hand, i) => {
      const result = settleHand(hand, this.dealer, this.rules);
      hand.result = result;
      this.chips += result.payout;
      return { hand: i, bet: hand.bet, ...result };
    });
    const net = this.chips - this.startChips;
    this.#emit({ type: 'settle', results, net, dealer: handValue(this.dealer).total });

    const gameOver = this.chips < this.rules.minBet;
    this.phase = gameOver ? 'game-over' : 'betting';
    this.#emit({ type: 'round-end', gameOver, net });
  }
}
