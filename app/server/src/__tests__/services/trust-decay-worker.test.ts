import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock BullMQ ───────────────────────────────────────────────────────────────
// Named function constructors so `new Queue()` / `new Worker()` works correctly.
// Do NOT reference outer `const` vars in the mock factory (hoisting issue).

let capturedProcessor: Function | null = null;
const mockWorkerOn = vi.fn();

function MockWorker(this: any, _name: string, processor: Function, _opts: object) {
  capturedProcessor = processor;
  this.on = mockWorkerOn;
}

function MockQueue(this: any) {
  this.add = vi.fn().mockResolvedValue({});
}

vi.mock('bullmq', () => ({ Queue: MockQueue, Worker: MockWorker }));

// ── Import module under test (AFTER vi.mock calls) ────────────────────────────
import { trustDecayQueue, startTrustDecayWorker } from '../../services/trust-decay-worker.js';

describe('trustDecayQueue', () => {
  it('is defined and has an add method', () => {
    expect(trustDecayQueue).toBeDefined();
    expect(typeof (trustDecayQueue as any).add).toBe('function');
  });
});

describe('startTrustDecayWorker()', () => {
  let prisma: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    prisma = {
      printer: {
        findMany: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    };
  });

  it('returns a worker instance', () => {
    startTrustDecayWorker(prisma);
    expect(capturedProcessor).not.toBeNull();
  });

  it('schedules a daily repeatable job on the queue', () => {
    startTrustDecayWorker(prisma);
    const queueAddMock = (trustDecayQueue as any).add;
    expect(queueAddMock).toHaveBeenCalledWith(
      'decay',
      {},
      expect.objectContaining({ repeat: { pattern: '0 0 * * *' } }),
    );
  });

  it('creates a Worker with a processor function', () => {
    startTrustDecayWorker(prisma);
    expect(typeof capturedProcessor).toBe('function');
  });

  // ── Processor function tests ────────────────────────────────────────────────
  describe('processor function', () => {
    async function runProcessor(printers: any[]) {
      capturedProcessor = null;
      prisma.printer.findMany.mockResolvedValue(printers);
      startTrustDecayWorker(prisma);
      expect(capturedProcessor).not.toBeNull();
      await capturedProcessor!();
    }

    it('does nothing when there are no inactive printers', async () => {
      await runProcessor([]);
      expect(prisma.printer.update).not.toHaveBeenCalled();
    });

    it('reduces trustScore by 5 for each inactive printer', async () => {
      await runProcessor([
        { id: 'p1', trustScore: 300 },
        { id: 'p2', trustScore: 500 },
      ]);
      expect(prisma.printer.update).toHaveBeenCalledTimes(2);
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { trustScore: 295 } });
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { trustScore: 495 } });
    });

    it('floors trustScore at 100 — never goes below', async () => {
      await runProcessor([{ id: 'p1', trustScore: 102 }]);
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { trustScore: 100 } });
    });

    it('score 103 decays to floor 100', async () => {
      await runProcessor([{ id: 'p1', trustScore: 103 }]);
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { trustScore: 100 } });
    });

    it('score 101 decays to floor 100', async () => {
      await runProcessor([{ id: 'p1', trustScore: 101 }]);
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { trustScore: 100 } });
    });

    it('score 105 decays to exactly 100', async () => {
      await runProcessor([{ id: 'p1', trustScore: 105 }]);
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { trustScore: 100 } });
    });

    it('score 110 decays normally to 105', async () => {
      await runProcessor([{ id: 'p1', trustScore: 110 }]);
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { trustScore: 105 } });
    });

    it('queries printers with trustScore > 100 (above floor)', async () => {
      capturedProcessor = null;
      prisma.printer.findMany.mockResolvedValueOnce([]);
      startTrustDecayWorker(prisma);
      await capturedProcessor!();

      expect(prisma.printer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ trustScore: { gt: 100 } }),
        }),
      );
    });

    it('filters printers with no confirmed orders in past 30 days', async () => {
      capturedProcessor = null;
      prisma.printer.findMany.mockResolvedValueOnce([]);
      startTrustDecayWorker(prisma);
      await capturedProcessor!();

      const callArg = prisma.printer.findMany.mock.calls[0][0];
      expect(callArg.where.orders).toEqual({
        none: {
          status: 'confirmed',
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        },
      });

      // Verify cutoff is approximately 30 days ago
      const cutoff: Date = callArg.where.orders.none.createdAt.gte;
      const diff = Math.abs(Date.now() - cutoff.getTime() - 30 * 24 * 60 * 60 * 1000);
      expect(diff).toBeLessThan(5000);
    });

    it('logs the count of processed printers', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await runProcessor([{ id: 'p1', trustScore: 200 }, { id: 'p2', trustScore: 300 }]);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2'));
      consoleSpy.mockRestore();
    });

    it('processes multiple printers independently with correct floors', async () => {
      await runProcessor([
        { id: 'p1', trustScore: 1000 },
        { id: 'p2', trustScore: 500 },
        { id: 'p3', trustScore: 105 },
      ]);
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { trustScore: 995 } });
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { trustScore: 495 } });
      expect(prisma.printer.update).toHaveBeenCalledWith({ where: { id: 'p3' }, data: { trustScore: 100 } });
    });
  });
});
