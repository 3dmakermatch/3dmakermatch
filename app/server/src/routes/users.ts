import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';

const updateUserSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
});

export async function userRoutes(app: FastifyInstance) {
  // Get current user profile
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
          updatedAt: true,
          printer: true,
        },
      });
      if (!user) {
        return reply.status(404).send({ error: 'User not found', code: 404 });
      }
      return user;
    },
  });

  // Update current user
  app.patch('/me', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const body = updateUserSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const user = await app.prisma.user.update({
        where: { id: request.userId! },
        data: body.data,
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return user;
    },
  });

  // Get public user profile
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = await app.prisma.user.findUnique({
      where: { id: request.params.id },
      select: {
        id: true,
        fullName: true,
        role: true,
        createdAt: true,
        printer: {
          select: {
            id: true,
            bio: true,
            addressCity: true,
            addressState: true,
            isVerified: true,
            capabilities: true,
            averageRating: true,
            trustScore: true,
          },
        },
      },
    });
    if (!user) {
      return reply.status(404).send({ error: 'User not found', code: 404 });
    }
    return user;
  });
}
