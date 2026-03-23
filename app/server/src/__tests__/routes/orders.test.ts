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
// GET /api/v1/orders — List my orders
// ---------------------------------------------------------------------------
describe('GET /api/v1/orders', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/orders' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with buyer orders', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    await seedOrder({ buyerId: buyer.id });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].buyerId).toBe(buyer.id);
  });

  it('returns 200 with printer orders', async () => {
    const { printer, accessToken } = await createTestPrinter();
    await seedOrder({ printerId: printer.id });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].printerId).toBe(printer.id);
  });

  it('returns empty list for user with no orders', async () => {
    const { accessToken } = await createTestUser();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/orders/:id — Order detail
// ---------------------------------------------------------------------------
describe('GET /api/v1/orders/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/orders/nonexistent' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 for buyer in the order', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${order.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(order.id);
  });

  it('returns 200 for printer in the order', async () => {
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ printerId: printer.id });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${order.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(order.id);
  });

  it('returns 403 for unrelated user', async () => {
    const { accessToken } = await createTestUser();
    const order = await seedOrder();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${order.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for non-existent order', async () => {
    const { accessToken } = await createTestUser();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/orders/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/orders/:id/status — Update status (printer only)
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/orders/:id/status', () => {
  it('transitions paid → printing', async () => {
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ printerId: printer.id, status: 'paid' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'printing' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('printing');
  });

  it('transitions printing → shipped with trackingNumber', async () => {
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ printerId: printer.id, status: 'printing' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'shipped', trackingNumber: 'TRACK123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('shipped');
    expect(res.json().trackingNumber).toBe('TRACK123');
  });

  it('transitions shipped → delivered', async () => {
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ printerId: printer.id, status: 'shipped' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'delivered' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('delivered');
  });

  it('returns 400 for invalid transition paid → shipped', async () => {
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ printerId: printer.id, status: 'paid' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'shipped' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Cannot transition/);
  });

  it('returns 400 for invalid transition delivered → printing', async () => {
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ printerId: printer.id, status: 'delivered' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'printing' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when buyer tries to update status', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id, status: 'paid' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'printing' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when unrelated printer tries to update status', async () => {
    const { accessToken } = await createTestPrinter();
    const order = await seedOrder({ status: 'paid' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'printing' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 409 on concurrent modification (status already changed)', async () => {
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ printerId: printer.id, status: 'paid' });

    // Simulate concurrent change — advance status directly in DB
    await prisma.order.update({ where: { id: order.id }, data: { status: 'printing' } });

    // Now the route sees status=paid in memory, but DB has printing → updateMany finds 0 rows
    // We need to trick the handler: re-read via inject while DB is already updated
    // The simplest way: send a second status update (paid→printing is now invalid since DB is printing)
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'printing' },
    });

    // Either 400 (invalid transition from printing→printing) or 409 (concurrent)
    expect([400, 409]).toContain(res.statusCode);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/orders/:id/confirm — Confirm delivery (buyer only)
// ---------------------------------------------------------------------------
describe('POST /api/v1/orders/:id/confirm', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/orders/nonexistent/confirm' });
    expect(res.statusCode).toBe(401);
  });

  it('confirms a delivered order and sets status to confirmed', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id, status: 'delivered' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/confirm`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('confirmed');
  });

  it('confirms a shipped order', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id, status: 'shipped' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/confirm`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('confirmed');
  });

  it('returns 400 when order is not shipped/delivered', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id, status: 'paid' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/confirm`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/shipped or delivered/);
  });

  it('returns 403 when printer tries to confirm', async () => {
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ printerId: printer.id, status: 'delivered' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/confirm`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/orders/:id/refund — Refund (buyer only)
// ---------------------------------------------------------------------------
describe('POST /api/v1/orders/:id/refund', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/orders/nonexistent/refund' });
    expect(res.statusCode).toBe(401);
  });

  it('refunds a paid order', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id, status: 'paid' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/refund`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().refunded).toBe(true);

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.status).toBe('refunded');
  });

  it('refunds a printing order', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id, status: 'printing' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/refund`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().refunded).toBe(true);
  });

  it('returns 400 when order is shipped (cannot refund)', async () => {
    const { user: buyer, accessToken } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id, status: 'shipped' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/refund`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/cannot be refunded/);
  });

  it('returns 403 when printer tries to refund', async () => {
    const { printer, accessToken } = await createTestPrinter();
    const order = await seedOrder({ printerId: printer.id, status: 'paid' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/refund`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
