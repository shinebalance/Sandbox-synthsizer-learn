// main.js — UI・シンセ・ビジュアライザーを繋ぐ
import { Synth } from "./synth.js";
import { Visualizer } from "./visualizer.js";

const synth = new Synth();
let viz = null;

// 波形ごとの説明
const WAVE_HINTS = {
  sine: "純粋な音。倍音がなく、最もまろやか。波形はなめらかな曲線。",
  triangle: "やわらかい音。奇数倍音が少し含まれ、笛のような音色。",
  square: "中空でレトロな音。奇数倍音が豊富。ゲーム機を思わせる響き。",
  sawtooth: "最も明るく豊か。全ての倍音を含み、ストリングスやリードに最適。",
};

// ---------- 開始オーバーレイ ----------
const overlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");

function boot() {
  synth.init();
  synth.resume();
  if (!viz) {
    viz = new Visualizer(document.getElementById("scene"), synth);
  }
  overlay.classList.add("hidden");
}
startBtn.addEventListener("click", boot);

// ---------- 波形ボタン ----------
const waveButtons = document.querySelectorAll("#wave-buttons button");
const waveHint = document.getElementById("wave-hint");
waveButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    waveButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const w = btn.dataset.wave;
    synth.setParam("wave", w);
    waveHint.textContent = WAVE_HINTS[w];
    if (viz) viz.updateSurface();
  });
});

// ---------- スライダー ----------
function bindSlider(id, param, fmt, onChange) {
  const el = document.getElementById(id);
  const label = document.getElementById("v-" + id);
  const apply = () => {
    const val = parseFloat(el.value);
    synth.setParam(param, val);
    if (label) label.textContent = fmt ? fmt(val) : val;
    if (onChange) onChange(val);
    if (viz) viz.updateSurface();
  };
  el.addEventListener("input", apply);
  apply();
}

bindSlider("attack", "attack", (v) => v.toFixed(2));
bindSlider("decay", "decay", (v) => v.toFixed(2));
bindSlider("sustain", "sustain", (v) => v.toFixed(2));
bindSlider("release", "release", (v) => v.toFixed(2));
bindSlider("cutoff", "cutoff", (v) => Math.round(v));
bindSlider("reso", "reso", (v) => v.toFixed(1));

// ピッチ（MIDIノート → 表示）
let currentMidi = 57;
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiLabel(m) {
  const name = noteNames[m % 12];
  const octave = Math.floor(m / 12) - 1;
  const freq = Math.round(Synth.midiToFreq(m));
  return `${name}${octave} (${freq}Hz)`;
}
const pitchEl = document.getElementById("pitch");
const pitchLabel = document.getElementById("v-pitch");
function applyPitch() {
  currentMidi = parseInt(pitchEl.value);
  pitchLabel.textContent = midiLabel(currentMidi);
}
pitchEl.addEventListener("input", applyPitch);
applyPitch();

// ---------- 演奏ボタン ----------
const playBtn = document.getElementById("play-btn");
playBtn.addEventListener("click", () => {
  synth.resume();
  synth.playDemo(currentMidi, 0.6);
  if (viz) viz.triggerPlayhead();
});

const holdBtn = document.getElementById("hold-btn");
const holdDown = () => {
  synth.resume();
  synth.noteOn("hold", currentMidi);
  if (viz) viz.triggerPlayhead();
};
const holdUp = () => synth.noteOff("hold");
holdBtn.addEventListener("mousedown", holdDown);
holdBtn.addEventListener("mouseup", holdUp);
holdBtn.addEventListener("mouseleave", holdUp);
holdBtn.addEventListener("touchstart", (e) => { e.preventDefault(); holdDown(); }, { passive: false });
holdBtn.addEventListener("touchend", (e) => { e.preventDefault(); holdUp(); });

// ---------- PCキーボード演奏 ----------
// A S D F G H J K → C D E F G A B C のように白鍵を割り当て
const KEY_MAP = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6,
  g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
};
const pressed = new Set();
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (!(k in KEY_MAP) || pressed.has(k)) return;
  pressed.add(k);
  synth.resume();
  synth.noteOn("kbd-" + k, currentMidi + KEY_MAP[k]);
  if (viz) viz.triggerPlayhead();
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (!(k in KEY_MAP)) return;
  pressed.delete(k);
  synth.noteOff("kbd-" + k);
});

// 波形ヒントの初期表示
waveHint.textContent = WAVE_HINTS.sine;
