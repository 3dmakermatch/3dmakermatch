import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrate() {
  // Step 1: Migrate PrintJob files to JobFile
  const jobs = await prisma.printJob.findMany({
    where: { fileUrl: { not: null } },
  });

  for (const job of jobs) {
    if (!job.fileUrl) continue;
    const existing = await prisma.jobFile.findFirst({ where: { jobId: job.id } });
    if (existing) continue;

    const meta = job.fileMetadata as Record<string, unknown> | null;
    await prisma.jobFile.create({
      data: {
        jobId: job.id,
        fileUrl: job.fileUrl,
        thumbnailUrl: job.thumbnailUrl,
        fileName: (meta?.fileName as string) || job.fileUrl.split('/').pop() || 'unknown',
        fileMetadata: job.fileMetadata || undefined,
        displayOrder: 0,
      },
    });
  }
  console.log(`Migrated ${jobs.length} PrintJob files to JobFile`);

  // Step 2: Migrate capabilities.machines to PrinterMachine
  const printers = await prisma.printer.findMany();
  for (const printer of printers) {
    const caps = printer.capabilities as Record<string, unknown>;
    const machines = (caps?.machines || []) as Array<{
      name: string;
      type: string;
      materials: string[];
      buildVolume?: { x: number; y: number; z: number };
    }>;

    for (const machine of machines) {
      const existing = await prisma.printerMachine.findFirst({
        where: { printerId: printer.id, name: machine.name },
      });
      if (existing) continue;

      await prisma.printerMachine.create({
        data: {
          printerId: printer.id,
          name: machine.name,
          type: machine.type || 'FDM',
          materials: machine.materials || [],
          buildVolume: machine.buildVolume || { x: 220, y: 220, z: 250 },
        },
      });
    }
  }
  console.log(`Migrated machines for ${printers.length} printers`);

  await prisma.$disconnect();
}

migrate().catch(console.error);
