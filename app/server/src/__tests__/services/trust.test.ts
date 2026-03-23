import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recalculateTrustScore } from '../../services/trust.js';

// ── Prisma mock factory ────────────────────────────────────────────────────────
function makePrisma(overrides: {
  printer?: object | null;
  reviewAgg?: { _avg: { rating: number | null }; _count: { rating: number } };
  orderCounts?: Array<{ status: string; _count: number }>;
  bids?: Array<{ createdAt: Date; job: { createdAt: Date } }>;
}) {
  const printer = overrides.printer !== undefined ? overrides.printer : {
    id: 'printer-1',
    userId: 'user-1',
    isVerified: false,
    trustScore: 500,
    createdAt: new Date(),
    user: { id: 'user-1' },
  };

  const reviewAgg = overrides.reviewAgg ?? {
    _avg: { rating: null },
    _count: { rating: 0 },
  };

  const orderCounts = overrides.orderCounts ?? [];
  const bids = overrides.bids ?? [];

  return {
    printer: {
      findUnique: vi.fn().mockResolvedValue(printer),
      update: vi.fn().mockResolvedValue(printer),
    },
    review: {
      aggregate: vi.fn().mockResolvedValue(reviewAgg),
    },
    order: {
      groupBy: vi.fn().mockResolvedValue(orderCounts),
    },
    bid: {
      findMany: vi.fn().mockResolvedValue(bids),
    },
  };
}

