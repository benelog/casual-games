// 텐핀 볼링 점수 규칙. 투구마다 쓰러뜨린 핀 수만 기록하고, 프레임·보너스·누계는 여기서 계산한다.
// 스트라이크는 다음 두 투구, 스페어는 다음 한 투구를 보너스로 더한다.
// 10프레임에서 스트라이크나 스페어를 하면 보너스 투구를 더 해서 최대 3번 던진다.

export const FRAMES = 10;
export const PINS = 10;

const mark = (pins) => (pins === 0 ? '-' : String(pins));

/**
 * 투구 기록을 프레임으로 나눈다.
 * 반환: frames[i] = { rolls, marks, score(이 프레임 점수, 보너스가 아직 없으면 null), total(누계 또는 null) },
 *       next = { frame, ball, standing } 다음 투구가 몇 프레임 몇 번째 공이고 핀이 몇 개 서 있는지, done
 */
export function scoreCard(rolls) {
  const frames = [];
  let i = 0;
  for (let f = 0; f < FRAMES && i < rolls.length; f++) {
    const last = f === FRAMES - 1;
    const cleared = rolls[i] === PINS || rolls[i] + (rolls[i + 1] ?? 0) === PINS;
    // 이 프레임에서 던지는 공 수. 10프레임은 두 번 안에 10개를 다 쓰러뜨리면 세 번째 공을 던진다
    const size = last ? (cleared ? 3 : 2) : rolls[i] === PINS ? 1 : 2;
    // 점수에 들어가는 공 수. 스트라이크·스페어는 다음 투구를 보너스로 가져온다
    const counted = last ? size : cleared ? 3 : 2;
    const own = rolls.slice(i, i + size);
    const needed = rolls.slice(i, i + counted);
    frames.push({
      rolls: own,
      marks: last ? tenthMarks(own) : frameMarks(own),
      score: needed.length === counted ? needed.reduce((a, b) => a + b, 0) : null,
      total: null,
    });
    i += size;
  }

  let total = 0;
  for (const frame of frames) {
    if (frame.score === null) break;
    total += frame.score;
    frame.total = total;
  }
  return { frames, total, next: nextBall(frames), done: isDone(frames) };
}

function isDone(frames) {
  if (frames.length < FRAMES) return false;
  const tenth = frames[FRAMES - 1].rolls;
  const [a, b = 0] = tenth;
  const needed = a === PINS || a + b === PINS ? 3 : 2;
  return tenth.length === needed;
}

/** 다음 투구의 위치와 서 있는 핀 수. 게임이 끝났으면 null */
function nextBall(frames) {
  if (isDone(frames)) return null;
  const current = frames.at(-1);
  // 앞 프레임이 끝났으면 새 프레임의 첫 공
  if (!current || (frames.length < FRAMES && (current.rolls[0] === PINS || current.rolls.length === 2))) {
    return { frame: frames.length, ball: 0, standing: PINS };
  }
  const rolls = current.rolls;
  const frame = frames.length - 1;
  if (frame < FRAMES - 1) return { frame, ball: 1, standing: PINS - rolls[0] };
  // 10프레임: 직전 공으로 핀을 다 치웠으면 새로 세운다
  const [a, b] = rolls;
  if (rolls.length === 1) return { frame, ball: 1, standing: a === PINS ? PINS : PINS - a };
  const fresh = (a === PINS && b === PINS) || (a < PINS && a + b === PINS);
  return { frame, ball: 2, standing: fresh ? PINS : PINS - b };
}

function frameMarks([a, b]) {
  if (a === PINS) return ['', 'X'];
  if (b === undefined) return [mark(a), ''];
  return [mark(a), a + b === PINS ? '/' : mark(b)];
}

function tenthMarks(rolls) {
  const marks = ['', '', ''];
  let standing = PINS;
  let fresh = true; // 새로 세운 핀에 던지는 첫 공인가
  rolls.forEach((pins, k) => {
    marks[k] = pins === standing ? (fresh ? 'X' : '/') : mark(pins);
    const cleared = pins === standing;
    standing = cleared ? PINS : standing - pins;
    fresh = cleared;
  });
  return marks;
}

export class BowlingGame {
  constructor() {
    this.players = ['나', '컴퓨터'].map((name) => ({ name, rolls: [] }));
    this.current = 0;
  }

  card(player = this.current) {
    return scoreCard(this.players[player].rolls);
  }

  /** 지금 차례인 사람의 다음 투구 { frame, ball, standing }. 게임이 끝났으면 null */
  get next() {
    return this.over ? null : this.card().next;
  }

  get over() {
    return this.players.every((p) => scoreCard(p.rolls).done);
  }

  /** 끝난 게임의 승자 0 | 1, 비기면 null */
  get winner() {
    const [a, b] = this.players.map((p) => scoreCard(p.rolls).total);
    return a === b ? null : a > b ? 0 : 1;
  }

  /**
   * 현재 차례인 사람이 pins 개를 쓰러뜨렸다.
   * 반환: { pins, strike, spare, rerack(다음 공은 핀 10개를 새로 세움), turnOver(프레임이 끝나 차례가 넘어감), gameOver }
   */
  roll(pins) {
    if (this.over) throw new Error('게임이 끝났습니다');
    const before = this.card().next;
    if (!before) throw new Error('차례를 넘겨야 합니다');
    if (!Number.isInteger(pins) || pins < 0 || pins > before.standing) {
      throw new Error(`쓰러뜨릴 수 없는 핀 수입니다: ${pins} (서 있는 핀 ${before.standing})`);
    }
    this.players[this.current].rolls.push(pins);
    const card = this.card();
    const after = card.next;
    const turnOver = !after || after.frame !== before.frame;
    // 점수표에 X 나 / 로 적히는지로 판단한다 (10프레임의 0 다음 10 은 스페어다)
    const marks = card.frames[before.frame].marks;
    const shown = before.frame < FRAMES - 1 ? marks[1] : marks[before.ball];
    return {
      pins,
      strike: shown === 'X',
      spare: shown === '/',
      rerack: turnOver || after.standing === PINS,
      turnOver,
      gameOver: this.over,
    };
  }

  nextTurn() {
    if (this.over) throw new Error('게임이 끝났습니다');
    const other = 1 - this.current;
    // 1:1 에서는 프레임마다 번갈아 던진다. 상대가 이미 다 던졌으면 차례를 그대로 둔다
    if (!scoreCard(this.players[other].rolls).done) this.current = other;
  }
}
