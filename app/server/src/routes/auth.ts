import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticate,
} from '../middleware/auth.js';

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(100),
  role: z.enum(['buyer', 'printer']),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  // Register
  app.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    handler: async (request, reply) => {
      const body = registerSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const { email, password, fullName, role } = body.data;

      const existing = await app.prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.status(409).send({ error: 'Email already registered', code: 409 });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await app.prisma.user.create({
        data: { email, passwordHash, fullName, role },
        select: { id: true, email: true, fullName: true, role: true, createdAt: true },
      });

      const accessToken = generateAccessToken({ userId: user.id, role: user.role });
      const refreshToken = generateRefreshToken({ userId: user.id, role: user.role });

      await app.prisma.user.update({
        where: { id: user.id },
        data: { refreshToken },
      });

      reply.setCookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.status(201).send({ user, accessToken });
    },
  });

  // Login
  app.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const body = loginSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const { email, password } = body.data;
      const user = await app.prisma.user.findUnique({ where: { email } });
      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials', code: 401 });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid credentials', code: 401 });
      }

      const accessToken = generateAccessToken({ userId: user.id, role: user.role });
      const refreshToken = generateRefreshToken({ userId: user.id, role: user.role });

      await app.prisma.user.update({
        where: { id: user.id },
        data: { refreshToken },
      });

      reply.setCookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: 7 * 24 * 60 * 60,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
        accessToken,
      };
    },
  });

  // Refresh token
  app.post('/refresh', async (request, reply) => {
    const token = request.cookies.refreshToken;
    if (!token) {
      return reply.status(401).send({ error: 'No refresh token', code: 401 });
    }

    try {
      const payload = verifyRefreshToken(token);
      const user = await app.prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user || user.refreshToken !== token) {
        return reply.status(401).send({ error: 'Invalid refresh token', code: 401 });
      }

      const accessToken = generateAccessToken({ userId: user.id, role: user.role });
      const newRefreshToken = generateRefreshToken({ userId: user.id, role: user.role });

      await app.prisma.user.update({
        where: { id: user.id },
        data: { refreshToken: newRefreshToken },
      });

      reply.setCookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: 7 * 24 * 60 * 60,
      });

      return { accessToken };
    } catch {
      return reply.status(401).send({ error: 'Invalid refresh token', code: 401 });
    }
  });

  // Logout
  app.post('/logout', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      await app.prisma.user.update({
        where: { id: request.userId! },
        data: { refreshToken: null },
      });

      reply.clearCookie('refreshToken', { path: '/api/v1/auth' });
      return { message: 'Logged out' };
    },
  });

  // Get current user (useful for checking auth state)
  app.get('/me', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const user = await app.prisma.user.findUnique({
        where: { id: request.userId! },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          createdAt: true,
          printer: {
            select: {
              id: true,
              isVerified: true,
              averageRating: true,
            },
          },
        },
      });
      if (!user) {
        return reply.status(404).send({ error: 'User not found', code: 404 });
      }
      return user;
    },
  });
}
