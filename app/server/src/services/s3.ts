import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  ...(process.env.S3_ENDPOINT && {
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
  }),
  ...(process.env.S3_ACCESS_KEY && {
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  }),
});

const BUCKET = process.env.S3_BUCKET || 'printbid-data';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_EXTENSIONS = ['.stl', '.3mf', '.obj'];

export function validateFileUpload(fileName: string): { valid: boolean; error?: string } {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `File type ${ext} not supported. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
  }
  return { valid: true };
}

export async function generatePresignedUploadUrl(
  userId: string,
  fileName: string,
): Promise<{ uploadUrl: string; fileKey: string }> {
  const fileId = crypto.randomUUID();
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  const fileKey = `users/${userId}/models/${fileId}/original${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: fileKey,
    ContentType: getContentType(ext),
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 }); // 15 min

  return { uploadUrl, fileKey };
}

export async function generatePresignedDownloadUrl(fileKey: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: fileKey,
  });

  return getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour
}

function getContentType(ext: string): string {
  switch (ext) {
    case '.stl': return 'model/stl';
    case '.3mf': return 'model/3mf';
    case '.obj': return 'text/plain';
    default: return 'application/octet-stream';
  }
}

export { MAX_FILE_SIZE, ALLOWED_EXTENSIONS };
