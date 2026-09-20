// Touch/trackpad scrolling and momentum belong to the browser. Never capture
// touch pointers, prevent their default action, or snap the strip to a week.
export function bindDateScroll(element, { onScroll = () => {}, onIdle = () => {}, timers = globalThis } = {}) {
  let drag = null, touching = false, scrolling = false, blockClick = false, idleTimer;
  function settle() {
    timers.clearTimeout(idleTimer);
    if (touching || drag || !scrolling) return;
    scrolling = false;
    onIdle();
  }
  function scheduleIdle() {
    timers.clearTimeout(idleTimer);
    idleTimer = timers.setTimeout(settle, 200);
  }
  element.addEventListener('scroll', () => {
    scrolling = true;
    onScroll();
    scheduleIdle();
  }, {passive:true});
  element.addEventListener('scrollend', settle);
  element.addEventListener('touchstart', () => { touching = true; }, {passive:true});
  const endTouch = event => {
    touching = Boolean(event.touches?.length);
    scheduleIdle();
  };
  element.addEventListener('touchend', endTouch, {passive:true});
  element.addEventListener('touchcancel', endTouch, {passive:true});
  // Desktop mouse dragging supplements native touch and trackpad scrolling.
  element.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false || drag) return;
    blockClick = false;
    drag = {id:event.pointerId, x:event.clientX, y:event.clientY, left:element.scrollLeft, horizontal:false};
  });
  element.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (Math.abs(dy) >= Math.abs(dx)) { drag = null; return; }
      drag.horizontal = true;
      element.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    element.scrollLeft = drag.left - dx;
  });
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    blockClick = drag.horizontal;
    drag = null;
    scheduleIdle();
  }
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
  element.addEventListener('lostpointercapture', event => {
    if (event.target === element) endDrag(event);
  });
  element.addEventListener('pointerleave', event => {
    if (drag && !drag.horizontal) endDrag(event);
  });
  element.addEventListener('click', event => {
    if (!blockClick || event.detail === 0) return;
    blockClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  return { get active() { return Boolean(drag || touching || scrolling); } };
}
