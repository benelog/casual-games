// 1:1 포커 엔진. 렌더링과 무관한 순수 로직이며, 종목별 차이는 variants.js 의 정의로 처리한다.
// startHand()/act()/draw() 는 UI 가 순서대로 재생할 이벤트 목록을 돌려준다.
// 각 이벤트의 snap 은 그 시점의 칩 상태다.

import { createDeck, shuffle } from './cards.js';
import { evaluateBest } from './hand.js';
import { VARIANTS } from './variants.js';

export class PokerGame {
  #events = [];

  constructor({ variant = 'holdem', startingChips = 1000, smallBlind = 10, bigBlind = 20, rng = Math.random } = {}) {
    this.variant = VARIANTS[variant];
    if (!this.variant) throw new Error(`알 수 없는 종목: ${variant}`);
    this.smallBlind = smallBlind; // 앤티 방식에서는 앤티 금액으로 쓴다
    this.bigBlind = bigBlind; // 최소 베팅 단위
    this.rng = rng;
    this.players = ['나', '컴퓨터'].map((name) => ({
      name,
      chips: startingChips,
      hole: [],
      up: [], // hole 과 같은 순서로, 상대에게 공개된 카드인지
      bet: 0, // 현재 베팅 라운드에 낸 금액
      acted: false,
    }));
    this.dealer = 1; // startHand 에서 뒤집히므로 첫 핸드는 0번이 딜러
    this.handNumber = 0;
    this.phase = 'idle'; // 'betting' | 'drawing' | 'hand-over' | 'game-over'
    this.board = [];
    this.collected = 0; // 이전 라운드까지 모인 팟
    this.currentBet = 0;
    this.lastRaise = bigBlind;
    this.toAct = 0;
    this.streetIndex = 0;
  }

  get pot() {
    return this.collected + this.players[0].bet + this.players[1].bet;
  }

  snapshot() {
    return {
      chips: this.players.map((p) => p.chips),
      bets: this.players.map((p) => p.bet),
      pot: this.collected,
      total: this.pot,
    };
  }

