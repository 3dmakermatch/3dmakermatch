import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp, cleanDatabase, disconnectPrisma, createTestUser } from '../helpers/index.js';
import { generateRefreshToken } from '../../middleware/auth.js';
import { prisma } from '../helpers/prisma.js';
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
// POST /api/v1/auth/register
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/register', () => {
  it('creates a new user and returns 201 with accessToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'newuser@test.com',
        password: 'TestPass123!',
        fullName: 'New User',
        role: 'buyer',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe('newuser@test.com');
    expect(body.user.fullName).toBe('New User');
    expect(body.user.role).toBe('buyer');
    expect(body.accessToken).toBeDefined();
    expect(body.user.passwordHash).toBeUndefined();
  });

  it('sets a refreshToken cookie on registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'cookie@test.com',
        password: 'TestPass123!',
        fullName: 'Cookie User',
        role: 'printer',
      },
    });

    expect(res.statusCode).toBe(201);
    const cookies = res.cookies;
    const refreshCookie = cookies.find((c) => c.name === 'refreshToken');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
  });

  it('returns 409 when email is already registered', async () => {
    await createTestUser({ email: 'duplicate@test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'duplicate@test.com',
        password: 'TestPass123!',
        fullName: 'Dup User',
        role: 'buyer',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already registered/i);
  });

  it('returns 400 for an invalid email address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'not-an-email',
        password: 'TestPass123!',
        fullName: 'Bad Email',
        role: 'buyer',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when password is too short (< 8 chars)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'short@test.com',
        password: 'abc',
        fullName: 'Short Pass',
        role: 'buyer',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'missing@test.com' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for an invalid role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'badrole@test.com',
        password: 'TestPass123!',
        fullName: 'Bad Role',
        role: 'superadmin',
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/login', () => {
  it('returns 200 with accessToken on valid credentials', async () => {
    await createTestUser({ email: 'login@test.com', password: 'TestPassword123!' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'login@test.com', password: 'TestPassword123!' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeDefined();
    expect(body.user.email).toBe('login@test.com');
  });

  it('sets a refreshToken cookie on login', async () => {
    await createTestUser({ email: 'logincookie@test.com', password: 'TestPassword123!' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'logincookie@test.com', password: 'TestPassword123!' },
    });

    expect(res.statusCode).toBe(200);
    const cookies = res.cookies;
    const refreshCookie = cookies.find((c) => c.name === 'refreshToken');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httpOnly).toBe(true);
  });

  it('returns 401 on wrong password', async () => {
    await createTestUser({ email: 'wrongpass@test.com', password: 'TestPassword123!' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'wrongpass@test.com', password: 'WrongPassword999!' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid credentials/i);
  });

  it('returns 401 for a non-existent email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@test.com', password: 'TestPassword123!' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid credentials/i);
  });

  it('returns 401 with Google sign-in message for OAuth-only user', async () => {
    // Create a user with no password (OAuth-only)
    await prisma.user.create({
      data: {
        email: 'oauth@test.com',
        fullName: 'OAuth User',
        role: 'buyer',
        passwordHash: null,
        googleId: 'google-sub-123',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'oauth@test.com', password: 'anything' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/google sign-in/i);
  });

  it('returns 400 when email field is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'TestPassword123!' },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/refresh', () => {
  it('returns 200 with a new accessToken when given a valid refresh cookie', async () => {
    const { user } = await createTestUser({ email: 'refresh@test.com' });

    // Generate a real refresh token and store it in the DB
    const refreshToken = generateRefreshToken({ userId: user.id, role: user.role });
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { refreshToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeDefined();

    // A new refreshToken cookie should be set
    const newCookie = res.cookies.find((c) => c.name === 'refreshToken');
    expect(newCookie).toBeDefined();
  });

  it('returns 401 when the refresh cookie is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/no refresh token/i);
  });

  it('returns 401 for an invalid / tampered refresh token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { refreshToken: 'this.is.not.valid' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the token does not match the stored token', async () => {
    const { user } = await createTestUser({ email: 'mismatch@test.com' });

    // Store a different token in the DB than what we send
    const storedToken = generateRefreshToken({ userId: user.id, role: user.role });
    const sentToken = generateRefreshToken({ userId: user.id, role: user.role });
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: storedToken } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { refreshToken: sentToken },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/logout', () => {
  it('returns 200 and clears the refreshToken for an authenticated user', async () => {
    const { authHeaders } = await createTestUser({ email: 'logout@test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { ...authHeaders },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatch(/logged out/i);
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me
// ---------------------------------------------------------------------------
describe('GET /api/v1/auth/me', () => {
  it('returns the current user for a valid token', async () => {
    const { user, authHeaders } = await createTestUser({ email: 'me@test.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { ...authHeaders },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(user.id);
    expect(body.email).toBe('me@test.com');
    expect(body.passwordHash).toBeUndefined();
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for an invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { Authorization: 'Bearer invalid.token.value' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/google/status
// ---------------------------------------------------------------------------
describe('GET /api/v1/auth/google/status', () => {
  it('returns configured: false when no Google env vars are set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/status',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/google  (when not configured)
// ---------------------------------------------------------------------------
describe('GET /api/v1/auth/google', () => {
  it('returns 503 when Google OAuth is not configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/google',
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/not configured/i);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/google/callback  (when not configured)
// ---------------------------------------------------------------------------
describe('GET /api/v1/auth/google/callback', () => {
  it('returns 503 when Google OAuth is not configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/google/callback?code=fake',
    });

    expect(res.statusCode).toBe(503);
  });
});
