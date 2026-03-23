import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock BullMQ ───────────────────────────────────────────────────────────────
// Named function constructors — arrow functions can't be used with `new`.
// Mock factory must NOT reference outer `const` variables (hoisting issue).

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

// ── Mock email services ────────────────────────────────────────────────────────
// Use vi.fn() inline — no outer const references in factory.
vi.mock('../../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/email-templates.js', () => ({
  jobDigestEmail: vi.fn().mockReturnValue({ subject: 'Digest subject', html: '<p>Digest</p>' }),
}));

// ── Import module under test (AFTER vi.mock calls) ────────────────────────────
import { digestQueue, startDigestWorker } from '../../services/digest-worker.js';
import { sendEmail } from '../../services/email.js';
import { jobDigestEmail } from '../../services/email-templates.js';

// Get typed mock references
const mockSendEmail = vi.mocked(sendEmail);
const mockJobDigestEmail = vi.mocked(jobDigestEmail);

// ── Helpers ────────────────────────────────────────────────────────────────────
function makePrinter(overrides: {
  id?: string;
  userId?: string;
  fullName?: string;
  email?: string;
  materials?: string[];
  emailPreferences?: object;
  lastDigestAt?: Date | null;
}) {
  return {
    id: overrides.id ?? 'printer-1',
    lastDigestAt: overrides.lastDigestAt ?? null,
    machines: [{ materials: overrides.materials ?? ['PLA'] }],
    user: {
      id: overrides.userId ?? 'user-1',
      fullName: overrides.fullName ?? 'Test Printer',
      email: overrides.email ?? 'printer@example.com',
      emailPreferences: overrides.emailPreferences ?? { jobAlerts: 'hourly' },
    },
  };
}

function makePrisma(printers: any[], jobs: any[]) {
  return {
    printer: {
      findMany: vi.fn().mockResolvedValue(printers),
      update: vi.fn().mockResolvedValue({}),
    },
    printJob: {
      findMany: vi.fn().mockResolvedValue(jobs),
    },
  } as any;
}

async function runDigestProcessor(prisma: any, frequency: string) {
  capturedProcessor = null;
  startDigestWorker(prisma);
  expect(capturedProcessor).not.toBeNull();
  await capturedProcessor!({ data: { frequency } });
}

// ── digestQueue ───────────────────────────────────────────────────────────────
describe('digestQueue', () => {
  it('is defined and has an add method', () => {
    expect(digestQueue).toBeDefined();
    expect(typeof (digestQueue as any).add).toBe('function');
  });
});

// ── startDigestWorker() ───────────────────────────────────────────────────────
describe('startDigestWorker()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    mockSendEmail.mockResolvedValue(undefined);
    mockJobDigestEmail.mockReturnValue({ subject: 'Digest', html: '<p>D</p>' });
  });

  it('schedules hourly, daily, and weekly repeatable jobs', () => {
    const prisma = makePrisma([], []);
    startDigestWorker(prisma);
    const queueAdd = (digestQueue as any).add;
    expect(queueAdd).toHaveBeenCalledWith('hourly', { frequency: 'hourly' }, expect.objectContaining({ repeat: { pattern: '0 * * * *' } }));
    expect(queueAdd).toHaveBeenCalledWith('daily', { frequency: 'daily' }, expect.objectContaining({ repeat: { pattern: '0 8 * * *' } }));
    expect(queueAdd).toHaveBeenCalledWith('weekly', { frequency: 'weekly' }, expect.objectContaining({ repeat: { pattern: '0 8 * * 1' } }));
  });

  it('creates a Worker and captures a processor function', () => {
    const prisma = makePrisma([], []);
    startDigestWorker(prisma);
    expect(capturedProcessor).not.toBeNull();
    expect(typeof capturedProcessor).toBe('function');
  });
});

// ── Processor: frequency matching ─────────────────────────────────────────────
describe('digest processor — frequency matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    mockSendEmail.mockResolvedValue(undefined);
    mockJobDigestEmail.mockReturnValue({ subject: 'D', html: '<p>D</p>' });
  });

  it('queries printers matching the "hourly" digest frequency', async () => {
    const prisma = makePrisma([], []);
    await runDigestProcessor(prisma, 'hourly');
    expect(prisma.printer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: { emailPreferences: { path: ['jobAlerts'], equals: 'hourly' } } },
      }),
    );
  });

  it('queries printers matching the "daily" digest frequency', async () => {
    const prisma = makePrisma([], []);
    await runDigestProcessor(prisma, 'daily');
    expect(prisma.printer.findMany.mock.calls[0][0].where.user.emailPreferences.equals).toBe('daily');
  });

  it('queries printers matching the "weekly" digest frequency', async () => {
    const prisma = makePrisma([], []);
    await runDigestProcessor(prisma, 'weekly');
    expect(prisma.printer.findMany.mock.calls[0][0].where.user.emailPreferences.equals).toBe('weekly');
  });
});

