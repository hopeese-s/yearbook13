import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadSteps, computeInsertIndex, selectInRect, STEP_COUNT } from '../../public/assets/js/admin/steps.js';

function file(name, type = 'image/jpeg') {
  return { name, type, size: 100 };
}

test('wizard starts at step 0 and cannot advance without files', () => {
  const steps = createUploadSteps();
  assert.equal(steps.snapshot.index, 0);
  assert.equal(steps.snapshot.canAdvance, false);
  steps.next();
  assert.equal(steps.snapshot.index, 0, 'blocked advance keeps the step');
});

test('adding files enables advancing; metadata is optional', () => {
  const steps = createUploadSteps();
  steps.addFiles([file('a.jpg'), file('b.png')]);
  assert.equal(steps.snapshot.files.length, 2);
  assert.equal(steps.snapshot.canAdvance, true);
  steps.next();
  assert.equal(steps.snapshot.index, 1);
  steps.next(); // metadata optional
  assert.equal(steps.snapshot.index, 2);
  assert.equal(steps.snapshot.isLast, true);
});

test('unsupported file types are rejected', () => {
  const steps = createUploadSteps();
  const accepted = steps.addFiles([file('doc.pdf', 'application/pdf'), file('ok.jpg')]);
  assert.equal(accepted.length, 1);
  assert.equal(steps.snapshot.files[0].name, 'ok.jpg');
});

test('duplicate files are rejected by name+size', () => {
  const steps = createUploadSteps();
  steps.addFiles([file('a.jpg')]);
  const accepted = steps.addFiles([file('a.jpg'), file('b.jpg')]);
  assert.equal(accepted.length, 1);
  assert.equal(steps.snapshot.files.length, 2);
});

test('removeFile and clearFiles', () => {
  const steps = createUploadSteps();
  steps.addFiles([file('a.jpg'), file('b.jpg')]);
  steps.removeFile('a.jpg');
  assert.deepEqual(steps.snapshot.files.map((f) => f.name), ['b.jpg']);
  steps.clearFiles();
  assert.equal(steps.snapshot.files.length, 0);
  assert.equal(steps.snapshot.canAdvance, false);
});

test('moveFile reorders the batch; invalid moves are no-ops', () => {
  const steps = createUploadSteps();
  steps.addFiles([file('1.jpg'), file('2.jpg'), file('3.jpg')]);
  steps.moveFile(0, 2);
  assert.deepEqual(steps.snapshot.files.map((f) => f.name), ['2.jpg', '3.jpg', '1.jpg']);
  steps.moveFile(5, 0); // out of range -> no-op
  assert.deepEqual(steps.snapshot.files.map((f) => f.name), ['2.jpg', '3.jpg', '1.jpg']);
  steps.moveFile(1, 1); // same -> no-op
  assert.deepEqual(steps.snapshot.files.map((f) => f.name), ['2.jpg', '3.jpg', '1.jpg']);
});

test('back navigation is bounded', () => {
  const steps = createUploadSteps();
  steps.addFiles([file('a.jpg')]);
  steps.next();
  steps.back();
  assert.equal(steps.snapshot.index, 0);
  steps.back();
  assert.equal(steps.snapshot.index, 0);
});

test('subscribers are notified on every transition', () => {
  const steps = createUploadSteps();
  const seen = [];
  const unsubscribe = steps.subscribe((snap) => seen.push(snap.index));
  steps.addFiles([file('a.jpg')]);
  steps.next();
  unsubscribe();
  steps.next();
  assert.deepEqual(seen, [0, 0, 1]); // initial + addFiles + next (final next ignored: unsubscribed)
  assert.equal(STEP_COUNT, 3);
});

test('computeInsertIndex places before the midpoint of each item', () => {
  const rects = [
    { left: 0, width: 100 },
    { left: 110, width: 100 },
    { left: 220, width: 100 },
  ];
  assert.equal(computeInsertIndex(rects, -5), 0);
  assert.equal(computeInsertIndex(rects, 0), 0);
  assert.equal(computeInsertIndex(rects, 40), 0);
  assert.equal(computeInsertIndex(rects, 60), 1);
  assert.equal(computeInsertIndex(rects, 150), 1);
  assert.equal(computeInsertIndex(rects, 180), 2);
  assert.equal(computeInsertIndex(rects, 999), 3);
  assert.equal(computeInsertIndex([], 50), 0);
});

test('selectInRect intersects AABBs and is direction-agnostic', () => {
  const items = [
    { id: 'a', left: 0, right: 50, top: 0, bottom: 50 },
    { id: 'b', left: 60, right: 110, top: 0, bottom: 50 },
    { id: 'c', left: 120, right: 170, top: 60, bottom: 110 },
  ];
  assert.deepEqual([...selectInRect(items, { left: 10, right: 70, top: 10, bottom: 40 })], ['a', 'b']);
  // Dragged right-to-left / bottom-to-top must still work.
  assert.deepEqual([...selectInRect(items, { left: 70, right: 10, top: 40, bottom: 10 })], ['a', 'b']);
  assert.equal(selectInRect(items, { left: 500, right: 600, top: 500, bottom: 600 }).size, 0);
});
