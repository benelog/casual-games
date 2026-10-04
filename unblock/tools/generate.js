// 단계 목록(js/levels.js)을 만드는 생성기. 저장소 루트에서 node 로 실행한다.
//
//   node unblock/tools/generate.js                 # 기본 설정으로 js/levels.js 를 다시 쓴다
//   node unblock/tools/generate.js --seed 7 --climbs 60 --steps 1500 --per-tier 12 --dry
//
// 여러 일꾼(worker_threads)이 시드를 나눠 받아 언덕 오르기(js/generator.js 의 climb)를 돌리고,
// 지나가며 만난 퍼즐을 모두 모은다. 모은 퍼즐은 같은 모양끼리 합치고(normalize), 최소 수로 난이도를 나눈 뒤
// 난이도마다 범위 안에서 고르게 per-tier 개를 골라 쉬운 순으로 적는다.
// 고른 퍼즐은 풀이기(solve)로 앞에서부터 다시 풀어 최소 수가 맞는지 확인한다.
// 일꾼마다 할 일과 시드가 정해져 있고 고르는 순서도 정해져 있어, 같은 설정이면 언제나 같은 목록이 나온다.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { climb, createRng, hashSeed } from '../js/generator.js';
import { parseBoard, TIERS } from '../js/game.js';
import { solve } from '../js/solver.js';

const OUT = new URL('../js/levels.js', import.meta.url);

function options(argv) {
  const get = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? Number(argv[i + 1]) : fallback;
  };
  return {
    seed: get('seed', 2026),
    climbs: get('climbs', 24), // 일꾼 하나가 돌리는 언덕 오르기 수
    steps: get('steps', 1200), // 언덕 오르기 하나에서 바꿔 보는 횟수
    perTier: get('per-tier', 12),
    workers: get('workers', 8), // 일꾼 수도 결과를 바꾸므로 기기의 코어 수와 상관없이 정해 둔다
    dry: argv.includes('--dry'),
  };
}

// ---------- 일꾼 ----------

function work({ seed, climbs, steps }) {
  const rng = createRng(seed);
  const found = new Map(); // 판 → 최소 수
  for (let i = 0; i < climbs; i++) {
    climb(rng, {
      count: 9 + Math.floor(rng() * 5),
      steps,
      onResult: ({ board, moves }) => found.set(board, moves),
    });
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ found: [...found] });
}

// ---------- 고르기 ----------

// 쉬운 난이도는 차가 적은 판부터 고른다. 언덕 오르기 중에 만난 쉬운 퍼즐은 차가 빽빽해 처음 하는 사람에게 어지럽다
const SPARSE_TIERS = new Set(['intro', 'easy']);
const pieceCount = (board) => new Set(board.replaceAll('.', '')).size;

/**
 * 범위 [min, max] 안에서 고르게 count 개. 같은 수 안에서는 판의 해시가 작은 것부터 (무작위처럼 보이게).
 * sparse 면 차가 적은 판을 먼저 쓴다.
 */
function spread(candidates, { min, max }, count, sparse = false) {
  const byMoves = new Map();
  for (const [board, moves] of candidates) {
    if (moves < min || moves > max) continue;
    if (!byMoves.has(moves)) byMoves.set(moves, []);
    byMoves.get(moves).push(board);
  }
  const order = (a, b) =>
    (sparse ? pieceCount(a) - pieceCount(b) : 0) || hashSeed(a) - hashSeed(b) || (a < b ? -1 : 1);
  for (const list of byMoves.values()) list.sort(order);
  const values = [...byMoves.keys()].sort((a, b) => a - b);
  if (values.length === 0) return [];
  const top = values.at(-1);
  const picked = [];
  // 목표 수를 범위에 고르게 두고, 목표에 가장 가까운 수에서 아직 안 쓴 판을 하나씩 꺼낸다
  for (let k = 0; k < count; k++) {
    const goal = count === 1 ? min : min + ((top - min) * k) / (count - 1);
    const nearest = [...values].sort((a, b) => Math.abs(a - goal) - Math.abs(b - goal) || a - b);
    const moves = nearest.find((m) => byMoves.get(m).length > 0);
    if (moves === undefined) break;
    picked.push({ board: byMoves.get(moves).shift(), moves });
  }
  return picked.sort((a, b) => a.moves - b.moves || hashSeed(a.board) - hashSeed(b.board));
}

