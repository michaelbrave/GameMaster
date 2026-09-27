import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { buildApp } from "../../src/app";
import { MemoryStore } from "../../src/infrastructure/memoryStore";
import { battlefieldJourney } from "./battlefieldJourney";
import type { AddressInfo } from "node:net";

test("battlefield HTTP journey saves movement, obstacles and tokens in memory", async () => {
  const app = await buildApp(
    {
      port: 0,
      store: "memory",
      databaseUrl: "",
      contentDir: resolve(process.cwd(), "../content/core"),
      clientDir: "/nonexistent",
      logLevel: "error",
    },
    { store: new MemoryStore(), listen: false },
  );
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const board = await battlefieldJourney({
      get: (path) => call("GET", path),
      post: (path, body) => call("POST", path, body),
    });
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    for (const name of ["common", "battlefield"]) {
      ajv.addSchema(
        JSON.parse(
          readFileSync(
            resolve(
              process.cwd(),
              "../contracts/json-schema/" + name + ".json",
            ),
            "utf8",
          ),
        ),
      );
    }
    const validate = ajv.getSchema("worldforge/battlefield.json")!;
    assert.ok(validate(board), JSON.stringify(validate.errors));
  } finally {
    await app.close();
  }
});
