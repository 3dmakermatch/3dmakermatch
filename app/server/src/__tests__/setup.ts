import { vi } from 'vitest';

// Override DATABASE_URL for tests
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgresql://printbid:printbid@localhost:5432/printbid_test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.NODE_ENV = 'test';

// Mock BullMQ globally to prevent Redis connections in integration tests
vi.mock('bullmq', () => {
  function MockQueue() {
    (this as any).add = vi.fn().mockResolvedValue({ id: 'mock-job-id' });
    (this as any).close = vi.fn().mockResolvedValue(undefined);
    (this as any).obliterate = vi.fn().mockResolvedValue(undefined);
  }
  function MockWorker() {
    (this as any).on = vi.fn().mockReturnThis();
    (this as any).close = vi.fn().mockResolvedValue(undefined);
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

// Mock redis to prevent connection attempts
vi.mock('redis', () => ({
  createClient: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    setEx: vi.fn().mockResolvedValue('OK'),
    getDel: vi.fn().mockResolvedValue(null),
    quit: vi.fn().mockResolvedValue(undefined),
  }),
}));
