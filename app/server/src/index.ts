import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
import { PrismaClient } from '@prisma/client';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { printerRoutes } from './routes/printers.js';
import { uploadRoutes } from './routes/uploads.js';
import { jobRoutes } from './routes/jobs.js';
import { bidRoutes } from './routes/bids.js';
import { messageRoutes } from './routes/messages.js';
import { orderRoutes } from './routes/orders.js';
import { reviewRoutes } from './routes/reviews.js';
import { paymentWebhookRoutes } from './routes/payments.js';
import { notificationPrefRoutes } from './routes/notification-prefs.js';
import { startFileProcessingWorker } from './services/queue.js';

const prisma = new PrismaClient();

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
  bodyLimit: 52_428_800, // 50MB for file uploads
});

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
  interface FastifyRequest {
    userId?: string;
    userRole?: string;
  }
}

async function start() {
  // Decorate with prisma
  app.decorate('prisma', prisma);

  // Plugins
  await app.register(cors, {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  });

  await app.register(cookie, {
    secret: process.env.JWT_SECRET || 'dev-cookie-secret',
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(rawBody, {
    global: false,
    encoding: false,
    runFirst: true,
  });

  // Accept raw binary uploads
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // Health check
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Routes
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

  // Start file processing worker
  const worker = startFileProcessingWorker(prisma);

  // Serve static files in production
  if (process.env.NODE_ENV === 'production') {
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const fastifyStatic = await import('@fastify/static');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await app.register(fastifyStatic.default, {
      root: path.join(__dirname, '..', 'public'),
      wildcard: false,
    });
    app.setNotFoundHandler(async (_req, reply) => {
      return (reply as any).sendFile('index.html');
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info('Shutting down...');
    await worker.close();
    await prisma.$disconnect();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Server running on port ${port}`);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
