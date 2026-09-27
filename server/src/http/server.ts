import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import type { Logger } from "../logger";
import {
  readBody,
  sendCorsPreflight,
  sendJson,
  toErrorResponse,
  tryStatic,
  errorBody,
} from "./util";

export interface HttpRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  requestId: string;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export type Handler = (req: HttpRequest) => Promise<HttpResponse>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

/** Tiny HTTP application: pattern routing, request IDs, JSON, static client. */
export class HttpApp {
  private routes: Route[] = [];

  constructor(private readonly opts: { logger: Logger; clientDir?: string }) {}

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({
      method,
      segments: pattern.split("/").filter(Boolean),
      handler,
    });
  }

  match(
    method: string,
    path: string,
  ): { handler: Handler; params: Record<string, string> } | null {
    const parts = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length)
        continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i += 1) {
        const seg = route.segments[i];
        if (seg.startsWith(":"))
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }

  listen(port: number): Server {
    const server = createHttpServer((incoming, outgoing) => {
      void this.serve(incoming, outgoing);
    });
    server.listen(port);
    return server;
  }

  private async serve(
    incoming: IncomingMessage,
    outgoing: ServerResponse,
  ): Promise<void> {
    const requestId =
      (incoming.headers["x-request-id"] as string) || randomUUID();
    const log = this.opts.logger.child({ requestId });
    const url = new URL(incoming.url ?? "/", "http://localhost");
    const start = Date.now();
    try {
      if (incoming.method === "OPTIONS") {
        sendCorsPreflight(outgoing);
        return;
      }
      const body = await readBody(incoming);
      const matched = this.match(incoming.method ?? "GET", url.pathname);
      if (matched) {
        const result = await matched.handler({
          method: incoming.method ?? "GET",
          path: url.pathname,
          params: matched.params,
          query: url.searchParams,
          body,
          requestId,
        });
        sendJson(outgoing, result.status, result.body, requestId);
      } else if ((incoming.method ?? "GET") === "GET" && this.opts.clientDir) {
        const served = await tryStatic(
          this.opts.clientDir,
          url.pathname,
          outgoing,
          requestId,
        );
        if (!served)
          sendJson(
            outgoing,
            404,
            errorBody("not_found", "not found", requestId),
            requestId,
          );
      } else {
        sendJson(
          outgoing,
          404,
          errorBody(
            "not_found",
            `no route for ${incoming.method} ${url.pathname}`,
            requestId,
          ),
          requestId,
        );
      }
      log.info("request", {
        method: incoming.method,
        path: url.pathname,
        ms: Date.now() - start,
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err, requestId);
      sendJson(outgoing, status, body, requestId);
      if (status >= 500)
        log.error("request failed", { err: String(err), path: url.pathname });
      else log.info("request rejected", { status, path: url.pathname });
    }
  }
}
