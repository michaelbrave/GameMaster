import {
  getBattlefield,
  commandBattlefield,
  type BattleCommand,
} from "../application/battlefields";
import type { Store } from "../infrastructure/store";
import type { Engine } from "../application/engine";
import { ApiError, notFound } from "../application/errors";
import { createSession, createWorld } from "../application/worlds";
import { travel } from "../application/travel";
import { encounterAction } from "../application/encounterAction";
import { getMap, getSessionState } from "../application/queries";
import {
  getCreatorHistory,
  getHexDetail,
  getHistory,
} from "../application/history";
import {
  getTable,
  listTables,
  previewRolls,
  publishTable,
  validateDraft,
} from "../application/tablesService";
import { HttpApp, type Handler } from "./server";
import type { Logger } from "../logger";

const json =
  (status: number, fn: (body: never) => Promise<unknown> | unknown): Handler =>
  async (req) => ({ status, body: await fn(req.body as never) });

const intParam = (raw: string, name: string): number => {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value))
    throw new ApiError("validation_failed", `${name} must be an integer`);
  return value;
};

export function registerRoutes(
  app: HttpApp,
  deps: { store: Store; engine: Engine; logger: Logger },
): void {
  const { store, engine } = deps;

  app.add("GET", "/health", async () => ({
    status: 200,
    body: { status: "ok", contentRelease: engine.pack.release, store: "ready" },
  }));

  app.add(
    "POST",
    "/api/v1/worlds",
    json(
      201,
      async (body: {
        name: string;
        seed?: string;
        gridType?: import("../domain/grid").GridType;
      }) =>
        createWorld(store, engine, {
          name: body?.name,
          seed: body?.seed,
          gridType: body?.gridType,
        }),
    ),
  );

  app.add("GET", "/api/v1/worlds/:worldId", async (req) => {
    const world = await store.withTransaction((tx) =>
      tx.getWorld(req.params.worldId),
    );
    if (!world) throw notFound(`world ${req.params.worldId}`);
    return { status: 200, body: world };
  });

  app.add(
    "POST",
    "/api/v1/sessions",
    json(
      201,
      async (body: {
        worldId: string;
        characterName: string;
        creatorPolicy?: { tablePreview?: boolean; completeHistory?: boolean };
      }) => {
        if (!body?.worldId)
          throw new ApiError("validation_failed", "worldId is required");
        const session = await createSession(store, engine, body);
        const state = await getSessionState(store, engine, session.id);
        return state;
      },
    ),
  );

  app.add("GET", "/api/v1/sessions/:sessionId", async (req) => ({
    status: 200,
    body: await getSessionState(store, engine, req.params.sessionId),
  }));

  app.add(
    "GET",
    "/api/v1/sessions/:sessionId/battlefields/:q/:r",
    async (req) => ({
      status: 200,
      body: await getBattlefield(store, engine, req.params.sessionId, {
        q: intParam(req.params.q, "q"),
        r: intParam(req.params.r, "r"),
      }),
    }),
  );
  app.add(
    "POST",
    "/api/v1/sessions/:sessionId/battlefields/:q/:r",
    async (req) => ({
      status: 200,
      body: await commandBattlefield(
        store,
        engine,
        req.params.sessionId,
        {
          q: intParam(req.params.q, "q"),
          r: intParam(req.params.r, "r"),
        },
        req.body as BattleCommand,
      ),
    }),
  );

  app.add("GET", "/api/v1/sessions/:sessionId/map", async (req) => ({
    status: 200,
    body: await getMap(store, engine, req.params.sessionId),
  }));

  app.add("GET", "/api/v1/sessions/:sessionId/hexes/:q/:r", async (req) => ({
    status: 200,
    body: await getHexDetail(store, engine, req.params.sessionId, {
      q: intParam(req.params.q, "q"),
      r: intParam(req.params.r, "r"),
    }),
  }));

  app.add("GET", "/api/v1/sessions/:sessionId/history", async (req) => {
    // Parse here (defaulting only on absence/garbage); getHistory owns
    // clamping to the valid range so 0 is not silently the default.
    const offsetParam = Number.parseInt(req.query.get("offset") ?? "", 10);
    const limitParam = Number.parseInt(req.query.get("limit") ?? "", 10);
    return {
      status: 200,
      body: await getHistory(
        store,
        req.params.sessionId,
        Number.isNaN(offsetParam) ? 0 : offsetParam,
        Number.isNaN(limitParam) ? 100 : limitParam,
      ),
    };
  });

  app.add(
    "GET",
    "/api/v1/sessions/:sessionId/creator/history",
    async (req) => ({
      status: 200,
      body: await getCreatorHistory(store, req.params.sessionId),
    }),
  );

  app.add(
    "POST",
    "/api/v1/sessions/:sessionId/commands/travel",
    async (req) => ({
      status: 200,
      body: await travel(
        store,
        engine,
        req.params.sessionId,
        req.body as never,
      ),
    }),
  );

  app.add(
    "POST",
    "/api/v1/sessions/:sessionId/commands/encounter-action",
    async (req) => ({
      status: 200,
      body: await encounterAction(
        store,
        engine,
        req.params.sessionId,
        req.body as never,
      ),
    }),
  );

  app.add("GET", "/api/v1/tables", async () => ({
    status: 200,
    body: await listTables(store),
  }));

  app.add("GET", "/api/v1/tables/:id", async (req) => ({
    status: 200,
    body: await getTable(store, decodeURIComponent(req.params.id)),
  }));

  app.add(
    "POST",
    "/api/v1/tables/validate",
    json(200, async (body: { draft: unknown }) => {
      if (!body || typeof body !== "object" || !("draft" in body)) {
        throw new ApiError(
          "validation_failed",
          "body must be { draft: <table definition> }",
        );
      }
      return validateDraft(store, body.draft);
    }),
  );

  app.add("POST", "/api/v1/tables/preview", async (req) => ({
    status: 200,
    body: await previewRolls(store, req.body as never),
  }));

  app.add("POST", "/api/v1/tables", async (req) => ({
    status: 201,
    body: await publishTable(store, req.body as never),
  }));
}