describe('recalculateTrustScore()', () => {
  it('returns 0 when printer does not exist', async () => {
    const prisma = makePrisma({ printer: null }) as any;
    const score = await recalculateTrustScore(prisma, 'nonexistent');
    expect(score).toBe(0);
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('uses baseline ratingScore (200) when fewer than 5 reviews', async () => {
    const createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 3); // 3 months old
    const prisma = makePrisma({
      printer: {
        id: 'p1', userId: 'u1', isVerified: false, trustScore: 500,
        createdAt, user: { id: 'u1' },
      },
      reviewAgg: { _avg: { rating: null }, _count: { rating: 3 } },
      orderCounts: [],
      bids: [],
    }) as any;
    const score = await recalculateTrustScore(prisma, 'p1');
    // ratingScore=200, completionScore=125, responseScore=75, ageScore=~50, verifyScore=0
    // total ≈ 450, clamped to [0,1000]
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1000);
    // Specifically check ratingScore component was 200 (no reviews)
    // ageScore = min(100, (3/6)*100) = 50
    // total = 200 + 125 + 75 + 50 + 0 = 450
    expect(score).toBe(450);
  });

  it('uses actual rating when 5+ reviews', async () => {
    const createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 12); // 12 months old
    const prisma = makePrisma({
      printer: {
        id: 'p1', userId: 'u1', isVerified: false, trustScore: 500,
        createdAt, user: { id: 'u1' },
      },
      reviewAgg: { _avg: { rating: 5 }, _count: { rating: 10 } },
      orderCounts: [],
      bids: [],
    }) as any;
    const score = await recalculateTrustScore(prisma, 'p1');
    // ratingScore = (5/5)*400 = 400
    // completionScore = 125 (< 3 orders)
    // responseScore = 75
    // ageScore = min(100, (12/6)*100) = 100
    // verifyScore = 0
    // total = 400 + 125 + 75 + 100 + 0 = 700
    expect(score).toBe(700);
  });

  it('uses completion rate when 3+ orders', async () => {
    const createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 12);
    const prisma = makePrisma({
      printer: {
        id: 'p1', userId: 'u1', isVerified: false, trustScore: 500,
        createdAt, user: { id: 'u1' },
      },
      reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
      orderCounts: [
        { status: 'confirmed', _count: 8 },
        { status: 'cancelled', _count: 2 },
      ],
      bids: [],
    }) as any;
    const score = await recalculateTrustScore(prisma, 'p1');
    // ratingScore = 200
    // completionScore = (8/10)*250 = 200
    // responseScore = 75
    // ageScore = 100
    // verifyScore = 0
    // total = 200 + 200 + 75 + 100 + 0 = 575
    expect(score).toBe(575);
  });

  it('gives full completion score when 100% completion rate', async () => {
    const createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 12);
    const prisma = makePrisma({
      printer: {
        id: 'p1', userId: 'u1', isVerified: false, trustScore: 500,
        createdAt, user: { id: 'u1' },
      },
      reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
      orderCounts: [{ status: 'confirmed', _count: 5 }],
      bids: [],
    }) as any;
    const score = await recalculateTrustScore(prisma, 'p1');
    // completionScore = (5/5)*250 = 250
    // ratingScore=200, responseScore=75, ageScore=100, verifyScore=0
    // total = 625
    expect(score).toBe(625);
  });

  describe('response time tiers', () => {
    function makeBid(bidHoursAfterJob: number) {
      const jobCreatedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7);
      const bidCreatedAt = new Date(jobCreatedAt.getTime() + bidHoursAfterJob * 60 * 60 * 1000);
      return { createdAt: bidCreatedAt, job: { createdAt: jobCreatedAt } };
    }

    it('responseScore=150 when avg response < 1h', async () => {
      const createdAt = new Date(0); // ancient account — ageScore=100
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: false, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
        orderCounts: [],
        bids: [makeBid(0.5)], // 30 min
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      // responseScore=150, ratingScore=200, completionScore=125, ageScore=100, verifyScore=0 → 575
      expect(score).toBe(575);
    });

    it('responseScore=120 when 1h ≤ avg response < 4h', async () => {
      const createdAt = new Date(0);
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: false, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
        orderCounts: [],
        bids: [makeBid(2)], // 2 hours
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      // responseScore=120, ratingScore=200, completionScore=125, ageScore=100, verifyScore=0 → 545
      expect(score).toBe(545);
    });

    it('responseScore=80 when 4h ≤ avg response < 24h', async () => {
      const createdAt = new Date(0);
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: false, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
        orderCounts: [],
        bids: [makeBid(12)], // 12 hours
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      // responseScore=80, ratingScore=200, completionScore=125, ageScore=100, verifyScore=0 → 505
      expect(score).toBe(505);
    });

    it('responseScore=40 when avg response ≥ 24h', async () => {
      const createdAt = new Date(0);
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: false, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
        orderCounts: [],
        bids: [makeBid(48)], // 2 days
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      // responseScore=40, ratingScore=200, completionScore=125, ageScore=100, verifyScore=0 → 465
      expect(score).toBe(465);
    });
  });

  describe('account age scoring', () => {
    it('ageScore is 0 for brand new account', async () => {
      const createdAt = new Date(); // just now
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: false, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
        orderCounts: [],
        bids: [],
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      // ageScore≈0, ratingScore=200, completionScore=125, responseScore=75 → ≈400
      expect(score).toBeCloseTo(400, -1); // within ~10
    });

    it('ageScore is capped at 100 for accounts older than 6 months', async () => {
      const createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365); // 1 year old
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: false, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
        orderCounts: [],
        bids: [],
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      // ageScore=100, ratingScore=200, completionScore=125, responseScore=75 → 500
      expect(score).toBe(500);
    });
  });

  describe('verification bonus', () => {
    it('adds 100 points when printer is verified', async () => {
      const createdAt = new Date(0);
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: true, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
        orderCounts: [],
        bids: [],
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      // verifyScore=100, ratingScore=200, completionScore=125, responseScore=75, ageScore=100 → 600
      expect(score).toBe(600);
    });

    it('adds 0 points when printer is not verified', async () => {
      const createdAt = new Date(0);
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: false, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
        orderCounts: [],
        bids: [],
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      // verifyScore=0, ageScore=100, ratingScore=200, completionScore=125, responseScore=75 → 500
      expect(score).toBe(500);
    });
  });

  describe('clamping', () => {
    it('clamps maximum score to 1000', async () => {
      const createdAt = new Date(0); // ancient, ageScore=100
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: true, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: 5 }, _count: { rating: 100 } },
        orderCounts: [{ status: 'confirmed', _count: 100 }],
        bids: [{ createdAt: new Date(Date.now() - 1000), job: { createdAt: new Date(Date.now() - 2000) } }],
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      expect(score).toBeLessThanOrEqual(1000);
    });

    it('score is never negative', async () => {
      const createdAt = new Date();
      const prisma = makePrisma({
        printer: { id: 'p1', userId: 'u1', isVerified: false, trustScore: 0, createdAt, user: { id: 'u1' } },
        reviewAgg: { _avg: { rating: 0 }, _count: { rating: 10 } },
        orderCounts: [{ status: 'cancelled', _count: 10 }],
        bids: [],
      }) as any;
      const score = await recalculateTrustScore(prisma, 'p1');
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  it('saves the clamped score via prisma.printer.update', async () => {
    const createdAt = new Date(0);
    const prisma = makePrisma({
      printer: { id: 'p1', userId: 'u1', isVerified: false, trustScore: 0, createdAt, user: { id: 'u1' } },
      reviewAgg: { _avg: { rating: null }, _count: { rating: 0 } },
      orderCounts: [],
      bids: [],
    }) as any;
    const score = await recalculateTrustScore(prisma, 'p1');
    expect(prisma.printer.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { trustScore: score },
    });
  });
});
