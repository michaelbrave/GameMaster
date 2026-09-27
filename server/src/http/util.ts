import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { ApiError } from "../application/errors";

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function errorBody(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
) {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/** Map any thrown error to the shared contract error envelope. */
export function toErrorResponse(
  err: unknown,
  requestId: string,
): { status: number; body: unknown } {
  if (err instanceof ApiError) {
    return {
      status: err.httpStatus,
      body: errorBody(err.code, err.message, requestId, err.details),
    };
  }
  if (err instanceof SyntaxError) {
    return {
      status: 400,
      body: errorBody(
        "validation_failed",
        "request body is not valid JSON",
        requestId,
      ),
    };
  }
  return {
    status: 500,
    body: errorBody("internal_error", "unexpected server error", requestId),
  };
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  requestId: string,
): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-request-id": requestId,
  });
  res.end(payload);
}

/**
 * The client is served by this same process and calls window.location.origin,
 * so requests are same-origin and no CORS grant is needed. Answer preflights
 * without one.
 */
export function sendCorsPreflight(res: ServerResponse): void {
  res.writeHead(204, { "content-length": "0" });
  res.end();
}

export async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000)
      throw new ApiError("validation_failed", "request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Serve a built client asset; path traversal safe. Returns false when missing. */
export async function tryStatic(
  clientDir: string,
  path: string,
  res: ServerResponse,
  requestId: string,
): Promise<boolean> {
  const rel = normalize(path === "/" ? "/index.html" : path).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  const file = join(clientDir, rel);
  if (!file.startsWith(clientDir)) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "x-request-id": requestId,
      // The client bundle is rebuilt during local development; never leave a
      // browser stuck on a previous Elm bundle after a restart.
      "cache-control": "no-store",
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}
