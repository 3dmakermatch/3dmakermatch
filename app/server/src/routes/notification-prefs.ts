import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { verifyUnsubscribeToken } from '../services/email.js';

const prefsSchema = z.object({
  bids: z.boolean().optional(),
  orders: z.boolean().optional(),
  messages: z.boolean().optional(),
  reviews: z.boolean().optional(),
  marketing: z.boolean().optional(),
  jobAlerts: z.enum(['instant', 'hourly', 'daily', 'weekly', 'off']).optional(),
});

export async function notificationPrefRoutes(app: FastifyInstance) {
  // Update email preferences
  app.patch('/users/me/email-preferences', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const body = prefsSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const user = await app.prisma.user.findUnique({ where: { id: request.userId! } });
      if (!user) return reply.status(404).send({ error: 'User not found', code: 404 });

      const currentPrefs = (user.emailPreferences as Record<string, unknown>) || {};
      const newPrefs = { ...currentPrefs, ...body.data };

      await app.prisma.user.update({
        where: { id: user.id },
        data: { emailPreferences: newPrefs },
      });
      return newPrefs;
    },
  });

  // Validate unsubscribe token (GET — for SPA to render confirmation)
  app.get('/unsubscribe', async (request, reply) => {
    const { token, category } = request.query as { token?: string; category?: string };
    if (!token || !category) {
      return reply.status(400).send({ error: 'Missing token or category', code: 400 });
    }

    const result = verifyUnsubscribeToken(token);
    if (!result) return reply.status(400).send({ error: 'Invalid or expired token', code: 400 });

    return { valid: true, category: result.category };
  });

  // Process unsubscribe (POST — user confirmed)
  app.post('/unsubscribe', async (request, reply) => {
    const { token } = request.body as { token?: string };
    if (!token) return reply.status(400).send({ error: 'Missing token', code: 400 });

    const result = verifyUnsubscribeToken(token);
    if (!result) return reply.status(400).send({ error: 'Invalid or expired token', code: 400 });

    const user = await app.prisma.user.findUnique({ where: { id: result.userId } });
    if (!user) return reply.status(404).send({ error: 'User not found', code: 404 });

    const prefs = (user.emailPreferences as Record<string, unknown>) || {};
    prefs[result.category] = false;

    await app.prisma.user.update({
      where: { id: user.id },
      data: { emailPreferences: prefs as never },
    });
    return { unsubscribed: true, category: result.category };
  });
}
