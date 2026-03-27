import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  buildApp,
  cleanDatabase,
  disconnectPrisma,
  createTestUser,
  prisma,
} from '../helpers/index.js';
import { generateUnsubscribeToken } from '../../services/email.js';
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
// PATCH /api/v1/users/me/email-preferences — Update preferences
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/users/me/email-preferences', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/email-preferences',
      payload: { orders: false },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 and updates a specific preference', async () => {
    const { accessToken } = await createTestUser();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/email-preferences',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { orders: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orders).toBe(false);
  });

  it('merges with existing preferences (does not replace)', async () => {
    const { user, accessToken } = await createTestUser();

    // Set initial prefs
    await prisma.user.update({
      where: { id: user.id },
      data: { emailPreferences: { bids: true, orders: true, marketing: false } },
    });

    // Update only one field
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/email-preferences',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { orders: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // orders changed, others preserved
    expect(body.orders).toBe(false);
    expect(body.bids).toBe(true);
    expect(body.marketing).toBe(false);
  });

  it('returns 400 for invalid jobAlerts value', async () => {
    const { accessToken } = await createTestUser();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/email-preferences',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { jobAlerts: 'never' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 200 and accepts a valid jobAlerts enum value', async () => {
    const { accessToken } = await createTestUser();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/email-preferences',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { jobAlerts: 'daily' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().jobAlerts).toBe('daily');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/unsubscribe — Validate unsubscribe token
// ---------------------------------------------------------------------------
describe('GET /api/v1/unsubscribe', () => {
  it('returns 400 when token is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/unsubscribe?category=orders',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Missing token or category/);
  });

  it('returns 400 when category is missing', async () => {
    const { user } = await createTestUser();
    const token = generateUnsubscribeToken(user.id, 'orders');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/unsubscribe?token=${token}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Missing token or category/);
  });

  it('returns 400 for invalid/expired token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/unsubscribe?token=invalid.token.here&category=orders',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid or expired token/);
  });

  it('returns 200 with category for valid token', async () => {
    const { user } = await createTestUser();
    const token = generateUnsubscribeToken(user.id, 'orders');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/unsubscribe?token=${token}&category=orders`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.category).toBe('orders');
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/unsubscribe — Process unsubscribe
// ---------------------------------------------------------------------------
describe('POST /api/v1/unsubscribe', () => {
  it('returns 400 when token is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/unsubscribe',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Missing token/);
  });

  it('returns 400 for invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/unsubscribe',
      payload: { token: 'not.a.valid.token' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid or expired token/);
  });

  it('returns 200 and disables the category in user preferences', async () => {
    const { user } = await createTestUser();
    const token = generateUnsubscribeToken(user.id, 'marketing');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/unsubscribe',
      payload: { token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.unsubscribed).toBe(true);
    expect(body.category).toBe('marketing');

    // Verify preference persisted in DB
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    const prefs = updated?.emailPreferences as Record<string, unknown>;
    expect(prefs.marketing).toBe(false);
  });

  it('disables the specific category without affecting other prefs', async () => {
    const { user } = await createTestUser();

    // Pre-set some preferences
    await prisma.user.update({
      where: { id: user.id },
      data: { emailPreferences: { orders: true, reviews: true, marketing: true } },
    });

    const token = generateUnsubscribeToken(user.id, 'marketing');
    await app.inject({
      method: 'POST',
      url: '/api/v1/unsubscribe',
      payload: { token },
    });

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    const prefs = updated?.emailPreferences as Record<string, unknown>;
    expect(prefs.marketing).toBe(false);
    expect(prefs.orders).toBe(true);
    expect(prefs.reviews).toBe(true);
  });
});
