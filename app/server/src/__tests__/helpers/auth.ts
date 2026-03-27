import bcrypt from 'bcrypt';
import { prisma } from './prisma.js';
import { generateAccessToken } from '../../middleware/auth.js';

export async function createTestUser(overrides: {
  email?: string;
  fullName?: string;
  role?: 'buyer' | 'printer' | 'admin';
  password?: string;
} = {}) {
  const password = overrides.password || 'TestPassword123!';
  const passwordHash = await bcrypt.hash(password, 4); // Low rounds for speed

  const user = await prisma.user.create({
    data: {
      email: overrides.email || `test-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      fullName: overrides.fullName || 'Test User',
      passwordHash,
      role: overrides.role || 'buyer',
    },
  });

  const accessToken = generateAccessToken({ userId: user.id, role: user.role });

  return {
    user,
    password,
    accessToken,
    authHeaders: { Authorization: `Bearer ${accessToken}` },
  };
}

export async function createTestPrinter(userOverrides: Parameters<typeof createTestUser>[0] = {}) {
  const { user, ...rest } = await createTestUser({ role: 'printer', ...userOverrides });

  const printer = await prisma.printer.create({
    data: {
      userId: user.id,
      bio: 'Test printer bio',
      addressCity: 'Boston',
      addressState: 'MA',
    },
  });

  return { user, printer, ...rest };
}
