import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  buildApp,
  cleanDatabase,
  disconnectPrisma,
  createTestUser,
  createTestPrinter,
  seedOrder,
  prisma,
} from '../helpers/index.js';
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
// POST /api/v1/orders/:orderId/reviews — Create review
// ---------------------------------------------------------------------------
describe('POST /api/v1/orders/:orderId/reviews', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/orders/nonexistent/reviews',
      payload: { rating: 5 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a review after confirmed order (201)', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const { printer } = await createTestPrinter();
    const order = await seedOrder({ buyerId: buyer.id, printerId: printer.id, status: 'confirmed' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/reviews`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { rating: 5, comment: 'Excellent print quality!' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.rating).toBe(5);
    expect(body.comment).toBe('Excellent print quality!');
    expect(body.orderId).toBe(order.id);
  });

  it('recalculates printer averageRating after review', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const { printer } = await createTestPrinter();
    const order = await seedOrder({ buyerId: buyer.id, printerId: printer.id, status: 'confirmed' });

    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/reviews`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { rating: 4 },
    });

    const updatedPrinter = await prisma.printer.findUnique({ where: { id: printer.id } });
    expect(updatedPrinter?.averageRating).toBeCloseTo(4, 1);
  });

  it('returns 400 when order is not confirmed', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const { printer } = await createTestPrinter();
    const order = await seedOrder({ buyerId: buyer.id, printerId: printer.id, status: 'delivered' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/reviews`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { rating: 5 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/confirmed/);
  });

  it('returns 403 when printer tries to review', async () => {
    const { user: buyer } = await createTestUser();
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ buyerId: buyer.id, printerId: printer.id, status: 'confirmed' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/reviews`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { rating: 5 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 400 for rating below minimum (0)', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const { printer } = await createTestPrinter();
    const order = await seedOrder({ buyerId: buyer.id, printerId: printer.id, status: 'confirmed' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/reviews`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { rating: 0 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for rating above maximum (6)', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const { printer } = await createTestPrinter();
    const order = await seedOrder({ buyerId: buyer.id, printerId: printer.id, status: 'confirmed' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/reviews`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { rating: 6 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 409 for duplicate review on same order', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const { printer } = await createTestPrinter();
    const order = await seedOrder({ buyerId: buyer.id, printerId: printer.id, status: 'confirmed' });

    // First review
    await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/reviews`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { rating: 5 },
    });

    // Second review on same order
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/reviews`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { rating: 3 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already reviewed/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/printers/:printerId/reviews — List printer reviews
// ---------------------------------------------------------------------------
describe('GET /api/v1/printers/:printerId/reviews', () => {
  it('returns 200 with reviews for a printer (no auth required)', async () => {
    const { user: buyer } = await createTestUser();
    const { printer } = await createTestPrinter();
    const order = await seedOrder({ buyerId: buyer.id, printerId: printer.id, status: 'confirmed' });

    // Create a review directly
    await prisma.review.create({
      data: {
        orderId: order.id,
        reviewerId: buyer.id,
        revieweeId: printer.userId,
        rating: 5,
        comment: 'Great work',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/printers/${printer.id}/reviews`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].rating).toBe(5);
  });

  it('returns empty list for printer with no reviews', async () => {
    const { printer } = await createTestPrinter();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/printers/${printer.id}/reviews`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it('returns 404 for non-existent printer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers/00000000-0000-0000-0000-000000000000/reviews',
    });

    expect(res.statusCode).toBe(404);
  });
});
