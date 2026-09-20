// Telegram controls the outer tablet window; CSS and expand() cannot widen it.
export function createFullscreenController({ webApp, onChange, onError, schedule = setTimeout, cancel = clearTimeout }) {
  let pending = false;
  let manual = false;
  let timer;
  const publish = () => onChange({ fullscreen: Boolean(webApp?.isFullscreen), pending });
  function settle() {
    cancel(timer);
    pending = false;
    publish();
  }
  function failed(event = {}) {
    const report = manual;
    manual = false;
    settle();
    if (report && event.error !== 'ALREADY_FULLSCREEN') {
      onError('Telegram не включил полный экран. Обновите Telegram и попробуйте снова.');
    }
  }
  return {
    update() { manual = false; settle(); },
    failed,
    request(fromButton = false) {
      if (pending || webApp?.isFullscreen) return;
      manual = fromButton;
      if (!webApp?.isVersionAtLeast?.('8.0') || typeof webApp.requestFullscreen !== 'function') {
        failed({error:'UNSUPPORTED'});
        return;
      }
      pending = true;
      publish();
      // Some clients do not send a completion event. Keep a manual retry usable.
      timer = schedule(() => failed({error:'TIMEOUT'}), 4000);
      try { webApp.requestFullscreen(); } catch { failed(); }
    }
  };
}

export function isWideMobileLandscape(platform, viewport, screen) {
  return ['android','ios'].includes(platform) &&
    [viewport, screen].some(size => size && size.width >= 760 && size.width > size.height);
}
