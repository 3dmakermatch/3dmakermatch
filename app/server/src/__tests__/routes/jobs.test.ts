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
// POST /api/v1/jobs
// ---------------------------------------------------------------------------
describe('POST /api/v1/jobs', () => {
  it('creates a job with files and returns 201', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: authHeaders,
      payload: {
        title: 'My First Print Job',
        description: 'A test description',
        files: [
          { fileKey: 'uploads/abc123.stl', fileName: 'model.stl', displayOrder: 0 },
        ],
        materialPreferred: 'PLA',
        quantity: 2,
        expiresInDays: 7,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe('My First Print Job');
    expect(body.description).toBe('A test description');
    expect(body.quantity).toBe(2);
    expect(body.status).toBe('draft');
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].fileName).toBe('model.stl');
    expect(body.user).toBeDefined();
  });

  it('creates JobFile records in the database', async () => {
    const { user, authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: authHeaders,
      payload: {
        title: 'File Record Test',
        files: [
          { fileKey: 'uploads/file1.stl', fileName: 'part1.stl', displayOrder: 0 },
          { fileKey: 'uploads/file2.stl', fileName: 'part2.stl', displayOrder: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    const dbFiles = await prisma.jobFile.findMany({ where: { jobId: body.id } });
    expect(dbFiles).toHaveLength(2);
    expect(dbFiles.map((f) => f.fileName).sort()).toEqual(['part1.stl', 'part2.stl'].sort());
  });

  it('sets job status to draft on creation', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: authHeaders,
      payload: {
        title: 'Draft Status Test',
        files: [{ fileKey: 'uploads/x.stl', fileName: 'x.stl', displayOrder: 0 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('draft');
  });

  it('accepts materialPreferred as a single string and normalises to array', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: authHeaders,
      payload: {
        title: 'String Material Test',
        files: [{ fileKey: 'uploads/x.stl', fileName: 'x.stl', displayOrder: 0 }],
        materialPreferred: 'PETG',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Array.isArray(body.materialPreferred)).toBe(true);
    expect(body.materialPreferred).toContain('PETG');
  });

  it('accepts materialPreferred as a string array', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: authHeaders,
      payload: {
        title: 'Array Material Test',
        files: [{ fileKey: 'uploads/x.stl', fileName: 'x.stl', displayOrder: 0 }],
        materialPreferred: ['PLA', 'ABS'],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.materialPreferred).toContain('PLA');
    expect(body.materialPreferred).toContain('ABS');
  });

  it('returns 400 when title is missing', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: authHeaders,
      payload: {
        files: [{ fileKey: 'uploads/x.stl', fileName: 'x.stl', displayOrder: 0 }],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when files array is empty', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: authHeaders,
      payload: {
        title: 'No Files Job',
        files: [],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when fileKey is missing from a file entry', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: authHeaders,
      payload: {
        title: 'Missing fileKey',
        files: [{ fileName: 'x.stl', displayOrder: 0 }],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        title: 'Unauthorized Job',
        files: [{ fileKey: 'uploads/x.stl', fileName: 'x.stl', displayOrder: 0 }],
      },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/jobs
// ---------------------------------------------------------------------------
describe('GET /api/v1/jobs', () => {
  it('returns 200 with paginated results including files', async () => {
    const { user } = await createTestUser();
    // seedJob creates with status 'bidding'
    await seedJob(user.id);
    await seedJob(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBeGreaterThanOrEqual(1);
    // Each job should include files array
    body.data.forEach((job: any) => {
      expect(Array.isArray(job.files)).toBe(true);
    });
  });

  it('defaults to showing only bidding status jobs', async () => {
    const { user } = await createTestUser();
    await seedJob(user.id); // status: 'bidding'
    // Create a draft job directly
    await prisma.printJob.create({
      data: {
        userId: user.id,
        title: 'Draft Job',
        status: 'draft',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    body.data.forEach((job: any) => {
      expect(job.status).toBe('bidding');
    });
  });

  it('filters by status query param', async () => {
    const { user } = await createTestUser();
    await seedJob(user.id); // bidding
    await prisma.printJob.create({
      data: {
        userId: user.id,
        title: 'Active Job',
        status: 'active',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?status=active',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    body.data.forEach((job: any) => {
      expect(job.status).toBe('active');
    });
  });

  it('filters by material', async () => {
    const { user } = await createTestUser();
    // seedJob uses PLA
    await seedJob(user.id);
    // Create a job with PETG
    await prisma.printJob.create({
      data: {
        userId: user.id,
        title: 'PETG Job',
        materialPreferred: ['PETG'],
        status: 'bidding',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?material=PETG',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    body.data.forEach((job: any) => {
      expect(job.materialPreferred).toContain('PETG');
    });
  });

  it('excludes expired jobs by default', async () => {
    const { user } = await createTestUser();
    // Expired job
    await prisma.printJob.create({
      data: {
        userId: user.id,
        title: 'Expired Job',
        status: 'bidding',
        expiresAt: new Date(Date.now() - 1000), // in the past
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    body.data.forEach((job: any) => {
      expect(new Date(job.expiresAt).getTime()).toBeGreaterThan(Date.now() - 5000);
    });
  });

  it('supports pagination with page and limit params', async () => {
    const { user } = await createTestUser();
    for (let i = 0; i < 5; i++) {
      await seedJob(user.id);
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?page=1&limit=2',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.limit).toBe(2);
    expect(body.page).toBe(1);
  });

  it('supports sorting by created_at', async () => {
    const { user } = await createTestUser();
    await seedJob(user.id);
    await seedJob(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?sort_by=created_at&order=asc',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    if (body.data.length >= 2) {
      const first = new Date(body.data[0].createdAt).getTime();
      const second = new Date(body.data[1].createdAt).getTime();
      expect(first).toBeLessThanOrEqual(second);
    }
  });

  it('supports sorting by expires_at', async () => {
    const { user } = await createTestUser();
    await seedJob(user.id);
    await seedJob(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?sort_by=expires_at&order=desc',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    if (body.data.length >= 2) {
      const first = new Date(body.data[0].expiresAt).getTime();
      const second = new Date(body.data[1].expiresAt).getTime();
      expect(first).toBeGreaterThanOrEqual(second);
    }
  });

  it('includes bidCount on each job', async () => {
    const { user } = await createTestUser();
    await seedJob(user.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs',
    });

    expect(res.statusCode).toBe(200);
    res.json().data.forEach((job: any) => {
      expect(typeof job.bidCount).toBe('number');
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/jobs/:id
// ---------------------------------------------------------------------------
describe('GET /api/v1/jobs/:id', () => {
  it('returns 200 with full job details including files', async () => {
    const { job, jobFile } = await seedJob();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${job.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(job.id);
    expect(body.title).toBe(job.title);
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files.length).toBeGreaterThanOrEqual(1);
    expect(body.user).toBeDefined();
    expect(typeof body.bidCount).toBe('number');
  });

  it('returns 404 for a non-existent job', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/jobs/:id
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/jobs/:id', () => {
  it('allows the job owner to update title and description', async () => {
    const { user, authHeaders } = await createTestUser();
    const { job } = await seedJob(user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${job.id}`,
      headers: authHeaders,
      payload: { title: 'Updated Title', description: 'Updated desc' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe('Updated Title');
    expect(body.description).toBe('Updated desc');
  });

  it('returns 403 when a non-owner tries to update', async () => {
    const { job } = await seedJob();
    const { authHeaders: otherHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${job.id}`,
      headers: otherHeaders,
      payload: { title: 'Hack Title' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for a non-existent job', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/jobs/00000000-0000-0000-0000-000000000000',
      headers: authHeaders,
      payload: { title: 'Ghost Update' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth token', async () => {
    const { job } = await seedJob();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${job.id}`,
      payload: { title: 'No Auth Update' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('allows owner to cancel a job by setting status to cancelled', async () => {
    const { user, authHeaders } = await createTestUser();
    const { job } = await seedJob(user.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${job.id}`,
      headers: authHeaders,
      payload: { status: 'cancelled' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/jobs/mine
// ---------------------------------------------------------------------------
describe('GET /api/v1/jobs/mine', () => {
  it('returns only the authenticated user\'s jobs', async () => {
    const { user, authHeaders } = await createTestUser();
    const { user: otherUser } = await createTestUser();

    await seedJob(user.id);
    await seedJob(user.id);
    await seedJob(otherUser.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/mine',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.total).toBe(2);
    body.data.forEach((job: any) => {
      expect(job.userId).toBe(user.id);
    });
  });

  it('returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/mine',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns empty list when user has no jobs', async () => {
    const { authHeaders } = await createTestUser();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/mine',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('supports status filter on mine endpoint', async () => {
    const { user, authHeaders } = await createTestUser();
    await seedJob(user.id); // bidding
    await prisma.printJob.create({
      data: {
        userId: user.id,
        title: 'Draft Mine Job',
        status: 'draft',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/mine?status=draft',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    body.data.forEach((job: any) => {
      expect(job.status).toBe('draft');
    });
  });
});
