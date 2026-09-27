import type { PendingEncounter } from "../domain/events";
import { newId } from "../domain/ids";
import { rngFromParts } from "../domain/rng";
import { resolveTable, type RollRecord } from "../domain/tables";
import { hexStream, sessionStream, type Store } from "../infrastructure/store";
import { ApiError } from "./errors";
import {
  EventFactory,
  ensureHexMaterialized,
  hashCommand,
  persistResolution,
  prelude,
  rethrowIdempotencyRace,
  type CommandResponse,
  type EncounterActionCommand,
  type Engine,
} from "./commands";
import { applyEffects } from "./effects";

/**
 * Apply one explicit oracle choice: resolve the choice's nested table,
 * append its events into the same hex, and either continue the encounter
 * (when the result offers further authored choices) or close it.
 */
export async function encounterAction(
  store: Store,
  engine: Engine,
  sessionId: string,
  command: EncounterActionCommand,
): Promise<CommandResponse> {
  try {
    return await store.withTransaction(async (tx) => {
      const pre = await prelude(
        tx,
        engine,
        sessionId,
        "encounter-action",
        { choiceId: command.choiceId },
        command.idempotencyKey,
        command.expectedVersion,
      );
      if ("replay" in pre) return pre.replay;
      const { session, world, resolver } = pre;

      const pending = session.pendingEncounter;
      if (!pending)
        throw new ApiError(
          "command_rejected",
          "no encounter is awaiting a choice",
        );
      const choice = pending.choices.find((c) => c.id === command.choiceId);
      if (!choice) {
        throw new ApiError(
          "validation_failed",
          `choice "${command.choiceId}" is not one of the offered options`,
          { offered: pending.choices.map((c) => c.id) },
        );
      }

      const resolutionId = newId();
      const rolls: RollRecord[] = [];
      const factory = new EventFactory(
        tx,
        {
          worldId: world.id,
          correlationId: resolutionId,
          actor: { type: "character", id: session.id },
          now: engine.now,
        },
        world.currentTick,
      );

      const { hex } = await ensureHexMaterialized(
        tx,
        engine,
        world,
        pending.hex,
        factory,
        rolls,
      );
      const stream = hexStream(world.id, hex);

      const table = resolver.mustGet(choice.table);
      const rng = rngFromParts(
        world.seed,
        world.contentRelease,
        "encounter-action",
        choice.id,
        session.version,
      );
      const outcome = resolveTable(
        table,
        { tags: hex.tags },
        rng,
        resolver.lookup,
      );
      rolls.push(...outcome.rolls);

      const text = [...outcome.text];
      await factory.emit(
        sessionStream(sessionId),
        "encounter_resolved",
        "public",
        {
          encounterId: pending.encounterId,
          choiceId: choice.id,
          choiceLabel: choice.label,
          table: `${table.id}@${table.version}`,
          text: outcome.text,
        },
        { location: hex },
      );
      for (const t of outcome.text) {
        await factory.emit(
          stream,
          "log_appended",
          "public",
          { text: t },
          { location: hex },
        );
      }
      await applyEffects(outcome.effects, hex, { world, at: hex }, factory);

      let result: string;
      if (outcome.choices.length > 0) {
        // The oracle chain continues with a fresh set of authored options.
        const next: PendingEncounter = {
          encounterId: newId(),
          tableId: table.id,
          tableVersion: table.version,
          text: outcome.text[outcome.text.length - 1] ?? pending.text,
          choices: outcome.choices,
          startedTick: world.currentTick,
          hex: pending.hex,
          ...(outcome.results[outcome.results.length - 1]?.asset
            ? { asset: outcome.results[outcome.results.length - 1].asset }
            : {}),
          ...(outcome.results[outcome.results.length - 1]?.assetLabel
            ? {
                assetLabel:
                  outcome.results[outcome.results.length - 1]!.assetLabel,
              }
            : {}),
        };
        session.pendingEncounter = next;
        await factory.emit(
          sessionStream(sessionId),
          "encounter_started",
          "public",
          {
            ...next,
            entryId: outcome.rolls[outcome.rolls.length - 1].selectedEntryId,
          },
          { location: hex },
        );
        result = "encounter";
      } else {
        session.pendingEncounter = null;
        result = "resolved";
      }

      // No time passes during an encounter action, and world evolution runs
      // only when relevant time advances or a hex is loaded — so none here.
      hex.version += factory.countOn(stream);
      await tx.upsertHexProjection(hex);
      const expectedVersion = session.version;
      session.version = expectedVersion + 1;
      await tx.updateSession(session, expectedVersion);
      await tx.appendEvents(factory.events);

      const response: CommandResponse = {
        resolution: {
          id: resolutionId,
          command: "encounter-action",
          outcome: result,
          worldTick: world.currentTick,
          text,
          rolls,
          events: factory.events.filter((e) => e.visibility === "public"),
        },
        session: {
          id: session.id,
          version: session.version,
          position: { q: session.q, r: session.r },
          pendingEncounter: session.pendingEncounter,
        },
        worldTick: world.currentTick,
      };
      await persistResolution(
        tx,
        {
          id: resolutionId,
          worldId: world.id,
          sessionId,
          commandType: "encounter-action",
          commandHash: hashCommand("encounter-action", {
            choiceId: command.choiceId,
          }),
          seed: `${world.seed}|encounter-action|${choice.id}|${expectedVersion}`,
          worldTick: world.currentTick,
          rolls,
          eventIds: factory.events.map((e) => e.id),
          outcome: result,
          idempotencyKey: command.idempotencyKey,
          response,
        },
        engine,
      );
      return response;
    });
  } catch (error) {
    rethrowIdempotencyRace(error);
  }
}
