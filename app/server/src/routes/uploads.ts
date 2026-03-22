import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { generatePresignedUploadUrl, validateFileUpload } from '../services/s3.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const presignSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().min(1).max(MAX_FILE_SIZE, {
    message: `File size exceeds 50MB limit`,
  }),
});

export async function uploadRoutes(app: FastifyInstance) {
  // Get presigned upload URL
  app.post('/presign', {
    preHandler: [authenticate],
    handler: async (request, reply) => {
      const body = presignSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.issues[0].message, code: 400 });
      }

      const { fileName, fileSize } = body.data;

      const validation = validateFileUpload(fileName);
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.error, code: 400 });
      }

      const { uploadUrl, fileKey } = await generatePresignedUploadUrl(
        request.userId!,
        fileName,
      );

      return {
        uploadUrl,
        fileKey,
        maxSize: 50 * 1024 * 1024,
        expiresIn: 900,
      };
    },
  });
}
