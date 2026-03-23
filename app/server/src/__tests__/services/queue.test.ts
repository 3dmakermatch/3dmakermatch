import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock BullMQ ───────────────────────────────────────────────────────────────
// Use named function constructors so `new Queue(...)` / `new Worker(...)` works.
// Variables referenced inside vi.mock factories must be declared with `var` (hoisted)
// or the factory must not reference outer `const` variables.

let _lastProcessor: Function | null = null;
const mockWorkerOn = vi.fn();

function MockWorker(this: any, _name: string, processor: Function, _opts: object) {
  _lastProcessor = processor;
  this.on = mockWorkerOn;
}

function MockQueue(this: any) {
  this.add = vi.fn().mockResolvedValue({});
}

vi.mock('bullmq', () => ({ Queue: MockQueue, Worker: MockWorker }));

// ── Mock fs/promises ──────────────────────────────────────────────────────────
// Do NOT reference outer const variables in the factory — use vi.fn() inline.
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock dependent services ───────────────────────────────────────────────────
vi.mock('../../services/matching.js', () => ({
  findMatchingPrinters: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/email-templates.js', () => ({
  jobAlertEmail: vi.fn().mockReturnValue({ subject: 'Test', html: '<p>test</p>' }),
}));

vi.mock('../../services/websocket.js', () => ({
  notifyUser: vi.fn(),
}));

vi.mock('adm-zip', () => ({
  default: vi.fn().mockImplementation(() => ({
    getEntry: vi.fn().mockReturnValue(null),
    getEntries: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@scalenc/stl-to-png', () => ({
  stl2png: vi.fn().mockReturnValue(Buffer.alloc(100)),
}));

// ── Import modules under test (AFTER all vi.mock() calls) ─────────────────────
import { fileProcessingQueue, startFileProcessingWorker } from '../../services/queue.js';
import { readFile } from 'fs/promises';

// Get typed mock references
const mockReadFile = vi.mocked(readFile);

// ── Helper: build a minimal valid binary STL buffer ───────────────────────────
function makeBinaryStl(triangles: Array<{
  normal: [number, number, number];
  v1: [number, number, number];
  v2: [number, number, number];
  v3: [number, number, number];
}>): Buffer {
  const buf = Buffer.alloc(84 + triangles.length * 50);
  buf.fill(0, 0, 80); // header
  buf.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const tri of triangles) {
    const all = [...tri.normal, ...tri.v1, ...tri.v2, ...tri.v3];
    for (const val of all) {
      buf.writeFloatLE(val, offset);
      offset += 4;
    }
    buf.writeUInt16LE(0, offset);
    offset += 2;
  }
  return buf;
}

function makePrisma(overrides: {
  fileMetadatas?: Array<{ fileMetadata: object | null }>;
  printJobUpdate?: object;
}) {
  return {
    jobFile: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue(
        overrides.fileMetadatas ?? [{ fileMetadata: {} }],
      ),
    },
    printJob: {
      update: vi.fn().mockResolvedValue(
        overrides.printJobUpdate ?? {
          id: 'job-1', title: 'Test Job', materialPreferred: ['PLA'], userId: 'user-1',
        },
      ),
    },
  } as any;
}

// ── fileProcessingQueue ───────────────────────────────────────────────────────
describe('fileProcessingQueue', () => {
  it('is defined and has an add method', () => {
    expect(fileProcessingQueue).toBeDefined();
    expect(typeof (fileProcessingQueue as any).add).toBe('function');
  });
});

// ── startFileProcessingWorker() ───────────────────────────────────────────────
describe('startFileProcessingWorker()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _lastProcessor = null;
  });

  it('returns a worker instance', () => {
    const prisma = makePrisma({});
    const worker = startFileProcessingWorker(prisma);
    expect(worker).toBeDefined();
    expect(typeof (worker as any).on).toBe('function');
  });

  it('registers completed and failed event handlers', () => {
    const prisma = makePrisma({});
    startFileProcessingWorker(prisma);
    expect(mockWorkerOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockWorkerOn).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('processor updates job to draft status on failure', async () => {
    const prisma = makePrisma({});
    mockReadFile.mockRejectedValueOnce(new Error('File not found'));

    startFileProcessingWorker(prisma);
    expect(_lastProcessor).not.toBeNull();

    await expect(_lastProcessor!({
      data: { jobId: 'job-1', fileId: 'file-1', fileKey: 'users/u/original.stl', fileName: 'model.stl' },
      log: vi.fn(),
    })).rejects.toThrow();

    expect(prisma.printJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'draft' } }),
    );
  });

  it('processor updates jobFile with metadata on success', async () => {
    const stlBuf = makeBinaryStl([
      { normal: [0, 0, 1], v1: [0, 0, 0], v2: [10, 0, 0], v3: [0, 10, 0] },
    ]);
    mockReadFile.mockResolvedValueOnce(stlBuf);
    const prisma = makePrisma({ fileMetadatas: [{ fileMetadata: {} }] });

    startFileProcessingWorker(prisma);
    await _lastProcessor!({
      data: { jobId: 'job-1', fileId: 'file-1', fileKey: 'key/original.stl', fileName: 'model.stl' },
      log: vi.fn(),
    });

    expect(prisma.jobFile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'file-1' },
        data: expect.objectContaining({ fileMetadata: expect.any(Object) }),
      }),
    );
  });

  it('moves print job to bidding when all files have metadata', async () => {
    const stlBuf = makeBinaryStl([
      { normal: [0, 0, 1], v1: [0, 0, 0], v2: [10, 0, 0], v3: [0, 10, 0] },
    ]);
    mockReadFile.mockResolvedValueOnce(stlBuf);
    const prisma = makePrisma({
      fileMetadatas: [{ fileMetadata: { polygonCount: 1 } }, { fileMetadata: { polygonCount: 2 } }],
    });

    startFileProcessingWorker(prisma);
    await _lastProcessor!({
      data: { jobId: 'job-1', fileId: 'file-1', fileKey: 'key/original.stl', fileName: 'model.stl' },
      log: vi.fn(),
    });

    expect(prisma.printJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'bidding' } }),
    );
  });

  it('does NOT move to bidding when some files are still unprocessed (null metadata)', async () => {
    const stlBuf = makeBinaryStl([
      { normal: [0, 0, 1], v1: [0, 0, 0], v2: [10, 0, 0], v3: [0, 10, 0] },
    ]);
    mockReadFile.mockResolvedValueOnce(stlBuf);
    const prisma = makePrisma({
      fileMetadatas: [{ fileMetadata: { polygonCount: 1 } }, { fileMetadata: null }],
    });

    startFileProcessingWorker(prisma);
    await _lastProcessor!({
      data: { jobId: 'job-1', fileId: 'file-1', fileKey: 'key/original.stl', fileName: 'model.stl' },
      log: vi.fn(),
    });

    const biddingCalls = prisma.printJob.update.mock.calls.filter(
      (args: any[]) => args[0]?.data?.status === 'bidding',
    );
    expect(biddingCalls).toHaveLength(0);
  });
});