  startHand() {
    if (this.phase === 'betting' || this.phase === 'drawing') throw new Error('핸드가 진행 중입니다');
    if (this.phase === 'game-over') throw new Error('게임이 끝났습니다');
    this.#events = [];
    this.dealer = 1 - this.dealer;
    this.handNumber++;
    this.deck = shuffle(createDeck(), this.rng);
    this.board = [];
    this.collected = 0;
    this.revealed = false;
    for (const p of this.players) {
      p.hole = [];
      p.up = [];
      p.bet = 0;
      p.acted = false;
    }
    this.phase = 'betting';
    this.#emit({ type: 'hand-start', dealer: this.dealer, handNumber: this.handNumber });

    const first = this.players[this.dealer];
    const second = this.players[1 - this.dealer];
    this.streetIndex = 0;

    if (this.variant.forced === 'ante') {
      for (const index of [1 - this.dealer, this.dealer]) {
        const p = this.players[index];
        this.#put(p, Math.min(this.smallBlind, p.chips));
        this.#emit({ type: 'blind', player: index });
      }
      this.#collect();
      this.#dealStreet(this.variant.streets[0]);
      if (!this.#startBetting()) this.#advance();
      return this.#events;
    }

    // 헤즈업 블라인드: 딜러가 스몰 블라인드이며 첫 라운드에 먼저 행동한다
    this.#put(first, Math.min(this.smallBlind, first.chips));
    this.#emit({ type: 'blind', player: this.dealer });
    this.#put(second, Math.min(this.bigBlind, second.chips));
    this.#emit({ type: 'blind', player: 1 - this.dealer });
    this.#dealStreet(this.variant.streets[0]);

    this.currentBet = Math.max(first.bet, second.bet);
    this.lastRaise = this.bigBlind;
    this.toAct = this.dealer;

    // 블라인드만으로 올인이 되어 더 행동할 것이 없는 경우
    if (first.chips === 0 || (second.chips === 0 && first.bet >= second.bet)) this.#endStreet();
    return this.#events;
  }

  legalActions() {
    const p = this.players[this.toAct];
    const o = this.players[1 - this.toAct];
    const toCall = Math.max(0, this.currentBet - p.bet);
    // 상대가 받을 수 있는 금액까지만 올릴 수 있다
    const allInTo = Math.min(p.bet + p.chips, o.bet + o.chips);
    let maxRaiseTo = allInTo;
    // 팟 리밋: 콜한 뒤의 팟만큼만 더 올릴 수 있다
    if (this.variant.potLimit) maxRaiseTo = Math.min(maxRaiseTo, this.currentBet + this.pot + toCall);
    return {
      canCheck: toCall === 0,
      callAmount: Math.min(toCall, p.chips),
      canRaise: o.chips > 0 && maxRaiseTo > this.currentBet,
      minRaiseTo: Math.min(this.currentBet + this.lastRaise, maxRaiseTo),
      maxRaiseTo,
      allInTo,
    };
  }

  /** action: { type: 'fold' | 'check' | 'call' | 'raise', amount?: 올린 뒤의 총 베팅액 } */
  act(action) {
    if (this.phase !== 'betting') throw new Error('행동할 수 없는 상태입니다');
    this.#events = [];
    const index = this.toAct;
    const p = this.players[index];
    const o = this.players[1 - index];
    const legal = this.legalActions();

    if (action.type === 'fold') {
      this.#emit({ type: 'action', player: index, action: 'fold', amount: 0 });
      this.#collect();
      this.#award([1 - index], 'fold');
      return this.#events;
    }

    let kind = action.type;
    let amount = 0;
    if (kind === 'call' && legal.callAmount === 0) kind = 'check';
    if (kind === 'check') {
      if (!legal.canCheck) throw new Error('체크할 수 없습니다');
    } else if (kind === 'call') {
      amount = legal.callAmount;
    } else if (kind === 'raise') {
      if (!legal.canRaise) throw new Error('레이즈할 수 없습니다');
      const to = Math.min(Math.max(Math.round(action.amount), legal.minRaiseTo), legal.maxRaiseTo);
      if (this.currentBet === 0) kind = 'bet';
      this.lastRaise = Math.max(this.lastRaise, to - this.currentBet);
      this.currentBet = to;
      amount = to - p.bet;
      o.acted = false;
    } else {
      throw new Error(`알 수 없는 행동: ${action.type}`);
    }
    this.#put(p, amount);
    p.acted = true;
    this.#emit({ type: 'action', player: index, action: kind, amount, to: p.bet, allIn: p.chips === 0 });

    let complete;
    if (o.chips === 0) complete = p.bet >= o.bet;
    else if (p.chips === 0 && p.bet <= o.bet) complete = true;
    else complete = p.acted && o.acted && p.bet === o.bet;

    if (complete) this.#endStreet();
    else this.toAct = 1 - index;
    return this.#events;
  }

  /** 카드 교환. indices: 버릴 카드의 hole 인덱스 목록 (빈 배열이면 교환하지 않음) */
  draw(indices) {
    if (this.phase !== 'drawing') throw new Error('카드를 교환할 수 없는 상태입니다');
    this.#events = [];
    const p = this.players[this.toAct];
    const unique = [...new Set(indices)].sort((a, b) => a - b);
    if (unique.some((i) => !Number.isInteger(i) || i < 0 || i >= p.hole.length)) {
      throw new Error('잘못된 카드 인덱스입니다');
    }
    for (const i of unique) p.hole[i] = this.deck.pop();
    this.#emit({ type: 'draw', player: this.toAct, indices: unique, cards: unique.map((i) => p.hole[i]) });

    this.drawsLeft--;
    if (this.drawsLeft > 0) this.toAct = 1 - this.toAct;
    else if (!this.#startBetting()) this.#advance();
    return this.#events;
  }

  #emit(event) {
    this.#events.push({ ...event, snap: this.snapshot() });
  }

  #put(player, amount) {
    player.chips -= amount;
    player.bet += amount;
  }

