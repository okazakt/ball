// DeviceMotion.acceleration is the platform's gravity-free estimate, in m/s².
// Never substitute accelerationIncludingGravity: it would count tilt twice.
export class MotionInertia {
  constructor() { this.reset(); }
  reset() { this.x = 0; this.z = 0; this.at = -Infinity; }
  sample(acceleration, angle, now) {
    if (!Number.isFinite(acceleration?.x) || !Number.isFinite(acceleration?.y)) {
      this.reset();
      return;
    }
    const radians = (Number.isFinite(angle) ? angle : 0) * Math.PI / 180;
    const x = Math.cos(radians) * acceleration.x + Math.sin(radians) * acceleration.y;
    const y = -Math.sin(radians) * acceleration.x + Math.cos(radians) * acceleration.y;
    const magnitude = Math.hypot(x, y);
    // Small sensor noise should not move a resting marble; bound strong spikes.
    const gain = magnitude > .15 ? Math.min(magnitude - .15, 35) / magnitude * (32 / 9.80665) : 0;
    this.x = -x * gain;
    this.z = y * gain; // Device +Y is screen-up; board +Z is screen-down.
    this.at = now;
  }
  read(now) {
    // Do not keep accelerating when events stop or the page resumes.
    return now - this.at <= 150 ? { x: this.x, z: this.z } : { x: 0, z: 0 };
  }
}
