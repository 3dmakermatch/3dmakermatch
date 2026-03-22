/**
 * AutoLayoutEngine — Pure TypeScript 2D bin-packing module.
 *
 * Uses a greedy shelf algorithm: parts are sorted by area (descending),
 * then placed left-to-right on shelves that grow top-to-bottom.
 */

export interface PartFootprint {
  id: string;
  width: number; // X dimension in mm
  depth: number; // Y dimension in mm
  height: number; // Z dimension in mm (reference only, not used in packing)
}

export interface PlacedPart {
  id: string;
  x: number; // Position on plate (mm from origin)
  y: number;
  width: number;
  depth: number;
}

export interface LayoutResult {
  placed: PlacedPart[];
  overflow: PartFootprint[]; // Parts that didn't fit
}

/**
 * Greedy bin-packing using a shelf algorithm.
 *
 * Parts are sorted by area descending (largest first), then placed
 * left-to-right on horizontal shelves. When a part doesn't fit on the
 * current shelf, a new shelf is started below. Parts that don't fit
 * anywhere are collected in `overflow`.
 *
 * @param parts      - Array of part footprints to place
 * @param plateWidth - Build plate width in mm
 * @param plateDepth - Build plate depth in mm
 * @param gap        - Minimum gap between parts and plate edges in mm (default: 5)
 */
export function autoLayout(
  parts: PartFootprint[],
  plateWidth: number,
  plateDepth: number,
  gap: number = 5,
): LayoutResult {
  // Sort by area descending — place largest parts first for better packing
  const sorted = [...parts].sort(
    (a, b) => b.width * b.depth - (a.width * a.depth),
  );

  const placed: PlacedPart[] = [];
  const overflow: PartFootprint[] = [];

  // Shelf state
  let shelfY = gap;
  let shelfHeight = 0;
  let cursorX = gap;

  for (const part of sorted) {
    // Try to place on current shelf
    if (cursorX + part.width + gap <= plateWidth) {
      if (shelfY + part.depth + gap <= plateDepth) {
        placed.push({
          id: part.id,
          x: cursorX,
          y: shelfY,
          width: part.width,
          depth: part.depth,
        });
        cursorX += part.width + gap;
        shelfHeight = Math.max(shelfHeight, part.depth);
        continue;
      }
    }

    // Current shelf is full horizontally — start a new shelf
    shelfY += shelfHeight + gap;
    cursorX = gap;
    shelfHeight = 0;

    if (
      shelfY + part.depth + gap <= plateDepth &&
      cursorX + part.width + gap <= plateWidth
    ) {
      placed.push({
        id: part.id,
        x: cursorX,
        y: shelfY,
        width: part.width,
        depth: part.depth,
      });
      cursorX += part.width + gap;
      shelfHeight = Math.max(shelfHeight, part.depth);
    } else {
      overflow.push(part);
    }
  }

  return { placed, overflow };
}
