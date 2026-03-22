import crypto from 'crypto';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const USE_LOCAL_STORAGE = !IS_PRODUCTION;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_EXTENSIONS = ['.stl', '.3mf', '.obj'];

export function validateFileUpload(fileName: string): { valid: boolean; error?: string } {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `File type ${ext} not supported. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
  }
  return { valid: true };
}

export function generateFileKey(userId: string, fileName: string): string {
  const fileId = crypto.randomUUID();
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  return `users/${userId}/models/${fileId}/original${ext}`;
}

export async function generatePresignedUploadUrl(
  userId: string,
  fileName: string,
): Promise<{ uploadUrl: string; fileKey: string; mode: 's3' | 'local' }> {
  const fileKey = generateFileKey(userId, fileName);

  if (!USE_LOCAL_STORAGE) {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const s3 = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      ...(process.env.S3_ENDPOINT && {
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: true,
      }),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
    });

    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: fileKey,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    return { uploadUrl, fileKey, mode: 's3' };
  }

  // Local mode: client will POST to /api/v1/uploads/file
  return { uploadUrl: `/api/v1/uploads/file?key=${encodeURIComponent(fileKey)}`, fileKey, mode: 'local' };
}

export { MAX_FILE_SIZE, ALLOWED_EXTENSIONS, USE_LOCAL_STORAGE };
