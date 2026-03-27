import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

export async function cleanDatabase() {
  // Delete in order respecting foreign keys
  await prisma.dispute.deleteMany();
  await prisma.review.deleteMany();
  await prisma.message.deleteMany();
  await prisma.order.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.jobFile.deleteMany();
  await prisma.printJob.deleteMany();
  await prisma.printerBenchmark.deleteMany();
  await prisma.printerMachine.deleteMany();
  await prisma.printer.deleteMany();
  await prisma.user.deleteMany();
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
