import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp, cleanDatabase, disconnectPrisma, createTestUser } from '../helpers/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  await cleanDatabase();
});

// ---------------------------------------------------------------------------
// GET /api/v1/users/me
// ---------------------------------------------------------------------------
describe('GET /api/v1/users/me', () => {
  it('returns the authenticated user profile', async () => {
    const { user, authHeaders } = await createTestUser({
      email: 'me@users.test.com',
      fullName: 'My Profile',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { ...authHeaders },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(user.id);
    expect(body.email).toBe('me@users.test.com');
    expect(body.fullName).toBe('My Profile');
    expect(body.role).toBe('buyer');
    expect(body.passwordHash).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });

  it('includes a null printer field for non-printer users', async () => {
    const { authHeaders } = await createTestUser({ email: 'noprinter@users.test.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { ...authHeaders },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().printer).toBeNull();
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { Authorization: 'Bearer bad.token' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/users/me
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/users/me', () => {
  it('updates the authenticated user fullName', async () => {
    const { authHeaders } = await createTestUser({
      email: 'patch@users.test.com',
      fullName: 'Old Name',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { ...authHeaders },
      payload: { fullName: 'New Name' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fullName).toBe('New Name');
    expect(body.email).toBe('patch@users.test.com');
  });

  it('returns 400 when fullName is empty string', async () => {
    const { authHeaders } = await createTestUser({ email: 'emptyname@users.test.com' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { ...authHeaders },
      payload: { fullName: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when fullName exceeds 100 characters', async () => {
    const { authHeaders } = await createTestUser({ email: 'longname@users.test.com' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { ...authHeaders },
      payload: { fullName: 'A'.repeat(101) },
    });

    expect(res.statusCode).toBe(400);
  });

  it('succeeds with an empty body (no-op update)', async () => {
    const { authHeaders } = await createTestUser({ email: 'noop@users.test.com' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { ...authHeaders },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      payload: { fullName: 'Nobody' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('does not expose sensitive fields in the response', async () => {
    const { authHeaders } = await createTestUser({ email: 'sensitive@users.test.com' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { ...authHeaders },
      payload: { fullName: 'Safe Name' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.passwordHash).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/users/:id  (public profile)
// ---------------------------------------------------------------------------
describe('GET /api/v1/users/:id', () => {
  it('returns a public user profile by ID', async () => {
    const { user } = await createTestUser({
      email: 'public@users.test.com',
      fullName: 'Public Person',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${user.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(user.id);
    expect(body.fullName).toBe('Public Person');
    // Email should NOT be in the public profile
    expect(body.email).toBeUndefined();
    expect(body.passwordHash).toBeUndefined();
  });

  it('returns 404 for a non-existent user ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/not found/i);
  });

  it('does not require authentication', async () => {
    const { user } = await createTestUser({ email: 'noauth@users.test.com' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${user.id}`,
      // No auth header
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(user.id);
  });
});
