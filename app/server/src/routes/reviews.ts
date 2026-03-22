import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';
import { reviewReceivedEmail } from '../services/email-templates.js';
import { notifyUser } from '../services/websocket.js';

const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export async function reviewRoutes(app: FastifyInstance) {
  // Create a review for a completed order
  app.post<{ Params: { orderId: string } }>('/orders/:orderId/reviews', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const order = await app.prisma.order.findUnique({
        where: { id: request.params.orderId },
        include: { printer: true, review: true, job: { select: { title: true } } },
      });

      if (!order) {
        return reply.status(404).send({ error: 'Order not found', code: 404 });
      }
      if (order.buyerId !== request.userId) {
        return reply.status(403).send({ error: 'Only the buyer can review', code: 403 });
      }
      if (order.status !== 'confirmed') {
        return reply.status(400).send({ error: 'Order must be confirmed before reviewing', code: 400 });
      }
      if (order.review) {
        return reply.status(409).send({ error: 'Order already reviewed', code: 409 });
      }

      const body = createReviewSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const review = await app.prisma.$transaction(async (tx) => {
        const created = await tx.review.create({
          data: {
            orderId: order.id,
            reviewerId: request.userId!,
            revieweeId: order.printer.userId,
            rating: body.data.rating,
            comment: body.data.comment,
          },
          include: {
            reviewer: { select: { id: true, fullName: true } },
          },
        });

        // Update printer average rating
        const avgResult = await tx.review.aggregate({
          where: {
            revieweeId: order.printer.userId,
          },
          _avg: { rating: true },
        });

        await tx.printer.update({
          where: { id: order.printerId },
          data: { averageRating: avgResult._avg.rating || 0 },
        });

        return created;
      });

      const revieweeUser = await app.prisma.user.findUnique({
        where: { id: order.printer.userId },
        select: { id: true, email: true, emailPreferences: true },
      });
      if (revieweeUser) {
        const tpl = reviewReceivedEmail(order.job.title, body.data.rating);
        sendEmail({ to: revieweeUser.email, subject: tpl.subject, html: tpl.html, category: 'reviews', userId: revieweeUser.id, userPrefs: revieweeUser.emailPreferences as any }).catch(() => {});
        notifyUser(revieweeUser.id, { type: 'review:new', data: { reviewId: review.id, orderId: order.id } });
      }

      return reply.status(201).send(review);
    },
  });

  // Get reviews for a printer
  app.get<{ Params: { printerId: string } }>('/printers/:printerId/reviews', async (request, reply) => {
    const printer = await app.prisma.printer.findUnique({
      where: { id: request.params.printerId },
    });
    if (!printer) {
      return reply.status(404).send({ error: 'Printer not found', code: 404 });
    }

    const reviews = await app.prisma.review.findMany({
      where: { revieweeId: printer.userId },
      include: {
        reviewer: { select: { id: true, fullName: true } },
        order: {
          select: {
            job: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { data: reviews };
  });
}
