// visualizer.js — Three.js による 3D ビジュアライゼーション
// 「波形サーフェス」: X=波形の位相 / Z=時間(エンベロープ) / Y=振幅 / 色=倍音の豊かさ

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---- 波形 1 周期のサンプル値（位相 0..1 → -1..1）----
function waveSample(type, phase) {
  switch (type) {
    case "sine":
      return Math.sin(phase * Math.PI * 2);
    case "square":
      return phase < 0.5 ? 1 : -1;
    case "sawtooth":
      return 2 * phase - 1;
    case "triangle":
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    default:
      return 0;
  }
}

// ---- 倍音の豊かさ（0=純粋 .. 1=リッチ）----
function harmonicRichness(type) {
  return { sine: 0.0, triangle: 0.32, square: 0.7, sawtooth: 1.0 }[type] ?? 0;
}

// ---- ADSR エンベロープ（時刻 t、ノート長 gate）----
function envelopeAt(t, p, gate) {
  const { attack, decay, sustain, release } = p;
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  if (t < attack + decay) {
    const d = (t - attack) / decay;
    return 1 - (1 - sustain) * d;
  }
  if (t < gate) return sustain;
  const r = (t - gate) / release;
  if (r >= 1) return 0;
  return sustain * (1 - r);
}

export class Visualizer {
  constructor(canvas, synth) {
    this.canvas = canvas;
    this.synth = synth;
    this.params = synth.params;

    // サーフェスの解像度
    this.segX = 140; // 位相方向
    this.segZ = 120; // 時間方向
    this.cycles = 4; // 表示する波の周期数
    this.width = 26;
    this.depth = 30;

    this.waveBuffer = new Float32Array(2048);
    this.clock = new THREE.Clock();

    this._initScene();
    this._buildSurface();
    this._buildScope();
    this._buildParticles();
    this._buildPlayhead();
    this.updateSurface(); // 初期形状

    window.addEventListener("resize", () => this._onResize());
    this._animate();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05060f, 0.012);

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      300
    );
    this.camera.position.set(0, 22, 38);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 0, 0);
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 80;

    // ライト
    this.scene.add(new THREE.AmbientLight(0x404060, 1.2));
    const key = new THREE.PointLight(0x2ff7ff, 1.6, 200);
    key.position.set(-20, 30, 20);
    this.scene.add(key);
    const fill = new THREE.PointLight(0xff3df5, 1.4, 200);
    fill.position.set(25, 18, -10);
    this.scene.add(fill);

    // 床グリッド
    const grid = new THREE.GridHelper(80, 40, 0x2a3170, 0x161a3a);
    grid.position.y = -8;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    this.scene.add(grid);
  }

  // ---- メインの波形サーフェス ----
  _buildSurface() {
    const geo = new THREE.PlaneGeometry(
      this.width,
      this.depth,
      this.segX,
      this.segZ
    );
    geo.rotateX(-Math.PI / 2); // 水平に寝かせる（XZ平面）

    const colors = new Float32Array((this.segX + 1) * (this.segZ + 1) * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      metalness: 0.35,
      roughness: 0.45,
      emissive: 0x101830,
      emissiveIntensity: 0.6,
      flatShading: false,
    });

    this.surface = new THREE.Mesh(geo, mat);
    this.scene.add(this.surface);

    // ワイヤーフレームを重ねて発光感を出す
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x6fe0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
    });
    this.wire = new THREE.Mesh(geo, wireMat);
    this.scene.add(this.wire);
  }

  // ---- パラメーター変更時に呼ぶ：サーフェスの形状と色を再計算 ----
  updateSurface() {
    const p = this.params;
    const geo = this.surface.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;

    const gate = p.attack + p.decay + 0.6; // 表示用のノート保持時間
    const total = gate + p.release;
    const rich = harmonicRichness(p.wave);

    // フィルターによる高域減衰を「色のくすみ」として表現
    const bright = THREE.MathUtils.clamp(p.cutoff / 12000, 0.15, 1);

    const nx = this.segX + 1;
    const nz = this.segZ + 1;

    for (let zi = 0; zi < nz; zi++) {
      const tNorm = zi / (nz - 1); // 0..1
      const time = tNorm * total;
      const env = envelopeAt(time, p, gate);

      for (let xi = 0; xi < nx; xi++) {
        const i = zi * nx + xi;
        const phase = ((xi / (nx - 1)) * this.cycles) % 1;
        const sample = waveSample(p.wave, phase);

        const amp = sample * env * 6.0; // Y の高さ
        pos.setY(i, amp);

        // 色: 倍音の豊かさで色相、振幅で明るさ
        const hue = (0.55 - rich * 0.45 + 1) % 1; // cyan(0.55) → magenta/red
        const sat = 0.85;
        const light = (0.25 + Math.abs(sample) * env * 0.55) * bright + 0.08;
        const c = new THREE.Color().setHSL(hue, sat, Math.min(light, 0.9));
        col.setXYZ(i, c.r, c.g, c.b);
      }
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeVertexNormals();

    this._totalTime = total;
    this._richness = rich;
  }

  // ---- リアルタイム・オシロスコープ（実際の音波形を表示する光るリング）----
  _buildScope() {
    const N = 256;
    this.scopeN = N;
    const pts = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));

    const m = new THREE.LineBasicMaterial({
      color: 0xffe14d,
      transparent: true,
      opacity: 0.95,
    });
    this.scope = new THREE.Line(g, m);
    this.scope.position.y = 11;
    this.scene.add(this.scope);

    // グローのために少し太い半透明の複製
    const m2 = new THREE.LineBasicMaterial({
      color: 0xff3df5,
      transparent: true,
      opacity: 0.3,
    });
    this.scopeGlow = new THREE.Line(g, m2);
    this.scopeGlow.position.y = 11;
    this.scopeGlow.scale.set(1.02, 1.6, 1.02);
    this.scene.add(this.scopeGlow);
  }

  _updateScope() {
    const ok = this.synth.getWaveform(this.waveBuffer);
    const g = this.scope.geometry;
    const pos = g.attributes.position;
    const N = this.scopeN;
    const radius = 13;
    const step = Math.floor(this.waveBuffer.length / N);

    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const sample = ok ? this.waveBuffer[i * step] : 0;
      const r = radius + sample * 7;
      pos.setXYZ(i, Math.cos(a) * r, sample * 5, Math.sin(a) * r);
    }
    // 輪を閉じる
    pos.setXYZ(N - 1, pos.getX(0), pos.getY(0), pos.getZ(0));
    pos.needsUpdate = true;
  }

  // ---- 背景パーティクル ----
  _buildParticles() {
    const N = 700;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 90;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
      const c = new THREE.Color().setHSL(0.5 + Math.random() * 0.35, 0.8, 0.6);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size: 0.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
    });
    this.particles = new THREE.Points(g, m);
    this.scene.add(this.particles);
  }

  // ---- 時間軸を走る再生ヘッド ----
  _buildPlayhead() {
    const g = new THREE.PlaneGeometry(this.width + 2, 14);
    g.rotateX(-Math.PI / 2);
    g.rotateZ(0);
    const m = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });
    this.playhead = new THREE.Mesh(g, m);
    this.playhead.rotation.x = Math.PI / 2;
    this.playhead.visible = false;
    this.scene.add(this.playhead);
    this._playStart = 0;
  }

  triggerPlayhead() {
    this._playStart = this.clock.getElapsedTime();
    this.playhead.visible = true;
  }

  _updatePlayhead() {
    if (!this.playhead.visible) return;
    const t = this.clock.getElapsedTime() - this._playStart;
    const total = this._totalTime || 2;
    const prog = t / total;
    if (prog > 1) {
      this.playhead.visible = false;
      return;
    }
    // Z 方向に移動（手前 → 奥）
    this.playhead.position.z = (0.5 - prog) * this.depth;
    this.playhead.material.opacity = 0.25 * (1 - prog);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const t = this.clock.getElapsedTime();

    this._updateScope();
    this._updatePlayhead();

    // 音が鳴っている時はサーフェスを脈動させる
    const pulse = this.synth.isActive ? 1 + Math.sin(t * 8) * 0.04 : 1;
    this.surface.scale.y = pulse;
    this.wire.scale.y = pulse;

    // パーティクルをゆっくり回転
    this.particles.rotation.y = t * 0.02;

    // スコープを回転
    this.scope.rotation.y = t * 0.15;
    this.scopeGlow.rotation.y = t * 0.15;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
