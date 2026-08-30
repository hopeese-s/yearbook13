import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestApp } from '../helpers.js';

test('GET / serves the public gallery shell', async () => {
  const res = await request(await makeTestApp()).get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.text.includes('IMS13'), 'shell must carry the brand');
  assert.ok(res.text.includes('main.js'), 'shell must load the gallery entry module');
});

test('vendored Three.js module is served as JavaScript', async () => {
  const res = await request(await makeTestApp()).get('/assets/js/vendor/three.module.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript|text\/javascript/);
});

test('Three.js core companion module is served', async () => {
  const res = await request(await makeTestApp()).get('/assets/js/vendor/three.core.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript|text\/javascript/);
});

test('gallery entry module is served', async () => {
  for (const modulePath of [
    '/assets/js/main.js',
    '/assets/js/gallery/preview.js',
    '/assets/js/gallery/masonry.js',
    '/assets/js/gallery/carousel.js',
    '/assets/js/gallery/lightbox.js',
    '/assets/js/three/hero.js',
    '/assets/js/three/fallback.js',
    '/assets/js/ui/mac-window.js',
    '/assets/js/ui/focus.js',
    '/assets/js/ui/menu.js',
    '/assets/js/api.js',
  ]) {
    const res = await request(await makeTestApp()).get(modulePath);
    assert.equal(res.status, 200, `${modulePath} must be served`);
  }
});
