// 효과음. Web Audio 로 짧은 소리를 겹쳐 튼다. 브라우저 정책상 첫 클릭·터치·키 입력 뒤에야
// 소리를 낼 수 있어 그때 불러온다. 불러오기에 실패해도 게임은 소리 없이 계속된다.
//
// 게임마다 소리 이름별 { volume, gap } 표를 넘겨 쓴다. 파일은 baseUrl 아래 '이름.mp3'.
//   class Sound extends BaseSound { constructor(baseUrl) { super(baseUrl, SOUNDS); } }
// 파일 없이 만드는 소리(잡음 등)가 있으면 prepare() 를 덮어써 AudioContext 가 생긴 뒤 준비한다.

/** 소리 켜고 끈 상태를 남기는 공용 키 */
export const SOUND_KEY = 'casual-games.sound';

export class Sound {
  /**
   * @param sounds 소리 이름 → { volume, gap }. gap 초 안에는 같은 소리를 다시 내지 않는다
   * @param storageKey 켜고 끈 상태를 남기는 localStorage 키. 기본은 모든 게임이 같이 쓰는 키라
   *   한 게임에서 끄면 다른 게임도 꺼진 채 시작한다. null 이면 남기지 않는다
   * @param jitter 매번 재생 속도를 이 폭만큼 흔들어 같은 소리가 덜 단조롭게 들리게 한다
   */
  constructor(baseUrl, sounds, { storageKey = SOUND_KEY, jitter = 0.08 } = {}) {
    this.baseUrl = baseUrl;
    this.sounds = sounds;
    this.storageKey = storageKey;
    this.jitter = jitter;
    this.enabled = true;
    if (storageKey) {
      try {
        this.enabled = localStorage.getItem(storageKey) !== 'off';
      } catch {
        // 저장소가 막혀 있으면 켠 채로 시작한다
      }
    }
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
    this.prepare();
    for (const name of Object.keys(this.sounds)) {
      fetch(new URL(`${name}.mp3`, this.baseUrl))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((data) => this.context.decodeAudioData(data))
        .then((buffer) => {
          this.buffers[name] = buffer;
          this.loaded(name);
        })
        .catch(() => {});
    }
  }

  /** AudioContext 를 만든 직후에 불린다. 파일 없이 만드는 소리를 여기서 준비한다 */
  prepare() {}

  /** 소리 파일 하나를 다 불러왔을 때 불린다 */
  loaded() {}

  setEnabled(on) {
    this.enabled = on;
    if (!this.storageKey) return;
    try {
      localStorage.setItem(this.storageKey, on ? 'on' : 'off');
    } catch {
      // 저장하지 못해도 이번 페이지에서는 바뀐다
    }
  }

  /** 지금 소리를 낼 수 있는지 */
  get ready() {
    return this.enabled && this.context?.state === 'running';
  }

  /**
   * 소리를 낸다. 냈으면 { source, gain } 를, 못 냈으면 null 을 돌려준다.
   * volume 은 표의 볼륨에 곱하고, pan 은 -1(왼쪽) ~ 1(오른쪽).
   */
  play(name, rate = 1, { volume = 1, pan = 0 } = {}) {
    const buffer = this.buffers[name];
    if (!this.ready || !buffer) return null;
    // 같은 소리가 한꺼번에 몰리면 시끄러우니 간격을 둔다. 자리가 다른 소리는 따로 센다
    const now = this.context.currentTime;
    const { volume: base, gap } = this.sounds[name];
    const key = pan ? `${name}:${pan}` : name;
    if (now - (this.lastPlayed[key] ?? -1) < gap) return null;
    this.lastPlayed[key] = now;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate * (1 - this.jitter / 2 + Math.random() * this.jitter);
    const gain = this.context.createGain();
    gain.gain.value = base * volume;
    let node = source.connect(gain);
    if (pan && this.context.createStereoPanner) {
      const panner = this.context.createStereoPanner();
      panner.pan.value = pan;
      node = node.connect(panner);
    }
    node.connect(this.master);
    source.start();
    return { source, gain };
  }

  /** seconds 초 길이의 백색 잡음. 바람·물 소리처럼 파일 없이 만드는 소리의 재료 */
  whiteNoise(seconds) {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
