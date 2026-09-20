import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundRefresh } from '../public/sync.js';

function fixture() {
  let resolve, reject;
  const f = { ready:true, version:0, requests:0, applied:[], errors:[] };
  f.refresh = createBackgroundRefresh({
    canRefresh: () => f.ready,
    revision: () => f.version,
    fetchSnapshot: () => {
      f.requests++;
      return new Promise((yes, no) => { resolve = yes; reject = no; });
    },
    applySnapshot: data => f.applied.push(data),
    onError: error => f.errors.push(error.message)
  });
  f.resolve = value => resolve(value);
  f.reject = () => reject(new Error('offline'));
  return f;
}

test('hidden, editing and busy UI gates skip refresh; simultaneous triggers coalesce', async () => {
  const f = fixture();
  f.ready = false;
  await f.refresh();
  assert.equal(f.requests, 0);
  f.ready = true;
  const pending = f.refresh();
  await f.refresh();
  assert.equal(f.requests, 1);
  f.resolve({ bookings:[] });
  await pending;
  assert.deepEqual(f.applied, [{ bookings:[] }]);
});

test('a form opened during a request prevents both data replacement and error interruption', async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    const pending = f.refresh();
    f.ready = false;
    fail ? f.reject() : f.resolve('old data');
    await pending;
    assert.deepEqual(f.applied, []);
    assert.deepEqual(f.errors, []);
  }
});

test('a local save or manual reload invalidates older in-flight data and errors', async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    const pending = f.refresh();
    f.version++;
    fail ? f.reject() : f.resolve('old data');
    await pending;
    assert.deepEqual(f.applied, []);
    assert.deepEqual(f.errors, []);
    const retry = f.refresh();
    f.resolve('current data');
    await retry;
    assert.deepEqual(f.applied, ['current data']);
  }
});

test('failed refresh preserves cached data, reports failure and allows online recovery', async () => {
  const f = fixture();
  f.applied.push('cached data');
  const pending = f.refresh();
  f.reject();
  await pending;
  assert.deepEqual(f.applied, ['cached data']);
  assert.deepEqual(f.errors, ['offline']);
  const retry = f.refresh();
  f.resolve('remote update');
  await retry;
  assert.deepEqual(f.applied, ['cached data','remote update']);
});
