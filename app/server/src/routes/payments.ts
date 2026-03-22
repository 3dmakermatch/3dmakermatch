import { FastifyInstance } from 'fastify';
import { verifyWebhookSignature, isMockStripe } from '../services/stripe.js';

export async function paymentWebhookRoutes(app: FastifyInstance) {
  app.post('/webhook', {
    config: { rawBody: true },
    handler: async (request, reply) => {
      const sig = request.headers['stripe-signature'] as string;
      const rawBody = request.rawBody;
      if (!rawBody) return reply.status(400).send({ error: 'Missing raw body' });
      const event = verifyWebhookSignature(rawBody, sig);
      if (!event) return reply.status(400).send({ error: 'Invalid signature' });
      if (event.type === 'payment_intent.succeeded') {
        app.log.info(`Payment succeeded: ${(event.data.object as any).id}`);
      }
      return { received: true };
    },
  });

  if (isMockStripe()) {
    app.post('/simulate-webhook', {
      handler: async (request, reply) => {
        const { eventType, data } = request.body as { eventType: string; data: Record<string, unknown> };
        app.log.info(`[MOCK WEBHOOK] ${eventType}: ${JSON.stringify(data)}`);
        return { simulated: true, eventType };
      },
    });
  }
}
