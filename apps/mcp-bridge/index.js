#!/usr/bin/env node

const DEFAULT_API_BASE = "http://127.0.0.1:5001/mcp-arena-local/us-central1/api";
const apiBaseUrl = (process.env.MCP_ARENA_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, "");

function writeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([header, body]));
}

function rpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }

  return {
    jsonrpc: "2.0",
    id,
    error,
  };
}

async function callArenaMcp(method, params, id) {
  const response = await fetch(`${apiBaseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: id || "bridge-forward",
      method,
      params,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const reason = data?.error?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(`mcp-arena API error: ${reason}`);
  }

  return data.result;
}

async function handleMessage(request) {
  const id = request.id;

  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return rpcError(id ?? null, -32600, "Invalid Request");
  }

  if (request.method === "notifications/initialized") {
    return null;
  }

  if (request.method === "initialize") {
    return rpcResult(id ?? null, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "mcp-arena-bridge",
        version: "0.2.0",
      },
      instructions:
        "This MCP bridge forwards tools/list and tools/call to mcp-arena HTTP API /mcp endpoint.",
    });
  }

  if (request.method === "ping") {
    return rpcResult(id ?? null, {});
  }

  if (request.method === "tools/list" || request.method === "tools/call") {
    try {
      const result = await callArenaMcp(request.method, request.params || {}, id);
      return rpcResult(id ?? null, result);
    } catch (error) {
      return rpcError(id ?? null, -32000, "Tool execution failed", error.message);
    }
  }

  return rpcError(id ?? null, -32601, `Method not found: ${request.method}`);
}

let buffered = Buffer.alloc(0);

function processBuffer() {
  while (true) {
    const headerEnd = buffered.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }

    const headerText = buffered.slice(0, headerEnd).toString("utf8");
    const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      process.stderr.write("[mcp-arena-bridge] Invalid header: missing Content-Length\n");
      buffered = Buffer.alloc(0);
      return;
    }

    const contentLength = Number.parseInt(lengthMatch[1], 10);
    const messageEnd = headerEnd + 4 + contentLength;

    if (buffered.length < messageEnd) {
      return;
    }

    const bodyBuffer = buffered.slice(headerEnd + 4, messageEnd);
    buffered = buffered.slice(messageEnd);

    let request;
    try {
      request = JSON.parse(bodyBuffer.toString("utf8"));
    } catch (error) {
      writeMessage(rpcError(null, -32700, "Parse error", error.message));
      continue;
    }

    Promise.resolve(handleMessage(request))
      .then((responsePayload) => {
        if (responsePayload && request.id !== undefined) {
          writeMessage(responsePayload);
        }
      })
      .catch((error) => {
        if (request.id !== undefined) {
          writeMessage(rpcError(request.id, -32000, "Internal bridge error", error.message));
        }
      });
  }
}

process.stdin.on("data", (chunk) => {
  buffered = Buffer.concat([buffered, chunk]);
  processBuffer();
});

process.stdin.on("end", () => {
  process.exit(0);
});

process.on("SIGINT", () => {
  process.exit(0);
});

process.stderr.write(`[mcp-arena-bridge] started -> ${apiBaseUrl}/mcp\n`);
