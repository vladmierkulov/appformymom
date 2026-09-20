import test from 'node:test';
import assert from 'node:assert/strict';
import { bindDateScroll } from '../public/swipe.js';

function fixture() {
  const element = new EventTarget();
  element.scrollLeft = 500;
  let captured = 0, idle = 0, scrolls = 0, timer;
  element.setPointerCapture = () => { captured++; };
  const controller = bindDateScroll(element, {
    onScroll: () => scrolls++, onIdle: () => idle++,
    timers: {setTimeout: fn => {timer=fn; return 1;}, clearTimeout: () => {timer=null;}}
  });
  function send(type, extra = {}) {
    const event = new Event(type,{cancelable:true});
    const {target,...properties} = extra;
    Object.assign(event,{pointerId:1,pointerType:'mouse',isPrimary:true,button:0,clientX:200,clientY:40,detail:1,...properties});
    if (target) Object.defineProperty(event,'target',{value:target});
    element.dispatchEvent(event);
    return event;
  }
  return {element,controller,send,flush:()=>timer?.(),get captured(){return captured;},get idle(){return idle;},get scrolls(){return scrolls;}};
}

test('touch pointers are never captured or prevented; momentum remains native', () => {
  const f=fixture();
  f.send('touchstart');
  assert.equal(f.controller.active,true);
  for (const type of ['pointerdown','pointermove','lostpointercapture','pointercancel']) {
    assert.equal(f.send(type,{pointerType:'touch',clientX:20}).defaultPrevented,false);
  }
  assert.equal(f.captured,0);
  assert.equal(f.element.scrollLeft,500);
  f.send('scroll');
  f.send('touchend',{touches:[]});
  // Scroll events keep the strip active through inertia after touchend.
  f.send('scroll');
  assert.equal(f.controller.active,true);
  f.flush();
  assert.equal(f.idle,1);
  assert.equal(f.controller.active,false);
});

test('scrollend cannot extend the strip while a finger remains on it', () => {
  const f=fixture();
  f.send('touchstart');
  f.send('scroll');
  f.send('scrollend');
  f.flush();
  assert.equal(f.idle,0);
  f.send('touchend',{touches:[]});
  f.flush();
  assert.equal(f.idle,1);
  f.send('scrollend');
  assert.equal(f.idle,1);
});

test('trackpad scrolling notifies position and settles without any snapping', () => {
  const f=fixture();
  f.element.scrollLeft=621.75;
  f.send('scroll');
  f.send('scrollend');
  assert.equal(f.scrolls,1);
  assert.equal(f.idle,1);
  assert.equal(f.element.scrollLeft,621.75);
  assert.equal(f.controller.active,false);
});

test('mouse dragging moves continuously by pixels in either direction, not whole weeks', () => {
  for (const x of [20,181,450,-500]) {
    const f=fixture();
    f.send('pointerdown');
    f.send('pointermove',{clientX:x});
    assert.equal(f.element.scrollLeft,500+200-x);
    f.send('pointerup',{clientX:x});
    assert.equal(f.send('click').defaultPrevented,true);
    f.send('pointerdown');
    f.send('pointerup');
    assert.equal(f.send('click').defaultPrevented,false);
  }
});

test('ordinary taps, vertical drags and secondary pointers are left alone', () => {
  const f=fixture();
  f.send('pointerdown',{button:2});
  f.send('pointerdown',{isPrimary:false});
  assert.equal(f.controller.active,false);
  f.send('pointerdown');
  f.send('pointermove',{pointerId:2,clientX:0});
  f.send('pointerup',{pointerId:2});
  assert.equal(f.controller.active,true);
  f.send('pointermove',{clientX:203,clientY:100});
  assert.equal(f.controller.active,false);
  assert.equal(f.element.scrollLeft,500);
  assert.equal(f.send('click').defaultPrevented,false);
  f.send('pointerdown');
  f.send('pointerup');
  assert.equal(f.send('click').defaultPrevented,false);
});

test('capture transfer from child does not cancel mouse dragging; actual capture loss does', () => {
  const f=fixture();
  f.send('pointerdown');
  f.send('pointermove',{clientX:150});
  f.send('lostpointercapture',{target:new EventTarget()});
  assert.equal(f.controller.active,true);
  f.send('pointermove',{clientX:100});
  assert.equal(f.element.scrollLeft,600);
  f.send('lostpointercapture');
  assert.equal(f.controller.active,false);
  assert.equal(f.send('click',{detail:0}).defaultPrevented,false);
  assert.equal(f.send('click').defaultPrevented,true);
});

test('touch cancellation and leaving without a drag cannot leave refresh locked', () => {
  const f=fixture();
  f.send('touchstart');
  f.send('touchcancel',{touches:[]});
  f.flush();
  assert.equal(f.controller.active,false);
  f.send('pointerdown');
  f.send('pointerleave');
  assert.equal(f.controller.active,false);
});

test('multi-touch remains active until the last touch ends', () => {
  const f=fixture();
  f.send('touchstart');
  f.send('touchend',{touches:[{}]});
  f.flush();
  assert.equal(f.controller.active,true);
  f.send('touchend',{touches:[]});
  f.flush();
  assert.equal(f.controller.active,false);
});
