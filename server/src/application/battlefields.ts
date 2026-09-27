import { same, type Axial } from "../domain/axial";
import {
  applyBattleAction,
  battlefieldResponse,
  type Battlefield,
  type BattleAction,
} from "../domain/battlefield";
import { newId } from "../domain/ids";
import type { WorldEvent } from "../domain/events";
import {
  DuplicateEventError,
  type Store,
  type Tx,
} from "../infrastructure/store";
import { ApiError, notFound } from "./errors";
import { requirePinnedContent, type Engine } from "./engine";

export interface BattleCommand {
  expectedVersion: number;
  commandId: string;
  action: BattleAction;
}

interface SavedBattle {
  board: Battlefield;
  commandId: string;
  command: string;
}

async function context(
  tx: Tx,
  engine: Engine,
  sessionId: string,
  location: Axial,
) {
  const session = await tx.getSession(sessionId);
  if (!session) throw notFound("session");
  if (!same(session, location))
    throw new ApiError(
      "command_rejected",
      "Open the battlefield at your current world location.",
    );
  const world = await tx.getWorld(session.worldId);
  if (!world) throw notFound("world");
  requirePinnedContent(world, engine);
  const hex = await tx.getHexProjection(world.id, location);
  if (!hex) throw notFound("location");
  const stream = `battlefield:${sessionId}:${location.q},${location.r}`;
  const events = await tx.listEventsByStream(stream);
  const latest = events.at(-1)?.payload as unknown as SavedBattle | undefined;
  const terrain = engine.pack.terrain[hex.terrain];
  const board: Battlefield = latest?.board ?? {
    version: 0,
    location,
    gridType: world.gridType ?? "hex",
    radius: 4,
    feetPerStep: 5,
    terrain: terrain.label,
    color: terrain.color,
    tokens: [
      {
        id: session.id,
        label: session.characterName,
        kind: "character",
        position: { q: 0, r: 0 },
        allowance: 6,
        spent: 0,
      },
    ],
    obstacles: [],
  };
  return { session, world, stream, events, board };
}

export async function getBattlefield(
  store: Store,
  engine: Engine,
  sessionId: string,
  location: Axial,
) {
  return store.withTransaction(async (tx) =>
    battlefieldResponse((await context(tx, engine, sessionId, location)).board),
  );
}

export async function commandBattlefield(
  store: Store,
  engine: Engine,
  sessionId: string,
  location: Axial,
  command: BattleCommand,
) {
  if (
    !command ||
    !Number.isInteger(command.expectedVersion) ||
    command.expectedVersion < 0 ||
    typeof command.commandId !== "string" ||
    command.commandId.length < 1 ||
    command.commandId.length > 100
  ) {
    throw new ApiError(
      "validation_failed",
      "expectedVersion and a commandId of 1–100 characters are required.",
    );
  }
  try {
    return await store.withTransaction(async (tx) => {
      const { session, world, stream, events, board } = await context(
        tx,
        engine,
        sessionId,
        location,
      );
      const serialized = JSON.stringify(command.action);
      const replay = events.find(
        (e) => e.payload.commandId === command.commandId,
      )?.payload as unknown as SavedBattle | undefined;
      if (replay) {
        if (replay.command !== serialized)
          throw new ApiError(
            "command_rejected",
            "commandId was already used for a different action.",
          );
        return battlefieldResponse(replay.board);
      }
      if (board.version !== command.expectedVersion)
        throw new ApiError(
          "version_conflict",
          "Battlefield changed. Reload it before trying again.",
        );
      let updated: Battlefield;
      try {
        updated = applyBattleAction(board, command.action, newId());
      } catch (error) {
        throw new ApiError("validation_failed", (error as Error).message);
      }
      const event: WorldEvent = {
        id: newId(),
        worldId: world.id,
        streamId: stream,
        streamVersion: updated.version,
        seq: 0,
        type: "battlefield_updated",
        schemaVersion: 1,
        worldTick: world.currentTick,
        recordedAt: engine.now(),
        actor: { type: "character", id: session.id },
        location,
        causationId: null,
        correlationId: newId(),
        visibility: "system",
        payload: {
          board: updated,
          commandId: command.commandId,
          command: serialized,
        },
      };
      await tx.appendEvents([event]);
      return battlefieldResponse(updated);
    });
  } catch (error) {
    if (error instanceof DuplicateEventError)
      throw new ApiError(
        "version_conflict",
        "Battlefield changed. Reload it before trying again.",
      );
    throw error;
  }
}
