import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { createPaymentIntent, isMockStripe } from '../services/stripe.js';

const createBidSchema = z.object({
  amountCents: z.number().int().min(100).max(10_000_00),
  shippingCostCents: z.number().int().min(0).max(100_00).default(0),
  estimatedDays: z.number().int().min(1).max(90),
  message: z.string().max(2000).optional(),
});

export async function bidRoutes(app: FastifyInstance) {
  // Submit a bid on a job
  app.post<{ Params: { jobId: string } }>('/jobs/:jobId/bids', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      if (request.userRole !== 'printer') {
        return reply.status(403).send({ error: 'Only printers can submit bids', code: 403 });
      }

      const printer = await app.prisma.printer.findUnique({
        where: { userId: request.userId! },
      });
      if (!printer) {
        return reply.status(400).send({ error: 'Create a printer profile first', code: 400 });
      }

      const job = await app.prisma.printJob.findUnique({
        where: { id: request.params.jobId },
      });
      if (!job) {
        return reply.status(404).send({ error: 'Job not found', code: 404 });
      }
      if (job.status !== 'bidding') {
        return reply.status(400).send({ error: 'Job is not accepting bids', code: 400 });
      }
      if (new Date(job.expiresAt) < new Date()) {
        return reply.status(400).send({ error: 'Job has expired', code: 400 });
      }
      if (job.userId === request.userId) {
        return reply.status(400).send({ error: 'Cannot bid on your own job', code: 400 });
      }

      const body = createBidSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const existing = await app.prisma.bid.findUnique({
        where: { jobId_printerId: { jobId: job.id, printerId: printer.id } },
      });
      if (existing) {
        return reply.status(409).send({ error: 'You already bid on this job', code: 409 });
      }

      const bid = await app.prisma.bid.create({
        data: {
          jobId: job.id,
          printerId: printer.id,
          ...body.data,
        },
        include: {
          printer: {
            include: { user: { select: { id: true, fullName: true } } },
          },
        },
      });

      return reply.status(201).send(bid);
    },
  });

  // List bids for a job
  app.get<{ Params: { jobId: string } }>('/jobs/:jobId/bids', async (request, reply) => {
    const job = await app.prisma.printJob.findUnique({
      where: { id: request.params.jobId },
    });
    if (!job) {
      return reply.status(404).send({ error: 'Job not found', code: 404 });
    }

    const bids = await app.prisma.bid.findMany({
      where: { jobId: request.params.jobId },
      include: {
        printer: {
          include: { user: { select: { id: true, fullName: true } } },
        },
      },
      orderBy: { amountCents: 'asc' },
    });

    return { data: bids };
  });

  // Accept a bid (buyer only)
  app.post<{ Params: { id: string } }>('/bids/:id/accept', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const bid = await app.prisma.bid.findUnique({
        where: { id: request.params.id },
        include: { job: true },
      });
      if (!bid) {
        return reply.status(404).send({ error: 'Bid not found', code: 404 });
      }
      if (bid.job.userId !== request.userId) {
        return reply.status(403).send({ error: 'Only the job owner can accept bids', code: 403 });
      }
      if (bid.status !== 'pending') {
        return reply.status(400).send({ error: 'Bid is no longer pending', code: 400 });
      }

      // Accept this bid, reject all others, create order
      const [updatedBid, order] = await app.prisma.$transaction(async (tx) => {
        const accepted = await tx.bid.update({
          where: { id: bid.id },
          data: { status: 'accepted' },
        });

        await tx.bid.updateMany({
          where: { jobId: bid.jobId, id: { not: bid.id }, status: 'pending' },
          data: { status: 'rejected' },
        });

        await tx.printJob.update({
          where: { id: bid.jobId },
          data: { status: 'active' },
        });

        const newOrder = await tx.order.create({
          data: {
            jobId: bid.jobId,
            bidId: bid.id,
            buyerId: request.userId!,
            printerId: bid.printerId,
            status: 'paid',
          },
        });

        return [accepted, newOrder];
      });

      return { bid: updatedBid, order };
    },
  });

  // Reject a bid (buyer only)
  app.post<{ Params: { id: string } }>('/bids/:id/reject', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const bid = await app.prisma.bid.findUnique({
        where: { id: request.params.id },
        include: { job: true },
      });
      if (!bid) {
        return reply.status(404).send({ error: 'Bid not found', code: 404 });
      }
      if (bid.job.userId !== request.userId) {
        return reply.status(403).send({ error: 'Only the job owner can reject bids', code: 403 });
      }
      if (bid.status !== 'pending') {
        return reply.status(400).send({ error: 'Can only reject pending bids', code: 400 });
      }

      const updated = await app.prisma.bid.update({
        where: { id: bid.id },
        data: { status: 'rejected' },
      });

      return updated;
    },
  });

  // Payment for accepted bid
  app.post<{ Params: { id: string } }>('/bids/:id/pay', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const bid = await app.prisma.bid.findUnique({
        where: { id: request.params.id },
        include: { job: true, printer: true },
      });
      if (!bid) return reply.status(404).send({ error: 'Bid not found', code: 404 });
      if (bid.job.userId !== request.userId) return reply.status(403).send({ error: 'Not authorized', code: 403 });
      if (bid.status !== 'accepted') return reply.status(400).send({ error: 'Bid must be accepted first', code: 400 });

      const platformFeeCents = 499;
      const totalCents = bid.amountCents + bid.shippingCostCents;

      if (isMockStripe()) {
        const order = await app.prisma.$transaction(async (tx) => {
          const o = await tx.order.create({
            data: { jobId: bid.jobId, bidId: bid.id, buyerId: request.userId!, printerId: bid.printerId, platformFeeCents, status: 'paid' },
          });
          await tx.printJob.update({ where: { id: bid.jobId }, data: { status: 'active' } });
          return o;
        });
        return { order, mock: true };
      }

      const { clientSecret, paymentIntentId } = await createPaymentIntent(totalCents, platformFeeCents, bid.printer.stripeAccountId || '');
      return { clientSecret, paymentIntentId, totalCents: totalCents + platformFeeCents };
    },
  });

  // Withdraw a bid (printer only)
  app.delete<{ Params: { id: string } }>('/bids/:id', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const bid = await app.prisma.bid.findUnique({
        where: { id: request.params.id },
        include: { printer: true },
      });
      if (!bid) {
        return reply.status(404).send({ error: 'Bid not found', code: 404 });
      }
      if (bid.printer.userId !== request.userId) {
        return reply.status(403).send({ error: 'Not your bid', code: 403 });
      }
      if (bid.status !== 'pending') {
        return reply.status(400).send({ error: 'Can only withdraw pending bids', code: 400 });
      }

      const updated = await app.prisma.bid.update({
        where: { id: bid.id },
        data: { status: 'withdrawn' },
      });

      return updated;
    },
  });
}
