export type JsonRpcId = string | number | null;

export interface JsonRpcSuccess<T = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: T;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcError;

export interface ToolResultEnvelope<TPayload extends object> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: TPayload;
}

export function rpcSuccess<T>(id: JsonRpcId, result: T): JsonRpcSuccess<T> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

export function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcError {
  const payload: JsonRpcError = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };

  if (data !== undefined) {
    payload.error.data = data;
  }

  return payload;
}

export function toolResult<TPayload extends object>(payload: TPayload): ToolResultEnvelope<TPayload> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}
