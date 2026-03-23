import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock @fastify/websocket ────────────────────────────────────────────────────
vi.mock('@fastify/websocket', () => ({ default: vi.fn() }));

// ── Mock the auth middleware ───────────────────────────────────────────────────
vi.mock('../../middleware/auth.js', () => ({
  authenticate: vi.fn(async () => {}),
}));

// ── Mock Redis — default: unavailable (so in-memory fallback is used) ─────────
const mockRedisConnect = vi.fn().mockResolvedValue(undefined);
const mockRedisDisconnect = vi.fn().mockResolvedValue(undefined);
const mockRedisSetEx = vi.fn().mockResolvedValue('OK');
const mockRedisGetDel = vi.fn().mockResolvedValue(null);

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    connect: mockRedisConnect,
    disconnect: mockRedisDisconnect,
    setEx: mockRedisSetEx,
    getDel: mockRedisGetDel,
  })),
}));

// ── Import module under test (AFTER vi.mock calls) ────────────────────────────
import { notifyUser, setupWebSocket } from '../../services/websocket.js';

// ── Helper: build a mock Fastify app that captures route registrations ─────────
function buildMockApp() {
  let ticketRouteOpts: any = null;
  let wsRouteHandler: Function | null = null;

  const app = {
    register: vi.fn(),
    // POST /api/v1/ws/ticket uses { preHandler, handler } opts as 2nd arg
    post: vi.fn((path: string, opts: any) => {
      if (path === '/api/v1/ws/ticket') ticketRouteOpts = opts;
    }),
    // GET /api/v1/ws uses { websocket: true } as 2nd arg, handler as 3rd arg
    get: vi.fn((path: string, _opts: any, handler?: Function) => {
      if (path === '/api/v1/ws' && handler) wsRouteHandler = handler;
    }),
    getTicketHandler(): Function { return ticketRouteOpts?.handler; },
    getWsHandler(): Function | null { return wsRouteHandler; },
  };
  return app;
}

// ── notifyUser() ──────────────────────────────────────────────────────────────
describe('notifyUser()', () => {
  it('does nothing when userId has no connected clients', () => {
    expect(() =>
      notifyUser('unknown-user', { type: 'test:event', data: {} }),
    ).not.toThrow();
  });

  it('does not throw for any event type when user is not connected', () => {
    expect(() =>
      notifyUser('u1', { type: 'order:status', data: { orderId: 'o1', status: 'shipped' } }),
    ).not.toThrow();
  });
});

// ── ticket endpoint ───────────────────────────────────────────────────────────
describe('setupWebSocket() — ticket endpoint', () => {
  beforeEach(() => {
    delete process.env.REDIS_URL; // use in-memory fallback
    vi.clearAllMocks();
  });

  it('registers the POST /api/v1/ws/ticket route', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    expect(app.post).toHaveBeenCalledWith(
      '/api/v1/ws/ticket',
      expect.objectContaining({ handler: expect.any(Function) }),
    );
  });

  it('ticket handler returns an object with a ticket property', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    const handler = app.getTicketHandler();
    expect(handler).toBeDefined();
    const result = await handler({ userId: 'user-abc' });
    expect(result).toHaveProperty('ticket');
    expect(typeof result.ticket).toBe('string');
  });

  it('generates a UUID-formatted ticket', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    const handler = app.getTicketHandler();
    const { ticket } = await handler({ userId: 'user-1' });
    expect(ticket).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('generates unique tickets for successive calls', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    const handler = app.getTicketHandler();
    const r1 = await handler({ userId: 'user-1' });
    const r2 = await handler({ userId: 'user-1' });
    expect(r1.ticket).not.toBe(r2.ticket);
  });

  it('stores the ticket for the given userId', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    const handler = app.getTicketHandler();
    const { ticket } = await handler({ userId: 'user-store-test' });
    // Validate by calling through the WS handler with the same ticket
    const wsHandler = app.getWsHandler();
    expect(wsHandler).not.toBeNull();
    const mockClose = vi.fn();
    const mockSocket = { close: mockClose, readyState: 1, ping: vi.fn(), on: vi.fn(), send: vi.fn() };
    wsHandler!(mockSocket, { url: `/api/v1/ws?ticket=${ticket}` });
    await new Promise((r) => setImmediate(r));
    // Should NOT be closed with 4001 (invalid ticket)
    const invalid4001 = (mockClose.mock.calls as [number, string][]).filter(([c]) => c === 4001);
    expect(invalid4001).toHaveLength(0);
  });
});

