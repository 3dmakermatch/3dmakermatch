import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';

const sendMessageSchema = z.object({
  jobId: z.string().uuid(),
  receiverId: z.string().uuid(),
  content: z.string().min(1).max(5000),
});

export async function messageRoutes(app: FastifyInstance) {
  // Send a message
  app.post('/', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const body = sendMessageSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const { jobId, receiverId, content } = body.data;

      const job = await app.prisma.printJob.findUnique({ where: { id: jobId } });
      if (!job) {
        return reply.status(404).send({ error: 'Job not found', code: 404 });
      }

      const message = await app.prisma.message.create({
        data: {
          jobId,
          senderId: request.userId!,
          receiverId,
          content,
        },
        include: {
          sender: { select: { id: true, fullName: true } },
        },
      });

      return reply.status(201).send(message);
    },
  });

  // Get message threads (list of jobs with messages)
  app.get('/threads', {
    preHandler: [authenticate],
    handler: async (request) => {
      const messages = await app.prisma.message.findMany({
        where: {
          OR: [
            { senderId: request.userId! },
            { receiverId: request.userId! },
          ],
        },
        include: {
          job: { select: { id: true, title: true } },
          sender: { select: { id: true, fullName: true } },
          receiver: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['jobId'],
        take: 50,
      });

      return { data: messages };
    },
  });

  // Get messages for a specific job thread
  app.get<{ Params: { jobId: string } }>('/threads/:jobId', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const messages = await app.prisma.message.findMany({
        where: {
          jobId: request.params.jobId,
          OR: [
            { senderId: request.userId! },
            { receiverId: request.userId! },
          ],
        },
        include: {
          sender: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Mark unread messages as read
      await app.prisma.message.updateMany({
        where: {
          jobId: request.params.jobId,
          receiverId: request.userId!,
          isRead: false,
        },
        data: { isRead: true },
      });

      return { data: messages };
    },
  });
}
