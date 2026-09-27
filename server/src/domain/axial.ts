/** Axial coordinates for a pointy-top hex grid. See docs/adr/0002. */
export interface Axial {
  q: number;
  r: number;
}

export function key(a: Axial): string {
  return `${a.q},${a.r}`;
}

export function same(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Neighbor offsets in index order 0..5: E, NE, NW, W, SW, SE. */
export const DIRECTIONS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function add(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function neighbor(a: Axial, direction: number): Axial {
  return add(a, DIRECTIONS[direction]);
}

export function neighbors(a: Axial): Axial[] {
  return DIRECTIONS.map((d) => add(a, d));
}

export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function isNeighbor(a: Axial, b: Axial): boolean {
  return distance(a, b) === 1;
}

/** A hex is inside the finite world when its hex-distance from origin <= radius. */
export function isWithinRadius(a: Axial, radius: number): boolean {
  return Math.max(Math.abs(a.q), Math.abs(a.r), Math.abs(a.q + a.r)) <= radius;
}

/**
 * All hexes of the hex-shaped finite region, ordered by distance from the
 * origin (then q, then r) so iteration order is stable and deterministic.
 */
export function allHexes(radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    const lo = Math.max(-radius, -q - radius);
    const hi = Math.min(radius, -q + radius);
    for (let r = lo; r <= hi; r += 1) {
      out.push({ q, r });
    }
  }
  const origin: Axial = { q: 0, r: 0 };
  out.sort(
    (a, b) =>
      distance(origin, a) - distance(origin, b) || a.q - b.q || a.r - b.r,
  );
  return out;
}