// ── WebSocket GET handler ─────────────────────────────────────────────────────
describe('setupWebSocket() — WebSocket GET handler', () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    vi.clearAllMocks();
  });

  it('registers the GET /api/v1/ws route', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    expect(app.get).toHaveBeenCalledWith('/api/v1/ws', expect.any(Object), expect.any(Function));
  });

  it('closes socket with 4001 when no ticket query param is present', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    const wsHandler = app.getWsHandler()!;

    const mockClose = vi.fn();
    wsHandler({ close: mockClose, readyState: 1 }, { url: '/api/v1/ws' });
    expect(mockClose).toHaveBeenCalledWith(4001, 'Missing ticket');
  });

  it('closes socket with 4001 when ticket is unknown/expired', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    const wsHandler = app.getWsHandler()!;

    const mockClose = vi.fn();
    const mockSocket = { close: mockClose, readyState: 1, ping: vi.fn(), on: vi.fn() };
    wsHandler(mockSocket, { url: '/api/v1/ws?ticket=totally-invalid-ticket' });
    await new Promise((r) => setImmediate(r));
    expect(mockClose).toHaveBeenCalledWith(4001, 'Invalid ticket');
  });

  it('does NOT close with 4001 when a valid ticket is presented', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    const ticketHandler = app.getTicketHandler();
    const { ticket } = await ticketHandler({ userId: 'ws-user-99' });

    const wsHandler = app.getWsHandler()!;
    const mockClose = vi.fn();
    const mockSocket = { close: mockClose, readyState: 1, ping: vi.fn(), on: vi.fn(), send: vi.fn() };
    wsHandler(mockSocket, { url: `/api/v1/ws?ticket=${ticket}` });
    await new Promise((r) => setImmediate(r));

    const invalid = (mockClose.mock.calls as [number, string][]).filter(([c]) => c === 4001);
    expect(invalid).toHaveLength(0);
  });

  it('ticket is single-use: second presentation of the same ticket closes with 4001', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    const ticketHandler = app.getTicketHandler();
    const { ticket } = await ticketHandler({ userId: 'ws-single-use' });

    const wsHandler = app.getWsHandler()!;

    // First use — valid
    wsHandler(
      { close: vi.fn(), readyState: 1, ping: vi.fn(), on: vi.fn(), send: vi.fn() },
      { url: `/api/v1/ws?ticket=${ticket}` },
    );
    await new Promise((r) => setImmediate(r));

    // Second use — same ticket, should fail
    const sock2Close = vi.fn();
    wsHandler(
      { close: sock2Close, readyState: 1, ping: vi.fn(), on: vi.fn(), send: vi.fn() },
      { url: `/api/v1/ws?ticket=${ticket}` },
    );
    await new Promise((r) => setImmediate(r));
    expect(sock2Close).toHaveBeenCalledWith(4001, 'Invalid ticket');
  });

  it('closes with 4001 when ticket is an empty string in URL (treated as missing)', async () => {
    const app = buildMockApp();
    await setupWebSocket(app as any);
    const wsHandler = app.getWsHandler()!;
    const mockClose = vi.fn();
    // Empty ticket string is falsy → treated as missing
    wsHandler({ close: mockClose, readyState: 1, ping: vi.fn(), on: vi.fn() }, { url: '/api/v1/ws?ticket=' });
    await new Promise((r) => setImmediate(r));
    // Empty string ticket is falsy — service closes with "Missing ticket"
    expect(mockClose).toHaveBeenCalledWith(4001, 'Missing ticket');
  });
});
