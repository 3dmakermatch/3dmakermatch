import { beforeAll, afterAll } from 'vitest';

// Override DATABASE_URL for tests
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgresql://printbid:printbid@localhost:5432/printbid_test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.NODE_ENV = 'test';
