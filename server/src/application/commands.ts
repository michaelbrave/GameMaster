import { createHash } from "node:crypto";
import type { Axial } from "../domain/axial";
import type { PendingEncounter, WorldEvent } from "../domain/events";
import type { RollRecord } from "../domain/tables";
import {
  DuplicateEventError,
  type ResolutionRow,
  type SessionRow,
  type Tx,
  type WorldRow,
} from "../infrastructure/store";
import { ApiError, notFound } from "./errors";
import {
  EventFactory,
  TableResolver,
  ensureHexMaterialized,
  requirePinnedContent,
  type Engine,
} from "./engine";

export { EventFactory, ensureHexMaterialized, TableResolver };
export type { Engine };

export interface TravelCommand {
  idempotencyKey: string;
  expectedVersion: number;
  to: Axial;
}

export interface EncounterActionCommand {
  idempotencyKey: string;
  expectedVersion: number;
  choiceId: string;
}

export interface CommandResponse {
  resolution: {
    id: string;
    command: "travel" | "encounter-action";
    outcome: string;
    worldTick: number;
    text: string[];
    rolls: RollRecord[];
    events: WorldEvent[];
  };
  session: {
    id: string;
    version: number;
    position: Axial;
    pendingEncounter: PendingEncounter | null;
  };
  worldTick: number;
}

export const hashCommand = (type: string, payload: unknown): string =>
  createHash("sha256").update(JSON.stringify({ type, payload })).digest("hex");

interface CommandPrelude {
  session: SessionRow;
  world: WorldRow;
  resolver: TableResolver;
}

export async function prelude(
  tx: Tx,
  engine: Engine,
  sessionId: string,
  commandType: "travel" | "encounter-action",
  payload: unknown,
  idempotencyKey: string,
  expectedVersion: number,
): Promise<CommandPrelude | { replay: CommandResponse }> {
  const session = await tx.getSession(sessionId);
  if (!session) throw notFound(`session ${sessionId}`);
  if (!idempotencyKey)
    throw new ApiError("validation_failed", "idempotencyKey is required");
  const prior = await tx.getResolutionByKey(sessionId, idempotencyKey);
  if (prior) {
    if (prior.commandHash !== hashCommand(commandType, payload)) {
      throw new ApiError(
        "command_rejected",
        `idempotency key "${idempotencyKey}" was already used with a different command payload`,
      );
    }
    // Idempotent retry: return the original result without rerolling.
    return { replay: prior.response as CommandResponse };
  }
  if (session.version !== expectedVersion) {
    throw new ApiError(
      "version_conflict",
      `session version is ${session.version}, command expected ${expectedVersion}`,
      { currentVersion: session.version },
    );
  }
  const world = await tx.getWorld(session.worldId);
  if (!world) throw notFound(`world ${session.worldId}`);
  requirePinnedContent(world, engine);
  const resolver = new TableResolver(engine.pack);
  await resolver.prime(tx);
  return { session, world, resolver };
}

export async function persistResolution(
  tx: Tx,
  row: Omit<ResolutionRow, "createdAt" | "response"> & {
    response: CommandResponse;
  },
  engine: Engine,
): Promise<void> {
  await tx.insertResolution({ ...row, createdAt: engine.now() });
}

/**
 * Two concurrent commands can share an idempotency key: the loser loses the
 * unique-constraint race at insert time rather than seeing the stored
 * resolution in the prelude. That is a lost race, not a server fault, so it
 * must not surface as a 500. Re-read state and retry.
 */
export function rethrowIdempotencyRace(error: unknown): never {
  if (error instanceof DuplicateEventError) {
    throw new ApiError(
      "version_conflict",
      "A concurrent command with the same idempotency key was accepted first. Refresh and retry.",
    );
  }
  throw error;
}
