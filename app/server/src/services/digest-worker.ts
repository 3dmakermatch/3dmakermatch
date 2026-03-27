import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from './email.js';
import { jobDigestEmail } from './email-templates.js';

const connection = {
  host: process.env.REDIS_URL?.replace('redis://', '').split(':')[0] || 'localhost',
  port: Number(process.env.REDIS_URL?.split(':').pop()) || 6379,
};

export const digestQueue = new Queue('job-digest', { connection });

export function startDigestWorker(prisma: PrismaClient) {
  // Schedule repeatable digest jobs
  digestQueue.add('hourly', { frequency: 'hourly' }, { repeat: { pattern: '0 * * * *' } });
  digestQueue.add('daily', { frequency: 'daily' }, { repeat: { pattern: '0 8 * * *' } });
  digestQueue.add('weekly', { frequency: 'weekly' }, { repeat: { pattern: '0 8 * * 1' } });

  const worker = new Worker(
    'job-digest',
    async (job) => {
      const { frequency } = job.data as { frequency: string };

      // Find printers whose email preferences match this digest frequency
      const printers = await prisma.printer.findMany({
        where: {
          user: {
            emailPreferences: {
              path: ['jobAlerts'],
              equals: frequency,
            },
          },
        },
        include: {
          user: true,
          machines: true,
        },
      });

      for (const printer of printers) {
        const since = printer.lastDigestAt || new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Collect all materials this printer can handle
        const printerMaterials = printer.machines.flatMap((m) =>
          m.materials.map((mat) => mat.toLowerCase()),
        );

        // Find jobs posted since last digest that are still open
        const newJobs = await prisma.printJob.findMany({
          where: {
            status: 'bidding',
            createdAt: { gte: since },
            expiresAt: { gt: new Date() },
          },
          select: { id: true, title: true, materialPreferred: true },
        });

        // Filter to jobs whose required materials overlap with printer's capabilities
        const matchingJobs = newJobs.filter((j) => {
          if (j.materialPreferred.length === 0) return true;
          return j.materialPreferred.some((mat) =>
            printerMaterials.includes(mat.toLowerCase()),
          );
        });

        if (matchingJobs.length === 0) continue;

        const tpl = jobDigestEmail(
          printer.user.fullName,
          matchingJobs.map((j) => ({ title: j.title, id: j.id, materials: j.materialPreferred })),
        );

        sendEmail({
          to: printer.user.email,
          subject: tpl.subject,
          html: tpl.html,
          category: 'jobAlerts',
          userId: printer.user.id,
          userPrefs: printer.user.emailPreferences as any,
        }).catch(() => {});

        // Record when this printer last received a digest
        await prisma.printer.update({
          where: { id: printer.id },
          data: { lastDigestAt: new Date() },
        });
      }

      console.log(`Digest (${frequency}): processed ${printers.length} printers`);
    },
    { connection },
  );

  return worker;
}
