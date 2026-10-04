// 효과음. Web Audio 로 짧은 소리를 겹쳐 튼다. 브라우저 정책상 첫 클릭·터치·키 입력 뒤에야
// 소리를 낼 수 있어 그때 불러온다. 불러오기에 실패해도 게임은 소리 없이 계속된다.
// 소리 파일의 출처는 assets/CREDITS.md. 화살이 날아가는 바람 소리는 파일 없이 잡음을 걸러 만든다.
// 켜고 끈 상태는 localStorage 에 남긴다.

const SOUNDS = {
  draw: { volume: 0.5, gap: 0.2 },
  release: { volume: 0.7, gap: 0.05 },
  hit: { volume: 0.8, gap: 0.05 },
  miss: { volume: 0.6, gap: 0.05 },
  tick: { volume: 0.5, gap: 0.3 },
  'set-win': { volume: 0.55, gap: 0 },
  turn: { volume: 0.35, gap: 0.2 },
  applause: { volume: 0.45, gap: 1 },
  'ceremony-applause': { volume: 0.55, gap: 1 },
  fanfare: { volume: 0.6, gap: 1 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};

const STORAGE_KEY = 'casual-games.archery.sound';

export class Sound {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      // 저장소가 막혀 있으면 켠 채로 시작한다
    }
    this.context = null;
    this.buffers = {};
    this.lastPlayed = {};
    this.long = new Set(); // 끌 수 있게 들고 있는 긴 소리 (박수·팡파르)
  }

  /** 사용자 입력 처리 중에 불러야 한다 */
  unlock() {
    if (this.context) {
      if (this.context.state === 'suspended') this.context.resume();
      return;
    }
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.context.destination);
    this.noise = this.makeNoise();
    for (const name of Object.keys(SOUNDS)) {
      fetch(new URL(`${name}.mp3`, this.baseUrl))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((data) => this.context.decodeAudioData(data))
        .then((buffer) => {
          this.buffers[name] = buffer;
        })
        .catch(() => {});
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stopLong();
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // 저장하지 못해도 이번 페이지에서는 바뀐다
    }
  }

  get ready() {
    return this.enabled && this.context?.state === 'running';
  }

  play(name, rate = 1) {
    const buffer = this.buffers[name];
    if (!this.ready || !buffer) return;
    // 같은 소리가 한꺼번에 몰리면 시끄러우니 간격을 둔다
    const now = this.context.currentTime;
    const { volume, gap } = SOUNDS[name];
    if (now - (this.lastPlayed[name] ?? -1) < gap) return;
    this.lastPlayed[name] = now;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.start();
    if (buffer.duration > 3) {
      const entry = { source, gain };
      this.long.add(entry);
      source.onended = () => this.long.delete(entry);
    }
  }

  /** 시상식을 떠날 때 박수·팡파르를 줄여 끈다 */
  stopLong() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const { source, gain } of this.long) {
      gain.gain.setTargetAtTime(0, now, 0.15);
      source.stop(now + 0.6);
    }
    this.long.clear();
  }

  makeNoise() {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** 화살이 귀 옆을 떠나 멀어지는 바람 소리: 띠 잡음의 높이와 크기를 함께 내린다 */
  whoosh(duration = 0.75) {
    if (!this.ready) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(2600, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.05);
  }
}
