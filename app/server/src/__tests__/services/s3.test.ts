import { describe, it, expect, vi, afterEach } from 'vitest';

// We test the pure utility functions that don't require AWS SDK (local mode).
// For the presigned URL path, we test the local mode branch.

describe('validateFileUpload()', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns valid=true for .stl files', async () => {
    vi.resetModules();
    const { validateFileUpload } = await import('../../services/s3.js');
    expect(validateFileUpload('model.stl')).toEqual({ valid: true });
  });

  it('returns valid=true for .3mf files', async () => {
    vi.resetModules();
    const { validateFileUpload } = await import('../../services/s3.js');
    expect(validateFileUpload('model.3mf')).toEqual({ valid: true });
  });

  it('returns valid=true for .obj files', async () => {
    vi.resetModules();
    const { validateFileUpload } = await import('../../services/s3.js');
    expect(validateFileUpload('model.obj')).toEqual({ valid: true });
  });

  it('returns valid=false for .pdf files', async () => {
    vi.resetModules();
    const { validateFileUpload } = await import('../../services/s3.js');
    const result = validateFileUpload('document.pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.pdf');
    expect(result.error).toContain('not supported');
  });

  it('returns valid=false for .exe files', async () => {
    vi.resetModules();
    const { validateFileUpload } = await import('../../services/s3.js');
    const result = validateFileUpload('malware.exe');
    expect(result.valid).toBe(false);
  });

  it('returns valid=false for .png files', async () => {
    vi.resetModules();
    const { validateFileUpload } = await import('../../services/s3.js');
    const result = validateFileUpload('image.png');
    expect(result.valid).toBe(false);
  });

  it('error message lists the allowed extensions', async () => {
    vi.resetModules();
    const { validateFileUpload } = await import('../../services/s3.js');
    const result = validateFileUpload('file.txt');
    expect(result.error).toContain('.stl');
    expect(result.error).toContain('.3mf');
    expect(result.error).toContain('.obj');
  });

  it('is case-insensitive for extensions', async () => {
    vi.resetModules();
    const { validateFileUpload } = await import('../../services/s3.js');
    expect(validateFileUpload('MODEL.STL')).toEqual({ valid: true });
    expect(validateFileUpload('MODEL.OBJ')).toEqual({ valid: true });
  });

  it('handles filenames with multiple dots correctly', async () => {
    vi.resetModules();
    const { validateFileUpload } = await import('../../services/s3.js');
    expect(validateFileUpload('my.cool.model.stl')).toEqual({ valid: true });
    const bad = validateFileUpload('my.stl.exe');
    expect(bad.valid).toBe(false);
  });
});

describe('generateFileKey()', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns a key with users/{userId}/models/{uuid}/original{ext} pattern', async () => {
    vi.resetModules();
    const { generateFileKey } = await import('../../services/s3.js');
    const key = generateFileKey('user-abc', 'model.stl');
    expect(key).toMatch(/^users\/user-abc\/models\/[0-9a-f-]+\/original\.stl$/);
  });

  it('preserves the file extension', async () => {
    vi.resetModules();
    const { generateFileKey } = await import('../../services/s3.js');
    expect(generateFileKey('u1', 'thing.3mf')).toMatch(/\.3mf$/);
    expect(generateFileKey('u1', 'thing.obj')).toMatch(/\.obj$/);
  });

  it('lowercases the extension', async () => {
    vi.resetModules();
    const { generateFileKey } = await import('../../services/s3.js');
    const key = generateFileKey('u1', 'MODEL.STL');
    expect(key).toMatch(/\.stl$/);
  });

  it('generates unique keys for the same user and filename', async () => {
    vi.resetModules();
    const { generateFileKey } = await import('../../services/s3.js');
    const k1 = generateFileKey('user-1', 'model.stl');
    const k2 = generateFileKey('user-1', 'model.stl');
    expect(k1).not.toBe(k2);
  });

  it('includes the userId in the key path', async () => {
    vi.resetModules();
    const { generateFileKey } = await import('../../services/s3.js');
    const key = generateFileKey('user-xyz', 'model.stl');
    expect(key).toContain('user-xyz');
  });
});

describe('generatePresignedUploadUrl() — local mode', () => {
  afterEach(() => {
    delete process.env.STORAGE_MODE;
    vi.resetModules();
  });

  it('returns local mode URL when STORAGE_MODE is not "s3"', async () => {
    delete process.env.STORAGE_MODE;
    vi.resetModules();
    const { generatePresignedUploadUrl } = await import('../../services/s3.js');
    const result = await generatePresignedUploadUrl('user-1', 'model.stl');
    expect(result.mode).toBe('local');
    expect(result.uploadUrl).toContain('/api/v1/uploads/file');
    expect(result.uploadUrl).toContain('key=');
  });

  it('includes the fileKey in the local upload URL', async () => {
    delete process.env.STORAGE_MODE;
    vi.resetModules();
    const { generatePresignedUploadUrl } = await import('../../services/s3.js');
    const result = await generatePresignedUploadUrl('user-1', 'model.stl');
    // fileKey should be URL-encoded in the query string
    const urlKey = decodeURIComponent(result.uploadUrl.split('key=')[1]);
    expect(urlKey).toBe(result.fileKey);
  });

  it('returns a fileKey that matches the expected path pattern', async () => {
    delete process.env.STORAGE_MODE;
    vi.resetModules();
    const { generatePresignedUploadUrl } = await import('../../services/s3.js');
    const result = await generatePresignedUploadUrl('user-abc', 'thing.obj');
    expect(result.fileKey).toMatch(/^users\/user-abc\/models\/.+\/original\.obj$/);
  });
});

describe('MAX_FILE_SIZE and ALLOWED_EXTENSIONS constants', () => {
  it('MAX_FILE_SIZE is 50MB', async () => {
    vi.resetModules();
    const { MAX_FILE_SIZE } = await import('../../services/s3.js');
    expect(MAX_FILE_SIZE).toBe(50 * 1024 * 1024);
  });

  it('ALLOWED_EXTENSIONS includes .stl, .3mf, .obj', async () => {
    vi.resetModules();
    const { ALLOWED_EXTENSIONS } = await import('../../services/s3.js');
    expect(ALLOWED_EXTENSIONS).toContain('.stl');
    expect(ALLOWED_EXTENSIONS).toContain('.3mf');
    expect(ALLOWED_EXTENSIONS).toContain('.obj');
  });

  it('ALLOWED_EXTENSIONS does not include .pdf or other common formats', async () => {
    vi.resetModules();
    const { ALLOWED_EXTENSIONS } = await import('../../services/s3.js');
    expect(ALLOWED_EXTENSIONS).not.toContain('.pdf');
    expect(ALLOWED_EXTENSIONS).not.toContain('.png');
    expect(ALLOWED_EXTENSIONS).not.toContain('.jpg');
  });
});