// ── Processor: material overlap filtering ─────────────────────────────────────
describe('digest processor — material overlap filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    mockSendEmail.mockResolvedValue(undefined);
    mockJobDigestEmail.mockReturnValue({ subject: 'D', html: '<p>D</p>' });
  });

  it('sends digest when job materials overlap with printer materials', async () => {
    const printer = makePrinter({ materials: ['PLA', 'ABS'] });
    const job = { id: 'j1', title: 'Rocket Part', materialPreferred: ['PLA'] };
    await runDigestProcessor(makePrisma([printer], [job]), 'hourly');
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('sends digest when job has no material requirements (any printer qualifies)', async () => {
    const printer = makePrinter({ materials: ['PLA'] });
    const job = { id: 'j1', title: 'Widget', materialPreferred: [] };
    await runDigestProcessor(makePrisma([printer], [job]), 'hourly');
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('does NOT send digest when no job materials match printer capabilities', async () => {
    const printer = makePrinter({ materials: ['PLA'] });
    const job = { id: 'j1', title: 'ABS Job', materialPreferred: ['ABS'] };
    await runDigestProcessor(makePrisma([printer], [job]), 'hourly');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('material matching is case-insensitive', async () => {
    const printer = makePrinter({ materials: ['pla'] }); // lowercase
    const job = { id: 'j1', title: 'Test', materialPreferred: ['PLA'] }; // uppercase
    await runDigestProcessor(makePrisma([printer], [job]), 'hourly');
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('does NOT send digest when there are no new jobs', async () => {
    const printer = makePrinter({ materials: ['PLA'] });
    await runDigestProcessor(makePrisma([printer], []), 'hourly');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('skips printer entirely (no lastDigestAt update) when matchingJobs is empty', async () => {
    const printer = makePrinter({ materials: ['ABS'] });
    const job = { id: 'j1', title: 'PLA only', materialPreferred: ['PLA'] };
    const prisma = makePrisma([printer], [job]);
    await runDigestProcessor(prisma, 'hourly');
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });
});

// ── Processor: lastDigestAt update ────────────────────────────────────────────
describe('digest processor — lastDigestAt update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    mockSendEmail.mockResolvedValue(undefined);
    mockJobDigestEmail.mockReturnValue({ subject: 'D', html: '<p>D</p>' });
  });

  it('updates lastDigestAt after successfully sending digest', async () => {
    const printer = makePrinter({ materials: ['PLA'] });
    const job = { id: 'j1', title: 'Widget', materialPreferred: ['PLA'] };
    const prisma = makePrisma([printer], [job]);
    await runDigestProcessor(prisma, 'hourly');
    expect(prisma.printer.update).toHaveBeenCalledWith({
      where: { id: 'printer-1' },
      data: { lastDigestAt: expect.any(Date) },
    });
  });

  it('uses printer.lastDigestAt as the "since" cutoff for the job query', async () => {
    const lastDigestAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const printer = makePrinter({ lastDigestAt, materials: ['PLA'] });
    const prisma = makePrisma([printer], []);
    await runDigestProcessor(prisma, 'hourly');
    const query = prisma.printJob.findMany.mock.calls[0][0];
    expect(query.where.createdAt.gte).toBe(lastDigestAt);
  });

  it('defaults "since" to 24h ago when lastDigestAt is null', async () => {
    const printer = makePrinter({ lastDigestAt: null, materials: ['PLA'] });
    const prisma = makePrisma([printer], []);
    await runDigestProcessor(prisma, 'hourly');
    const query = prisma.printJob.findMany.mock.calls[0][0];
    const since: Date = query.where.createdAt.gte;
    const diff = Math.abs(Date.now() - since.getTime() - 24 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(5000);
  });

  it('does NOT update lastDigestAt when no matching jobs were found', async () => {
    const printer = makePrinter({ materials: ['ABS'] });
    const job = { id: 'j1', title: 'PLA job', materialPreferred: ['PLA'] };
    const prisma = makePrisma([printer], [job]);
    await runDigestProcessor(prisma, 'hourly');
    expect(prisma.printer.update).not.toHaveBeenCalled();
  });

  it('queries only bidding jobs that have not yet expired', async () => {
    const printer = makePrinter({ materials: ['PLA'] });
    const prisma = makePrisma([printer], []);
    await runDigestProcessor(prisma, 'hourly');
    const query = prisma.printJob.findMany.mock.calls[0][0];
    expect(query.where.status).toBe('bidding');
    expect(query.where.expiresAt.gt).toBeInstanceOf(Date);
  });
});

// ── Processor: email composition ──────────────────────────────────────────────
describe('digest processor — email composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    mockSendEmail.mockResolvedValue(undefined);
    mockJobDigestEmail.mockReturnValue({ subject: '2 new print jobs', html: '<ul></ul>' });
  });

  it('calls jobDigestEmail with printer name and all matching jobs', async () => {
    const printer = makePrinter({ fullName: 'Alice Maker', materials: ['PLA'] });
    const jobs = [
      { id: 'j1', title: 'Widget A', materialPreferred: ['PLA'] },
      { id: 'j2', title: 'Widget B', materialPreferred: [] },
    ];
    await runDigestProcessor(makePrisma([printer], jobs), 'hourly');
    expect(mockJobDigestEmail).toHaveBeenCalledWith(
      'Alice Maker',
      expect.arrayContaining([
        expect.objectContaining({ title: 'Widget A', id: 'j1' }),
        expect.objectContaining({ title: 'Widget B', id: 'j2' }),
      ]),
    );
  });

  it('calls sendEmail with correct recipient, subject, and category', async () => {
    const printer = makePrinter({ email: 'alice@example.com', materials: ['PLA'] });
    const job = { id: 'j1', title: 'Widget', materialPreferred: ['PLA'] };
    await runDigestProcessor(makePrisma([printer], [job]), 'hourly');
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        category: 'jobAlerts',
        subject: expect.any(String),
        html: expect.any(String),
      }),
    );
  });

  it('logs count of processed printers', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const printers = [
      makePrinter({ id: 'p1', userId: 'u1', email: 'p1@x.com', materials: ['PLA'] }),
      makePrinter({ id: 'p2', userId: 'u2', email: 'p2@x.com', materials: ['PLA'] }),
    ];
    const job = { id: 'j1', title: 'W', materialPreferred: ['PLA'] };
    await runDigestProcessor(makePrisma(printers, [job]), 'hourly');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2'));
    consoleSpy.mockRestore();
  });
});
