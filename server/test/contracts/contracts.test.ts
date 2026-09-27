import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test, { before } from "node:test";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

const ROOT = resolve(process.cwd(), "..");
const SCHEMA_DIR = join(ROOT, "contracts/json-schema");
const FIXTURE_DIR = join(ROOT, "contracts/fixtures");
const CONTENT_DIR = process.env.CONTENT_DIR ?? join(ROOT, "content/core");

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

let ajv: Ajv;
const validators = new Map<string, ValidateFunction>();

function validator(schemaName: string, def?: string): ValidateFunction {
  const key = `${schemaName}${def ?? ""}`;
  if (!validators.has(key)) {
    const schema = readJson(join(SCHEMA_DIR, `${schemaName}.json`));
    const uri = def
      ? `${schema.$id}#/definitions/${def}`
      : (schema.$id as string);
    const validate = ajv.getSchema(uri);
    if (!validate) throw new Error(`schema not registered: ${uri}`);
    validators.set(key, validate);
  }
  return validators.get(key)!;
}

function check(name: string, validate: ValidateFunction, data: unknown): void {
  const valid = validate(data);
  assert.ok(
    valid,
    `${name} failed schema validation:\n${JSON.stringify(validate.errors, null, 2)}`,
  );
}

before(() => {
  ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of readdirSync(SCHEMA_DIR)) {
    const schema = readJson(join(SCHEMA_DIR, file));
    ajv.addSchema(schema);
  }
});

test("every checked-in fixture validates against its contract schema", () => {
  const cases: Array<[string, string, string | undefined]> = [
    ["world.json", "world", undefined],
    ["session-state.json", "session", undefined],
    ["map.json", "map", undefined],
    ["history.json", "history", undefined],
    ["command-response-travel-encounter.json", "command-response", undefined],
    ["command-response-travel-moved.json", "command-response", undefined],
    ["command-response-action.json", "command-response", undefined],
    ["tables.json", "creator", "tableList"],
    ["table-validate.json", "creator", "validateResult"],
    ["table-preview.json", "creator", "previewResult"],
    ["creator-history.json", "creator", "creatorHistory"],
    ["error.json", "common", "error"],
  ];
  for (const [fixture, schema, def] of cases) {
    check(
      fixture,
      validator(schema, def),
      readJson(join(FIXTURE_DIR, fixture)),
    );
  }
});

test("every content-pack table validates against the table-definition contract", () => {
  const manifest = readJson(join(CONTENT_DIR, "manifest.json"));
  const validate = validator("table-definition");
  for (const file of manifest.tables as string[]) {
    check(file, validate, readJson(join(CONTENT_DIR, file)));
  }
  const ruleValidate = validator("evolution-rule");
  for (const file of manifest.evolutions as string[]) {
    check(file, ruleValidate, readJson(join(CONTENT_DIR, file)));
  }
});

test("openapi document parses and references existing schema files", () => {
  const doc = readJson(join(ROOT, "contracts/openapi.json"));
  assert.equal(doc.openapi, "3.1.0");
  const refs = JSON.stringify(doc).match(/json-schema\/[a-z-]+\.json/g) ?? [];
  assert.ok(refs.length > 0);
  for (const ref of new Set(refs)) {
    const file = ref.replace("json-schema/", "");
    assert.ok(
      readdirSync(SCHEMA_DIR).includes(file),
      `missing schema file ${file}`,
    );
  }
  const expectedPaths = [
    "/health",
    "/api/v1/worlds",
    "/api/v1/worlds/{worldId}",
    "/api/v1/sessions",
    "/api/v1/sessions/{sessionId}",
    "/api/v1/sessions/{sessionId}/map",
    "/api/v1/sessions/{sessionId}/hexes/{q}/{r}",
    "/api/v1/sessions/{sessionId}/history",
    "/api/v1/sessions/{sessionId}/creator/history",
    "/api/v1/sessions/{sessionId}/commands/travel",
    "/api/v1/sessions/{sessionId}/commands/encounter-action",
    "/api/v1/tables",
    "/api/v1/tables/{id}",
    "/api/v1/tables/validate",
    "/api/v1/tables/preview",
  ];
  for (const path of expectedPaths) {
    assert.ok(doc.paths[path], `openapi is missing path ${path}`);
  }
});
