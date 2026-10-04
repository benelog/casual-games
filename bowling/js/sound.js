// 효과음. Web Audio 로 짧은 소리를 겹쳐 튼다. 브라우저 정책상 첫 클릭·탭·키 입력 뒤에야
// 소리를 낼 수 있어 그때 불러온다. 불러오기에 실패해도 게임은 소리 없이 계속된다.
// 소리 파일은 Kenney 사운드 팩 (assets/CREDITS.md). 공이 구르는 소리는 파일 없이 잡음을 걸러 만든다.

const SOUNDS = {
  release: { volume: 0.5, gap: 0.1 },
  'pin-heavy': { volume: 0.9, gap: 0.03 },
  'pin-1': { volume: 0.6, gap: 0.03 },
  'pin-2': { volume: 0.6, gap: 0.03 },
  'pin-3': { volume: 0.6, gap: 0.03 },
  'pin-light': { volume: 0.4, gap: 0.04 },
  gutter: { volume: 0.45, gap: 0.5 },
  strike: { volume: 0.6, gap: 0 },
  spare: { volume: 0.6, gap: 0 },
  turn: { volume: 0.45, gap: 0 },
  win: { volume: 0.6, gap: 0 },
  lose: { volume: 0.6, gap: 0 },
};
const PIN_CLATTER = ['pin-1', 'pin-2', 'pin-3'];
const VOICES = 10; // 핀 충돌 소리를 동시에 이만큼까지만 낸다
const VOICE_TIME = 0.25; // 충돌 소리 하나가 자리를 차지하는 시간

export class Sound {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.enabled = true;
    this.context = null;
    this.buffers = {};
    this.lastPlayed = {};
    this.voices = []; // 최근 충돌 소리를 낸 시각
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
    this.buildRumble();
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

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.setRoll(0);
  }

  play(name, rate = 1, scale = 1) {
    const buffer = this.buffers[name];
    if (!this.enabled || !buffer || this.context?.state !== 'running') return false;
    // 같은 소리가 한꺼번에 몰리면 시끄러우니 간격을 둔다
    const now = this.context.currentTime;
    const { volume, gap } = SOUNDS[name];
    if (now - (this.lastPlayed[name] ?? -1) < gap) return false;
    this.lastPlayed[name] = now;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const gain = this.context.createGain();
    gain.gain.value = volume * scale;
    source.connect(gain).connect(this.master);
    source.start();
    return true;
  }

  /**
   * 물리에서 일어난 충돌. kind: ball-pin · pin-pin · pin-floor · ball-floor, speed: 부딪힌 속도 (m/s).
   * 세게 부딪힐수록 크고 조금 낮게 들린다. 핀이 한꺼번에 쓰러질 때는 동시에 나는 소리 수를 줄인다
   */
  impact(kind, speed) {
    if (!this.context) return;
    const min = kind === 'pin-floor' ? 0.6 : kind === 'ball-floor' ? 1.2 : 0.3;
    if (speed < min) return;
    const now = this.context.currentTime;
    this.voices = this.voices.filter((t) => now - t < VOICE_TIME);
    if (this.voices.length >= VOICES) return;
    const scale = Math.min(1, speed / (kind === 'ball-pin' ? 6 : 3));
    const rate = 1.12 - scale * 0.22;
    let played = false;
    if (kind === 'ball-pin') played = this.play('pin-heavy', rate, 0.4 + scale * 0.6);
    else if (kind === 'pin-pin') {
      played = this.play(PIN_CLATTER[Math.floor(Math.random() * PIN_CLATTER.length)], rate, 0.25 + scale * 0.75);
    } else if (kind === 'pin-floor') played = this.play('pin-light', rate, 0.2 + scale * 0.8);
    else played = this.play('release', 0.75, scale * 0.8); // 공이 핏 바닥이나 쿠션에 떨어진다
    if (played) this.voices.push(now);
  }

  // ---------- 굴러가는 소리 ----------

  /** 낮게 거른 갈색 잡음을 계속 돌려 두고, 공 속도에 따라 볼륨만 올린다 */
  buildRumble() {
    const ctx = this.context;
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      // 백색 잡음을 누적하면 낮은 소리가 강한 갈색 잡음이 된다
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    // 이음매에서 딸깍거리지 않게 앞뒤를 맞춘다
    const fade = 2048;
    for (let i = 0; i < fade; i++) data[length - fade + i] = data[length - fade + i] * (1 - i / fade) + data[i] * (i / fade);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 200;
    this.rumbleFilter.Q.value = 0.7;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    source.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.master);
    source.start();
  }

  /** 공이 바닥을 구르는 속도 (m/s, 0 이면 조용히). 거터에서는 쇠 홈을 구르듯 더 높고 가볍게 */
  setRoll(speed, gutter = false) {
    if (!this.rumbleGain) return;
    const now = this.context.currentTime;
    const level = this.enabled ? Math.min(1, speed / 8) : 0;
    this.rumbleGain.gain.setTargetAtTime(level * (gutter ? 0.5 : 0.9), now, 0.06);
    this.rumbleFilter.frequency.setTargetAtTime((gutter ? 500 : 140) + speed * (gutter ? 60 : 30), now, 0.1);
  }
}
