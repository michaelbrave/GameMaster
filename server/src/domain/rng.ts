import { createHash } from "node:crypto";

/**
 * Deterministically derive a 32-bit unsigned integer seed from string/number
 * parts. The same parts always produce the same seed, on every runtime.
 */
export function deriveSeed(...parts: Array<string | number>): number {
  const digest = createHash("sha256").update(parts.join("|"), "utf8").digest();
  return digest.readUInt32BE(0);
}

export interface Rng {
  /** Next float in [0, 1). */
  nextFloat(): number;
  /** Next integer in [1, boundInclusive], inclusive on both ends. */
  nextInt(boundInclusive: number): number;
}

/**
 * mulberry32 PRNG: tiny, fast, and bit-for-bit deterministic across JS
 * runtimes, which is what makes stored seeds replayable.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const nextFloat = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    nextFloat,
    nextInt(boundInclusive: number): number {
      if (!Number.isInteger(boundInclusive) || boundInclusive < 1) {
        throw new Error(
          `nextInt bound must be an integer >= 1, got ${boundInclusive}`,
        );
      }
      return 1 + Math.floor(nextFloat() * boundInclusive);
    },
  };
}

/** Convenience: derive a seeded RNG stream from contextual parts. */
export function rngFromParts(...parts: Array<string | number>): Rng {
  return mulberry32(deriveSeed(...parts));
}
