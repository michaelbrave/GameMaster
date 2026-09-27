import { createHash, randomUUID } from "node:crypto";

/** New random UUID for persistent identities (events, sessions, worlds, facts). */
export function newId(): string {
  return randomUUID();
}

/** Stable UUID-shaped identity for canonical generated entities. */
export function deterministicId(...parts: Array<string | number>): string {
  const bytes = createHash("sha256").update(parts.join("|"), "utf8").digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
