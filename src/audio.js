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
  roll() {}
}
