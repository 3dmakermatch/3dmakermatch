import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Stripe SDK mock ────────────────────────────────────────────────────────────
// Must use function (not arrow) so `new Stripe(key)` works as a constructor.
const mockAccountsCreate = vi.fn();
const mockAccountLinksCreate = vi.fn();
const mockPaymentIntentsCreate = vi.fn();
const mockTransfersCreate = vi.fn();
const mockRefundsCreate = vi.fn();
const mockWebhooksConstructEvent = vi.fn();

function MockStripe(this: any) {
  this.accounts = { create: mockAccountsCreate };
  this.accountLinks = { create: mockAccountLinksCreate };
  this.paymentIntents = { create: mockPaymentIntentsCreate };
  this.transfers = { create: mockTransfersCreate };
  this.refunds = { create: mockRefundsCreate };
  this.webhooks = { constructEvent: mockWebhooksConstructEvent };
}

vi.mock('stripe', () => ({ default: MockStripe }));

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('stripe service — mock mode (no STRIPE_SECRET_KEY)', () => {
  // env var is NOT set in this module scope — module is loaded once at import time,
  // so we test both modes by resetting the module registry.

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure key is absent for mock-mode tests
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('isMockStripe() returns true when STRIPE_SECRET_KEY is absent', async () => {
    vi.resetModules();
    const { isMockStripe } = await import('../../services/stripe.js');
    expect(isMockStripe()).toBe(true);
  });

  it('createConnectAccount() returns mock accountId and onboardingUrl', async () => {
    vi.resetModules();
    const { createConnectAccount } = await import('../../services/stripe.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await createConnectAccount('printer-abc123', 'test@example.com');
    expect(result.accountId).toMatch(/^acct_mock_/);
    expect(result.onboardingUrl).toBe('/printers/stripe/callback?mock=true');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[MOCK STRIPE]'));
    consoleSpy.mockRestore();
  });

  it('createConnectAccount() uses first 8 chars of printerId in mock accountId', async () => {
    vi.resetModules();
    const { createConnectAccount } = await import('../../services/stripe.js');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await createConnectAccount('abcdefgh-rest', 'x@x.com');
    expect(result.accountId).toBe('acct_mock_abcdefgh');
  });

  it('createPaymentIntent() returns mock clientSecret and paymentIntentId', async () => {
    vi.resetModules();
    const { createPaymentIntent } = await import('../../services/stripe.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await createPaymentIntent(1000, 100, 'acct_printer');
    expect(result.paymentIntentId).toMatch(/^pi_mock_/);
    expect(result.clientSecret).toMatch(/_secret_mock$/);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[MOCK STRIPE]'));
    consoleSpy.mockRestore();
  });

  it('createPaymentIntent() logs correct amounts', async () => {
    vi.resetModules();
    const { createPaymentIntent } = await import('../../services/stripe.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createPaymentIntent(2000, 200, 'acct_x');
    // total = 2200 cents = $22.00, fee = 200 cents = $2.00
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('$22.00'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('$2.00'));
    consoleSpy.mockRestore();
  });

  it('createTransfer() logs and returns void', async () => {
    vi.resetModules();
    const { createTransfer } = await import('../../services/stripe.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await createTransfer(500, 'acct_dest', 'order-1');
    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[MOCK STRIPE]'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('$5.00'));
    consoleSpy.mockRestore();
  });

  it('createRefund() logs full refund when no amount', async () => {
    vi.resetModules();
    const { createRefund } = await import('../../services/stripe.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createRefund('pi_abc');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('full'));
    consoleSpy.mockRestore();
  });

  it('createRefund() logs partial amount when provided', async () => {
    vi.resetModules();
    const { createRefund } = await import('../../services/stripe.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createRefund('pi_abc', 300);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('$3.00'));
    consoleSpy.mockRestore();
  });

  it('verifyWebhookSignature() returns null in mock mode', async () => {
    vi.resetModules();
    const { verifyWebhookSignature } = await import('../../services/stripe.js');
    const result = verifyWebhookSignature('payload', 'sig');
    expect(result).toBeNull();
  });
});

describe('stripe service — real mode (STRIPE_SECRET_KEY set)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
    process.env.CLIENT_URL = 'https://app.example.com';
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.CLIENT_URL;
    vi.resetModules();
  });

  it('isMockStripe() returns false when STRIPE_SECRET_KEY is set', async () => {
    vi.resetModules();
    const { isMockStripe } = await import('../../services/stripe.js');
    expect(isMockStripe()).toBe(false);
  });

  it('createConnectAccount() calls stripe.accounts.create and accountLinks.create', async () => {
    vi.resetModules();
    mockAccountsCreate.mockResolvedValueOnce({ id: 'acct_real' });
    mockAccountLinksCreate.mockResolvedValueOnce({ url: 'https://connect.stripe.com/onboard' });
    const { createConnectAccount } = await import('../../services/stripe.js');
    const result = await createConnectAccount('printer-1', 'real@example.com');
    expect(result.accountId).toBe('acct_real');
    expect(result.onboardingUrl).toBe('https://connect.stripe.com/onboard');
    expect(mockAccountsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'express', email: 'real@example.com' }),
    );
  });

  it('createPaymentIntent() calls stripe.paymentIntents.create', async () => {
    vi.resetModules();
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: 'pi_real',
      client_secret: 'pi_real_secret',
    });
    const { createPaymentIntent } = await import('../../services/stripe.js');
    const result = await createPaymentIntent(1000, 100, 'acct_printer');
    expect(result.paymentIntentId).toBe('pi_real');
    expect(result.clientSecret).toBe('pi_real_secret');
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1100, currency: 'usd' }),
    );
  });

  it('createTransfer() calls stripe.transfers.create', async () => {
    vi.resetModules();
    mockTransfersCreate.mockResolvedValueOnce({});
    const { createTransfer } = await import('../../services/stripe.js');
    await createTransfer(900, 'acct_dest', 'order-99');
    expect(mockTransfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 900, destination: 'acct_dest', metadata: { orderId: 'order-99' } }),
    );
  });

  it('createRefund() calls stripe.refunds.create without amount when omitted', async () => {
    vi.resetModules();
    mockRefundsCreate.mockResolvedValueOnce({});
    const { createRefund } = await import('../../services/stripe.js');
    await createRefund('pi_test');
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_test' }),
    );
    const callArg = mockRefundsCreate.mock.calls[0][0];
    expect(callArg.amount).toBeUndefined();
  });

  it('createRefund() passes amount when provided', async () => {
    vi.resetModules();
    mockRefundsCreate.mockResolvedValueOnce({});
    const { createRefund } = await import('../../services/stripe.js');
    await createRefund('pi_test', 500);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500 }),
    );
  });

  it('verifyWebhookSignature() delegates to stripe.webhooks.constructEvent', async () => {
    vi.resetModules();
    const fakeEvent = { type: 'payment_intent.succeeded' };
    mockWebhooksConstructEvent.mockReturnValueOnce(fakeEvent);
    const { verifyWebhookSignature } = await import('../../services/stripe.js');
    const result = verifyWebhookSignature('payload', 'sig');
    expect(result).toBe(fakeEvent);
    expect(mockWebhooksConstructEvent).toHaveBeenCalledWith('payload', 'sig', 'whsec_fake');
  });

  it('verifyWebhookSignature() returns null when STRIPE_WEBHOOK_SECRET is missing', async () => {
    vi.resetModules();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { verifyWebhookSignature } = await import('../../services/stripe.js');
    const result = verifyWebhookSignature('payload', 'sig');
    expect(result).toBeNull();
  });
});
