import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { createRefund } from '../services/stripe.js';
import { sendEmail } from '../services/email.js';
import { orderStatusEmail } from '../services/email-templates.js';
import { notifyUser } from '../services/websocket.js';

const updateOrderSchema = z.object({
  status: z.enum(['printing', 'shipped', 'delivered']),
  trackingNumber: z.string().max(100).optional(),
});

export async function orderRoutes(app: FastifyInstance) {
  // List my orders
  app.get('/', {
    preHandler: [authenticate],
    handler: async (request) => {
      const orders = await app.prisma.order.findMany({
        where: {
          OR: [
            { buyerId: request.userId! },
            { printer: { userId: request.userId! } },
          ],
        },
        include: {
          job: { select: { id: true, title: true, materialPreferred: true } },
          bid: { select: { id: true, amountCents: true, shippingCostCents: true, estimatedDays: true } },
          buyer: { select: { id: true, fullName: true } },
          printer: { include: { user: { select: { id: true, fullName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { data: orders };
    },
  });

  // Get order detail
  app.get<{ Params: { id: string } }>('/:id', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const order = await app.prisma.order.findUnique({
        where: { id: request.params.id },
        include: {
          job: true,
          bid: true,
          buyer: { select: { id: true, fullName: true, email: true } },
          printer: { include: { user: { select: { id: true, fullName: true } } } },
          review: true,
        },
      });

      if (!order) {
        return reply.status(404).send({ error: 'Order not found', code: 404 });
      }

      const isParty = order.buyerId === request.userId ||
        order.printer.userId === request.userId;
      if (!isParty) {
        return reply.status(403).send({ error: 'Not authorized', code: 403 });
      }

      return order;
    },
  });

  // Update order status (printer only)
  app.patch<{ Params: { id: string } }>('/:id/status', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const order = await app.prisma.order.findUnique({
        where: { id: request.params.id },
        include: { printer: true },
      });

      if (!order) {
        return reply.status(404).send({ error: 'Order not found', code: 404 });
      }
      if (order.printer.userId !== request.userId) {
        return reply.status(403).send({ error: 'Only the printer can update order status', code: 403 });
      }

      const body = updateOrderSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      // Validate status transitions
      const validTransitions: Record<string, string[]> = {
        paid: ['printing'],
        printing: ['shipped'],
        shipped: ['delivered'],
      };

      const allowed = validTransitions[order.status];
      if (!allowed || !allowed.includes(body.data.status)) {
        return reply.status(400).send({
          error: `Cannot transition from ${order.status} to ${body.data.status}`,
          code: 400,
        });
      }

      // Atomic conditional update to prevent race conditions
      const result = await app.prisma.order.updateMany({
        where: { id: order.id, status: order.status as any },
        data: {
          status: body.data.status,
          ...(body.data.trackingNumber && { trackingNumber: body.data.trackingNumber }),
        },
      });

      if (result.count === 0) {
        return reply.status(409).send({ error: 'Order status changed concurrently, please retry', code: 409 });
      }

      const updated = await app.prisma.order.findUnique({
        where: { id: order.id },
        include: { job: { select: { title: true } } },
      });

      const buyer = await app.prisma.user.findUnique({
        where: { id: order.buyerId },
        select: { id: true, email: true, emailPreferences: true },
      });
      if (buyer && updated) {
        const tpl = orderStatusEmail(updated.job.title, body.data.status, body.data.trackingNumber);
        sendEmail({ to: buyer.email, subject: tpl.subject, html: tpl.html, category: 'orders', userId: buyer.id, userPrefs: buyer.emailPreferences as any }).catch(() => {});
        notifyUser(buyer.id, { type: 'order:status', data: { orderId: order.id, status: body.data.status } });
      }

      return updated;
    },
  });

  // Refund (buyer only, pre-shipment)
  app.post<{ Params: { id: string } }>('/:id/refund', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const order = await app.prisma.order.findUnique({ where: { id: request.params.id } });
      if (!order) return reply.status(404).send({ error: 'Order not found', code: 404 });
      if (order.buyerId !== request.userId) return reply.status(403).send({ error: 'Only buyer can request refund', code: 403 });
      if (!['paid', 'printing'].includes(order.status)) {
        return reply.status(400).send({ error: 'Order cannot be refunded at this stage', code: 400 });
      }
      if (order.stripePaymentIntentId) await createRefund(order.stripePaymentIntentId);
      await app.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
      return { refunded: true };
    },
  });

  // Confirm delivery (buyer only) - releases funds
  app.post<{ Params: { id: string } }>('/:id/confirm', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const order = await app.prisma.order.findUnique({
        where: { id: request.params.id },
      });

      if (!order) {
        return reply.status(404).send({ error: 'Order not found', code: 404 });
      }
      if (order.buyerId !== request.userId) {
        return reply.status(403).send({ error: 'Only the buyer can confirm delivery', code: 403 });
      }
      if (order.status !== 'delivered' && order.status !== 'shipped') {
        return reply.status(400).send({ error: 'Order must be shipped or delivered to confirm', code: 400 });
      }

      const updated = await app.prisma.$transaction(async (tx) => {
        const confirmed = await tx.order.update({
          where: { id: order.id },
          data: { status: 'confirmed' },
          include: { job: { select: { title: true } } },
        });

        await tx.printJob.update({
          where: { id: order.jobId },
          data: { status: 'completed' },
        });

        // TODO: In production, release Stripe escrow funds here

        return confirmed;
      });

      const printerRecord = await app.prisma.printer.findUnique({
        where: { id: order.printerId },
        include: { user: { select: { id: true, email: true, emailPreferences: true } } },
      });
      if (printerRecord) {
        const tpl = orderStatusEmail(updated.job.title, 'confirmed');
        sendEmail({ to: printerRecord.user.email, subject: tpl.subject, html: tpl.html, category: 'orders', userId: printerRecord.user.id, userPrefs: printerRecord.user.emailPreferences as any }).catch(() => {});
        notifyUser(printerRecord.user.id, { type: 'order:status', data: { orderId: order.id, status: 'confirmed' } });
      }

      return updated;
    },
  });
}
