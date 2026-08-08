import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fetchMcpTools, type McpFetchOptions } from "../src/sources/mcp.js";
import { loadToolsFromJsonFile, parseToolsDocument } from "../src/sources/json.js";

test("loads a plain JSON array and an object with tools", () => {
  assert.equal(parseToolsDocument([{ name: "a" }], "fixture").length, 1);
  assert.equal(parseToolsDocument({ tools: [{ name: "b" }] }, "fixture")[0]?.name, "b");
});

test("rejects invalid JSON source shapes", () => {
  assert.throws(() => parseToolsDocument({ tools: "nope" }, "fixture"), /Expected fixture to contain/);
  assert.throws(() => parseToolsDocument([{ name: 1 }], "fixture"), /Tool at index 0 must have/);
});

test("loads a JSON file and reports missing files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-size-"));
  const file = join(directory, "tools.json");
  await writeFile(file, JSON.stringify([{ name: "file-tool" }]), "utf8");
  assert.equal((await loadToolsFromJsonFile(file))[0]?.name, "file-tool");
  await assert.rejects(loadToolsFromJsonFile(join(directory, "missing.json")), /Unable to read MCP tools from/);
  await rm(directory, { recursive: true, force: true });
});

test("fetches tools using initialize and official tools/list JSON-RPC methods", async () => {
  const requests: string[] = [];
  let listSession = "";
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const message = JSON.parse(body) as { method: string };
    requests.push(message.method);
    if (message.method === "tools/list") {
      const sessionHeader = request.headers["mcp-session-id"];
      listSession = Array.isArray(sessionHeader) ? (sessionHeader[0] ?? "") : (sessionHeader ?? "");
    }
    response.setHeader("content-type", "application/json");
    if (message.method === "initialize") {
      response.setHeader("mcp-session-id", "test-session");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test", version: "0" } } }));
    } else if (message.method === "tools/list") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "remote" }] } }));
    } else {
      response.end(JSON.stringify({ jsonrpc: "2.0", result: {} }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const tools = await fetchMcpTools(`http://127.0.0.1:${address.port}/mcp`);
  assert.deepEqual(tools, [{ name: "remote" }]);
  assert.deepEqual(requests, ["initialize", "notifications/initialized", "tools/list"]);
  assert.equal(listSession, "test-session");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("sends custom headers and configurable initialize negotiation and follows tool pages", async () => {
  const methods: string[] = [];
  const cursors: unknown[] = [];
  let initializeParams: Record<string, unknown> | undefined;
  let receivedAuthorization = "";
  let receivedApiKey = "";
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const message = JSON.parse(body) as { method: string; params?: Record<string, unknown> };
    methods.push(message.method);
    receivedAuthorization = Array.isArray(request.headers.authorization) ? (request.headers.authorization[0] ?? "") : (request.headers.authorization ?? "");
    receivedApiKey = Array.isArray(request.headers["x-api-key"]) ? (request.headers["x-api-key"][0] ?? "") : (request.headers["x-api-key"] ?? "");
    if (message.method === "initialize") initializeParams = message.params;
    if (message.method === "tools/list") cursors.push(message.params?.cursor);
    response.setHeader("content-type", "application/json");
    if (message.method === "initialize") {
      response.setHeader("mcp-session-id", "negotiated-session");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-01-01", capabilities: {}, serverInfo: { name: "test", version: "0" } } }));
    } else if (message.method === "tools/list" && message.params?.cursor === undefined) {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "first" }], nextCursor: "page-2" } }));
    } else {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { tools: [{ name: "second" }] } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const options = {
    headers: { Authorization: "Bearer placeholder-token", "X-API-Key": "placeholder-api-key" },
    protocolVersion: "2025-01-01",
    clientInfo: { name: "custom-client", version: "9.0.0" },
    capabilities: { experimental: { enabled: true } },
    accept: "application/json",
    maxToolListPages: 3
  } as McpFetchOptions;
  const tools = await fetchMcpTools(`http://127.0.0.1:${(address as import("node:net").AddressInfo).port}/mcp`, options);
  assert.deepEqual(tools.map((tool) => tool.name), ["first", "second"]);
  assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list", "tools/list"]);
  assert.deepEqual(cursors, [undefined, "page-2"]);
  assert.equal(receivedAuthorization, "Bearer placeholder-token");
  assert.equal(receivedApiKey, "placeholder-api-key");
  assert.deepEqual(initializeParams, {
    protocolVersion: "2025-01-01",
    capabilities: { experimental: { enabled: true } },
    clientInfo: { name: "custom-client", version: "9.0.0" }
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("rejects repeated cursors and page-limit overflows", async () => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const message = JSON.parse(body) as { method: string };
    response.setHeader("content-type", "application/json");
    if (message.method === "initialize") response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    else if (message.method === "tools/list") response.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "loop" }], nextCursor: "same" } }));
    else response.end(JSON.stringify({ jsonrpc: "2.0", result: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${(address as import("node:net").AddressInfo).port}/mcp`;
  await assert.rejects(fetchMcpTools(endpoint, { maxToolListPages: 5 } as McpFetchOptions), /repeated tools\/list cursor/i);
  await assert.rejects(fetchMcpTools(endpoint, { maxToolListPages: 1 } as McpFetchOptions), /maximum.*pages/i);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("reports actionable authentication and pagination response errors", async () => {
  const statuses = [401, 403];
  for (const status of statuses) {
    const server = createServer(async (_request, response) => {
      response.statusCode = status;
      if (status === 401) response.setHeader("www-authenticate", "Bearer realm=example");
      response.end("denied");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(fetchMcpTools(`http://127.0.0.1:${(address as import("node:net").AddressInfo).port}/mcp`), new RegExp(`HTTP ${status}`));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const message = JSON.parse(body) as { method: string };
    response.setHeader("content-type", "application/json");
    if (message.method === "initialize") response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    else if (message.method === "tools/list") response.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [], nextCursor: 42 } }));
    else response.end(JSON.stringify({ jsonrpc: "2.0", result: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await assert.rejects(fetchMcpTools(`http://127.0.0.1:${(address as import("node:net").AddressInfo).port}/mcp`), /nextCursor.*string/i);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
