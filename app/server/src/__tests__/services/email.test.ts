import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @sendgrid/mail before importing email module
const mockSgSend = vi.fn();
vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: vi.fn(),
    send: mockSgSend,
  },
}));

// jsonwebtoken is used as-is (real implementation) for token tests

describe('email service — mock mode (no SENDGRID_API_KEY)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENDGRID_API_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sendEmail() logs to console in mock mode', async () => {
    const { sendEmail } = await import('../../services/email.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({
      to: 'test@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      category: 'bids',
      userId: 'user-1',
      userPrefs: {},
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[MOCK EMAIL]'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test@example.com'));
    consoleSpy.mockRestore();
  });

  it('sendEmail() logs unsubscribe URL in mock mode', async () => {
    const { sendEmail } = await import('../../services/email.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>body</p>',
      category: 'orders',
      userId: 'user-2',
      userPrefs: {},
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unsubscribe'));
    consoleSpy.mockRestore();
  });

  it('sendEmail() skips send and logs when pref is false', async () => {
    const { sendEmail } = await import('../../services/email.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({
      to: 'user@example.com',
      subject: 'Bid update',
      html: '<p>Bid</p>',
      category: 'bids',
      userId: 'user-3',
      userPrefs: { bids: false },
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('SKIPPED'));
    consoleSpy.mockRestore();
  });

  it('sendEmail() sends when pref is explicitly true', async () => {
    const { sendEmail } = await import('../../services/email.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({
      to: 'user@example.com',
      subject: 'Order update',
      html: '<p>Order</p>',
      category: 'orders',
      userId: 'user-4',
      userPrefs: { orders: true },
    });
    // Should NOT see SKIPPED — should see the regular mock log
    const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes('SKIPPED'))).toBe(false);
    expect(calls.some((c) => c.includes('[MOCK EMAIL] To:'))).toBe(true);
    consoleSpy.mockRestore();
  });

  it('sendEmail() sends when prefs is empty object (default allow-all)', async () => {
    const { sendEmail } = await import('../../services/email.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({
      to: 'x@x.com',
      subject: 'Test',
      html: '<p>x</p>',
      category: 'reviews',
      userId: 'user-5',
      userPrefs: {},
    });
    const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes('SKIPPED'))).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('email service — shouldSend behavior via sendEmail', () => {
  // We test shouldSend indirectly through sendEmail
  afterEach(() => {
    vi.resetModules();
  });

  it('skips when category key is false', async () => {
    delete process.env.SENDGRID_API_KEY;
    vi.resetModules();
    const { sendEmail } = await import('../../services/email.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({
      to: 'a@b.com',
      subject: 'msg',
      html: '<p></p>',
      category: 'marketing',
      userId: 'u',
      userPrefs: { marketing: false },
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('SKIPPED'));
    consoleSpy.mockRestore();
  });

  it('sends when prefs has unrelated keys set to false but category is true', async () => {
    delete process.env.SENDGRID_API_KEY;
    vi.resetModules();
    const { sendEmail } = await import('../../services/email.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendEmail({
      to: 'a@b.com',
      subject: 'msg',
      html: '<p></p>',
      category: 'bids',
      userId: 'u',
      userPrefs: { marketing: false, bids: true },
    });
    const calls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes('SKIPPED'))).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('generateUnsubscribeToken() / verifyUnsubscribeToken()', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    vi.resetModules();
  });

  it('generates a token that verifies successfully', async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import('../../services/email.js');
    const token = generateUnsubscribeToken('user-abc', 'bids');
    const result = verifyUnsubscribeToken(token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('user-abc');
    expect(result!.category).toBe('bids');
  });

  it('roundtrip works for different categories', async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import('../../services/email.js');
    for (const cat of ['bids', 'orders', 'messages', 'reviews', 'marketing', 'jobAlerts']) {
      const token = generateUnsubscribeToken('user-xyz', cat);
      const result = verifyUnsubscribeToken(token);
      expect(result).not.toBeNull();
      expect(result!.category).toBe(cat);
    }
  });

  it('returns null for a tampered token', async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import('../../services/email.js');
    const token = generateUnsubscribeToken('user-1', 'bids');
    // Tamper: flip last char
    const tampered = token.slice(0, -3) + 'xxx';
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it('returns null for a completely invalid token', async () => {
    const { verifyUnsubscribeToken } = await import('../../services/email.js');
    expect(verifyUnsubscribeToken('not.a.real.token')).toBeNull();
  });

  it('returns null for an empty string', async () => {
    const { verifyUnsubscribeToken } = await import('../../services/email.js');
    expect(verifyUnsubscribeToken('')).toBeNull();
  });

  it('returns null for a token signed with wrong secret', async () => {
    // Sign with a different secret
    const jwt = await import('jsonwebtoken');
    const badToken = jwt.default.sign(
      { userId: 'u', category: 'bids', type: 'unsubscribe' },
      'wrong-secret',
      { expiresIn: '30d' },
    );
    const { verifyUnsubscribeToken } = await import('../../services/email.js');
    expect(verifyUnsubscribeToken(badToken)).toBeNull();
  });

  it('returns null for a token with wrong type field', async () => {
    const jwt = await import('jsonwebtoken');
    const wrongTypeToken = jwt.default.sign(
      { userId: 'u', category: 'bids', type: 'login' }, // wrong type
      process.env.JWT_SECRET!,
      { expiresIn: '30d' },
    );
    const { verifyUnsubscribeToken } = await import('../../services/email.js');
    expect(verifyUnsubscribeToken(wrongTypeToken)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const jwt = await import('jsonwebtoken');
    // Sign with -1s expiry (already expired)
    const expiredToken = jwt.default.sign(
      { userId: 'u', category: 'bids', type: 'unsubscribe' },
      process.env.JWT_SECRET!,
      { expiresIn: -1 },
    );
    const { verifyUnsubscribeToken } = await import('../../services/email.js');
    expect(verifyUnsubscribeToken(expiredToken)).toBeNull();
  });
});

