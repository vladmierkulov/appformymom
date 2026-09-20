// Pointer events support touch, pen and mouse while pan-y keeps page scrolling native.
export function bindWeekSwipe(element, { onMove, onFinish }) {
  let gesture = null;
  let blockClick = false;
  function finish(event, cancelled = false) {
    if (!gesture || (event.pointerId !== undefined && event.pointerId !== gesture.id)) return;
    const current = gesture;
    gesture = null;
    if (!current.horizontal) return;
    blockClick = true;
    const threshold = Math.max(40, element.getBoundingClientRect().width * .18);
    const direction = !cancelled && Math.abs(current.dx) >= threshold ? (current.dx < 0 ? 1 : -1) : 0;
    onFinish(direction, current.dx);
  }
  element.addEventListener('pointerdown', event => {
    if (event.isPrimary === false || event.button !== 0 || gesture) return;
    blockClick = false;
    gesture = {id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,horizontal:false};
  });
  element.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.max(Math.abs(dx),Math.abs(dy)) < 10) return;
      if (Math.abs(dy) >= Math.abs(dx)) { gesture = null; return; }
      gesture.horizontal = true;
      element.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const width = element.getBoundingClientRect().width;
    gesture.dx = Math.max(-width,Math.min(width,dx));
    onMove(gesture.dx);
  });
  element.addEventListener('pointerup', event => finish(event));
  element.addEventListener('pointercancel', event => finish(event,true));
  element.addEventListener('lostpointercapture', event => finish(event,true));
  element.addEventListener('click', event => {
    if (!blockClick || event.detail === 0) return;
    blockClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  return { get active() { return Boolean(gesture); } };
}
