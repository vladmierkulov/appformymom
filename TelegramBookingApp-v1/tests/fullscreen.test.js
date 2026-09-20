import test from 'node:test';
import assert from 'node:assert/strict';
import { createFullscreenController, isWideMobileLandscape } from '../public/fullscreen.js';

function fixture() {
  const f = { states:[], errors:[], calls:0, timeout:null };
  f.webApp = { isFullscreen:false, isVersionAtLeast:()=>true, requestFullscreen(){f.calls++;} };
  f.controller = createFullscreenController({
    webApp:f.webApp,
    onChange:value=>f.states.push(value),
    onError:value=>f.errors.push(value),
    schedule:fn=>{f.timeout=fn;return 1;},
    cancel:()=>{f.timeout=null;}
  });
  return f;
}

test('landscape tablet is recognized even when Telegram gives it a narrow portrait sheet', () => {
  assert.equal(isWideMobileLandscape('android',{width:600,height:780},{width:1280,height:800}),true);
  assert.equal(isWideMobileLandscape('ios',{width:1024,height:768},{width:768,height:1024}),true);
  assert.equal(isWideMobileLandscape('ios',{width:390,height:844},{width:390,height:844}),false);
  assert.equal(isWideMobileLandscape('tdesktop',{width:1280,height:800},{width:1920,height:1080}),false);
});

test('request uses native Telegram fullscreen, coalesces calls and updates after confirmation', () => {
  const f=fixture();
  f.controller.request();
  f.controller.request(true);
  assert.equal(f.calls,1);
  assert.equal(f.states.at(-1).pending,true);
  f.webApp.isFullscreen=true;
  f.controller.update();
  assert.deepEqual(f.states.at(-1),{fullscreen:true,pending:false});
  assert.equal(f.timeout,null);
  f.controller.request();
  assert.equal(f.calls,1);
  f.webApp.isFullscreen=false;
  f.controller.update();
  assert.deepEqual(f.states.at(-1),{fullscreen:false,pending:false});
});

test('unsupported versions and missing APIs preserve the normal UI and explain manual failure', () => {
  for(const missing of [false,true]){
    const f=fixture();
    if(missing) delete f.webApp.requestFullscreen;
    else f.webApp.isVersionAtLeast=()=>false;
    f.controller.request();
    assert.equal(f.errors.length,0);
    f.controller.request(true);
    assert.equal(f.errors.length,1);
    assert.equal(f.calls,0);
    assert.equal(f.states.at(-1).pending,false);
  }
});

test('failed or silent requests permit manual retry without an automatic retry loop', () => {
  const f=fixture();
  f.controller.request();
  f.timeout();
  assert.equal(f.calls,1);
  assert.equal(f.errors.length,0);
  assert.equal(f.states.at(-1).pending,false);
  f.controller.request(true);
  f.controller.failed({error:'UNSUPPORTED'});
  assert.equal(f.calls,2);
  assert.equal(f.errors.length,1);
  assert.equal(f.timeout,null);
});

test('synchronous success and exceptions settle safely', () => {
  const f=fixture();
  f.webApp.requestFullscreen=()=>{f.webApp.isFullscreen=true;f.controller.update();};
  f.controller.request();
  assert.equal(f.timeout,null);
  assert.deepEqual(f.states.at(-1),{fullscreen:true,pending:false});
  f.webApp.isFullscreen=false;
  f.webApp.requestFullscreen=()=>{throw new Error('unsupported');};
  f.controller.request(true);
  assert.equal(f.errors.length,1);
  assert.equal(f.states.at(-1).pending,false);
});
