import type { TableDefinition } from "../domain/content";
import { rngFromParts } from "../domain/rng";
import { resolveTable, type RollRecord } from "../domain/tables";
import {
  validateTableDefinition,
  type ValidationProblem,
} from "../domain/validate";
import type { Store } from "../infrastructure/store";
import { ApiError, notFound } from "./errors";

export interface TableListItemDto {
  id: string;
  purpose: string;
  label: string;
  versions: number[];
  latestVersion: number;
}

export async function listTables(
  store: Store,
): Promise<{ tables: TableListItemDto[] }> {
  return store.withTransaction(async (tx) => {
    const all = await tx.listTables();
    const byId = new Map<string, TableDefinition[]>();
    for (const t of all) {
      const arr = byId.get(t.id) ?? [];
      arr.push(t);
      byId.set(t.id, arr);
    }
    const tables = [...byId.entries()]
      .map(([id, defs]) => {
        const versions = defs.map((d) => d.version).sort((a, b) => a - b);
        const latest = defs.find(
          (d) => d.version === versions[versions.length - 1],
        );
        return {
          id,
          purpose: latest?.purpose ?? "",
          label: latest?.label ?? id,
          versions,
          latestVersion: versions[versions.length - 1],
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    return { tables };
  });
}

export async function getTable(
  store: Store,
  id: string,
): Promise<{ id: string; versions: TableDefinition[] }> {
  return store.withTransaction(async (tx) => {
    const all = await tx.listTables();
    const versions = all
      .filter((t) => t.id === id)
      .sort((a, b) => a.version - b.version);
    if (versions.length === 0) throw notFound(`table ${id}`);
    return { id, versions };
  });
}

export async function validateDraft(
  store: Store,
  draft: unknown,
): Promise<{ valid: boolean; errors: ValidationProblem[] }> {
  return store.withTransaction(async (tx) => {
    const all = await tx.listTables();
    const errors = validateTableDefinition(draft as TableDefinition, (ref) =>
      all.find((t) => t.id === ref.id && t.version === ref.version),
    );
    return { valid: errors.length === 0, errors };
  });
}

export interface PreviewRequest {
  sessionId: string;
  tableId?: string;
  draft?: TableDefinition;
  seed: string;
  count?: number;
}

export interface PreviewRollDto {
  index: number;
  seed: string;
  rolls: RollRecord[];
  text: string[];
}

/** Seeded preview rolls for the creator; never mutates world state. */
export async function previewRolls(
  store: Store,
  request: PreviewRequest,
): Promise<{ previews: PreviewRollDto[] }> {
  if (!request.seed)
    throw new ApiError("validation_failed", "seed is required");
  const count = Math.min(Math.max(request.count ?? 5, 1), 50);
  return store.withTransaction(async (tx) => {
    const session = await tx.getSession(request.sessionId);
    if (!session) throw notFound(`session ${request.sessionId}`);
    if (!session.creatorPolicy.tablePreview) {
      throw new ApiError(
        "forbidden",
        "roll-table preview is disabled by this session's visibility policy",
      );
    }
    const all = await tx.listTables();
    let def: TableDefinition | undefined;
    if (request.draft) {
      def = request.draft;
      const problems = validateTableDefinition(def, (ref) =>
        ref.id === def!.id && ref.version === def!.version
          ? def
          : all.find((t) => t.id === ref.id && t.version === ref.version),
      );
      if (problems.length > 0) {
        throw new ApiError("validation_failed", "draft table is invalid", {
          errors: problems,
        });
      }
    } else if (request.tableId) {
      const latest = await tx.latestTableVersion(request.tableId);
      if (latest === null) throw notFound(`table ${request.tableId}`);
      def = (await tx.getTable(request.tableId, latest)) ?? undefined;
    } else {
      throw new ApiError(
        "validation_failed",
        "either tableId or draft is required",
      );
    }
    if (!def)
      throw notFound(
        `table ${request.tableId ?? request.draft?.id ?? "<draft>"}`,
      );
    const table: TableDefinition = def;
    const lookup = (ref: { id: string; version: number }) =>
      ref.id === table.id && ref.version === table.version
        ? table
        : all.find((t) => t.id === ref.id && t.version === ref.version);
    const previews: PreviewRollDto[] = [];
    for (let i = 0; i < count; i += 1) {
      const rng = rngFromParts(request.seed, i);
      const outcome = resolveTable(table, { tags: [] }, rng, lookup);
      previews.push({
        index: i,
        seed: `${request.seed}#${i}`,
        rolls: outcome.rolls,
        text: outcome.text,
      });
    }
    return { previews };
  });
}

/** Publish a new immutable table version (creator capability). */
export async function publishTable(
  store: Store,
  input: { sessionId: string; definition: TableDefinition },
): Promise<{ id: string; version: number }> {
  return store.withTransaction(async (tx) => {
    const session = await tx.getSession(input.sessionId);
    if (!session) throw notFound(`session ${input.sessionId}`);
    if (!session.creatorPolicy.tablePreview) {
      throw new ApiError(
        "forbidden",
        "table publishing is disabled by this session's visibility policy",
      );
    }
    const all = await tx.listTables();
    const def = input.definition;
    const problems = validateTableDefinition(def, (ref) =>
      all.find((t) => t.id === ref.id && t.version === ref.version),
    );
    if (problems.length > 0) {
      throw new ApiError("validation_failed", "table definition is invalid", {
        errors: problems,
      });
    }
    const latest = await tx.latestTableVersion(def.id);
    const expected = (latest ?? 0) + 1;
    if (def.version !== expected) {
      throw new ApiError(
        "version_conflict",
        `table ${def.id} next version must be ${expected}, got ${def.version}`,
        { expectedVersion: expected },
      );
    }
    await tx.seedTable({ ...def, lifecycle: "published" });
    return { id: def.id, version: def.version };
  });
}
