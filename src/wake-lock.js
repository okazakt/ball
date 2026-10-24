// Browsers release screen locks when the page is hidden. Reacquire on return.
export function keepScreenAwake(doc = document, nav = navigator) {
  let lock, pending = false;
  async function request() {
    if (!nav.wakeLock || doc.visibilityState !== 'visible' || pending || (lock && !lock.released)) return;
    pending = true;
    try {
      const acquired = await nav.wakeLock.request('screen');
      lock = acquired;
      if (doc.visibilityState !== 'visible') await acquired.release();
    } catch {
      // Low-power mode or browser policy may deny a lock. Retry on interaction.
    } finally { pending = false; }
  }
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') request();
    else if (lock && !lock.released) lock.release().catch(() => {});
  });
  doc.addEventListener('pointerdown', request);
  doc.addEventListener('keydown', request);
  request();
}
