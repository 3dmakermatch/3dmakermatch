import { PrismaClient } from '@prisma/client';

export interface MatchedPrinter {
  printerId: string;
  userId: string;
  fullName: string;
  email: string;
  score: number;
  matchReasons: string[];
  emailPreferences: Record<string, unknown>;
}

export async function findMatchingPrinters(
  prisma: PrismaClient,
  job: { id: string; materialPreferred: string[]; userId: string },
  limit: number = 10,
): Promise<MatchedPrinter[]> {
  const printers = await prisma.printer.findMany({
    where: {
      userId: { not: job.userId },
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, emailPreferences: true } },
      machines: true,
    },
  });

  const scored: MatchedPrinter[] = [];

  for (const printer of printers) {
    const reasons: string[] = [];
    let matchScore = 0;

    // Material match (30% weight)
    if (job.materialPreferred.length === 0) {
      reasons.push('Any material accepted');
      matchScore += 30;
    } else {
      const printerMaterials = printer.machines.flatMap((m) =>
        m.materials.map((mat) => mat.toLowerCase()),
      );
      const overlap = job.materialPreferred.filter((m) =>
        printerMaterials.includes(m.toLowerCase()),
      );
      if (overlap.length > 0) {
        reasons.push(`Supports ${overlap.join(', ')}`);
        matchScore += 30 * (overlap.length / job.materialPreferred.length);
      } else {
        continue; // No material match — skip this printer
      }
    }

    // Trust score (40% weight, normalized 0–40)
    matchScore += (printer.trustScore / 1000) * 40;
    if (printer.trustScore >= 700) {
      reasons.push('High trust score');
    }

    // Rating (30% weight, normalized 0–30)
    matchScore += (printer.averageRating / 5) * 30;
    if (printer.averageRating >= 4) {
      reasons.push(`${printer.averageRating.toFixed(1)}-star rating`);
    }

    scored.push({
      printerId: printer.id,
      userId: printer.user.id,
      fullName: printer.user.fullName,
      email: printer.user.email,
      score: Math.round(matchScore),
      matchReasons: reasons,
      emailPreferences: printer.user.emailPreferences as Record<string, unknown>,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
