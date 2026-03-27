import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';
import { newMessageEmail } from '../services/email-templates.js';
import { notifyUser } from '../services/websocket.js';

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

      const job = await app.prisma.printJob.findUnique({
        where: { id: jobId },
        include: { bids: { select: { printer: { select: { userId: true } } } } },
      });
      if (!job) {
        return reply.status(404).send({ error: 'Job not found', code: 404 });
      }

      // Only the job owner and printers who have bid can message
      const isJobOwner = job.userId === request.userId;
      const isBidder = job.bids.some((b) => b.printer.userId === request.userId);
      if (!isJobOwner && !isBidder) {
        return reply.status(403).send({ error: 'Only the job owner and bidding printers can message', code: 403 });
      }

      // Verify receiver is also a participant
      const receiverIsOwner = job.userId === receiverId;
      const receiverIsBidder = job.bids.some((b) => b.printer.userId === receiverId);
      if (!receiverIsOwner && !receiverIsBidder) {
        return reply.status(400).send({ error: 'Receiver is not a participant in this job', code: 400 });
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

      const receiver = await app.prisma.user.findUnique({
        where: { id: receiverId },
        select: { id: true, email: true, emailPreferences: true },
      });
      if (receiver) {
        const tpl = newMessageEmail(job.title, message.sender.fullName);
        sendEmail({ to: receiver.email, subject: tpl.subject, html: tpl.html, category: 'messages', userId: receiver.id, userPrefs: receiver.emailPreferences as any }).catch(() => {});
        notifyUser(receiverId, { type: 'message:new', data: { messageId: message.id, jobId } });
      }

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
