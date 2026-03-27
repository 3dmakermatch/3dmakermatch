import { describe, it, expect, vi, afterEach } from 'vitest';
import { geocodeAddress } from '../../services/geocoding.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geocodeAddress()', () => {
  it('returns lat/lng on successful response', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ lat: '37.7749', lon: '-122.4194' }],
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await geocodeAddress('San Francisco', 'CA');
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(37.7749);
    expect(result!.lng).toBeCloseTo(-122.4194);
  });

  it('calls the correct Nominatim URL with encoded query', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ lat: '40.7128', lon: '-74.0060' }],
    });
    vi.stubGlobal('fetch', mockFetch);

    await geocodeAddress('New York', 'NY');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('nominatim.openstreetmap.org/search');
    expect(url).toContain(encodeURIComponent('New York, NY, US'));
    expect(url).toContain('format=json');
    expect(url).toContain('limit=1');
  });

  it('sends correct User-Agent header', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ lat: '0', lon: '0' }],
    });
    vi.stubGlobal('fetch', mockFetch);

    await geocodeAddress('Austin', 'TX');
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['User-Agent']).toContain('3dMakerMatch');
  });

  it('returns null when results array is empty', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await geocodeAddress('Nonexistent City', 'XX');
    expect(result).toBeNull();
  });

  it('returns null and warns when HTTP response is not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
    });
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await geocodeAddress('Denver', 'CO');
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('429'));
    consoleSpy.mockRestore();
  });

  it('returns null and warns on network error (fetch throws)', async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Network failure'));
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await geocodeAddress('Seattle', 'WA');
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GEOCODING]'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('returns null on invalid/malformed JSON response (json() throws)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new Error('Invalid JSON'); },
    });
    vi.stubGlobal('fetch', mockFetch);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await geocodeAddress('Portland', 'OR');
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  it('parses lat/lng as floats (strings in API response)', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ lat: '33.4484', lon: '-112.0740' }],
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await geocodeAddress('Phoenix', 'AZ');
    expect(typeof result!.lat).toBe('number');
    expect(typeof result!.lng).toBe('number');
    expect(result!.lat).toBe(33.4484);
    expect(result!.lng).toBe(-112.074);
  });

  it('uses first result when multiple are returned', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { lat: '1.0', lon: '2.0' },
        { lat: '3.0', lon: '4.0' },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await geocodeAddress('Springfield', 'IL');
    expect(result!.lat).toBe(1.0);
    expect(result!.lng).toBe(2.0);
  });
});
