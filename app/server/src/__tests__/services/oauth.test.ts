import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// oauth.ts reads env vars at module load time, so we use vi.resetModules() + dynamic import.

describe('isGoogleOAuthConfigured()', () => {
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.resetModules();
  });

  it('returns false when neither env var is set', async () => {
    vi.resetModules();
    const { isGoogleOAuthConfigured } = await import('../../services/oauth.js');
    expect(isGoogleOAuthConfigured()).toBe(false);
  });

  it('returns false when only GOOGLE_CLIENT_ID is set', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    vi.resetModules();
    const { isGoogleOAuthConfigured } = await import('../../services/oauth.js');
    expect(isGoogleOAuthConfigured()).toBe(false);
  });

  it('returns false when only GOOGLE_CLIENT_SECRET is set', async () => {
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    vi.resetModules();
    const { isGoogleOAuthConfigured } = await import('../../services/oauth.js');
    expect(isGoogleOAuthConfigured()).toBe(false);
  });

  it('returns true when both env vars are set', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    vi.resetModules();
    const { isGoogleOAuthConfigured } = await import('../../services/oauth.js');
    expect(isGoogleOAuthConfigured()).toBe(true);
  });
});

describe('getGoogleAuthUrl()', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.resetModules();
  });

  it('returns a URL starting with Google auth endpoint', async () => {
    const { getGoogleAuthUrl } = await import('../../services/oauth.js');
    const url = getGoogleAuthUrl('https://app.example.com/callback');
    expect(url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  });

  it('includes client_id param', async () => {
    const { getGoogleAuthUrl } = await import('../../services/oauth.js');
    const url = getGoogleAuthUrl('https://app.example.com/callback');
    expect(url).toContain('client_id=test-client-id');
  });

  it('includes redirect_uri param', async () => {
    const { getGoogleAuthUrl } = await import('../../services/oauth.js');
    const url = getGoogleAuthUrl('https://app.example.com/callback');
    expect(url).toContain(encodeURIComponent('https://app.example.com/callback'));
  });

  it('includes response_type=code', async () => {
    const { getGoogleAuthUrl } = await import('../../services/oauth.js');
    const url = getGoogleAuthUrl('https://app.example.com/callback');
    expect(url).toContain('response_type=code');
  });

  it('includes scope with openid email profile', async () => {
    const { getGoogleAuthUrl } = await import('../../services/oauth.js');
    const url = getGoogleAuthUrl('https://app.example.com/callback');
    expect(url).toContain('scope=');
    // URLSearchParams encodes spaces as +; parse via URLSearchParams to decode
    const parsed = new URLSearchParams(url.split('?')[1]);
    expect(parsed.get('scope')).toContain('openid');
    expect(parsed.get('scope')).toContain('email');
    expect(parsed.get('scope')).toContain('profile');
  });

  it('includes access_type=offline', async () => {
    const { getGoogleAuthUrl } = await import('../../services/oauth.js');
    const url = getGoogleAuthUrl('https://app.example.com/callback');
    expect(url).toContain('access_type=offline');
  });

  it('includes prompt=select_account', async () => {
    const { getGoogleAuthUrl } = await import('../../services/oauth.js');
    const url = getGoogleAuthUrl('https://app.example.com/callback');
    expect(url).toContain('prompt=select_account');
  });
});

describe('exchangeCodeForTokens()', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.resetModules();
  });

  it('returns tokens on successful exchange', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'acc_tok', id_token: 'id_tok' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { exchangeCodeForTokens } = await import('../../services/oauth.js');
    const result = await exchangeCodeForTokens('auth-code', 'https://app.example.com/callback');
    expect(result.access_token).toBe('acc_tok');
    expect(result.id_token).toBe('id_tok');

    vi.unstubAllGlobals();
  });

  it('POSTs to the correct token endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'a', id_token: 'b' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { exchangeCodeForTokens } = await import('../../services/oauth.js');
    await exchangeCodeForTokens('code123', 'https://redirect.example.com');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      text: async () => 'invalid_grant',
    });
    vi.stubGlobal('fetch', mockFetch);

    const { exchangeCodeForTokens } = await import('../../services/oauth.js');
    await expect(exchangeCodeForTokens('bad-code', 'https://redirect')).rejects.toThrow(
      'Google token exchange failed',
    );

    vi.unstubAllGlobals();
  });

  it('includes grant_type=authorization_code in body', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'a', id_token: 'b' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { exchangeCodeForTokens } = await import('../../services/oauth.js');
    await exchangeCodeForTokens('code', 'https://redirect');
    const body = mockFetch.mock.calls[0][1].body as string;
    expect(body).toContain('grant_type=authorization_code');

    vi.unstubAllGlobals();
  });
});

describe('getGoogleUserInfo()', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.resetModules();
  });

  it('returns user info on success', async () => {
    const mockUserInfo = {
      sub: 'google-uid-123',
      email: 'user@example.com',
      name: 'Test User',
      email_verified: true,
    };
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockUserInfo,
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getGoogleUserInfo } = await import('../../services/oauth.js');
    const result = await getGoogleUserInfo('access-token-abc');
    expect(result.sub).toBe('google-uid-123');
    expect(result.email).toBe('user@example.com');
    expect(result.name).toBe('Test User');
    expect(result.email_verified).toBe(true);

    vi.unstubAllGlobals();
  });

  it('sends Authorization Bearer header', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub: 's', email: 'e', name: 'n', email_verified: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getGoogleUserInfo } = await import('../../services/oauth.js');
    await getGoogleUserInfo('my-token');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      expect.objectContaining({ headers: { Authorization: 'Bearer my-token' } }),
    );

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      text: async () => 'Unauthorized',
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getGoogleUserInfo } = await import('../../services/oauth.js');
    await expect(getGoogleUserInfo('bad-token')).rejects.toThrow('Google userinfo fetch failed');

    vi.unstubAllGlobals();
  });
});
