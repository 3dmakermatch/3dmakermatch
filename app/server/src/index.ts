import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { printerRoutes } from './routes/printers.js';

const prisma = new PrismaClient();

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
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

  // Health check
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(printerRoutes, { prefix: '/api/v1/printers' });

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
