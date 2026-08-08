import { validateTools, type MCPTool } from "../core/types.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOOL_LIST_PAGES = 100;
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_ACCEPT = "application/json, text/event-stream";
const DEFAULT_CONTENT_TYPE = "application/json";
const DEFAULT_CLIENT_INFO = { name: "mcp-size", version: "0.1.0" };

type RpcMessage = Record<string, unknown>;

interface RpcResponse {
  message?: RpcMessage;
  sessionId?: string;
}

export interface McpClientInfo {
  name?: string;
  version?: string;
}

export interface McpPaginationMetadata {
  pageCount: number;
  cursors: string[];
}

export interface McpFetchResult {
  tools: MCPTool[];
  pagination: McpPaginationMetadata;
  sessionId?: string;
}

export interface McpFetchOptions {
  /** Custom HTTP headers, including Authorization, API-key, tenant, and vendor headers. */
  headers?: HeadersInit;
  timeoutMs?: number;
  maxResponseBytes?: number;
  protocolVersion?: string;
  clientInfo?: McpClientInfo;
  capabilities?: Record<string, unknown>;
  accept?: string;
  contentType?: string;
  maxToolListPages?: number;
}

interface NormalizedMcpFetchOptions {
  headers: Headers;
  timeoutMs: number;
  maxResponseBytes: number;
  protocolVersion: string;
  clientInfo: McpClientInfo;
  capabilities: Record<string, unknown>;
  accept?: string;
  contentType?: string;
  maxToolListPages: number;
}

function rpcError(message: RpcMessage): string | undefined {
  const error = message.error;
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  return typeof record.message === "string" ? record.message : "MCP request failed";
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) throw new Error(`${label} must be a non-empty string without line breaks.`);
  return value;
}

function normalizeOptions(options: McpFetchOptions): NormalizedMcpFetchOptions {
  let headers: Headers;
  try {
    headers = new Headers(options.headers);
  } catch {
    throw new Error("MCP custom HTTP headers are invalid.");
  }
  const clientInfo: McpClientInfo & { name: string; version: string } = {
    ...DEFAULT_CLIENT_INFO,
    ...(options.clientInfo ?? {})
  };
  nonEmptyString(clientInfo.name, "MCP client name");
  nonEmptyString(clientInfo.version, "MCP client version");
  const capabilities = options.capabilities ?? {};
  if (typeof capabilities !== "object" || capabilities === null || Array.isArray(capabilities)) throw new Error("MCP capabilities must be a JSON object.");
  const accept = options.accept === undefined ? undefined : nonEmptyString(options.accept, "MCP Accept header");
  const contentType = options.contentType === undefined ? undefined : nonEmptyString(options.contentType, "MCP Content-Type header");
  return {
    headers,
    timeoutMs: positiveLimit(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "MCP timeoutMs"),
    maxResponseBytes: positiveLimit(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, "MCP maxResponseBytes"),
    protocolVersion: nonEmptyString(options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION, "MCP protocolVersion"),
    clientInfo,
    capabilities,
    accept,
    contentType,
    maxToolListPages: positiveLimit(options.maxToolListPages ?? DEFAULT_MAX_TOOL_LIST_PAGES, "MCP maxToolListPages")
  };
}

function requestHeaders(options: NormalizedMcpFetchOptions, sessionId: string | undefined): Headers {
  const headers = new Headers(options.headers);
  if (options.accept !== undefined || !headers.has("accept")) headers.set("accept", options.accept ?? DEFAULT_ACCEPT);
  if (options.contentType !== undefined || !headers.has("content-type")) headers.set("content-type", options.contentType ?? DEFAULT_CONTENT_TYPE);
  headers.set("mcp-protocol-version", options.protocolVersion);
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return headers;
}

function httpError(response: Response): Error {
  const challenge = response.headers.get("www-authenticate");
  const scheme = challenge?.match(/^[^\s,]+/)?.[0];
  const challengeContext = scheme ? ` Server challenge: ${scheme}.` : "";
  if (response.status === 401) return new Error(`MCP authentication failed (HTTP 401). Check configured Authorization, API-key, or other authentication headers.${challengeContext}`);
  if (response.status === 403) return new Error(`MCP authorization denied (HTTP 403). Check credentials, tenant headers, and server permissions.${challengeContext}`);
  return new Error(`MCP server returned HTTP ${response.status}.`);
}

