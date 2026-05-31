// synth.js — Web Audio API を使ったシンプルなシンセサイザーエンジン
// オシレーター(波形) → ADSRゲイン(エンベロープ) → ローパスフィルター(音色) → アナライザー → 出力

export class Synth {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.master = null;
    this.activeVoices = new Map(); // key -> {osc, gain}
    this.params = {
      wave: "sine",
      attack: 0.05,
      decay: 0.3,
      sustain: 0.6,
      release: 0.5,
      cutoff: 8000,
      reso: 2,
    };
  }

  // ユーザー操作後に呼ぶ（ブラウザの自動再生制限のため）
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    // マスター音量
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;

    // リアルタイム波形解析用
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  setParam(name, value) {
    this.params[name] = value;
  }

  // MIDIノート番号 → 周波数
  static midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ノートオン
  noteOn(key, midi) {
    if (!this.ctx) return;
    if (this.activeVoices.has(key)) this.noteOff(key);

    const now = this.ctx.currentTime;
    const p = this.params;

    const osc = this.ctx.createOscillator();
    osc.type = p.wave;
    osc.frequency.value = Synth.midiToFreq(midi);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = p.cutoff;
    filter.Q.value = p.reso;

    const gain = this.ctx.createGain();
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    // Attack
    gain.gain.linearRampToValueAtTime(1.0, now + p.attack);
    // Decay → Sustain
    gain.gain.linearRampToValueAtTime(
      Math.max(0.0001, p.sustain),
      now + p.attack + p.decay
    );

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(now);

    this.activeVoices.set(key, { osc, gain, filter });
  }

  // ノートオフ（リリース）
  noteOff(key) {
    if (!this.ctx) return;
    const voice = this.activeVoices.get(key);
    if (!voice) return;

    const now = this.ctx.currentTime;
    const r = this.params.release;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0.0001, now + r);
    voice.osc.stop(now + r + 0.05);

    this.activeVoices.delete(key);
  }

  // デモ用：1音を鳴らして自動で離す
  playDemo(midi = 57, gate = 0.6) {
    if (!this.ctx) return;
    const key = "demo";
    this.noteOn(key, midi);
    setTimeout(() => this.noteOff(key), gate * 1000);
  }

  // リアルタイム波形データ取得（-1..1）
  getWaveform(buffer) {
    if (!this.analyser) return false;
    this.analyser.getFloatTimeDomainData(buffer);
    return true;
  }

  // いずれかの音が鳴っているか
  get isActive() {
    return this.activeVoices.size > 0;
  }
}
