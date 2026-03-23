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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up a job with at least one bid from a printer, making both the job owner
 * and the printer valid messaging participants.
 */
async function setupJobWithBid() {
  const { user: buyer, authHeaders: buyerHeaders } = await createTestUser();
  const { user: printerUser, printer, authHeaders: printerHeaders } = await createTestPrinter();
  const { job } = await seedJob(buyer.id);
  await seedBid(job.id, printer.id);
  return { buyer, buyerHeaders, printerUser, printer, printerHeaders, job };
}

// ---------------------------------------------------------------------------
// POST /api/v1/messages
// ---------------------------------------------------------------------------
describe('POST /api/v1/messages', () => {
  it('allows the job owner to send a message to a bidding printer and returns 201', async () => {
    const { buyer, buyerHeaders, printerUser, job } = await setupJobWithBid();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: buyerHeaders,
      payload: {
        jobId: job.id,
        receiverId: printerUser.id,
        content: 'Hello, can you start next week?',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.content).toBe('Hello, can you start next week?');
    expect(body.senderId).toBe(buyer.id);
    expect(body.receiverId).toBe(printerUser.id);
    expect(body.jobId).toBe(job.id);
    expect(body.sender).toBeDefined();
    expect(body.sender.fullName).toBeDefined();
  });

  it('allows a bidding printer to send a message to the job owner and returns 201', async () => {
    const { buyer, printerUser, printerHeaders, job } = await setupJobWithBid();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: printerHeaders,
      payload: {
        jobId: job.id,
        receiverId: buyer.id,
        content: 'I can start immediately!',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.senderId).toBe(printerUser.id);
    expect(body.receiverId).toBe(buyer.id);
    expect(body.content).toBe('I can start immediately!');
  });

  it('returns 403 when a non-participant tries to send a message', async () => {
    const { job, buyer } = await setupJobWithBid();
    const { user: outsider, authHeaders: outsiderHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: outsiderHeaders,
      payload: {
        jobId: job.id,
        receiverId: buyer.id,
        content: 'I am not involved in this job.',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/participant/i);
  });

  it('returns 400 when a participant tries to message a non-participant', async () => {
    const { buyerHeaders, job } = await setupJobWithBid();
    const { user: outsider } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: buyerHeaders,
      payload: {
        jobId: job.id,
        receiverId: outsider.id,
        content: 'Trying to message an outsider.',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/participant/i);
  });

  it('returns 400 when content is missing', async () => {
    const { buyerHeaders, printerUser, job } = await setupJobWithBid();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: buyerHeaders,
      payload: {
        jobId: job.id,
        receiverId: printerUser.id,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when content is empty string', async () => {
    const { buyerHeaders, printerUser, job } = await setupJobWithBid();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: buyerHeaders,
      payload: {
        jobId: job.id,
        receiverId: printerUser.id,
        content: '',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when jobId is missing', async () => {
    const { buyerHeaders, printerUser } = await setupJobWithBid();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: buyerHeaders,
      payload: {
        receiverId: printerUser.id,
        content: 'No job ID provided.',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when jobId does not exist', async () => {
    const { buyerHeaders, printerUser } = await setupJobWithBid();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: buyerHeaders,
      payload: {
        jobId: '00000000-0000-0000-0000-000000000000',
        receiverId: printerUser.id,
        content: 'This job does not exist.',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth token', async () => {
    const { printerUser, job } = await setupJobWithBid();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      payload: {
        jobId: job.id,
        receiverId: printerUser.id,
        content: 'Unauthorized message.',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('persists the message in the database', async () => {
    const { buyerHeaders, printerUser, job } = await setupJobWithBid();

    await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: buyerHeaders,
      payload: {
        jobId: job.id,
        receiverId: printerUser.id,
        content: 'Persistence check message.',
      },
    });

    const msgs = await prisma.message.findMany({ where: { jobId: job.id } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Persistence check message.');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/messages/threads/:jobId
// ---------------------------------------------------------------------------
describe('GET /api/v1/messages/threads/:jobId', () => {
  it('returns 200 with messages for the job thread visible to the participant', async () => {
    const { buyerHeaders, printerUser, buyer, job } = await setupJobWithBid();

    // Seed a message from buyer to printer
    await prisma.message.create({
      data: {
        jobId: job.id,
        senderId: buyer.id,
        receiverId: printerUser.id,
        content: 'First message',
      },
    });
    await prisma.message.create({
      data: {
        jobId: job.id,
        senderId: printerUser.id,
        receiverId: buyer.id,
        content: 'Second message',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/threads/${job.id}`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    body.data.forEach((msg: any) => {
      expect(msg.sender).toBeDefined();
    });
  });

  it('returns messages in ascending chronological order', async () => {
    const { buyerHeaders, printerUser, buyer, job } = await setupJobWithBid();

    await prisma.message.create({
      data: { jobId: job.id, senderId: buyer.id, receiverId: printerUser.id, content: 'First' },
    });
    // Small sleep ensures distinct timestamps
    await new Promise((r) => setTimeout(r, 10));
    await prisma.message.create({
      data: { jobId: job.id, senderId: printerUser.id, receiverId: buyer.id, content: 'Second' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/threads/${job.id}`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const msgs = res.json().data;
    if (msgs.length >= 2) {
      const firstTime = new Date(msgs[0].createdAt).getTime();
      const secondTime = new Date(msgs[1].createdAt).getTime();
      expect(firstTime).toBeLessThanOrEqual(secondTime);
    }
  });

  it('marks unread messages as read after fetching the thread', async () => {
    const { buyerHeaders, printerUser, buyer, job } = await setupJobWithBid();

    // Printer sends a message to buyer (isRead defaults to false)
    const msg = await prisma.message.create({
      data: {
        jobId: job.id,
        senderId: printerUser.id,
        receiverId: buyer.id,
        content: 'Please read me',
        isRead: false,
      },
    });

    // Buyer fetches the thread — should mark the message as read
    await app.inject({
      method: 'GET',
      url: `/api/v1/messages/threads/${job.id}`,
      headers: buyerHeaders,
    });

    const updated = await prisma.message.findUnique({ where: { id: msg.id } });
    expect(updated!.isRead).toBe(true);
  });

  it('does not return messages from other jobs in this thread', async () => {
    const { buyerHeaders, printerUser, buyer, job } = await setupJobWithBid();
    const { job: otherJob } = await seedJob(buyer.id);

    await prisma.message.create({
      data: { jobId: job.id, senderId: buyer.id, receiverId: printerUser.id, content: 'On job 1' },
    });
    await prisma.message.create({
      data: { jobId: otherJob.id, senderId: buyer.id, receiverId: printerUser.id, content: 'On job 2' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/threads/${job.id}`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(200);
    res.json().data.forEach((msg: any) => {
      expect(msg.jobId).toBe(job.id);
    });
  });

  it('returns empty data array when there are no messages for the job', async () => {
    const { buyerHeaders, job } = await setupJobWithBid();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/threads/${job.id}`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it('returns 401 without auth token', async () => {
    const { job } = await setupJobWithBid();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/threads/${job.id}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns only messages where the user is sender or receiver', async () => {
    const { buyerHeaders, printerUser, buyer, job } = await setupJobWithBid();
    const { user: thirdParty, printer: thirdPrinter } = await createTestPrinter();
    // Give third party a bid so they are a participant
    await seedBid(job.id, thirdPrinter.id);

    // Message between buyer and thirdParty
    await prisma.message.create({
      data: { jobId: job.id, senderId: buyer.id, receiverId: thirdParty.id, content: 'To third party' },
    });
    // Message between buyer and printer
    await prisma.message.create({
      data: { jobId: job.id, senderId: buyer.id, receiverId: printerUser.id, content: 'To printer' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/threads/${job.id}`,
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(200);
    // Buyer should see messages where they are sender OR receiver
    res.json().data.forEach((msg: any) => {
      const isSender = msg.senderId === buyer.id;
      const isReceiver = msg.receiverId === buyer.id;
      expect(isSender || isReceiver).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/messages/threads  (list all threads)
// ---------------------------------------------------------------------------
describe('GET /api/v1/messages/threads', () => {
  it('returns 200 with the user\'s message threads', async () => {
    const { buyerHeaders, printerUser, buyer, job } = await setupJobWithBid();

    await prisma.message.create({
      data: { jobId: job.id, senderId: buyer.id, receiverId: printerUser.id, content: 'Thread message' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/messages/threads',
      headers: buyerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    body.data.forEach((msg: any) => {
      expect(msg.job).toBeDefined();
      expect(msg.sender).toBeDefined();
    });
  });

  it('returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/messages/threads',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns empty data array when user has no messages', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/messages/threads',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });
});