describe('email service — real mode (SENDGRID_API_KEY set)', () => {
  beforeEach(() => {
    process.env.SENDGRID_API_KEY = 'SG.fake-key';
    process.env.JWT_SECRET = 'test-secret';
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SENDGRID_API_KEY;
    delete process.env.JWT_SECRET;
    vi.resetModules();
  });

  it('sendEmail() calls sgMail.send when API key is set and pref allows', async () => {
    mockSgSend.mockResolvedValueOnce([{ statusCode: 202 }]);
    const { sendEmail } = await import('../../services/email.js');
    await sendEmail({
      to: 'real@example.com',
      subject: 'Real email',
      html: '<p>body</p>',
      category: 'bids',
      userId: 'user-real',
      userPrefs: {},
    });
    expect(mockSgSend).toHaveBeenCalledTimes(1);
    const arg = mockSgSend.mock.calls[0][0];
    expect(arg.to).toBe('real@example.com');
    expect(arg.subject).toBe('Real email');
    expect(arg.html).toContain('<p>body</p>');
    expect(arg.html).toContain('Unsubscribe');
  });

  it('sendEmail() includes List-Unsubscribe header', async () => {
    mockSgSend.mockResolvedValueOnce([{ statusCode: 202 }]);
    const { sendEmail } = await import('../../services/email.js');
    await sendEmail({
      to: 'real@example.com',
      subject: 'Test',
      html: '<p>test</p>',
      category: 'orders',
      userId: 'user-real',
      userPrefs: {},
    });
    const arg = mockSgSend.mock.calls[0][0];
    expect(arg.headers['List-Unsubscribe']).toBeDefined();
    expect(arg.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('sendEmail() does NOT call sgMail.send when pref is false', async () => {
    const { sendEmail } = await import('../../services/email.js');
    await sendEmail({
      to: 'real@example.com',
      subject: 'Blocked',
      html: '<p>body</p>',
      category: 'marketing',
      userId: 'user-real',
      userPrefs: { marketing: false },
    });
    expect(mockSgSend).not.toHaveBeenCalled();
  });
});
