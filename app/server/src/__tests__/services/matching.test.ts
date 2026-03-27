import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findMatchingPrinters } from '../../services/matching.js';

// ── Helpers ────────────────────────────────────────────────────────────────────
function makePrinter(overrides: {
  id?: string;
  userId?: string;
  fullName?: string;
  email?: string;
  materials?: string[];
  trustScore?: number;
  averageRating?: number;
  emailPreferences?: Record<string, unknown>;
}) {
  const materials = overrides.materials ?? ['PLA'];
  return {
    id: overrides.id ?? 'printer-1',
    trustScore: overrides.trustScore ?? 500,
    averageRating: overrides.averageRating ?? 3.5,
    isVerified: false,
    machines: [{ materials }],
    user: {
      id: overrides.userId ?? 'user-printer-1',
      fullName: overrides.fullName ?? 'Test Printer',
      email: overrides.email ?? 'printer@example.com',
      emailPreferences: overrides.emailPreferences ?? {},
    },
  };
}

function makePrismaWithPrinters(printers: ReturnType<typeof makePrinter>[]) {
  return {
    printer: {
      findMany: vi.fn().mockResolvedValue(printers),
    },
  } as any;
}

// ── Material filtering ─────────────────────────────────────────────────────────
describe('findMatchingPrinters() — material filtering', () => {
  it('includes all printers when job has no material preferences (empty array)', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA'] }),
      makePrinter({ id: 'p2', materials: ['ABS'] }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: [], userId: 'job-owner' },
    );
    expect(results).toHaveLength(2);
  });

  it('adds "Any material accepted" reason when no materials required', async () => {
    const prisma = makePrismaWithPrinters([makePrinter({ id: 'p1' })]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: [], userId: 'job-owner' },
    );
    expect(results[0].matchReasons).toContain('Any material accepted');
  });

  it('excludes printers with no material overlap', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['ABS'] }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'job-owner' },
    );
    expect(results).toHaveLength(0);
  });

  it('includes printers with partial material overlap', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA', 'PETG'] }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA', 'ABS'], userId: 'job-owner' },
    );
    expect(results).toHaveLength(1);
    expect(results[0].matchReasons.some((r) => r.includes('PLA'))).toBe(true);
  });

  it('material matching is case-insensitive', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['pla'] }), // lowercase in printer
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'job-owner' }, // uppercase in job
    );
    expect(results).toHaveLength(1);
  });

  it('material matching is case-insensitive for job materials', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA'] }), // uppercase in printer
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['pla'], userId: 'job-owner' }, // lowercase in job
    );
    expect(results).toHaveLength(1);
  });

  it('match reason includes overlapping material names', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA', 'PETG'] }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA', 'PETG'], userId: 'job-owner' },
    );
    const reason = results[0].matchReasons.find((r) => r.startsWith('Supports'));
    expect(reason).toBeDefined();
    expect(reason).toContain('PLA');
    expect(reason).toContain('PETG');
  });

  it('partial material overlap reduces match score proportionally', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA'], trustScore: 0, averageRating: 0 }),
      makePrinter({ id: 'p2', materials: ['PLA', 'ABS'], trustScore: 0, averageRating: 0 }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA', 'ABS'], userId: 'job-owner' },
    );
    // p2 matches both materials (score 30), p1 only one (score 15)
    const p1 = results.find((r) => r.printerId === 'p1');
    const p2 = results.find((r) => r.printerId === 'p2');
    expect(p2!.score).toBeGreaterThan(p1!.score);
  });
});

// ── Job owner exclusion ────────────────────────────────────────────────────────
describe('findMatchingPrinters() — job owner exclusion', () => {
  it('excludes the printer belonging to the job owner', async () => {
    const prisma = {
      printer: {
        findMany: vi.fn().mockImplementation(({ where }: any) => {
          // The actual Prisma query filters by userId: { not: job.userId }
          // Since we mock, simulate by filtering here
          const all = [
            makePrinter({ id: 'p1', userId: 'job-owner' }),
            makePrinter({ id: 'p2', userId: 'other-user' }),
          ];
          return Promise.resolve(all.filter((p) => p.user.id !== where.userId.not));
        }),
      },
    } as any;

    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: [], userId: 'job-owner' },
    );
    expect(results.every((r) => r.userId !== 'job-owner')).toBe(true);
    expect(prisma.printer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: { not: 'job-owner' } } }),
    );
  });
});

