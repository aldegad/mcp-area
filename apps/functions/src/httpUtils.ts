export type JsonObject = Record<string, unknown>;

export interface RequestLike {
  method?: string;
  path?: string;
  url?: string;
  body?: unknown;
}

export interface ResponseLike {
  status(code: number): ResponseLike;
  json(payload: unknown): ResponseLike;
  send(body: string): void;
}

export function normalizePath(req: RequestLike): string {
  const pathWithQuery = req.path || req.url || "/";
  const pathOnly = pathWithQuery.split("?")[0] || "/";

  if (pathOnly === "/api") {
    return "/";
  }

  if (pathOnly.startsWith("/api/")) {
    return pathOnly.slice(4);
  }

  return pathOnly;
}

export function safeJsonBody(req: RequestLike): JsonObject {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "object" && req.body !== null && !Array.isArray(req.body)) {
    return req.body as JsonObject;
  }

  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as JsonObject;
      }

      throw new Error("JSON body must be an object");
    } catch (_error) {
      throw new Error("invalid JSON body");
    }
  }

  return {};
}

export function errorResponse(
  res: ResponseLike,
  status: number,
  message: string,
  details?: unknown
): ResponseLike {
  const payload: { error: string; details?: unknown } = { error: message };
  if (details !== undefined) {
    payload.details = details;
  }

  return res.status(status).json(payload);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return String(error);
}
