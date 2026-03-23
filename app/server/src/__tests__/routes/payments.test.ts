import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp, cleanDatabase, disconnectPrisma } from '../helpers/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await disconnectPrisma();
});

beforeEach(async () => {
  await cleanDatabase();
});

// ---------------------------------------------------------------------------
// POST /api/v1/payments/webhook — Stripe webhook
// ---------------------------------------------------------------------------
describe('POST /api/v1/payments/webhook', () => {
  it('returns 400 when raw body is missing', async () => {
    // In mock mode, verifyWebhookSignature returns null, but first rawBody check fires
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: { 'stripe-signature': 'test-sig', 'content-type': 'application/json' },
      payload: { type: 'payment_intent.succeeded' },
    });

    // Either 400 (missing raw body / invalid sig in mock mode) is expected
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid or missing stripe-signature in mock mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'payment_intent.succeeded' }),
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/payments/simulate-webhook — Mock webhook simulation
// ---------------------------------------------------------------------------
describe('POST /api/v1/payments/simulate-webhook', () => {
  it('returns 200 and simulated event type in mock mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/simulate-webhook',
      payload: {
        eventType: 'payment_intent.succeeded',
        data: { id: 'pi_test_123', amount: 5000 },
      },
    });

    // Route only exists when isMockStripe() is true (no STRIPE_SECRET_KEY in test env)
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.simulated).toBe(true);
    expect(body.eventType).toBe('payment_intent.succeeded');
  });

  it('returns simulated event for charge.refunded event type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/simulate-webhook',
      payload: {
        eventType: 'charge.refunded',
        data: { id: 'ch_test_456' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().eventType).toBe('charge.refunded');
  });
});
