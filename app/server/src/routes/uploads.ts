import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { generatePresignedUploadUrl, validateFileUpload } from '../services/s3.js';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const presignSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().min(1).max(MAX_FILE_SIZE, {
    message: 'File size exceeds 50MB limit',
  }),
});

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

export async function uploadRoutes(app: FastifyInstance) {
  // Get presigned upload URL (or local upload URL)
  app.post('/presign', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const body = presignSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const { fileName } = body.data;

      const validation = validateFileUpload(fileName);
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.error, code: 400 });
      }

      const result = await generatePresignedUploadUrl(request.userId!, fileName);

      return {
        uploadUrl: result.uploadUrl,
        fileKey: result.fileKey,
        mode: result.mode,
        maxSize: MAX_FILE_SIZE,
        expiresIn: 900,
      };
    },
  });

  // Local file upload endpoint (used when S3 is not configured)
  app.post('/file', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const fileKey = (request.query as { key?: string }).key;
      if (!fileKey) {
        return reply.status(400).send({ error: 'Missing file key', code: 400 });
      }

      const contentType = request.headers['content-type'] || '';
      const rawBody = request.body;

      if (!rawBody) {
        return reply.status(400).send({ error: 'No file data received', code: 400 });
      }

      const filePath = path.join(UPLOAD_DIR, fileKey);
      const dir = path.dirname(filePath);
      await mkdir(dir, { recursive: true });

      // rawBody is a Buffer when content-type is not JSON
      if (Buffer.isBuffer(rawBody)) {
        if (rawBody.length > MAX_FILE_SIZE) {
          return reply.status(400).send({ error: 'File size exceeds 50MB limit', code: 400 });
        }
        await writeFile(filePath, rawBody);
      } else {
        return reply.status(400).send({ error: 'Expected binary file data', code: 400 });
      }

      return { success: true, fileKey };
    },
  });
}
