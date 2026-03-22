import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { fileProcessingQueue } from '../services/queue.js';

const createJobSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  files: z.array(z.object({
    fileKey: z.string().min(1),
    fileName: z.string().min(1),
    displayOrder: z.number().int().min(0).default(0),
  })).min(1, 'At least one file is required'),
  materialPreferred: z.union([z.string(), z.array(z.string())]).optional().transform(v =>
    typeof v === 'string' ? [v] : (v || [])
  ),
  quantity: z.number().int().min(1).max(10000).default(1),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

const listJobsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'bidding', 'active', 'completed', 'cancelled']).optional(),
  material: z.string().optional(),
  city: z.string().optional(),
  sort_by: z.enum(['created_at', 'expires_at']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const updateJobSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  materialPreferred: z.union([z.string(), z.array(z.string())]).optional().transform(v =>
    typeof v === 'string' ? [v] : (v || [])
  ),
  status: z.enum(['cancelled']).optional(),
});

export async function jobRoutes(app: FastifyInstance) {
  // Create a print job
  app.post('/', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const body = createJobSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const { title, description, files, materialPreferred, quantity, expiresInDays } = body.data;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);

      const job = await app.prisma.printJob.create({
        data: {
          userId: request.userId!,
          title,
          description,
          materialPreferred,
          quantity,
          status: 'draft',
          expiresAt,
          files: {
            create: files.map(({ fileKey, fileName, displayOrder }) => ({
              fileUrl: fileKey,
              fileName,
              displayOrder,
            })),
          },
        },
        include: {
          user: { select: { id: true, fullName: true } },
          files: {
            select: { id: true, fileName: true, thumbnailUrl: true, displayOrder: true },
            orderBy: { displayOrder: 'asc' },
          },
        },
      });

      // Queue each file for processing
      await Promise.all(
        job.files.map((jobFile, idx) => {
          const { fileKey, fileName } = files[idx];
          return fileProcessingQueue.add('process-file', {
            jobId: job.id,
            fileId: jobFile.id,
            fileKey,
            fileName,
          });
        }),
      );

      return reply.status(201).send(job);
    },
  });

  // List / browse print jobs
  app.get('/', async (request, reply) => {
    const query = listJobsSchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: query.error.issues[0].message, code: 400 });
    }

    const { page, limit, status, material, city, sort_by, order } = query.data;

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    } else {
      // Default: show bidding jobs (open for bids)
      where.status = 'bidding';
    }
    if (material) {
      where.materialPreferred = { has: material };
    }
    if (city) {
      where.user = { printer: { addressCity: { contains: city, mode: 'insensitive' } } };
    }
    // Only show non-expired jobs
    where.expiresAt = { gt: new Date() };

    const [jobs, total] = await Promise.all([
      app.prisma.printJob.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true } },
          _count: { select: { bids: true } },
          files: {
            select: { id: true, fileName: true, thumbnailUrl: true, displayOrder: true },
            orderBy: { displayOrder: 'asc' },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sort_by === 'created_at' ? 'createdAt' : 'expiresAt']: order },
      }),
      app.prisma.printJob.count({ where }),
    ]);

    const data = jobs.map((job) => ({
      ...job,
      bidCount: job._count.bids,
      _count: undefined,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // Get job detail
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const job = await app.prisma.printJob.findUnique({
      where: { id: request.params.id },
      include: {
        user: { select: { id: true, fullName: true } },
        _count: { select: { bids: true } },
        files: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    if (!job) {
      return reply.status(404).send({ error: 'Job not found', code: 404 });
    }

    return {
      ...job,
      bidCount: job._count.bids,
      _count: undefined,
    };
  });

  // Update job (owner only)
  app.patch<{ Params: { id: string } }>('/:id', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const job = await app.prisma.printJob.findUnique({
        where: { id: request.params.id },
      });

      if (!job) {
        return reply.status(404).send({ error: 'Job not found', code: 404 });
      }
      if (job.userId !== request.userId) {
        return reply.status(403).send({ error: 'Not authorized', code: 403 });
      }

      const body = updateJobSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const updated = await app.prisma.printJob.update({
        where: { id: request.params.id },
        data: body.data,
        include: {
          user: { select: { id: true, fullName: true } },
          _count: { select: { bids: true } },
        },
      });

      return {
        ...updated,
        bidCount: updated._count.bids,
        _count: undefined,
      };
    },
  });

  // Get my jobs (authenticated user)
  app.get('/mine', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const query = listJobsSchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.issues[0].message, code: 400 });
      }

      const { page, limit, status, sort_by, order } = query.data;

      const where: Record<string, unknown> = { userId: request.userId };
      if (status) where.status = status;

      const [jobs, total] = await Promise.all([
        app.prisma.printJob.findMany({
          where,
          include: {
            _count: { select: { bids: true } },
            files: {
              select: { id: true, fileName: true, thumbnailUrl: true, displayOrder: true },
              orderBy: { displayOrder: 'asc' },
            },
          },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { [sort_by === 'created_at' ? 'createdAt' : 'expiresAt']: order },
        }),
        app.prisma.printJob.count({ where }),
      ]);

      const data = jobs.map((job) => ({
        ...job,
        bidCount: job._count.bids,
        _count: undefined,
      }));

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    },
  });
}
