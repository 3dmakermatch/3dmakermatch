import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  buildApp,
  cleanDatabase,
  disconnectPrisma,
  createTestUser,
  createTestPrinter,
  seedJob,
  seedBid,
} from '../helpers/index.js';
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
// POST /api/v1/jobs/:jobId/bids
// ---------------------------------------------------------------------------
describe('POST /api/v1/jobs/:jobId/bids', () => {
  it('returns 201 when a printer submits a valid bid', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer, authHeaders: printerHeaders } = await createTestPrinter();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      headers: printerHeaders,
      payload: {
        amountCents: 5000,
        shippingCostCents: 500,
        estimatedDays: 7,
        message: 'I can print this for you!',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.amountCents).toBe(5000);
    expect(body.shippingCostCents).toBe(500);
    expect(body.estimatedDays).toBe(7);
    expect(body.status).toBe('pending');
    expect(body.printer).toBeDefined();
  });

  it('returns 403 when a buyer tries to bid', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { authHeaders: buyerHeaders } = await createTestUser(); // another buyer

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      headers: buyerHeaders,
      payload: {
        amountCents: 5000,
        shippingCostCents: 0,
        estimatedDays: 5,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/printer/i);
  });

  it('returns 400 when a printer bids on their own job', async () => {
    // Create a printer user and a job owned by them
    const { user: printerUser, printer, authHeaders } = await createTestPrinter();
    const { job } = await seedJob(printerUser.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      headers: authHeaders,
      payload: {
        amountCents: 5000,
        shippingCostCents: 0,
        estimatedDays: 5,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/own job/i);
  });

  it('returns 409 when the same printer bids twice on the same job', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer, authHeaders: printerHeaders } = await createTestPrinter();

    // First bid
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      headers: printerHeaders,
      payload: { amountCents: 5000, shippingCostCents: 0, estimatedDays: 5 },
    });
    expect(first.statusCode).toBe(201);

    // Duplicate bid
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      headers: printerHeaders,
      payload: { amountCents: 4500, shippingCostCents: 0, estimatedDays: 4 },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatch(/already bid/i);
  });

  it('returns 400 when amountCents is missing', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { authHeaders: printerHeaders } = await createTestPrinter();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      headers: printerHeaders,
      payload: { shippingCostCents: 0, estimatedDays: 5 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth token', async () => {
    const { job } = await seedJob();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      payload: { amountCents: 5000, shippingCostCents: 0, estimatedDays: 5 },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when bidding on a job that is not in bidding status', async () => {
    const { user: buyer } = await createTestUser();
    const { printer, authHeaders: printerHeaders } = await createTestPrinter();

    // Create a draft job (not bidding)
    const job = await prisma.printJob.create({
      data: {
        userId: buyer.id,
        title: 'Draft Job',
        status: 'draft',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      headers: printerHeaders,
      payload: { amountCents: 5000, shippingCostCents: 0, estimatedDays: 5 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not accepting bids/i);
  });

  it('extends job deadline (anti-sniping) when bid is placed within 5 minutes of expiry', async () => {
    const { user: buyer } = await createTestUser();
    const { printer, authHeaders: printerHeaders } = await createTestPrinter();

    // Job that expires in 3 minutes
    const soonExpiry = new Date(Date.now() + 3 * 60 * 1000);
    const job = await prisma.printJob.create({
      data: {
        userId: buyer.id,
        title: 'Sniping Test Job',
        status: 'bidding',
        expiresAt: soonExpiry,
        extensionCount: 0,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      headers: printerHeaders,
      payload: { amountCents: 5000, shippingCostCents: 0, estimatedDays: 5 },
    });

    expect(res.statusCode).toBe(201);

    // The job's expiresAt should have been extended
    const updatedJob = await prisma.printJob.findUnique({ where: { id: job.id } });
    expect(updatedJob!.expiresAt.getTime()).toBeGreaterThan(soonExpiry.getTime());
    expect(updatedJob!.extensionCount).toBe(1);
  });

  it('does NOT extend deadline when bid is placed with more than 5 minutes remaining', async () => {
    const { user: buyer } = await createTestUser();
    const { printer, authHeaders: printerHeaders } = await createTestPrinter();

    const farExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    const job = await prisma.printJob.create({
      data: {
        userId: buyer.id,
        title: 'No Snipe Job',
        status: 'bidding',
        expiresAt: farExpiry,
        extensionCount: 0,
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/bids`,
      headers: printerHeaders,
      payload: { amountCents: 5000, shippingCostCents: 0, estimatedDays: 5 },
    });

    const updatedJob = await prisma.printJob.findUnique({ where: { id: job.id } });
    // Should not be extended significantly beyond the original
    expect(updatedJob!.expiresAt.getTime()).toBeLessThanOrEqual(farExpiry.getTime() + 1000);
    expect(updatedJob!.extensionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/jobs/:jobId/bids
// ---------------------------------------------------------------------------
describe('GET /api/v1/jobs/:jobId/bids', () => {
  it('returns 200 with bids sorted by amountCents ascending', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer: p1 } = await createTestPrinter();
    const { printer: p2 } = await createTestPrinter();

    await seedBid(job.id, p1.id, { amountCents: 8000 });
    await seedBid(job.id, p2.id, { amountCents: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${job.id}/bids`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].amountCents).toBe(3000);
    expect(body.data[1].amountCents).toBe(8000);
  });

  it('returns empty data array for a job with no bids', async () => {
    const { job } = await seedJob();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${job.id}/bids`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it('returns 404 for a non-existent job', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/00000000-0000-0000-0000-000000000000/bids',
    });

    expect(res.statusCode).toBe(404);
  });

  it('includes printer and user info on each bid', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    await seedBid(job.id, printer.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${job.id}/bids`,
    });

    expect(res.statusCode).toBe(200);
    const bid = res.json().data[0];
    expect(bid.printer).toBeDefined();
    expect(bid.printer.user).toBeDefined();
    expect(bid.printer.user.fullName).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/bids/:id/accept
// ---------------------------------------------------------------------------
describe('POST /api/v1/bids/:id/accept', () => {
  it('allows the job owner to accept a bid and creates an order', async () => {
    const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/accept`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bid).toBeDefined();
    expect(body.bid.status).toBe('accepted');
    expect(body.order).toBeDefined();
    expect(body.order.buyerId).toBe(buyer.id);
    expect(body.order.printerId).toBe(printer.id);
  });

  it('rejects all other pending bids atomically when one is accepted', async () => {
    const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer: p1 } = await createTestPrinter();
    const { printer: p2 } = await createTestPrinter();
    const { printer: p3 } = await createTestPrinter();

    const bid1 = await seedBid(job.id, p1.id);
    const bid2 = await seedBid(job.id, p2.id);
    const bid3 = await seedBid(job.id, p3.id);

    await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid1.id}/accept`,
      headers: buyerHeaders,
    });

    const updatedBid2 = await prisma.bid.findUnique({ where: { id: bid2.id } });
    const updatedBid3 = await prisma.bid.findUnique({ where: { id: bid3.id } });

    expect(updatedBid2!.status).toBe('rejected');
    expect(updatedBid3!.status).toBe('rejected');
  });

  it('sets the job status to active after accepting a bid', async () => {
    const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id);

    await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/accept`,
      headers: buyerHeaders,
    });

    const updatedJob = await prisma.printJob.findUnique({ where: { id: job.id } });
    expect(updatedJob!.status).toBe('active');
  });

  it('returns 403 when a non-owner tries to accept a bid', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id);
    const { authHeaders: otherHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/accept`,
      headers: otherHeaders,
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when the bid is not pending', async () => {
    const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id, { status: 'rejected' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/accept`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/pending/i);
  });

  it('returns 404 for a non-existent bid', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bids/00000000-0000-0000-0000-000000000000/accept',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/bids/:id/reject
// ---------------------------------------------------------------------------
describe('POST /api/v1/bids/:id/reject', () => {
  it('allows the job owner to reject a pending bid', async () => {
    const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/reject`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('rejected');
  });

  it('returns 403 when a non-owner tries to reject a bid', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id);
    const { authHeaders: otherHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/reject`,
      headers: otherHeaders,
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when the bid is already rejected', async () => {
    const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id, { status: 'rejected' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/reject`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/pending/i);
  });

  it('returns 400 when the bid is already accepted', async () => {
    const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id, { status: 'accepted' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/reject`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a non-existent bid', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bids/00000000-0000-0000-0000-000000000000/reject',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/bids/:id  (withdraw)
// ---------------------------------------------------------------------------
describe('DELETE /api/v1/bids/:id', () => {
  it('allows a printer to withdraw their own pending bid', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer, authHeaders: printerHeaders } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bids/${bid.id}`,
      headers: printerHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('withdrawn');
  });

  it('returns 403 when another printer tries to withdraw the bid', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id);
    const { authHeaders: otherPrinterHeaders } = await createTestPrinter();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bids/${bid.id}`,
      headers: otherPrinterHeaders,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/not your bid/i);
  });

  it('returns 400 when trying to withdraw an accepted bid', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer, authHeaders: printerHeaders } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id, { status: 'accepted' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bids/${bid.id}`,
      headers: printerHeaders,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/pending/i);
  });

  it('returns 404 for a non-existent bid', async () => {
    const { authHeaders } = await createTestPrinter();

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/bids/00000000-0000-0000-0000-000000000000',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth token', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/bids/${bid.id}`,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/bids/:id/pay
// ---------------------------------------------------------------------------
describe('POST /api/v1/bids/:id/pay', () => {
  it('returns mock order when Stripe is not configured (mock mode)', async () => {
    const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id, { status: 'accepted' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/pay`,
      headers: buyerHeaders,
    });

    // In test environment Stripe is mocked
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Either mock response or real stripe response — at minimum must not be a 4xx
    expect([200]).toContain(res.statusCode);
    // Mock stripe returns { order, mock: true }
    if (body.mock) {
      expect(body.order).toBeDefined();
      expect(body.mock).toBe(true);
    }
  });

  it('returns 400 when bid is not accepted', async () => {
    const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id); // status: pending

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/pay`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/accepted/i);
  });

  it('returns 403 when a non-owner tries to pay', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id, { status: 'accepted' });
    const { authHeaders: otherHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/pay`,
      headers: otherHeaders,
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for a non-existent bid', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bids/00000000-0000-0000-0000-000000000000/pay',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth token', async () => {
    const { user: buyer } = await createTestUser();
    const { job } = await seedJob(buyer.id);
    const { printer } = await createTestPrinter();
    const bid = await seedBid(job.id, printer.id, { status: 'accepted' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bids/${bid.id}/pay`,
    });

    expect(res.statusCode).toBe(401);
  });
});
