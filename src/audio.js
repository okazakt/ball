export class Sound {
  constructor() {
    this.enabled = false;
    this.last = 0;
  }
  async start() {
    this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    this.enabled = true;
  }
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
  tone(strength = 0.2, kind = 'hit') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    if (kind === 'hit' && t - this.last < 0.07) return;
    this.last = t;
    const o = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    o.type = kind === 'alert' ? 'square' : 'triangle';
    o.frequency.setValueAtTime(kind === 'alert' ? 620 : 500 + Math.random() * 700, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'alert' ? 980 : 120, t + 0.12);
    g.gain.setValueAtTime(Math.min(0.13, strength * 0.06), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + 0.16);
  }
  roll(speed) {
    if (!this.ctx || !this.enabled) return;
    if (!this.rolling) {
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate),
        d = buffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const n = this.ctx.createBufferSource(),
        filter = this.ctx.createBiquadFilter();
      this.rollGain = this.ctx.createGain();
      n.buffer = buffer;
      n.loop = true;
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      n.connect(filter).connect(this.rollGain).connect(this.ctx.destination);
      this.rollGain.gain.value = 0;
      n.start();
      this.rolling = n;
    }
    this.rollGain.gain.setTargetAtTime(Math.min(speed * 0.008, 0.035), this.ctx.currentTime, 0.08);
  }
}
