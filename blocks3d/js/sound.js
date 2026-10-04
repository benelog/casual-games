// 효과음. Web Audio 로 짧은 소리를 겹쳐 튼다. 브라우저 정책상 첫 클릭·키 입력 뒤에야
// 소리를 낼 수 있어 그때 불러온다. 불러오기에 실패해도 게임은 소리 없이 계속된다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md).

const SOUNDS = {
  move: { volume: 0.18, gap: 0.04 },
  rotate: { volume: 0.3, gap: 0.04 },
  drop: { volume: 0.35, gap: 0.05 },
  lock: { volume: 0.5, gap: 0.05 },
  clear: { volume: 0.6, gap: 0 },
  perfect: { volume: 0.7, gap: 0 },
  level: { volume: 0.6, gap: 0 },
  over: { volume: 0.7, gap: 0 },
};

export class Sound {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.enabled = true;
    this.context = null;
    this.buffers = {};
    this.lastPlayed = {};
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

  play(name, rate = 1) {
    const buffer = this.buffers[name];
    if (!this.enabled || !buffer || this.context?.state !== 'running') return;
    // 같은 소리가 한꺼번에 몰리면 시끄러우니 간격을 둔다
    const now = this.context.currentTime;
    const { volume, gap } = SOUNDS[name];
    if (now - (this.lastPlayed[name] ?? -1) < gap) return;
    this.lastPlayed[name] = now;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.start();
  }
}
