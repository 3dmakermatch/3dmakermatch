import { Queue, Worker, type Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';

const connection = {
  host: process.env.REDIS_URL?.replace('redis://', '').split(':')[0] || 'localhost',
  port: Number(process.env.REDIS_URL?.split(':').pop()) || 6379,
};

export const fileProcessingQueue = new Queue('file-processing', { connection });

interface FileProcessingJob {
  jobId: string;
  fileKey: string;
  fileName: string;
}

interface FileMetadata {
  fileName: string;
  fileSize: number;
  dimensions: { x: number; y: number; z: number };
  volumeCm3: number;
  polygonCount: number;
  isManifold: boolean;
  printabilityScore: number;
}

function estimateMetadataFromFileName(fileName: string): FileMetadata {
  // In production, this would use manifold-3d WASM to validate the mesh,
  // ADMesh for repair, and extract real geometry data.
  // For MVP, we provide placeholder metadata that will be replaced
  // when the file processing pipeline is fully implemented.
  return {
    fileName,
    fileSize: 0,
    dimensions: { x: 0, y: 0, z: 0 },
    volumeCm3: 0,
    polygonCount: 0,
    isManifold: true,
    printabilityScore: 80,
  };
}

export function startFileProcessingWorker(prisma: PrismaClient) {
  const worker = new Worker<FileProcessingJob>(
    'file-processing',
    async (job: Job<FileProcessingJob>) => {
      const { jobId, fileKey, fileName } = job.data;

      job.log(`Processing file: ${fileName} (key: ${fileKey})`);

      try {
        // Step 1: Generate metadata
        // TODO: Download from S3, run manifold-3d WASM validation,
        //       ADMesh repair, extract real dimensions/volume
        const metadata = estimateMetadataFromFileName(fileName);

        // Step 2: Update the print job with metadata
        await prisma.printJob.update({
          where: { id: jobId },
          data: {
            fileMetadata: metadata as any,
            status: 'bidding',
          },
        });

        job.log('File processing complete');
        return { success: true, metadata };
      } catch (error) {
        job.log(`Processing failed: ${error}`);

        await prisma.printJob.update({
          where: { id: jobId },
          data: { status: 'draft' },
        });

        throw error;
      }
    },
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    console.log(`File processing completed for job ${job.data.jobId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`File processing failed for job ${job?.data.jobId}:`, err.message);
  });

  return worker;
}
