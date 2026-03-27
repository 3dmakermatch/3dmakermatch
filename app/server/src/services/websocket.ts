import { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { randomUUID } from 'crypto';
import { authenticate } from '../middleware/auth.js';

// In-memory ticket store (fallback when Redis unavailable)
const ticketStore = new Map<string, { userId: string; expiresAt: number }>();
const clients = new Map<string, import('ws').WebSocket[]>();

// Clean expired tickets every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of ticketStore) {
    if (val.expiresAt < now) ticketStore.delete(key);
  }
}, 60_000);

async function storeTicket(ticket: string, userId: string): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const { createClient } = await import('redis');
      const client = createClient({ url: redisUrl });
      await client.connect();
      await client.setEx(`ws:ticket:${ticket}`, 30, userId);
      await client.disconnect();
      return;
    } catch { /* fall through to memory */ }
  }
  ticketStore.set(ticket, { userId, expiresAt: Date.now() + 30_000 });
}

async function validateTicket(ticket: string): Promise<string | null> {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const { createClient } = await import('redis');
      const client = createClient({ url: redisUrl });
      await client.connect();
      const userId = await client.getDel(`ws:ticket:${ticket}`);
      await client.disconnect();
      if (userId) return userId;
    } catch { /* fall through */ }
  }
  const entry = ticketStore.get(ticket);
  if (entry && entry.expiresAt > Date.now()) {
    ticketStore.delete(ticket);
    return entry.userId;
  }
  return null;
}

export function notifyUser(
  userId: string,
  event: { type: string; data: Record<string, unknown> },
): void {
  const conns = clients.get(userId);
  if (!conns || conns.length === 0) return;
  const msg = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
  for (const ws of conns) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

export async function setupWebSocket(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  // Ticket endpoint
  app.post('/api/v1/ws/ticket', {
    preHandler: [authenticate],
    handler: async (request) => {
      const ticket = randomUUID();
      await storeTicket(ticket, request.userId!);
      return { ticket };
    },
  });

  // WebSocket endpoint
  app.get('/api/v1/ws', { websocket: true }, (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const ticket = url.searchParams.get('ticket');
    if (!ticket) {
      socket.close(4001, 'Missing ticket');
      return;
    }

    validateTicket(ticket).then((userId) => {
      if (!userId) {
        socket.close(4001, 'Invalid ticket');
        return;
      }

      // Add to clients map
      if (!clients.has(userId)) clients.set(userId, []);
      const conns = clients.get(userId)!;

      // Max 3 connections — evict oldest first
      while (conns.length >= 3) {
        const oldest = conns.shift();
        oldest?.close(4002, 'Too many connections');
      }
      conns.push(socket);

      // Heartbeat: ping every 30s
      const pingInterval = setInterval(() => {
        if (socket.readyState === 1) socket.ping();
      }, 30_000);

      let pongReceived = true;
      socket.on('pong', () => {
        pongReceived = true;
      });

      // Check pong every 40s (10s grace after ping)
      const checkInterval = setInterval(() => {
        if (!pongReceived) {
          socket.close(4003, 'Pong timeout');
          return;
        }
        pongReceived = false;
      }, 40_000);

      socket.on('close', () => {
        clearInterval(pingInterval);
        clearInterval(checkInterval);
        const arr = clients.get(userId);
        if (arr) {
          const idx = arr.indexOf(socket);
          if (idx >= 0) arr.splice(idx, 1);
          if (arr.length === 0) clients.delete(userId);
        }
      });
    });
  });
}
