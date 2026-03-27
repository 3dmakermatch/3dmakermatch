import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  buildApp,
  cleanDatabase,
  disconnectPrisma,
  createTestUser,
  createTestPrinter,
  seedJob,
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
// GET /api/v1/admin/stats — Dashboard stats
// ---------------------------------------------------------------------------
describe('GET /api/v1/admin/stats', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for non-admin buyer', async () => {
    const { accessToken } = await createTestUser({ role: 'buyer' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for non-admin printer', async () => {
    const { accessToken } = await createTestPrinter();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with counts for admin user', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('totalUsers');
    expect(body).toHaveProperty('totalJobs');
    expect(body).toHaveProperty('totalOrders');
    expect(body).toHaveProperty('totalRevenueCents');
    expect(body).toHaveProperty('activeDisputes');
    expect(typeof body.totalUsers).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/users — List users
// ---------------------------------------------------------------------------
describe('GET /api/v1/admin/users', () => {
  it('returns 403 for non-admin', async () => {
    const { accessToken } = await createTestUser();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with paginated list of users', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    await createTestUser({ email: 'buyer1@test.com' });
    await createTestUser({ email: 'buyer2@test.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?page=1&limit=10',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(10);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by role', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    await createTestUser({ role: 'buyer' });
    await createTestPrinter();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?role=printer',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.every((u: { role: string }) => u.role === 'printer')).toBe(true);
  });

  it('filters by search (name/email)', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    await createTestUser({ email: 'uniqueuser@test.com', fullName: 'Unique Person' });
    await createTestUser({ email: 'other@test.com', fullName: 'Other Person' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?search=uniqueuser',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.some((u: { email: string }) => u.email === 'uniqueuser@test.com')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/users/:id — Update user
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/admin/users/:id', () => {
  it('returns 403 for non-admin', async () => {
    const { accessToken } = await createTestUser();
    const { user: target } = await createTestUser();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${target.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { role: 'printer' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('suspends a user (changes role to buyer, clears refreshToken)', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    const { user: target } = await createTestPrinter();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${target.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { suspend: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('buyer');
  });

  it('changes user role', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    const { user: target } = await createTestUser({ role: 'buyer' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${target.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { role: 'admin' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('admin');
  });

  it('returns 404 for non-existent user', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { role: 'buyer' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when no valid update fields provided', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    const { user: target } = await createTestUser();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${target.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/jobs — List all jobs
// ---------------------------------------------------------------------------
describe('GET /api/v1/admin/jobs', () => {
  it('returns 403 for non-admin', async () => {
    const { accessToken } = await createTestUser();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/jobs',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with all jobs including cancelled/expired', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    const { user: buyer } = await createTestUser();
    await seedJob(buyer.id);

    // Create a cancelled job directly
    await prisma.printJob.create({
      data: {
        userId: buyer.id,
        title: 'Cancelled Job',
        description: 'This was cancelled',
        materialPreferred: ['ABS'],
        quantity: 1,
        status: 'cancelled',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/jobs',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.pagination).toBeDefined();
    expect(body.data.some((j: { status: string }) => j.status === 'cancelled')).toBe(true);
    expect(body.data.some((j: { status: string }) => j.status === 'bidding')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/admin/jobs/:id — Soft delete job
// ---------------------------------------------------------------------------
describe('DELETE /api/v1/admin/jobs/:id', () => {
  it('returns 403 for non-admin', async () => {
    const { accessToken } = await createTestUser();
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/jobs/${job.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('sets job status to cancelled (soft delete)', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/jobs/${job.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');

    const updated = await prisma.printJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('cancelled');
  });

  it('returns 404 for non-existent job', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/jobs/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/disputes — List disputes
// ---------------------------------------------------------------------------
describe('GET /api/v1/admin/disputes', () => {
  it('returns 403 for non-admin', async () => {
    const { accessToken } = await createTestUser();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/disputes',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with list of disputes', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    const { user: buyer } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id });

    await prisma.dispute.create({
      data: {
        orderId: order.id,
        creatorId: buyer.id,
        reason: 'Item not as described',
        status: 'open',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/disputes',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe('open');
    expect(body.pagination).toBeDefined();
  });

  it('filters disputes by status', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    const { user: buyer } = await createTestUser();
    const order1 = await seedOrder({ buyerId: buyer.id });
    const order2 = await seedOrder({ buyerId: buyer.id });

    await prisma.dispute.create({
      data: { orderId: order1.id, creatorId: buyer.id, reason: 'Open dispute', status: 'open' },
    });
    await prisma.dispute.create({
      data: { orderId: order2.id, creatorId: buyer.id, reason: 'Resolved dispute', status: 'resolved' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/disputes?status=open',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.every((d: { status: string }) => d.status === 'open')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/disputes/:id — Resolve dispute
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/admin/disputes/:id', () => {
  it('returns 403 for non-admin', async () => {
    const { accessToken } = await createTestUser();
    const { user: buyer } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id });
    const dispute = await prisma.dispute.create({
      data: { orderId: order.id, creatorId: buyer.id, reason: 'Test', status: 'open' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/disputes/${dispute.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'resolved', resolution: 'Resolved by admin' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('updates dispute status and resolution', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    const { user: buyer } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id });
    const dispute = await prisma.dispute.create({
      data: { orderId: order.id, creatorId: buyer.id, reason: 'Test', status: 'open' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/disputes/${dispute.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'resolved', resolution: 'Refund issued' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('resolved');
    expect(body.resolution).toBe('Refund issued');
  });

  it('returns 404 for non-existent dispute', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/disputes/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'resolved' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid status value', async () => {
    const { accessToken } = await createTestUser({ role: 'admin' });
    const { user: buyer } = await createTestUser();
    const order = await seedOrder({ buyerId: buyer.id });
    const dispute = await prisma.dispute.create({
      data: { orderId: order.id, creatorId: buyer.id, reason: 'Test', status: 'open' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/disputes/${dispute.id}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      payload: { status: 'invalidstatus' },
    });

    expect(res.statusCode).toBe(400);
  });
});