function render(levels, opts) {
  const lines = [
    '// 단계 목록. tools/generate.js 가 만든 파일이라 손으로 고치지 않는다. 다시 만들려면 저장소 루트에서',
    `//   node unblock/tools/generate.js --seed ${opts.seed} --climbs ${opts.climbs} --steps ${opts.steps} --per-tier ${opts.perTier}`,
    '// 판은 36글자(6줄 × 6칸, 위 줄부터). \'.\' 빈칸, A 내 차, B~ 다른 차. moves 는 풀이기로 구한 최소 수다.',
    '// id 는 판에서 나온 해시라 저장된 기록의 열쇠가 된다. 판이 같으면 목록을 다시 만들어도 기록이 이어진다.',
    '// 모든 단계가 풀리고 최소 수가 맞는지는 test/unblock.test.js 가 확인한다.',
    '',
    'export const LEVELS = [',
  ];
  for (const { id, tier, board, moves } of levels) {
    lines.push(`  { id: '${id}', tier: '${tier}', moves: ${moves}, board: '${board}' },`);
  }
  lines.push('];', '');
  return lines.join('\n');
}

async function main() {
  const opts = options(process.argv.slice(2));
  const total = opts.workers * opts.climbs;
  let done = 0;
  const candidates = new Map();
  const file = fileURLToPath(import.meta.url);
  await Promise.all(
    Array.from({ length: opts.workers }, (_, w) => {
      const worker = new Worker(file, {
        workerData: { seed: hashSeed(`unblock:${opts.seed}:${w}`), climbs: opts.climbs, steps: opts.steps },
      });
      return new Promise((resolve, reject) => {
        worker.on('message', (message) => {
          if (message.progress) {
            done++;
            if (done % 8 === 0 || done === total) process.stderr.write(`언덕 오르기 ${done}/${total}\n`);
          }
          if (message.found) for (const [board, moves] of message.found) candidates.set(board, moves);
        });
        worker.on('error', reject);
        worker.on('exit', resolve);
      });
    }),
  );

  const histogram = {};
  for (const moves of candidates.values()) histogram[moves] = (histogram[moves] ?? 0) + 1;
  console.error(`모은 퍼즐 ${candidates.size}개, 최소 수별:`, JSON.stringify(histogram));

  const levels = [];
  for (const tier of TIERS) {
    const picked = spread(candidates, tier, opts.perTier, SPARSE_TIERS.has(tier.id));
    if (picked.length < opts.perTier) console.error(`경고: ${tier.id} 단계가 ${picked.length}개뿐이다`);
    for (const { board, moves } of picked) {
      const { pieces } = parseBoard(board);
      const check = solve(pieces, pieces.map((p) => p.start));
      if (!check || check.moves !== moves) throw new Error(`${board}: 최소 수가 ${moves} 가 아니라 ${check?.moves}`);
      levels.push({ id: hashSeed(board).toString(36), tier: tier.id, board, moves });
    }
    console.error(`${tier.id}: ${picked.map((p) => p.moves).join(' ')}`);
  }
  if (new Set(levels.map((l) => l.id)).size !== levels.length) throw new Error('id 가 겹친다');
  if (opts.dry) return;
  writeFileSync(OUT, render(levels, opts));
  console.error(`${fileURLToPath(OUT)} 에 ${levels.length}단계를 썼다`);
}

if (isMainThread) await main();
else work(workerData);