// ── Scoring weights ────────────────────────────────────────────────────────────
describe('findMatchingPrinters() — scoring weights', () => {
  it('high trust score printer scores higher (all else equal)', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p-low', materials: ['PLA'], trustScore: 0, averageRating: 0 }),
      makePrinter({ id: 'p-high', materials: ['PLA'], trustScore: 1000, averageRating: 0 }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
    );
    const high = results.find((r) => r.printerId === 'p-high')!;
    const low = results.find((r) => r.printerId === 'p-low')!;
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('adds "High trust score" reason when trustScore >= 700', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA'], trustScore: 800, averageRating: 0 }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
    );
    expect(results[0].matchReasons).toContain('High trust score');
  });

  it('does NOT add "High trust score" reason when trustScore < 700', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA'], trustScore: 600, averageRating: 0 }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
    );
    expect(results[0].matchReasons).not.toContain('High trust score');
  });

  it('adds star rating reason when averageRating >= 4', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA'], trustScore: 0, averageRating: 4.5 }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
    );
    const hasRatingReason = results[0].matchReasons.some((r) => r.includes('star rating'));
    expect(hasRatingReason).toBe(true);
  });

  it('does NOT add star rating reason when averageRating < 4', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA'], trustScore: 0, averageRating: 3.9 }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
    );
    const hasRatingReason = results[0].matchReasons.some((r) => r.includes('star rating'));
    expect(hasRatingReason).toBe(false);
  });

  it('results are sorted by score descending', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA'], trustScore: 100, averageRating: 1 }),
      makePrinter({ id: 'p2', materials: ['PLA'], trustScore: 900, averageRating: 5 }),
      makePrinter({ id: 'p3', materials: ['PLA'], trustScore: 500, averageRating: 3 }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
    );
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

// ── Limit parameter ────────────────────────────────────────────────────────────
describe('findMatchingPrinters() — limit parameter', () => {
  it('respects the limit parameter', async () => {
    const printers = Array.from({ length: 20 }, (_, i) =>
      makePrinter({ id: `p${i}`, userId: `u${i}`, email: `p${i}@x.com`, materials: ['PLA'] }),
    );
    const prisma = makePrismaWithPrinters(printers);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
      5,
    );
    expect(results).toHaveLength(5);
  });

  it('defaults to limit 10', async () => {
    const printers = Array.from({ length: 15 }, (_, i) =>
      makePrinter({ id: `p${i}`, userId: `u${i}`, email: `p${i}@x.com`, materials: ['PLA'] }),
    );
    const prisma = makePrismaWithPrinters(printers);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
    );
    expect(results).toHaveLength(10);
  });

  it('returns fewer than limit when not enough matches', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['PLA'] }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
      10,
    );
    expect(results).toHaveLength(1);
  });

  it('returns empty array when no printers match', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({ id: 'p1', materials: ['ABS'] }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
    );
    expect(results).toHaveLength(0);
  });
});

// ── Output shape ───────────────────────────────────────────────────────────────
describe('findMatchingPrinters() — output shape', () => {
  it('returns correct fields for each matched printer', async () => {
    const prisma = makePrismaWithPrinters([
      makePrinter({
        id: 'p1',
        userId: 'u-printer',
        fullName: 'Alice Maker',
        email: 'alice@print.com',
        materials: ['PLA'],
        trustScore: 600,
        averageRating: 4.2,
        emailPreferences: { jobAlerts: 'instant' },
      }),
    ]);
    const results = await findMatchingPrinters(
      prisma,
      { id: 'job-1', materialPreferred: ['PLA'], userId: 'owner' },
    );
    expect(results[0].printerId).toBe('p1');
    expect(results[0].userId).toBe('u-printer');
    expect(results[0].fullName).toBe('Alice Maker');
    expect(results[0].email).toBe('alice@print.com');
    expect(results[0].emailPreferences).toEqual({ jobAlerts: 'instant' });
    expect(typeof results[0].score).toBe('number');
    expect(Array.isArray(results[0].matchReasons)).toBe(true);
  });
});
