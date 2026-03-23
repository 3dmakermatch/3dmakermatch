import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

import { authRoutes } from '../../routes/auth.js';
import { userRoutes } from '../../routes/users.js';
import { printerRoutes } from '../../routes/printers.js';
import { uploadRoutes } from '../../routes/uploads.js';
import { jobRoutes } from '../../routes/jobs.js';
import { bidRoutes } from '../../routes/bids.js';
import { messageRoutes } from '../../routes/messages.js';
import { orderRoutes } from '../../routes/orders.js';
import { reviewRoutes } from '../../routes/reviews.js';
import { paymentWebhookRoutes } from '../../routes/payments.js';
import { adminRoutes } from '../../routes/admin.js';
import { notificationPrefRoutes } from '../../routes/notification-prefs.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
  interface FastifyRequest {
    userId?: string;
    userRole?: string;
  }
}

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 52_428_800 });

  app.decorate('prisma', prisma);

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie, { secret: 'test-cookie-secret' });

  // Accept raw binary uploads
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // Health check
  app.get('/api/health', async () => ({ status: 'ok' }));

  // Routes — same prefixes as index.ts
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(printerRoutes, { prefix: '/api/v1/printers' });
  await app.register(uploadRoutes, { prefix: '/api/v1/uploads' });
  await app.register(jobRoutes, { prefix: '/api/v1/jobs' });
  await app.register(bidRoutes, { prefix: '/api/v1' });
  await app.register(messageRoutes, { prefix: '/api/v1/messages' });
  await app.register(orderRoutes, { prefix: '/api/v1/orders' });
  await app.register(reviewRoutes, { prefix: '/api/v1' });
  await app.register(paymentWebhookRoutes, { prefix: '/api/v1/payments' });
  await app.register(notificationPrefRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });

  await app.ready();
  return app;
}
