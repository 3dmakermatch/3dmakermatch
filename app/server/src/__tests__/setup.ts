import { vi } from 'vitest';

// Override DATABASE_URL for tests
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgresql://printbid:printbid@localhost:5432/printbid_test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.NODE_ENV = 'test';

// Mock BullMQ globally to prevent Redis connections in integration tests
vi.mock('bullmq', () => {
  const mockAdd = vi.fn().mockResolvedValue({ id: 'mock-job-id' });
  return {
    Queue: vi.fn().mockImplementation(() => ({
      add: mockAdd,
      close: vi.fn().mockResolvedValue(undefined),
      obliterate: vi.fn().mockResolvedValue(undefined),
    })),
    Worker: vi.fn().mockImplementation(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});
