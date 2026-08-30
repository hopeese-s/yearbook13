import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestApp, testLoginRouter } from '../helpers.js';
import { applyRole, mapGoogleProfile } from '../../src/auth/passport.js';

const OAUTH_CREDS = {
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
};

test('GET /auth/google redirects to Google with AUTH-ONLY scopes (never Drive)', async () => {
  const res = await request(await makeTestApp(OAUTH_CREDS)).get('/auth/google');
  assert.equal(res.status, 302);
  const location = res.headers.location;
  assert.ok(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), location);
  const url = new URL(location);
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.ok(!url.searchParams.get('scope').includes('drive'), 'Drive scopes are forbidden in login');
  assert.ok(url.searchParams.get('state'), 'CSRF state parameter must be present');
  assert.equal(url.searchParams.get('client_id'), 'test-client-id');
});

test('OAuth returns 503 with clear error when not configured', async () => {
  const res = await request(await makeTestApp({})).get('/auth/google');
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'OAUTH_NOT_CONFIGURED');
});

test('auth routes are rate limited', async () => {
  const app = await makeTestApp({ ...OAUTH_CREDS, AUTH_RATE_LIMIT_MAX: '3' });
  for (let i = 0; i < 3; i += 1) {
    const res = await request(app).get('/auth/google');
    assert.equal(res.status, 302, `request ${i + 1} should pass`);
  }
  const limited = await request(app).get('/auth/google');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  assert.ok(limited.headers.ratelimit, 'standard RateLimit headers must be present');
});

test('session login persists across requests; role comes from the session', async () => {
  const app = await makeTestApp({}, { extraRouters: [testLoginRouter()] });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);
  const status = await agent.get('/auth/status');
  assert.equal(status.body.authenticated, true);
  assert.equal(status.body.user.role, 'admin');
  assert.equal(status.body.user.email, 'admin@example.com');
});

test('requireAdmin blocks non-admin users with 403 and anonymous with 401', async () => {
  const viewerApp = await makeTestApp({}, { extraRouters: [testLoginRouter({ email: 'viewer@example.com', role: 'viewer' })] });
  const viewerAgent = request.agent(viewerApp);
  await viewerAgent.post('/test/login').expect(200);
  const forbidden = await viewerAgent.get('/test/admin-only');
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, 'FORBIDDEN');

  const adminApp = await makeTestApp({}, { extraRouters: [testLoginRouter()] });
  const adminAgent = request.agent(adminApp);
  await adminAgent.post('/test/login').expect(200);
  const allowed = await adminAgent.get('/test/admin-only');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.admin, true);

  const anonymous = await request(await makeTestApp({}, { extraRouters: [testLoginRouter()] })).get('/test/admin-only');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error.code, 'UNAUTHENTICATED');
});

test('admin allowlist grants admin role only to listed emails', () => {
  const user = applyRole(mapGoogleProfile({ id: 'sub-1', displayName: 'A', emails: [{ value: 'Boss@Example.com' }] }), ['boss@example.com']);
  assert.equal(user.role, 'admin');
  assert.equal(user.email, 'boss@example.com');
  const outsider = applyRole(mapGoogleProfile({ id: 'sub-2', displayName: 'B', emails: [{ value: 'x@y.com' }] }), ['boss@example.com']);
  assert.equal(outsider.role, 'viewer');
});

test('logout destroys the session', async () => {
  const app = await makeTestApp({}, { extraRouters: [testLoginRouter()] });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);
  await agent.post('/auth/logout').expect(200);
  const status = await agent.get('/auth/status');
  assert.equal(status.body.authenticated, false);
  assert.equal(status.body.user, null);
});

test('OAuth callback with an error redirects to the failure route', async () => {
  const res = await request(await makeTestApp(OAUTH_CREDS)).get('/auth/google/callback?error=access_denied');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/auth/failure');
  const failure = await request(await makeTestApp(OAUTH_CREDS)).get('/auth/failure');
  assert.equal(failure.status, 401);
  assert.equal(failure.body.error.code, 'AUTH_FAILED');
});

test('oversized JSON bodies are rejected with 413', async () => {
  const app = await makeTestApp({ JSON_BODY_LIMIT: '1kb' }, { extraRouters: [testLoginRouter()] });
  const big = { data: 'x'.repeat(20 * 1024) };
  const res = await request(app).post('/test/login').send(big).set('Content-Type', 'application/json');
  assert.equal(res.status, 413);
  assert.match(res.headers['content-type'], /^application\/json/);
});

test('unauthenticated /auth/status reports anonymous', async () => {
  const res = await request(await makeTestApp()).get('/auth/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.authenticated, false);
  assert.equal(res.body.user, null);
});

test('GET /auth/logout destroys session and redirects to /', async () => {
  const app = await makeTestApp({}, { extraRouters: [testLoginRouter()] });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);
  const res = await agent.get('/auth/logout');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
  const status = await agent.get('/auth/status');
  assert.equal(status.body.authenticated, false);
});

test('GET /auth/me returns 200 with user when authenticated and 401 when anonymous', async () => {
  const anonRes = await request(await makeTestApp()).get('/auth/me');
  assert.equal(anonRes.status, 401);
  assert.equal(anonRes.body.error.code, 'UNAUTHENTICATED');

  const app = await makeTestApp({}, { extraRouters: [testLoginRouter()] });
  const agent = request.agent(app);
  await agent.post('/test/login').expect(200);
  const authRes = await agent.get('/auth/me');
  assert.equal(authRes.status, 200);
  assert.equal(authRes.body.user.email, 'admin@example.com');
});

