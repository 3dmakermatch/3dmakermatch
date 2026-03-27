import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';

const connection = {
  host: process.env.REDIS_URL?.replace('redis://', '').split(':')[0] || 'localhost',
  port: Number(process.env.REDIS_URL?.split(':').pop()) || 6379,
};

export const trustDecayQueue = new Queue('trust-decay', { connection });

export function startTrustDecayWorker(prisma: PrismaClient) {
  // Schedule daily at midnight
  trustDecayQueue.add('decay', {}, { repeat: { pattern: '0 0 * * *' } });

  const worker = new Worker('trust-decay', async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Find printers with no confirmed orders in the past 30 days whose score is above the floor
    const printers = await prisma.printer.findMany({
      where: {
        trustScore: { gt: 100 },
        orders: {
          none: {
            status: 'confirmed',
            createdAt: { gte: thirtyDaysAgo },
          },
        },
      },
    });

    for (const printer of printers) {
      const newScore = Math.max(100, printer.trustScore - 5);
      await prisma.printer.update({
        where: { id: printer.id },
        data: { trustScore: newScore },
      });
    }

    console.log(`Trust decay: processed ${printers.length} inactive printers`);
  }, { connection });

  return worker;
}
