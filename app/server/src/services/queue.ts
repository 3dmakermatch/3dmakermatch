import { Queue, Worker, type Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { readFile, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { findMatchingPrinters } from './matching.js';
import { sendEmail } from './email.js';
import { jobAlertEmail } from './email-templates.js';
import { notifyUser } from './websocket.js';

const connection = {
  host: process.env.REDIS_URL?.replace('redis://', '').split(':')[0] || 'localhost',
  port: Number(process.env.REDIS_URL?.split(':').pop()) || 6379,
};

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

export const fileProcessingQueue = new Queue('file-processing', { connection });

export interface FileProcessingJob {
  jobId: string;
  fileId: string;
  fileKey: string;
  fileName: string;
}

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  dimensions: { x: number; y: number; z: number };
  volumeCm3: number;
  polygonCount: number;
  isManifold: boolean;
  printabilityScore: number;
}

// ── STL binary parser ────────────────────────────────────────────────────────
// Format: 80-byte header | uint32 triangle count | N × 50-byte triangles
// Each triangle: 12B normal + 3×12B vertices + 2B attribute
function parseStlBinary(buf: Buffer): FileMetadata {
  const triangleCount = buf.readUInt32LE(80);
  const expectedSize = 84 + triangleCount * 50;
  const isManifold = buf.length === expectedSize;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // skip normal
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(offset);
      const y = buf.readFloatLE(offset + 4);
      const z = buf.readFloatLE(offset + 8);
      offset += 12;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    offset += 2; // skip attribute byte count
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  // Convert mm to cm for volume
  const volumeCm3 = (dx / 10) * (dy / 10) * (dz / 10);

  return buildMetadata({
    fileName: '',
    fileSize: buf.length,
    dx, dy, dz,
    volumeCm3,
    polygonCount: triangleCount,
    isManifold,
  });
}

// ── STL ASCII parser ─────────────────────────────────────────────────────────
function parseStlAscii(text: string, fileSize: number): FileMetadata {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let triangleCount = 0;

  const vertexRe = /^\s*vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/m;
  const lines = text.split('\n');
  for (const line of lines) {
    const m = vertexRe.exec(line);
    if (m) {
      const x = parseFloat(m[1]);
      const y = parseFloat(m[2]);
      const z = parseFloat(m[3]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (line.trim().startsWith('facet normal')) triangleCount++;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const volumeCm3 = (dx / 10) * (dy / 10) * (dz / 10);

  return buildMetadata({
    fileName: '',
    fileSize,
    dx, dy, dz,
    volumeCm3,
    polygonCount: triangleCount,
    isManifold: true, // cannot easily verify for ASCII
  });
}

// ── OBJ parser ───────────────────────────────────────────────────────────────
function parseObj(text: string, fileSize: number): FileMetadata {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let faceCount = 0;

  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trimStart();
    if (t.startsWith('v ')) {
      const parts = t.slice(2).trim().split(/\s+/);
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      const z = parseFloat(parts[2]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    } else if (t.startsWith('f ')) {
      faceCount++;
    }
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const volumeCm3 = (dx / 10) * (dy / 10) * (dz / 10);

  return buildMetadata({
    fileName: '',
    fileSize,
    dx, dy, dz,
    volumeCm3,
    polygonCount: faceCount,
    isManifold: true,
  });
}

// ── 3MF parser (ZIP containing XML) ──────────────────────────────────────────
async function parse3mf(buf: Buffer, fileName: string): Promise<FileMetadata> {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buf);

  // Find the primary model file
  const modelEntry =
    zip.getEntry('3D/3dmodel.model') ||
    zip.getEntries().find((e) => e.entryName.endsWith('.model'));

  if (!modelEntry) {
    return buildMetadata({
      fileName,
      fileSize: buf.length,
      dx: 0, dy: 0, dz: 0,
      volumeCm3: 0,
      polygonCount: 0,
      isManifold: true,
    });
  }

  const xml = modelEntry.getData().toString('utf-8');

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let triangleCount = 0;

  // Parse vertices: <v x="..." y="..." z="..."/>
  const vertexRe = /<v\s[^>]*x="([-\d.eE+]+)"[^>]*y="([-\d.eE+]+)"[^>]*z="([-\d.eE+]+)"/g;
  let vm: RegExpExecArray | null;
  while ((vm = vertexRe.exec(xml)) !== null) {
    const x = parseFloat(vm[1]);
    const y = parseFloat(vm[2]);
    const z = parseFloat(vm[3]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  // Count triangles: <triangle .../>
  const triangleRe = /<triangle\s/g;
  while (triangleRe.exec(xml) !== null) triangleCount++;

  const dx = isFinite(maxX - minX) ? maxX - minX : 0;
  const dy = isFinite(maxY - minY) ? maxY - minY : 0;
  const dz = isFinite(maxZ - minZ) ? maxZ - minZ : 0;
  // 3MF uses millimetres by default
  const volumeCm3 = (dx / 10) * (dy / 10) * (dz / 10);

  return buildMetadata({
    fileName,
    fileSize: buf.length,
    dx, dy, dz,
    volumeCm3,
    polygonCount: triangleCount,
    isManifold: true,
  });
}

// ── Shared metadata builder ───────────────────────────────────────────────────
interface RawMetrics {
  fileName: string;
  fileSize: number;
  dx: number;
  dy: number;
  dz: number;
  volumeCm3: number;
  polygonCount: number;
  isManifold: boolean;
}

function buildMetadata(m: RawMetrics): FileMetadata {
  let score = 0;
  if (m.isManifold) score += 40;
  // Reasonable dimensions: each axis 1mm–500mm
  const reasonableDims =
    m.dx > 0 && m.dx <= 500 &&
    m.dy > 0 && m.dy <= 500 &&
    m.dz > 0 && m.dz <= 500;
  if (reasonableDims) score += 20;
  if (m.polygonCount > 0 && m.polygonCount < 1_000_000) score += 20;
  if (m.fileSize > 0) score += 20;

  return {
    fileName: m.fileName,
    fileSize: m.fileSize,
    dimensions: { x: m.dx, y: m.dy, z: m.dz },
    volumeCm3: m.volumeCm3,
    polygonCount: m.polygonCount,
    isManifold: m.isManifold,
    printabilityScore: score,
  };
}

// ── Thumbnail generation ──────────────────────────────────────────────────────
async function generateStlThumbnail(
  buf: Buffer,
  fileKey: string,
): Promise<string | null> {
  try {
    const { stl2png } = await import('@scalenc/stl-to-png');
    const thumbnailBuf: Buffer = stl2png(buf, { width: 256, height: 256 });

    const thumbKey = fileKey.replace(/(\.[^.]+)$/, '_thumb.png');
    const thumbPath = path.join(UPLOAD_DIR, thumbKey);
    await mkdir(path.dirname(thumbPath), { recursive: true });
    await writeFile(thumbPath, thumbnailBuf);
    return thumbKey;
  } catch {
    return null;
  }
}

// ── Main parsing dispatcher ───────────────────────────────────────────────────
async function parseFile(buf: Buffer, fileName: string, fileKey: string): Promise<{
  metadata: FileMetadata;
  thumbnailKey: string | null;
}> {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  let metadata: FileMetadata;
  let thumbnailKey: string | null = null;

  if (ext === '.stl') {
    // Detect binary vs ASCII: ASCII STLs start with "solid"
    const header = buf.slice(0, 5).toString('ascii');
    const isAscii = header.toLowerCase() === 'solid' && buf.includes(Buffer.from('facet normal'));
    if (isAscii) {
      metadata = parseStlAscii(buf.toString('utf-8'), buf.length);
    } else {
      metadata = parseStlBinary(buf);
    }
    metadata.fileName = fileName;
    thumbnailKey = await generateStlThumbnail(buf, fileKey);
  } else if (ext === '.3mf') {
    metadata = await parse3mf(buf, fileName);
  } else if (ext === '.obj') {
    metadata = parseObj(buf.toString('utf-8'), buf.length);
    metadata.fileName = fileName;
  } else {
    // Unsupported — return empty metadata
    metadata = buildMetadata({
      fileName,
      fileSize: buf.length,
      dx: 0, dy: 0, dz: 0,
      volumeCm3: 0,
      polygonCount: 0,
      isManifold: false,
    });
  }

  return { metadata, thumbnailKey };
}

// ── File loader ───────────────────────────────────────────────────────────────
async function loadFile(fileKey: string): Promise<Buffer> {
  const USE_S3 = process.env.STORAGE_MODE === 's3';
  if (USE_S3) {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
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
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: fileKey }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // Local storage
  const filePath = path.join(UPLOAD_DIR, fileKey);
  return readFile(filePath);
}

// ── Worker ────────────────────────────────────────────────────────────────────
export function startFileProcessingWorker(prisma: PrismaClient) {
  const worker = new Worker<FileProcessingJob>(
    'file-processing',
    async (job: Job<FileProcessingJob>) => {
      const { jobId, fileId, fileKey, fileName } = job.data;

      job.log(`Processing file: ${fileName} (key: ${fileKey})`);

      try {
        // Step 1: Load file bytes
        const buf = await loadFile(fileKey);
        job.log(`Loaded ${buf.length} bytes`);

        // Step 2: Parse and extract metadata
        const { metadata, thumbnailKey } = await parseFile(buf, fileName, fileKey);
        job.log(`Parsed — triangles: ${metadata.polygonCount}, score: ${metadata.printabilityScore}`);

        // Step 3: Update JobFile with metadata and thumbnail
        await prisma.jobFile.update({
          where: { id: fileId },
          data: {
            fileMetadata: metadata as never,
            thumbnailUrl: thumbnailKey ?? null,
          },
        });

        // Step 4: Check if ALL JobFiles for this PrintJob now have metadata.
        // If so, transition the PrintJob to 'bidding'.
        const allFiles = await prisma.jobFile.findMany({
          where: { jobId },
          select: { fileMetadata: true },
        });
        const allProcessed = allFiles.every((f) => f.fileMetadata !== null);
        if (allProcessed) {
          const biddingJob = await prisma.printJob.update({
            where: { id: jobId },
            data: { status: 'bidding' },
            select: { id: true, title: true, materialPreferred: true, userId: true },
          });
          job.log('All files processed — job moved to bidding');

          // Notify matching printers about the new job
          try {
            const matches = await findMatchingPrinters(prisma, {
              id: biddingJob.id,
              materialPreferred: biddingJob.materialPreferred,
              userId: biddingJob.userId,
            });

            for (const match of matches) {
              const prefs = match.emailPreferences;
              const jobAlertPref = prefs.jobAlerts as string | undefined;

              // Only notify printers with instant alerts (or no preference set)
              if (!jobAlertPref || jobAlertPref === 'instant') {
                const { subject, html } = jobAlertEmail(
                  match.fullName,
                  biddingJob.title,
                  biddingJob.id,
                  match.score,
                  match.matchReasons,
                );
                await sendEmail({
                  to: match.email,
                  subject,
                  html,
                  category: 'jobAlerts',
                  userId: match.userId,
                  userPrefs: prefs as import('./email.js').EmailPreferences,
                });
              }

              // Always send WebSocket notification regardless of email preference
              notifyUser(match.userId, {
                type: 'job:new_match',
                data: {
                  jobId: biddingJob.id,
                  title: biddingJob.title,
                  matchScore: match.score,
                  matchReasons: match.matchReasons,
                },
              });
            }

            job.log(`Notified ${matches.length} matching printer(s)`);
          } catch (notifyErr) {
            // Non-fatal: log but don't fail the job processing
            job.log(`Matching/notification error: ${notifyErr}`);
          }
        }

        job.log('File processing complete');
        return { success: true, metadata };
      } catch (error) {
        job.log(`Processing failed: ${error}`);

        // Leave PrintJob in draft on failure
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
    console.log(`File processing completed for job ${job.data.jobId}, file ${job.data.fileId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`File processing failed for job ${job?.data.jobId}:`, err.message);
  });

  return worker;
}