// ── Binary STL parser (tested via processor) ──────────────────────────────────
describe('binary STL parsing via worker processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _lastProcessor = null;
  });

  async function processStlBuffer(buf: Buffer) {
    mockReadFile.mockResolvedValueOnce(buf);
    const prisma = makePrisma({ fileMetadatas: [{ fileMetadata: {} }] });
    startFileProcessingWorker(prisma);
    await _lastProcessor!({
      data: { jobId: 'j1', fileId: 'f1', fileKey: 'k/original.stl', fileName: 'model.stl' },
      log: vi.fn(),
    });
    return prisma.jobFile.update.mock.calls[0]?.[0]?.data?.fileMetadata;
  }

  it('correctly parses triangle count from binary STL', async () => {
    const buf = makeBinaryStl([
      { normal: [0, 0, 1], v1: [0, 0, 0], v2: [1, 0, 0], v3: [0, 1, 0] },
      { normal: [0, 0, 1], v1: [1, 0, 0], v2: [1, 1, 0], v3: [0, 1, 0] },
    ]);
    const meta = await processStlBuffer(buf);
    expect(meta.polygonCount).toBe(2);
  });

  it('reports isManifold=true for well-formed STL', async () => {
    const buf = makeBinaryStl([
      { normal: [0, 0, 1], v1: [0, 0, 0], v2: [10, 0, 0], v3: [0, 10, 0] },
    ]);
    const meta = await processStlBuffer(buf);
    expect(meta.isManifold).toBe(true);
  });

  it('computes bounding box dimensions correctly', async () => {
    const buf = makeBinaryStl([
      { normal: [0, 0, 1], v1: [0, 0, 0], v2: [10, 5, 0], v3: [0, 0, 3] },
    ]);
    const meta = await processStlBuffer(buf);
    expect(meta.dimensions.x).toBeCloseTo(10);
    expect(meta.dimensions.y).toBeCloseTo(5);
    expect(meta.dimensions.z).toBeCloseTo(3);
  });

  it('computes volumeCm3 as bounding box volume in cm³ (mm inputs)', async () => {
    // 100mm × 50mm × 20mm → 10cm × 5cm × 2cm = 100 cm³
    const buf = makeBinaryStl([
      { normal: [0, 0, 1], v1: [0, 0, 0], v2: [100, 50, 0], v3: [0, 0, 20] },
    ]);
    const meta = await processStlBuffer(buf);
    expect(meta.volumeCm3).toBeCloseTo(100);
  });
});

// ── printabilityScore ─────────────────────────────────────────────────────────
describe('printabilityScore calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _lastProcessor = null;
  });

  it('score = 100 for a well-formed printable STL (manifold + reasonable dims + polygons + size)', async () => {
    // Triangle spanning 10mm × 10mm × 10mm — all four score criteria met
    const buf = makeBinaryStl([
      { normal: [0, 0, 1], v1: [0, 0, 0], v2: [10, 0, 0], v3: [0, 10, 10] },
    ]);
    mockReadFile.mockResolvedValueOnce(buf);
    const prisma = makePrisma({ fileMetadatas: [{ fileMetadata: {} }] });
    startFileProcessingWorker(prisma);

    await _lastProcessor!({
      data: { jobId: 'j', fileId: 'f', fileKey: 'k/original.stl', fileName: 'model.stl' },
      log: vi.fn(),
    });

    const meta = prisma.jobFile.update.mock.calls[0]?.[0]?.data?.fileMetadata;
    // isManifold(40) + reasonableDims(20) + polygons>0(20) + fileSize>0(20) = 100
    expect(meta.printabilityScore).toBe(100);
  });
});