  #allIn() {
    return this.players.some((p) => p.chips === 0);
  }

  #collect() {
    const [a, b] = this.players;
    if (a.bet === 0 && b.bet === 0) return;
    this.collected += a.bet + b.bet;
    a.bet = b.bet = 0;
    this.#emit({ type: 'collect' });
  }

  #dealStreet(street) {
    if (street.hole) {
      const cards = [];
      for (const up of street.hole) {
        for (const index of [1 - this.dealer, this.dealer]) {
          const card = this.deck.pop();
          this.players[index].hole.push(card);
          this.players[index].up.push(up);
          cards.push({ player: index, card, up });
        }
      }
      this.#emit({ type: 'deal', cards });
    }
    if (street.board) {
      const cards = [];
      for (let i = 0; i < street.board; i++) cards.push(this.deck.pop());
      this.board.push(...cards);
      this.#emit({ type: 'street', cards });
    }
  }

  /** 새 베팅 라운드를 연다. 올인이라 베팅할 수 없으면 false. */
  #startBetting() {
    if (this.#allIn()) return false;
    for (const p of this.players) p.acted = false;
    this.currentBet = 0;
    this.lastRaise = this.bigBlind;
    this.toAct = this.#firstToAct();
    this.phase = 'betting';
    return true;
  }

  #firstToAct() {
    if (this.variant.firstToAct === 'showing') {
      const [mine, theirs] = this.players.map(
        (p) => evaluateBest(p.hole.filter((_, i) => p.up[i])).score,
      );
      if (mine !== theirs) return mine > theirs ? 0 : 1;
    }
    return 1 - this.dealer; // 첫 라운드 이후에는 딜러 반대편이 먼저
  }

  #endStreet() {
    // 콜 받지 못한 초과분은 돌려준다
    const [a, b] = this.players;
    if (a.bet !== b.bet) {
      const high = a.bet > b.bet ? a : b;
      const excess = Math.abs(a.bet - b.bet);
      high.bet -= excess;
      high.chips += excess;
    }
    this.#collect();
    this.#advance();
  }

  /** 다음 라운드들로 넘어간다. 올인이면 베팅 없이 끝까지 진행한다. */
  #advance() {
    const streets = this.variant.streets;
    while (this.streetIndex < streets.length - 1) {
      // 올인이고 더 교환할 일이 없으면 패를 공개하고 남은 카드를 받는다
      const remaining = streets.slice(this.streetIndex + 1);
      if (this.#allIn() && !remaining.some((s) => s.draw)) this.#reveal();

      const street = streets[++this.streetIndex];
      this.#dealStreet(street);
      if (street.draw) {
        this.phase = 'drawing';
        this.drawsLeft = 2;
        this.toAct = 1 - this.dealer;
        return;
      }
      if (this.#startBetting()) return;
    }
    this.#showdown();
  }

  #reveal() {
    if (this.revealed) return;
    this.revealed = true;
    this.#emit({ type: 'reveal' });
  }

  #showdown() {
    this.#reveal();
    const hands = this.players.map((p) => this.variant.evaluate(p.hole, this.board));
    let winners = [0, 1];
    if (hands[0].score > hands[1].score) winners = [0];
    else if (hands[0].score < hands[1].score) winners = [1];
    this.#emit({ type: 'showdown', hands: hands.map(({ name, cards }) => ({ name, cards })), winners });
    this.#award(winners, 'showdown');
  }

  #award(winners, reason) {
    const amounts = [0, 0];
    if (winners.length === 1) {
      amounts[winners[0]] = this.collected;
    } else {
      const half = Math.floor(this.collected / 2);
      amounts[this.dealer] = half;
      amounts[1 - this.dealer] = this.collected - half; // 홀수 칩은 딜러 반대편에게
    }
    this.collected = 0;
    this.players.forEach((p, i) => (p.chips += amounts[i]));
    this.#emit({ type: 'award', winners, amounts, reason });

    const loser = this.players.findIndex((p) => p.chips === 0);
    this.phase = loser >= 0 ? 'game-over' : 'hand-over';
    this.#emit({ type: 'hand-end', gameOver: loser >= 0, winner: loser >= 0 ? 1 - loser : null });
  }
}
