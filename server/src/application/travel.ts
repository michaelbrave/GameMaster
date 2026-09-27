import type { Axial } from "../domain/axial";
import { adjacent, withinGrid } from "../domain/grid";
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
  type Engine,
  type TravelCommand,
} from "./commands";
import { applyEffects, evaluateEvolution } from "./effects";

/**
 * Resolve one travel command: validate the step, materialize the destination
 * hex on first entry, advance world time by the terrain cost, record
 * discovery, roll the travel encounter table, run due fact evolution, and
 * persist everything atomically with a replayable resolution trace.
 */
export async function travel(
  store: Store,
  engine: Engine,
  sessionId: string,
  command: TravelCommand,
): Promise<CommandResponse> {
  try {
    return await store.withTransaction(async (tx) => {
      const pre = await prelude(
        tx,
        engine,
        sessionId,
        "travel",
        { to: command.to },
        command.idempotencyKey,
        command.expectedVersion,
      );
      if ("replay" in pre) return pre.replay;
      const { session, world, resolver } = pre;

      if (session.pendingEncounter) {
        throw new ApiError(
          "command_rejected",
          "an encounter must be resolved before traveling",
        );
      }
      if (
        !Number.isInteger(command.to?.q) ||
        !Number.isInteger(command.to?.r)
      ) {
        throw new ApiError(
          "validation_failed",
          "destination must be an axial coordinate {q,r}",
        );
      }
      if (
        !withinGrid(
          command.to,
          engine.pack.worldgen.regionRadius,
          world.gridType,
        )
      ) {
        throw new ApiError(
          "command_rejected",
          `destination ${command.to.q},${command.to.r} lies beyond the edge of the world`,
        );
      }
      if (
        !adjacent({ q: session.q, r: session.r }, command.to, world.gridType)
      ) {
        throw new ApiError(
          "command_rejected",
          "travel destination must be a neighboring space",
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
      const text: string[] = [];
      let outcome: string;

      // 1. Materialize the destination once, from seed + versioned content.
      const { hex } = await ensureHexMaterialized(
        tx,
        engine,
        world,
        command.to,
        factory,
        rolls,
      );
      const stream = hexStream(world.id, hex);
      const discoveries = await tx.listDiscoveries(sessionId);
      const alreadyKnown = discoveries.some(
        (d) => d.q === hex.q && d.r === hex.r,
      );
      const terrain = engine.pack.terrain[hex.terrain];

      if (!terrain || !terrain.passable) {
        // 2a. Impassable: the traveler sees what bars the way, but does not move.
        if (!alreadyKnown) {
          await factory.emit(
            stream,
            "hex_discovered",
            "public",
            { terrain: hex.terrain },
            { location: hex },
          );
          await tx.insertDiscovery({
            worldId: world.id,
            sessionId,
            q: hex.q,
            r: hex.r,
            tick: world.currentTick,
          });
        }
        await factory.emit(
          stream,
          "travel_blocked",
          "public",
          {
            terrain: hex.terrain,
            reason: `${terrain?.label ?? hex.terrain} is impassable`,
          },
          { location: hex },
        );
        text.push(
          `${terrain?.label ?? hex.terrain} bars the way; you cannot pass.`,
        );
        outcome = "blocked";
      } else {
        // 2b. Passable: advance explicit world time, move, discover.
        const from: Axial = { q: session.q, r: session.r };
        const newTick = world.currentTick + terrain.moveCost;
        await factory.emit(
          sessionStream(sessionId),
          "time_advanced",
          "public",
          {
            fromTick: world.currentTick,
            toTick: newTick,
            cost: terrain.moveCost,
            reason: "travel",
          },
          { location: hex },
        );
        await tx.advanceWorldTick(world.id, newTick, world.version);
        world.currentTick = newTick;
        world.version += 1;
        factory.setTick(newTick);
        session.q = hex.q;
        session.r = hex.r;
        await factory.emit(
          sessionStream(sessionId),
          "character_moved",
          "public",
          {
            from,
            to: { q: hex.q, r: hex.r },
            cost: terrain.moveCost,
            terrain: hex.terrain,
          },
          { location: hex },
        );
        if (!alreadyKnown) {
          await factory.emit(
            stream,
            "hex_discovered",
            "public",
            { terrain: hex.terrain },
            { location: hex },
          );
          await tx.insertDiscovery({
            worldId: world.id,
            sessionId,
            q: hex.q,
            r: hex.r,
            tick: newTick,
          });
        }
        text.push(
          `You travel to the ${terrain.label.toLowerCase()} (${hex.q},${hex.r}).`,
        );

        // 3. Oracle: the travel encounter table, seeded for this exact command.
        // Seed context is (world seed, content release, destination, command
        // nonce): fully replayable, and independent of random session ids.
        const encounterTable = resolver.mustGet(
          engine.pack.worldgen.encounterTable,
        );
        const rng = rngFromParts(
          world.seed,
          world.contentRelease,
          "travel",
          hex.q,
          hex.r,
          session.version,
        );
        const encounter = resolveTable(
          encounterTable,
          { tags: hex.tags },
          rng,
          resolver.lookup,
        );
        rolls.push(...encounter.rolls);
        for (const t of encounter.text) text.push(t);
        for (const t of encounter.text) {
          await factory.emit(
            stream,
            "log_appended",
            "public",
            { text: t },
            { location: hex },
          );
        }
        await applyEffects(encounter.effects, hex, { world, at: hex }, factory);

        if (encounter.choices.length > 0) {
          const lastResult = encounter.results[encounter.results.length - 1];
          const pending: PendingEncounter = {
            encounterId: newId(),
            tableId: encounterTable.id,
            tableVersion: encounterTable.version,
            text: encounter.text[encounter.text.length - 1],
            choices: encounter.choices,
            startedTick: newTick,
            hex: { q: hex.q, r: hex.r },
            ...(lastResult?.asset ? { asset: lastResult.asset } : {}),
            ...(lastResult?.assetLabel
              ? { assetLabel: lastResult.assetLabel }
              : {}),
          };
          session.pendingEncounter = pending;
          await factory.emit(
            sessionStream(sessionId),
            "encounter_started",
            "public",
            {
              ...pending,
              entryId:
                encounter.rolls[encounter.rolls.length - 1].selectedEntryId,
            },
            { location: hex },
          );
          outcome = "encounter";
        } else {
          outcome = "moved";
        }

        // 4. Time-banded fact evolution for the entered hex.
        await evaluateEvolution(
          engine.pack,
          resolver,
          hex,
          world,
          factory,
          rolls,
        );
      }

      // 5. Persist projections, events, and the resolution trace atomically.
      hex.version += factory.countOn(stream);
      await tx.upsertHexProjection(hex);
      const expectedVersion = session.version;
      session.version = expectedVersion + 1;
      await tx.updateSession(session, expectedVersion);
      await tx.appendEvents(factory.events);

      const response: CommandResponse = {
        resolution: {
          id: resolutionId,
          command: "travel",
          outcome,
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
          commandType: "travel",
          commandHash: hashCommand("travel", { to: command.to }),
          seed: `${world.seed}|travel|${command.to.q},${command.to.r}|${expectedVersion}`,
          worldTick: world.currentTick,
          rolls,
          eventIds: factory.events.map((e) => e.id),
          outcome,
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
