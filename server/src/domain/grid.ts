import { allHexes, isNeighbor, isWithinRadius, type Axial } from "./axial";

export type GridType = "hex" | "square-diamond";

// Doubled coordinates: even/even = large tile, odd/odd = corner diamond.
// Mixed parity is empty space, never a valid destination.
export function isDiamond(at: Axial): boolean {
  return Math.abs(at.q % 2) === 1 && Math.abs(at.r % 2) === 1;
}

export function withinGrid(
  at: Axial,
  radius: number,
  grid: GridType = "hex",
): boolean {
  if (!Number.isInteger(at.q) || !Number.isInteger(at.r)) return false;
  if (grid === "hex") return isWithinRadius(at, radius);
  return (
    Math.abs(at.q % 2) === Math.abs(at.r % 2) &&
    Math.max(Math.abs(at.q), Math.abs(at.r)) <= radius * 2
  );
}

export function adjacent(a: Axial, b: Axial, grid: GridType = "hex"): boolean {
  if (grid === "hex") return isNeighbor(a, b);
  if (
    ![a, b].every(
      (p) =>
        Number.isInteger(p.q) &&
        Number.isInteger(p.r) &&
        Math.abs(p.q % 2) === Math.abs(p.r % 2),
    )
  )
    return false;
  const dq = Math.abs(a.q - b.q);
  const dr = Math.abs(a.r - b.r);
  return (
    (dq === 1 && dr === 1) ||
    (!isDiamond(a) && !isDiamond(b) && dq + dr === 2 && (dq === 0 || dr === 0))
  );
}

export function gridSpaces(radius: number, grid: GridType = "hex"): Axial[] {
  if (grid === "hex") return allHexes(radius);
  const spaces: Axial[] = [];
  for (let r = -radius * 2; r <= radius * 2; r++) {
    for (let q = -radius * 2; q <= radius * 2; q++) {
      if (withinGrid({ q, r }, radius, grid)) spaces.push({ q, r });
    }
  }
  return spaces;
}
