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
// POST /api/v1/uploads/presign
// ---------------------------------------------------------------------------
describe('POST /api/v1/uploads/presign', () => {
  it('returns 200 with an uploadUrl, fileKey, and mode for a valid .stl file', async () => {
    const { authHeaders } = await createTestUser({ email: 'presign@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...authHeaders },
      payload: {
        fileName: 'model.stl',
        fileSize: 1024 * 1024, // 1 MB
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadUrl).toBeDefined();
    expect(body.fileKey).toBeDefined();
    expect(body.mode).toBe('local'); // No S3 env vars in test
    expect(body.maxSize).toBe(50 * 1024 * 1024);
    expect(body.expiresIn).toBe(900);
  });

  it('returns 200 for a valid .3mf file', async () => {
    const { authHeaders } = await createTestUser({ email: 'presign3mf@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...authHeaders },
      payload: { fileName: 'part.3mf', fileSize: 500 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('local');
  });

  it('returns 200 for a valid .obj file', async () => {
    const { authHeaders } = await createTestUser({ email: 'presignobj@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...authHeaders },
      payload: { fileName: 'mesh.obj', fileSize: 2048 },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for an unsupported file extension', async () => {
    const { authHeaders } = await createTestUser({ email: 'badext@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...authHeaders },
      payload: { fileName: 'virus.exe', fileSize: 1024 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not supported/i);
  });

  it('returns 400 for a .png file', async () => {
    const { authHeaders } = await createTestUser({ email: 'png@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...authHeaders },
      payload: { fileName: 'image.png', fileSize: 1024 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when fileSize exceeds 50 MB', async () => {
    const { authHeaders } = await createTestUser({ email: 'toobig@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...authHeaders },
      payload: {
        fileName: 'huge.stl',
        fileSize: 51 * 1024 * 1024, // 51 MB — exceeds limit
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/50MB/i);
  });

  it('returns 400 when fileName is missing', async () => {
    const { authHeaders } = await createTestUser({ email: 'noname@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...authHeaders },
      payload: { fileSize: 1024 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when fileSize is missing', async () => {
    const { authHeaders } = await createTestUser({ email: 'nosize@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...authHeaders },
      payload: { fileName: 'model.stl' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without an Authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      payload: { fileName: 'model.stl', fileSize: 1024 },
    });

    expect(res.statusCode).toBe(401);
  });

  it('the returned fileKey contains the userId path segment', async () => {
    const { user, authHeaders } = await createTestUser({ email: 'keychk@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: { ...authHeaders },
      payload: { fileName: 'model.stl', fileSize: 1024 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fileKey).toContain(user.id);
    expect(body.fileKey).toMatch(/\.stl$/);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/uploads/file  — local file upload
// ---------------------------------------------------------------------------
describe('POST /api/v1/uploads/file', () => {
  it('returns 400 when the key query parameter is missing', async () => {
    const { authHeaders } = await createTestUser({ email: 'nokey@uploads.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/file',
      headers: { ...authHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('fake stl data'),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/missing file key/i);
  });

  it('returns 400 when no file body is sent', async () => {
    const { user, authHeaders } = await createTestUser({ email: 'nobody@uploads.test.com' });
    const fileKey = `users/${user.id}/models/test-uuid/original.stl`;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/uploads/file?key=${encodeURIComponent(fileKey)}`,
      headers: { ...authHeaders, 'content-type': 'application/octet-stream' },
      // No payload
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without an Authorization header', async () => {
    const fileKey = 'users/some-id/models/uuid/original.stl';

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/uploads/file?key=${encodeURIComponent(fileKey)}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('fake stl data'),
    });

    expect(res.statusCode).toBe(401);
  });

  it('uploads a binary file and returns success with fileKey', async () => {
    const { user, authHeaders } = await createTestUser({ email: 'upload@uploads.test.com' });
    const fileKey = `users/${user.id}/models/test-uuid/original.stl`;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/uploads/file?key=${encodeURIComponent(fileKey)}`,
      headers: { ...authHeaders, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('solid test\nendsolid test\n'),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.fileKey).toBe(fileKey);
  });
});
