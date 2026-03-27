import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.enum(['buyer', 'printer', 'admin']).optional(),
  search: z.string().max(200).optional(),
});

const updateUserSchema = z.object({
  role: z.enum(['buyer', 'printer', 'admin']).optional(),
  suspend: z.boolean().optional(),
});

const listJobsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const listDisputesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['open', 'under_review', 'resolved', 'closed']).optional(),
});

const resolveDisputeSchema = z.object({
  status: z.enum(['under_review', 'resolved', 'closed']),
  resolution: z.string().max(2000).optional(),
});

const adminPreHandler = [authenticate, requireRole('admin')];

export async function adminRoutes(app: FastifyInstance) {
  // GET /users — list users with optional filters and pagination
  app.get<{ Querystring: Record<string, string> }>('/users', {
    preHandler: adminPreHandler,
    handler: async (request, reply) => {
      const query = listUsersSchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.issues[0].message, code: 400 });
      }

      const { page, limit, role, search } = query.data;
      const skip = (page - 1) * limit;

      const where: Record<string, unknown> = {};
      if (role) {
        where.role = role;
      }
      if (search) {
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [users, total] = await Promise.all([
        app.prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        app.prisma.user.count({ where }),
      ]);

      return {
        data: users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // PATCH /users/:id — update user role or suspend
  app.patch<{ Params: { id: string } }>('/users/:id', {
    preHandler: adminPreHandler,
    handler: async (request, reply) => {
      const body = updateUserSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const user = await app.prisma.user.findUnique({
        where: { id: request.params.id },
      });
      if (!user) {
        return reply.status(404).send({ error: 'User not found', code: 404 });
      }

      const updateData: Record<string, unknown> = {};

      if (body.data.suspend === true) {
        updateData.role = 'buyer';
        updateData.refreshToken = null;
      } else if (body.data.role) {
        updateData.role = body.data.role;
      }

      if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({ error: 'No valid update fields provided', code: 400 });
      }

      const updated = await app.prisma.user.update({
        where: { id: request.params.id },
        data: updateData,
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return updated;
    },
  });

  // GET /jobs — list all jobs including cancelled/expired, with pagination
  app.get<{ Querystring: Record<string, string> }>('/jobs', {
    preHandler: adminPreHandler,
    handler: async (request, reply) => {
      const query = listJobsSchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.issues[0].message, code: 400 });
      }

      const { page, limit } = query.data;
      const skip = (page - 1) * limit;

      const [jobs, total] = await Promise.all([
        app.prisma.printJob.findMany({
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            expiresAt: true,
            user: { select: { id: true, fullName: true, email: true } },
            _count: { select: { bids: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        app.prisma.printJob.count(),
      ]);

      return {
        data: jobs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // DELETE /jobs/:id — soft delete (set status to cancelled)
  app.delete<{ Params: { id: string } }>('/jobs/:id', {
    preHandler: adminPreHandler,
    handler: async (request, reply) => {
      const job = await app.prisma.printJob.findUnique({
        where: { id: request.params.id },
      });
      if (!job) {
        return reply.status(404).send({ error: 'Job not found', code: 404 });
      }

      const updated = await app.prisma.printJob.update({
        where: { id: request.params.id },
        data: { status: 'cancelled' },
        select: { id: true, status: true },
      });

      return updated;
    },
  });

  // GET /disputes — list disputes with optional status filter and pagination
  app.get<{ Querystring: Record<string, string> }>('/disputes', {
    preHandler: adminPreHandler,
    handler: async (request, reply) => {
      const query = listDisputesSchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.issues[0].message, code: 400 });
      }

      const { page, limit, status } = query.data;
      const skip = (page - 1) * limit;

      const where: Record<string, unknown> = {};
      if (status) {
        where.status = status;
      }

      const [disputes, total] = await Promise.all([
        app.prisma.dispute.findMany({
          where,
          include: {
            order: { select: { id: true } },
            creator: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        app.prisma.dispute.count({ where }),
      ]);

      return {
        data: disputes,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // PATCH /disputes/:id — resolve dispute
  app.patch<{ Params: { id: string } }>('/disputes/:id', {
    preHandler: adminPreHandler,
    handler: async (request, reply) => {
      const body = resolveDisputeSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const dispute = await app.prisma.dispute.findUnique({
        where: { id: request.params.id },
      });
      if (!dispute) {
        return reply.status(404).send({ error: 'Dispute not found', code: 404 });
      }

      const updated = await app.prisma.dispute.update({
        where: { id: request.params.id },
        data: {
          status: body.data.status,
          ...(body.data.resolution !== undefined && { resolution: body.data.resolution }),
        },
        include: {
          order: { select: { id: true } },
          creator: { select: { id: true, fullName: true, email: true } },
        },
      });

      return updated;
    },
  });

  // GET /stats — dashboard stats
  app.get('/stats', {
    preHandler: adminPreHandler,
    handler: async () => {
      const [
        totalUsers,
        totalJobs,
        totalOrders,
        activeDisputes,
        revenueResult,
      ] = await Promise.all([
        app.prisma.user.count(),
        app.prisma.printJob.count(),
        app.prisma.order.count(),
        app.prisma.dispute.count({
          where: { status: { in: ['open', 'under_review'] } },
        }),
        app.prisma.bid.aggregate({
          _sum: { amountCents: true },
          where: {
            order: {
              status: { in: ['paid', 'printing', 'shipped', 'delivered', 'confirmed'] },
            },
          },
        }),
      ]);

      const totalRevenueCents = revenueResult._sum.amountCents ?? 0;

      return {
        totalUsers,
        totalJobs,
        totalOrders,
        totalRevenueCents,
        activeDisputes,
      };
    },
  });
}
