import test from 'node:test';
import assert from 'node:assert/strict';
import { bindWeekSwipe } from '../public/swipe.js';
import { addDays } from '../public/domain.js';

function fixture() {
  const element = new EventTarget();
  element.getBoundingClientRect = () => ({width:350});
  element.setPointerCapture = () => {};
  const moves = [], finishes = [];
  const swipe = bindWeekSwipe(element,{onMove:x=>moves.push(x),onFinish:(...args)=>finishes.push(args)});
  function send(type,x=200,y=40,extra={}) {
    const event = new Event(type,{cancelable:true});
    const {target,...properties} = extra;
    Object.assign(event,{pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,detail:1,...properties});
    if (target) Object.defineProperty(event,'target',{value:target});
    element.dispatchEvent(event);
    return event;
  }
  return {send,moves,finishes,swipe};
}

test('touch capture transferred from a date child does not cancel the swipe', () => {
  for (const [end,direction] of [[80,1],[320,-1]]) {
    const f=fixture();
    const dateChild=new EventTarget();
    const touch={pointerType:'touch',target:dateChild};
    f.send('pointerdown',200,40,touch);
    f.send('pointermove',200+direction*-20,40,touch);
    // Touch implicitly captures to the date button/span. Transferring capture
    // to the viewport bubbles lostpointercapture from that previous child.
    f.send('lostpointercapture',200,40,touch);
    assert.equal(f.swipe.active,true);
    assert.deepEqual(f.finishes,[]);
    f.send('pointermove',end,40,{pointerType:'touch'});
    f.send('pointerup',end,40,{pointerType:'touch'});
    assert.deepEqual(f.finishes,[[direction,end-200]]);
    assert.equal(f.swipe.active,false);
    assert.equal(f.send('click').defaultPrevented,true);
  }
});

test('left and right drags switch one week and suppress the following accidental tap', () => {
  for (const [end,direction] of [[80,1],[320,-1]]) {
    const f=fixture();
    f.send('pointerdown');
    assert.equal(f.swipe.active,true);
    assert.equal(f.send('pointermove',end).defaultPrevented,true);
    f.send('pointerup',end);
    assert.deepEqual(f.finishes,[[direction,end-200]]);
    assert.equal(f.swipe.active,false);
    assert.equal(f.send('click').defaultPrevented,true);
    f.send('pointerdown');
    f.send('pointerup');
    assert.equal(f.send('click').defaultPrevented,false);
  }
});

test('ordinary taps and vertical scrolling do not switch weeks', () => {
  const f=fixture();
  f.send('pointerdown');
  f.send('pointermove',202,43);
  f.send('pointerup',202,43);
  assert.equal(f.send('click').defaultPrevented,false);
  f.send('pointerdown');
  assert.equal(f.send('pointermove',205,100).defaultPrevented,false);
  f.send('pointerup',205,100);
  assert.deepEqual(f.finishes,[]);
  assert.deepEqual(f.moves,[]);
});

test('short swipes and system cancellations return to the current week', () => {
  for(const [end,event] of [[170,'pointerup'],[80,'pointercancel'],[80,'lostpointercapture']]){
    const f=fixture();
    f.send('pointerdown');
    f.send('pointermove',end);
    f.send(event,end);
    assert.equal(f.finishes[0][0],0);
    assert.equal(f.swipe.active,false);
  }
});

test('secondary pointers and right mouse button do not initiate or finish a gesture', () => {
  const f=fixture();
  f.send('pointerdown',200,40,{button:2});
  assert.equal(f.swipe.active,false);
  f.send('pointerdown',200,40,{isPrimary:false});
  assert.equal(f.swipe.active,false);
  f.send('pointerdown');
  f.send('pointermove',0,40,{pointerId:2});
  f.send('pointerup',0,40,{pointerId:2});
  assert.deepEqual(f.moves,[]);
  assert.equal(f.swipe.active,true);
  f.send('pointercancel');
  assert.equal(f.swipe.active,false);
});

test('drag distance is capped and keyboard clicks remain available after dragging', () => {
  const f=fixture();
  f.send('pointerdown');
  f.send('pointermove',-1000);
  assert.deepEqual(f.moves,[-350]);
  f.send('pointerup',-1000);
  assert.equal(f.send('click',0,0,{detail:0}).defaultPrevented,false);
  assert.equal(addDays('2026-12-28',f.finishes[0][0]*7),'2027-01-04');
});
