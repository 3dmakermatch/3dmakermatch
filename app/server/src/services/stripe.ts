import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const IS_MOCK = !STRIPE_SECRET_KEY;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

export function isMockStripe(): boolean {
  return IS_MOCK;
}

export async function createConnectAccount(printerId: string, email: string): Promise<{ accountId: string; onboardingUrl: string }> {
  if (IS_MOCK) {
    const mockId = `acct_mock_${printerId.slice(0, 8)}`;
    console.log(`[MOCK STRIPE] Created Connect account ${mockId} for ${email}`);
    return { accountId: mockId, onboardingUrl: `/printers/stripe/callback?mock=true` };
  }
  const account = await stripe!.accounts.create({ type: 'express', email, capabilities: { card_payments: { requested: true }, transfers: { requested: true } } });
  const link = await stripe!.accountLinks.create({ account: account.id, refresh_url: `${process.env.CLIENT_URL}/printers/stripe/callback?refresh=true`, return_url: `${process.env.CLIENT_URL}/printers/stripe/callback`, type: 'account_onboarding' });
  return { accountId: account.id, onboardingUrl: link.url };
}

export async function createPaymentIntent(amountCents: number, platformFeeCents: number, printerAccountId: string): Promise<{ clientSecret: string; paymentIntentId: string }> {
  if (IS_MOCK) {
    const mockId = `pi_mock_${Date.now()}`;
    console.log(`[MOCK STRIPE] PaymentIntent $${((amountCents + platformFeeCents) / 100).toFixed(2)} (fee: $${(platformFeeCents / 100).toFixed(2)})`);
    return { clientSecret: `${mockId}_secret_mock`, paymentIntentId: mockId };
  }
  const intent = await stripe!.paymentIntents.create({ amount: amountCents + platformFeeCents, currency: 'usd', application_fee_amount: platformFeeCents, transfer_data: { destination: printerAccountId } });
  return { clientSecret: intent.client_secret!, paymentIntentId: intent.id };
}

export async function createTransfer(amountCents: number, printerAccountId: string, orderId: string): Promise<void> {
  if (IS_MOCK) { console.log(`[MOCK STRIPE] Transfer $${(amountCents / 100).toFixed(2)} to ${printerAccountId} for order ${orderId}`); return; }
  await stripe!.transfers.create({ amount: amountCents, currency: 'usd', destination: printerAccountId, metadata: { orderId } });
}

export async function createRefund(paymentIntentId: string, amountCents?: number): Promise<void> {
  if (IS_MOCK) { console.log(`[MOCK STRIPE] Refund ${amountCents ? `$${(amountCents / 100).toFixed(2)}` : 'full'} for ${paymentIntentId}`); return; }
  await stripe!.refunds.create({ payment_intent: paymentIntentId, ...(amountCents && { amount: amountCents }) });
}

export function verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event | null {
  if (IS_MOCK) return null;
  if (!STRIPE_WEBHOOK_SECRET) return null;
  return stripe!.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
}
