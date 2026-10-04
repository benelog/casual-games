// 메모리 카드의 규칙. 화면·소리와 분리된 순수 로직이라 node 에서 그대로 테스트한다.
//
// 카드는 번호(0 … count-1)로 가리키고, 어느 줄·칸에 놓을지는 화면이 정한다(layoutFor).
// 한 턴에 두 장을 뒤집는다. 같은 그림이면 그대로 두고 점수를 얻으며, 다르면 잠깐 보여 준 뒤 다시 덮는다.
// 2인 대전에서는 짝을 맞추면 한 번 더 하고, 틀리면 차례가 넘어간다.
// 일어난 일은 사건으로 쌓아 두고 drain() 으로 꺼내 화면과 소리에 옮긴다.

export const FACES = [
  'bear',
  'buffalo',
  'chick',
  'chicken',
  'cow',
  'crocodile',
  'dog',
  'duck',
  'elephant',
  'frog',
  'giraffe',
  'goat',
  'gorilla',
  'hippo',
  'horse',
  'monkey',
  'moose',
  'narwhal',
  'owl',
  'panda',
  'parrot',
  'penguin',
  'pig',
  'rabbit',
  'rhino',
  'sloth',
  'snake',
  'walrus',
  'whale',
  'zebra',
];

/** 고를 수 있는 카드 장수 */
export const SIZES = [12, 20, 30];
export const MISS_DELAY = 1.1; // 틀린 두 장을 보여 주는 시간(초)

/** 시드로 만드는 난수(mulberry32). 테스트에서 같은 판을 다시 만들 때 쓴다 */
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng = Math.random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** 초 → '1:05' */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * count 장을 가로 cols × 세로 rows 로 놓는 방법 중, 가로세로 비가 aspect 인 영역에서 카드가 가장 크게 보이는 것.
 * cellAspect 는 카드 한 칸의 가로/세로 비. 한 줄로 늘어놓지는 않는다.
 */
export function layoutFor(count, aspect, cellAspect = 1) {
  let best = null;
  for (let rows = 2; rows <= count / 2; rows++) {
    if (count % rows) continue;
    const cols = count / rows;
    const scale = Math.min(aspect / (cols * cellAspect), 1 / rows);
    if (!best || scale > best.scale + 1e-9) best = { cols, rows, scale };
  }
  return best ? { cols: best.cols, rows: best.rows } : { cols: count, rows: 1 };
}

export class MemoryGame {
  /**
   * count: 카드 장수(짝수), players: 1(혼자) 또는 2, first: 먼저 하는 사람,
   * faces: 쓸 그림 이름들(짝 수보다 많으면 그중에서 고른다)
   */
  constructor({ count = SIZES[0], players = 1, first = 0, rng = Math.random, faces = FACES } = {}) {
    const pairs = count / 2;
    if (!Number.isInteger(pairs) || pairs < 1) throw new Error(`카드 장수는 짝수여야 한다: ${count}`);
    if (faces.length < pairs) throw new Error(`그림이 모자란다: ${faces.length} < ${pairs}`);
    this.count = count;
    this.pairs = pairs;
    this.players = players;
    this.current = players > 1 ? first % players : 0;
    this.scores = new Array(players).fill(0);
    this.turns = 0; // 두 장을 뒤집어 본 횟수
    this.found = 0;
    this.elapsed = 0; // 첫 카드를 뒤집은 뒤부터 다 맞출 때까지(초)
    this.started = false;
    this.done = false;
    this.winner = null; // 끝난 뒤: 이긴 사람 번호, 비기면 -1
    this.first = -1; // 이번 턴에 먼저 뒤집은 카드
    this.pending = null; // 틀려서 곧 덮을 두 장 { a, b, time }
    this.events = [];

    const picked = shuffle([...faces], rng).slice(0, pairs);
    /** state: 'down'(덮임) | 'up'(이번 턴에 뒤집음) | 'matched', owner: 맞춘 사람 */
    this.cards = shuffle([...picked, ...picked], rng).map((face) => ({ face, state: 'down', owner: -1 }));
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  /** 쌓인 사건을 꺼낸다 */
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** 지금 뒤집을 수 있는 카드인가 */
  canFlip(index) {
    return !this.done && this.cards[index]?.state === 'down';
  }

  /**
   * 카드를 뒤집는다. 무언가 바뀌었으면 true.
   * 틀린 두 장이 아직 펼쳐져 있을 때 누르면 기다리지 않고 바로 덮는다. 혼자 할 때는 누른 카드까지 이어서 뒤집고,
   * 2인 대전에서는 덮기만 한다(차례가 넘어간 사람의 카드를 앞사람이 뒤집지 않게).
   */
  flip(index) {
    if (this.done) return false;
    if (this.pending) {
      this.settle();
      if (this.players > 1) return true;
    }
    const card = this.cards[index];
    if (!card || card.state !== 'down') return false;
    card.state = 'up';
    this.started = true;
    this.emit('flip', { index, face: card.face });
    if (this.first < 0) {
      this.first = index;
      return true;
    }

    const a = this.first;
    const b = index;
    const player = this.current;
    this.first = -1;
    this.turns++;
    if (this.cards[a].face !== card.face) {
      this.pending = { a, b, time: MISS_DELAY };
      this.emit('miss', { a, b, player });
      return true;
    }
    for (const matched of [this.cards[a], card]) {
      matched.state = 'matched';
      matched.owner = player;
    }
    this.scores[player]++;
    this.found++;
    this.emit('match', { a, b, player, face: card.face });
    if (this.found === this.pairs) {
      this.done = true;
      const top = Math.max(...this.scores);
      this.winner = this.scores.filter((score) => score === top).length > 1 ? -1 : this.scores.indexOf(top);
      this.emit('done', { winner: this.winner });
    }
    return true;
  }

  /** 틀린 두 장을 덮고 차례를 넘긴다 */
  settle() {
    if (!this.pending) return;
    const { a, b } = this.pending;
    this.pending = null;
    this.cards[a].state = 'down';
    this.cards[b].state = 'down';
    this.emit('hide', { a, b });
    if (this.players > 1) {
      this.current = (this.current + 1) % this.players;
      this.emit('turn', { player: this.current });
    }
  }

  /** 시간을 흘린다 */
  update(dt) {
    if (this.started && !this.done) this.elapsed += dt;
    if (this.pending && (this.pending.time -= dt) <= 0) this.settle();
  }
}
