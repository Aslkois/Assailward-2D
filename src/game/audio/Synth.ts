import type { WeaponAudio } from '../../config/weapons';

// Procedural WebAudio sound effects (no audio assets). Every sound is positioned with a simple
// stereo pan and a volume already attenuated by distance / wall occlusion by the caller.

type Ctx = AudioContext;

export class Synth {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  volume = 0.7;

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private out(vol: number, pan: number): { g: GainNode; t: number } | null {
    if (!this.ctx || !this.master || vol <= 0.01 || this.voices > 40) return null;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.master);
    this.voices++;
    setTimeout(() => {
      this.voices--;
      try {
        g.disconnect();
        p.disconnect();
      } catch {
        /* already disconnected */
      }
    }, 2500);
    return { g, t: this.ctx.currentTime };
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack = 0.002): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(env).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.003): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  gunshot(kind: WeaponAudio, vol: number, pan: number, muffled: boolean): void {
    const o = this.out(vol, pan);
    if (!o) return;
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = muffled ? 700 : 9000;
    lp.connect(o.g);
    const p: Record<WeaponAudio, [number, number, number]> = {
      rifle: [1800, 0.16, 120],
      dmr: [2400, 0.22, 100],
      smg: [2600, 0.1, 150],
      lmg: [1500, 0.17, 110],
      pistol: [2200, 0.1, 160],
      shotgun: [900, 0.3, 80],
    };
    const [f, d, thump] = p[kind];
    this.noiseBurst(lp, o.t, d, 'bandpass', f, 0.7, 0.9);
    this.noiseBurst(lp, o.t, d * 0.5, 'highpass', 3000, 0.5, 0.35);
    this.tone(lp, o.t, 'sine', thump, 40, d * 0.8, 0.7);
  }

  explosion(vol: number, pan: number, big = true): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.noiseBurst(o.g, o.t, big ? 1.1 : 0.6, 'lowpass', 900, 0.4, 1.0, 0.005);
    this.tone(o.g, o.t, 'sine', 110, 28, big ? 0.9 : 0.5, 1.0);
  }

  flashbang(vol: number, pan: number, ring: number): void {
    const o = this.out(vol, pan);
    if (o) {
      this.noiseBurst(o.g, o.t, 0.35, 'highpass', 1500, 0.4, 1.0);
      this.tone(o.g, o.t, 'square', 900, 400, 0.12, 0.4);
    }
    if (ring > 0.15) {
      const r = this.out(0.18 * ring, 0);
      if (r) this.tone(r.g, r.t, 'sine', 3300, 3100, 1.5 + ring * 2, 0.5, 0.05);
    }
  }

  knock(vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.tone(o.g, o.t, 'triangle', 210, 95, 0.09, 0.9);
    this.noiseBurst(o.g, o.t, 0.04, 'bandpass', 1800, 2, 0.5);
  }

  woodHit(vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.noiseBurst(o.g, o.t, 0.08, 'bandpass', 700, 1.2, 0.8);
    this.tone(o.g, o.t, 'triangle', 160, 90, 0.07, 0.5);
  }

  woodBreak(vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    for (let i = 0; i < 4; i++) this.noiseBurst(o.g, o.t + i * 0.035 + Math.random() * 0.02, 0.07, 'bandpass', 1200 + Math.random() * 900, 1.5, 0.7);
    this.tone(o.g, o.t, 'triangle', 140, 60, 0.18, 0.5);
  }

  crumble(vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.noiseBurst(o.g, o.t, 0.5, 'lowpass', 600, 0.6, 0.9, 0.01);
    for (let i = 0; i < 5; i++) this.noiseBurst(o.g, o.t + 0.05 + i * 0.06, 0.06, 'bandpass', 2000, 2, 0.25);
  }

  plaster(vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.noiseBurst(o.g, o.t, 0.05, 'bandpass', 2600, 1.5, 0.5);
  }

  metal(vol: number, pan: number, heavy = false): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.tone(o.g, o.t, 'square', heavy ? 180 : 420, heavy ? 120 : 380, heavy ? 0.3 : 0.12, 0.25);
    this.tone(o.g, o.t, 'sine', heavy ? 1200 : 2100, heavy ? 1100 : 2000, heavy ? 0.4 : 0.15, 0.2);
  }

  footstep(vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.noiseBurst(o.g, o.t, 0.05, 'lowpass', 500, 0.8, 0.8);
  }

  click(vol: number, pan: number, pitch = 1): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.noiseBurst(o.g, o.t, 0.025, 'highpass', 3000 * pitch, 1, 0.8);
  }

  reload(vol: number, pan: number): void {
    this.click(vol, pan, 0.7);
    setTimeout(() => this.click(vol, pan, 1.1), 140);
  }

  whoosh(vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.noiseBurst(o.g, o.t, 0.18, 'bandpass', 900, 0.6, 0.5, 0.06);
  }

  beep(vol: number, pan: number, freq = 1400, dur = 0.08): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.tone(o.g, o.t, 'square', freq, freq, dur, 0.25, 0.005);
  }

  buzz(vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.tone(o.g, o.t, 'sawtooth', 120, 110, 0.35, 0.3);
  }

  sweep(vol: number, pan: number): void {
    const o = this.out(vol, pan);
    if (!o) return;
    this.tone(o.g, o.t, 'sine', 400, 1600, 0.5, 0.3, 0.02);
  }

  sting(win: boolean): void {
    const o = this.out(0.5, 0);
    if (!o) return;
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((n, i) => this.tone(o.g, o.t + i * 0.14, 'triangle', n, n, 0.35, 0.4, 0.01));
  }

  hurt(vol: number): void {
    const o = this.out(vol, 0);
    if (!o) return;
    this.tone(o.g, o.t, 'sine', 160, 70, 0.15, 0.8);
  }

  hitConfirm(strong: boolean): void {
    const o = this.out(0.35, 0);
    if (!o) return;
    this.tone(o.g, o.t, 'square', strong ? 1900 : 1500, strong ? 2100 : 1500, 0.05, 0.18);
  }
}

export const synth = new Synth();
