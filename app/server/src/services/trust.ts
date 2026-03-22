import { PrismaClient } from '@prisma/client';

export async function recalculateTrustScore(prisma: PrismaClient, printerId: string): Promise<number> {
  const printer = await prisma.printer.findUnique({
    where: { id: printerId },
    include: { user: true },
  });
  if (!printer) return 0;

  // Rating component (400 max): requires min 5 reviews, else baseline 200
  const reviewAgg = await prisma.review.aggregate({
    where: { revieweeId: printer.userId },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const ratingScore = reviewAgg._count.rating >= 5
    ? ((reviewAgg._avg.rating || 0) / 5) * 400
    : 200;

  // Completion rate (250 max): requires min 3 orders, else baseline 125
  const orderCounts = await prisma.order.groupBy({
    by: ['status'],
    where: { printerId },
    _count: true,
  });
  const totalOrders = orderCounts.reduce((s, o) => s + o._count, 0);
  const completedOrders = orderCounts.find(o => o.status === 'confirmed')?._count || 0;
  const completionScore = totalOrders >= 3 ? (completedOrders / totalOrders) * 250 : 125;

  // Response time (150 max): avg hours between job posted and bid placed
  const bids = await prisma.bid.findMany({
    where: { printerId },
    include: { job: { select: { createdAt: true } } },
  });
  let responseScore = 75; // neutral baseline when no bids
  if (bids.length > 0) {
    const avgHours = bids.reduce((sum, bid) => {
      const diff = bid.createdAt.getTime() - bid.job.createdAt.getTime();
      return sum + diff / (1000 * 60 * 60);
    }, 0) / bids.length;
    if (avgHours < 1) responseScore = 150;
    else if (avgHours < 4) responseScore = 120;
    else if (avgHours < 24) responseScore = 80;
    else responseScore = 40;
  }

  // Account age (100 max): linear 0-100 over first 6 months
  const monthsOld = (Date.now() - printer.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
  const ageScore = Math.min(100, (monthsOld / 6) * 100);

  // Verification (100): full points if verified
  const verifyScore = printer.isVerified ? 100 : 0;

  const total = Math.round(ratingScore + completionScore + responseScore + ageScore + verifyScore);
  const clamped = Math.max(0, Math.min(1000, total));

  await prisma.printer.update({
    where: { id: printerId },
    data: { trustScore: clamped },
  });

  return clamped;
}