async function postRpc(url: string, message: RpcMessage, options: NormalizedMcpFetchOptions, sessionId: string | undefined, allowEmpty = false): Promise<RpcResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: requestHeaders(options, sessionId),
      body: JSON.stringify(message),
      signal: controller.signal
    });
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > options.maxResponseBytes) throw new Error(`MCP response exceeded the ${options.maxResponseBytes} byte limit.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > options.maxResponseBytes) throw new Error(`MCP response exceeded the ${options.maxResponseBytes} byte limit.`);
    if (!response.ok) throw httpError(response);
    const body = new TextDecoder().decode(bytes);
    const responseSessionId = response.headers.get("mcp-session-id") ?? undefined;
    if (body.trim() === "") {
      if (allowEmpty) return { sessionId: responseSessionId };
      throw new Error("MCP server returned an empty JSON-RPC response.");
    }
    const contentType = response.headers.get("content-type") ?? "";
    let parsed: unknown;
    if (contentType.includes("text/event-stream")) {
      const events = body.split(/\r?\n\r?\n/).flatMap((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean));
      parsed = JSON.parse(events.at(-1) ?? "") as unknown;
    } else {
      parsed = JSON.parse(body) as unknown;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("MCP server returned an invalid JSON-RPC response.");
    const rpc = parsed as RpcMessage;
    const error = rpcError(rpc);
    if (error) throw new Error(error);
    return { message: rpc, sessionId: responseSessionId };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`MCP request timed out after ${options.timeoutMs} ms.`);
    if (error instanceof SyntaxError) throw new Error("MCP server returned invalid JSON.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toolsFromResponse(response: RpcResponse): { tools: MCPTool[]; nextCursor?: string } {
  const result = response.message?.result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw new Error("MCP tools/list response did not contain a result object.");
  const resultRecord = result as Record<string, unknown>;
  const tools = validateTools(resultRecord.tools, "MCP tools/list result");
  const rawNextCursor = resultRecord.nextCursor;
  if (rawNextCursor !== undefined && (typeof rawNextCursor !== "string" || rawNextCursor.trim() === "")) throw new Error("MCP tools/list response nextCursor must be a non-empty string when present.");
  const nextCursor = typeof rawNextCursor === "string" ? rawNextCursor : undefined;
  return { tools, nextCursor };
}

function validateEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`Invalid MCP server URL: ${endpoint}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MCP server URL must use http or https.");
}

export async function fetchMcpToolsWithMetadata(endpoint: string, options: McpFetchOptions = {}): Promise<McpFetchResult> {
  validateEndpoint(endpoint);
  const requestOptions = normalizeOptions(options);
  let sessionId: string | undefined;
  const initialize = await postRpc(endpoint, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: requestOptions.protocolVersion,
      capabilities: requestOptions.capabilities,
      clientInfo: requestOptions.clientInfo
    }
  }, requestOptions, sessionId);
  sessionId = initialize.sessionId ?? sessionId;
  const initialized = await postRpc(endpoint, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, requestOptions, sessionId, true);
  sessionId = initialized.sessionId ?? sessionId;

  const tools: MCPTool[] = [];
  const cursors: string[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  while (true) {
    if (pageCount >= requestOptions.maxToolListPages) throw new Error(`MCP tools/list exceeded the maximum of ${requestOptions.maxToolListPages} pages; increase maxToolListPages if the server is trusted.`);
    const listed = await postRpc(endpoint, {
      jsonrpc: "2.0",
      id: pageCount + 2,
      method: "tools/list",
      params: cursor === undefined ? {} : { cursor }
    }, requestOptions, sessionId);
    sessionId = listed.sessionId ?? sessionId;
    const page = toolsFromResponse(listed);
    tools.push(...page.tools);
    pageCount += 1;
    if (page.nextCursor === undefined) return { tools, pagination: { pageCount, cursors }, sessionId };
    if (seenCursors.has(page.nextCursor)) throw new Error("MCP tools/list returned a repeated tools/list cursor; refusing to loop forever.");
    seenCursors.add(page.nextCursor);
    cursors.push(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export async function fetchMcpTools(endpoint: string, options: McpFetchOptions = {}): Promise<MCPTool[]> {
  return (await fetchMcpToolsWithMetadata(endpoint, options)).tools;
}
