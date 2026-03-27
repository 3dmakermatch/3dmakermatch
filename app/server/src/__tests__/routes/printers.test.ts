import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  buildApp,
  cleanDatabase,
  disconnectPrisma,
  createTestUser,
  createTestPrinter,
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
// POST /api/v1/printers  — register as printer
// ---------------------------------------------------------------------------
describe('POST /api/v1/printers', () => {
  it('creates a printer profile for a printer-role user', async () => {
    const { authHeaders } = await createTestUser({ role: 'printer' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printers',
      headers: { ...authHeaders },
      payload: {
        bio: 'I print things.',
        addressCity: 'Austin',
        addressState: 'TX',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bio).toBe('I print things.');
    expect(body.addressCity).toBe('Austin');
    expect(body.user).toBeDefined();
  });

  it('returns 403 when a buyer-role user attempts to create a printer profile', async () => {
    const { authHeaders } = await createTestUser({ role: 'buyer' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printers',
      headers: { ...authHeaders },
      payload: { bio: 'Buyer pretending to be printer' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/only printer accounts/i);
  });

  it('returns 409 when printer profile already exists for the user', async () => {
    const { authHeaders } = await createTestPrinter();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printers',
      headers: { ...authHeaders },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already exists/i);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printers',
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for a latitude out of range', async () => {
    const { authHeaders } = await createTestUser({ role: 'printer' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printers',
      headers: { ...authHeaders },
      payload: { latitude: 999 },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/printers  — list printers
// ---------------------------------------------------------------------------
describe('GET /api/v1/printers', () => {
  it('returns an empty list when no printers exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
  });

  it('returns a list of printers with pagination metadata', async () => {
    await createTestPrinter({ email: 'p1@printers.test.com' });
    await createTestPrinter({ email: 'p2@printers.test.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers?page=1&limit=10',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.totalPages).toBe(1);
    expect(body.limit).toBe(10);
  });

  it('filters by city', async () => {
    await createTestPrinter({ email: 'boston@printers.test.com' });

    // Create one with a different city
    const { user } = await createTestUser({ role: 'printer', email: 'nyc@printers.test.com' });
    await prisma.printer.create({
      data: { userId: user.id, addressCity: 'New York', addressState: 'NY' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers?city=Boston',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].addressCity).toBe('Boston');
  });

  it('filters by state', async () => {
    await createTestPrinter({ email: 'ma@printers.test.com' });

    const { user } = await createTestUser({ role: 'printer', email: 'ca@printers.test.com' });
    await prisma.printer.create({
      data: { userId: user.id, addressCity: 'Los Angeles', addressState: 'CA' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers?state=MA',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].addressState).toBe('MA');
  });

  it('paginates correctly', async () => {
    await createTestPrinter({ email: 'pg1@printers.test.com' });
    await createTestPrinter({ email: 'pg2@printers.test.com' });
    await createTestPrinter({ email: 'pg3@printers.test.com' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers?page=2&limit=2',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.page).toBe(2);
    expect(body.totalPages).toBe(2);
  });

  it('returns 400 for an invalid limit value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers?limit=999',
    });

    expect(res.statusCode).toBe(400);
  });

  it('does not require authentication', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers',
    });

    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/printers/:id  — get printer detail
// ---------------------------------------------------------------------------
describe('GET /api/v1/printers/:id', () => {
  it('returns printer detail with machines included', async () => {
    const { printer } = await createTestPrinter({ email: 'detail@printers.test.com' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/printers/${printer.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(printer.id);
    expect(body.machines).toBeDefined();
    expect(Array.isArray(body.machines)).toBe(true);
    expect(body.user).toBeDefined();
  });

  it('returns 404 for a non-existent printer ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/printers/:id  — update printer profile
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/printers/:id', () => {
  it('allows the owner to update their printer profile', async () => {
    const { printer, authHeaders } = await createTestPrinter({ email: 'owner@printers.test.com' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/printers/${printer.id}`,
      headers: { ...authHeaders },
      payload: { bio: 'Updated bio here.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().bio).toBe('Updated bio here.');
  });

  it('returns 403 when a different user tries to update', async () => {
    const { printer } = await createTestPrinter({ email: 'owner2@printers.test.com' });
    const { authHeaders: otherHeaders } = await createTestPrinter({
      email: 'other@printers.test.com',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/printers/${printer.id}`,
      headers: { ...otherHeaders },
      payload: { bio: 'Hacked bio' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for a non-existent printer ID', async () => {
    const { authHeaders } = await createTestUser({ role: 'printer' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/printers/00000000-0000-0000-0000-000000000000',
      headers: { ...authHeaders },
      payload: { bio: 'Ghost bio' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const { printer } = await createTestPrinter({ email: 'noauth@printers.test.com' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/printers/${printer.id}`,
      payload: { bio: 'No auth' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/printers/:id/machines  — list machines (public)
// ---------------------------------------------------------------------------
describe('GET /api/v1/printers/:id/machines', () => {
  it('returns an empty array when the printer has no machines', async () => {
    const { printer } = await createTestPrinter({ email: 'nomachines@printers.test.com' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/printers/${printer.id}/machines`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns 404 for a non-existent printer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/printers/00000000-0000-0000-0000-000000000000/machines',
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/printers/:id/machines  — create machine
// ---------------------------------------------------------------------------
describe('POST /api/v1/printers/:id/machines', () => {
  const validMachine = {
    name: 'Prusa MK4',
    type: 'FDM',
    materials: ['PLA', 'PETG'],
    buildVolume: { x: 250, y: 210, z: 220 },
  };

  it('creates a machine for the owning printer', async () => {
    const { printer, authHeaders } = await createTestPrinter({
      email: 'machineowner@printers.test.com',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/printers/${printer.id}/machines`,
      headers: { ...authHeaders },
      payload: validMachine,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Prusa MK4');
    expect(body.type).toBe('FDM');
    expect(body.materials).toEqual(['PLA', 'PETG']);
    expect(body.printerId).toBe(printer.id);
  });

  it('returns 403 when a different printer owner tries to add a machine', async () => {
    const { printer } = await createTestPrinter({ email: 'target@printers.test.com' });
    const { authHeaders: otherAuth } = await createTestPrinter({
      email: 'attacker@printers.test.com',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/printers/${printer.id}/machines`,
      headers: { ...otherAuth },
      payload: validMachine,
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when name is missing', async () => {
    const { printer, authHeaders } = await createTestPrinter({
      email: 'missingname@printers.test.com',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/printers/${printer.id}/machines`,
      headers: { ...authHeaders },
      payload: { type: 'FDM', buildVolume: { x: 1, y: 1, z: 1 } },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when buildVolume values are not positive', async () => {
    const { printer, authHeaders } = await createTestPrinter({
      email: 'negvol@printers.test.com',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/printers/${printer.id}/machines`,
      headers: { ...authHeaders },
      payload: { name: 'Bad Machine', type: 'FDM', buildVolume: { x: -1, y: 200, z: 200 } },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a non-existent printer ID', async () => {
    const { authHeaders } = await createTestUser({ role: 'printer' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printers/00000000-0000-0000-0000-000000000000/machines',
      headers: { ...authHeaders },
      payload: validMachine,
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const { printer } = await createTestPrinter({ email: 'noauthmachine@printers.test.com' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/printers/${printer.id}/machines`,
      payload: validMachine,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/v1/printers/:id/machines/:machineId  — update machine
// ---------------------------------------------------------------------------
describe('PUT /api/v1/printers/:id/machines/:machineId', () => {
  it('allows the owner to update a machine', async () => {
    const { printer, authHeaders } = await createTestPrinter({
      email: 'updatemachine@printers.test.com',
    });

    const machine = await prisma.printerMachine.create({
      data: {
        printerId: printer.id,
        name: 'Old Name',
        type: 'FDM',
        materials: ['PLA'],
        buildVolume: { x: 200, y: 200, z: 200 },
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/printers/${printer.id}/machines/${machine.id}`,
      headers: { ...authHeaders },
      payload: { name: 'New Name', materials: ['PLA', 'ABS'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('New Name');
    expect(body.materials).toEqual(['PLA', 'ABS']);
  });

  it('returns 403 when a different user tries to update', async () => {
    const { printer } = await createTestPrinter({ email: 'own3@printers.test.com' });
    const { authHeaders: otherAuth } = await createTestPrinter({
      email: 'oth3r@printers.test.com',
    });

    const machine = await prisma.printerMachine.create({
      data: {
        printerId: printer.id,
        name: 'My Machine',
        type: 'SLA',
        materials: [],
        buildVolume: { x: 100, y: 100, z: 100 },
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/printers/${printer.id}/machines/${machine.id}`,
      headers: { ...otherAuth },
      payload: { name: 'Hijacked' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for a non-existent machine ID', async () => {
    const { printer, authHeaders } = await createTestPrinter({
      email: 'nomachineupdate@printers.test.com',
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/printers/${printer.id}/machines/00000000-0000-0000-0000-000000000000`,
      headers: { ...authHeaders },
      payload: { name: 'Ghost' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const { printer } = await createTestPrinter({ email: 'noauthupdatemachine@printers.test.com' });

    const machine = await prisma.printerMachine.create({
      data: {
        printerId: printer.id,
        name: 'My Machine',
        type: 'FDM',
        materials: [],
        buildVolume: { x: 100, y: 100, z: 100 },
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/printers/${printer.id}/machines/${machine.id}`,
      payload: { name: 'Unauthorized' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/printers/:id/machines/:machineId  — delete machine
// ---------------------------------------------------------------------------
describe('DELETE /api/v1/printers/:id/machines/:machineId', () => {
  it('allows the owner to delete a machine (returns 204)', async () => {
    const { printer, authHeaders } = await createTestPrinter({
      email: 'deletemachine@printers.test.com',
    });

    const machine = await prisma.printerMachine.create({
      data: {
        printerId: printer.id,
        name: 'To Delete',
        type: 'FDM',
        materials: [],
        buildVolume: { x: 100, y: 100, z: 100 },
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/printers/${printer.id}/machines/${machine.id}`,
      headers: { ...authHeaders },
    });

    expect(res.statusCode).toBe(204);

    // Verify it's gone
    const found = await prisma.printerMachine.findUnique({ where: { id: machine.id } });
    expect(found).toBeNull();
  });

  it('returns 403 when a different user tries to delete', async () => {
    const { printer } = await createTestPrinter({ email: 'own4@printers.test.com' });
    const { authHeaders: otherAuth } = await createTestPrinter({
      email: 'oth4r@printers.test.com',
    });

    const machine = await prisma.printerMachine.create({
      data: {
        printerId: printer.id,
        name: 'Protected Machine',
        type: 'FDM',
        materials: [],
        buildVolume: { x: 100, y: 100, z: 100 },
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/printers/${printer.id}/machines/${machine.id}`,
      headers: { ...otherAuth },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for a non-existent machine ID', async () => {
    const { printer, authHeaders } = await createTestPrinter({
      email: 'ghostdelete@printers.test.com',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/printers/${printer.id}/machines/00000000-0000-0000-0000-000000000000`,
      headers: { ...authHeaders },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const { printer } = await createTestPrinter({ email: 'noauthdelmachine@printers.test.com' });

    const machine = await prisma.printerMachine.create({
      data: {
        printerId: printer.id,
        name: 'Safe Machine',
        type: 'FDM',
        materials: [],
        buildVolume: { x: 100, y: 100, z: 100 },
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/printers/${printer.id}/machines/${machine.id}`,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/printers/stripe/onboard
// ---------------------------------------------------------------------------
describe('POST /api/v1/printers/stripe/onboard', () => {
  it('returns 404 when the user has no printer profile', async () => {
    const { authHeaders } = await createTestUser({
      role: 'printer',
      email: 'nostripeprofile@printers.test.com',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printers/stripe/onboard',
      headers: { ...authHeaders },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/printer profile not found/i);
  });

  it('returns 400 when the printer is already onboarded', async () => {
    const { printer, authHeaders } = await createTestPrinter({
      email: 'alreadyonboarded@printers.test.com',
    });

    // Pre-set a stripeAccountId to simulate already-onboarded state
    await prisma.printer.update({
      where: { id: printer.id },
      data: { stripeAccountId: 'acct_test123' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printers/stripe/onboard',
      headers: { ...authHeaders },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/already onboarded/i);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/printers/stripe/onboard',
    });

    expect(res.statusCode).toBe(401);
  });
});
