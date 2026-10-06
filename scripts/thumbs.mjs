// 게임 목록 카드에 쓰는 썸네일(thumbs/<게임>.webp)을 만든다. 게임마다 헤드리스 Chrome 으로 열어
// 3D 장면이 그려지면 HTML 화면(메뉴·버튼)을 숨기고 장면만 찍는다.
//
//   npm run thumbs            # 모든 게임
//   npm run thumbs -- darts   # 고른 게임만
//
// google-chrome 이 있어야 한다. 장면은 소프트웨어 렌더러(SwiftShader)로 그리므로 게임 하나에 몇 초 걸린다.
// 새 게임을 추가하면 이 스크립트로 썸네일을 만들고 index.html 의 games 항목은 그대로 둔다(경로는 디렉토리 이름으로 정해진다).

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'thumbs');
const WIDTH = 960; // 찍는 화면 크기. 저장은 SCALE 배로 줄인다
const HEIGHT = 600;
const SCALE = 2 / 3;

// 메뉴 뒤 장면만으로 게임이 잘 드러나지 않는 게임은 찍기 전에 누를 버튼을 적는다
const BEFORE = {
  parking: ['#btn-start'],
  defense: ['#btn-start'],
  blocks3d: ['#btn-start'],
  fruitpop: ['#btn-start'],
  minigolf: ['#btn-start'],
};

const games = readdirSync(ROOT).filter(
  (dir) => existsSync(join(ROOT, dir, 'index.html')) && existsSync(join(ROOT, dir, 'style.css')),
);
const only = process.argv.slice(2);
const targets = only.length ? games.filter((game) => only.includes(game)) : games;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'thumbs-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(
    'google-chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    await sleep(200);
    version = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then((r) => r.json())
      .catch(() => null);
  }
  if (!version) throw new Error('Chrome 을 띄우지 못했다');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const wait = pending.get(msg.id);
    if (!wait) return;
    pending.delete(msg.id);
    if (msg.error) wait.reject(new Error(msg.error.message));
    else wait.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return {
    send,
    close() {
      ws.close();
      chrome.kill();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

async function capture(chrome, base, game) {
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => chrome.send(method, params, sessionId);
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // 저장된 언어·기록과 상관없이 같은 화면이 나오게 처음 상태로 연다
  await send('Page.navigate', { url: `${base}/${game}/index.html` });

  const loaded = `(() => { const el = document.getElementById('loading'); return !!el && (el.hidden || getComputedStyle(el).display === 'none'); })()`;
  for (let i = 0; i < 120 && !(await evaluate(loaded)); i++) await sleep(250);
  await sleep(1500);
  for (const selector of BEFORE[game] ?? []) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    await sleep(4000);
  }
  // 장면 캔버스만 남긴다
  await evaluate(`(() => {
    const style = document.createElement('style');
    style.textContent = 'body > :not(#stage), #stage > :not(canvas) { visibility: hidden !important; }';
    document.head.append(style);
  })()`);
  await sleep(600);
  const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 80 });
  writeFileSync(join(OUT, `${game}.webp`), Buffer.from(data, 'base64'));
  await chrome.send('Target.closeTarget', { targetId });
}

mkdirSync(OUT, { recursive: true });
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = await launchChrome();
try {
  for (const game of targets) {
    await capture(chrome, base, game);
    console.log(`thumbs/${game}.webp`);
  }
} finally {
  chrome.close();
  server.close();
}
