import { prisma } from './prisma.js';
import { createTestUser, createTestPrinter } from './auth.js';

export async function seedJob(userId?: string) {
  let buyerId = userId;
  if (!buyerId) {
    const { user } = await createTestUser();
    buyerId = user.id;
  }

  const job = await prisma.printJob.create({
    data: {
      userId: buyerId,
      title: `Test Job ${Date.now()}`,
      description: 'A test print job',
      materialPreferred: ['PLA'],
      quantity: 1,
      status: 'bidding',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Create a JobFile
  const jobFile = await prisma.jobFile.create({
    data: {
      jobId: job.id,
      fileUrl: 'test/file.stl',
      fileName: 'test.stl',
      displayOrder: 0,
    },
  });

  return { job, jobFile };
}

export async function seedBid(jobId: string, printerId: string, overrides: Record<string, unknown> = {}) {
  return prisma.bid.create({
    data: {
      jobId,
      printerId,
      amountCents: 2500,
      shippingCostCents: 500,
      estimatedDays: 5,
      message: 'Test bid',
      ...overrides,
    },
  });
}

export async function seedOrder(overrides: {
  buyerId?: string;
  printerId?: string;
  jobId?: string;
  bidId?: string;
  status?: string;
} = {}) {
  let buyerId = overrides.buyerId;
  let printerId = overrides.printerId;
  let jobId = overrides.jobId;
  let bidId = overrides.bidId;

  if (!buyerId) {
    const { user } = await createTestUser();
    buyerId = user.id;
  }
  if (!printerId) {
    const { printer } = await createTestPrinter();
    printerId = printer.id;
  }
  if (!jobId) {
    const { job } = await seedJob(buyerId);
    jobId = job.id;
  }
  if (!bidId) {
    const bid = await seedBid(jobId, printerId);
    bidId = bid.id;
  }

  return prisma.order.create({
    data: {
      jobId,
      bidId,
      buyerId,
      printerId,
      status: (overrides.status as any) || 'paid',
    },
  });
}
