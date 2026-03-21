import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';

const createPrinterSchema = z.object({
  bio: z.string().max(2000).optional(),
  addressCity: z.string().max(100).optional(),
  addressState: z.string().max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  capabilities: z.object({
    machines: z.array(z.object({
      name: z.string(),
      type: z.enum(['FDM', 'SLA', 'SLS', 'MJF', 'OTHER']),
      buildVolume: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      materials: z.array(z.string()),
    })).optional(),
    materials: z.array(z.string()).optional(),
    maxBuildVolume: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  }).optional(),
});

const updatePrinterSchema = createPrinterSchema;

const listPrintersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  city: z.string().optional(),
  state: z.string().optional(),
  verified: z.coerce.boolean().optional(),
});

export async function printerRoutes(app: FastifyInstance) {
  // Register as printer
  app.post('/', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      if (request.userRole !== 'printer') {
        return reply.status(403).send({ error: 'Only printer accounts can create printer profiles', code: 403 });
      }

      const existing = await app.prisma.printer.findUnique({
        where: { userId: request.userId! },
      });
      if (existing) {
        return reply.status(409).send({ error: 'Printer profile already exists', code: 409 });
      }

      const body = createPrinterSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const printer = await app.prisma.printer.create({
        data: {
          userId: request.userId!,
          ...body.data,
          capabilities: body.data.capabilities ?? {},
        },
        include: { user: { select: { id: true, fullName: true, email: true } } },
      });

      return reply.status(201).send(printer);
    },
  });

  // List printers
  app.get('/', async (request, reply) => {
    const query = listPrintersSchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: query.error.issues[0].message, code: 400 });
    }

    const { page, limit, city, state, verified } = query.data;
    const where: Record<string, unknown> = {};
    if (city) where.addressCity = { contains: city, mode: 'insensitive' };
    if (state) where.addressState = { contains: state, mode: 'insensitive' };
    if (verified !== undefined) where.isVerified = verified;

    const [printers, total] = await Promise.all([
      app.prisma.printer.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { averageRating: 'desc' },
      }),
      app.prisma.printer.count({ where }),
    ]);

    return {
      data: printers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // Get printer by ID
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const printer = await app.prisma.printer.findUnique({
      where: { id: request.params.id },
      include: {
        user: { select: { id: true, fullName: true, createdAt: true } },
        benchmarks: true,
      },
    });
    if (!printer) {
      return reply.status(404).send({ error: 'Printer not found', code: 404 });
    }
    return printer;
  });

  // Update printer profile
  app.patch<{ Params: { id: string } }>('/:id', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const printer = await app.prisma.printer.findUnique({
        where: { id: request.params.id },
      });
      if (!printer) {
        return reply.status(404).send({ error: 'Printer not found', code: 404 });
      }
      if (printer.userId !== request.userId) {
        return reply.status(403).send({ error: 'Not authorized', code: 403 });
      }

      const body = updatePrinterSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const updated = await app.prisma.printer.update({
        where: { id: request.params.id },
        data: {
          ...body.data,
          capabilities: body.data.capabilities ?? undefined,
        },
        include: { user: { select: { id: true, fullName: true } } },
      });

      return updated;
    },
  });
}
