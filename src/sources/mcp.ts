import { spawn } from "node:child_process";
import { validateTools, type MCPTool } from "../core/types.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_RESPONSE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_TOOLS = 10_000;
const DEFAULT_MAX_TOOL_LIST_PAGES = 100;
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_ACCEPT = "application/json, text/event-stream";
const DEFAULT_CONTENT_TYPE = "application/json";
const DEFAULT_CLIENT_INFO = { name: "mcp-size", version: "0.4.0" };
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-01-01", "2025-03-26", "2025-06-18"]);

export type RpcMessage = Record<string, unknown>;
export type FetchLike = typeof globalThis.fetch;

export interface McpDiagnostic {
  event: "request" | "response" | "page" | "retry";
  method: string;
  requestId?: string | number;
  page?: number;
  status?: number;
  bytes?: number;
  attempt?: number;
  durationMs?: number;
}

export class McpRequestError extends Error {
  readonly method: string;
  readonly status?: number;
  readonly requestId?: string | number;
  readonly page?: number;
  readonly code?: number | string;
  readonly protocolVersion?: string;
  readonly retryable: boolean;

  constructor(message: string, fields: { method: string; status?: number; requestId?: string | number; page?: number; code?: number | string; protocolVersion?: string; retryable?: boolean }) {
    super(message);
    this.name = "McpRequestError";
    this.method = fields.method;
    this.status = fields.status;
    this.requestId = fields.requestId;
    this.page = fields.page;
    this.code = fields.code;
    this.protocolVersion = fields.protocolVersion;
    this.retryable = fields.retryable ?? false;
  }
}

export class McpProtocolError extends McpRequestError {
  constructor(message: string, fields: { method: string; requestId?: string | number; page?: number; code?: number | string; protocolVersion?: string }) {
    super(message, fields);
    this.name = "McpProtocolError";
  }
}

export interface McpClientInfo { name?: string; version?: string; }
export interface McpPaginationMetadata { pageCount: number; cursors: string[]; }
export interface McpFetchResult { tools: MCPTool[]; pagination: McpPaginationMetadata; sessionId?: string; }

export interface McpRetryOptions {
  /** Number of retries after the initial attempt. Defaults to 0. Timeout is per attempt. */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff. Defaults to 250. */
  retryDelayMs?: number;
}

export interface McpFetchOptions extends McpRetryOptions {
  headers?: HeadersInit;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxTotalResponseBytes?: number;
  maxTools?: number;
  protocolVersion?: string;
  clientInfo?: McpClientInfo;
  capabilities?: Record<string, unknown>;
  accept?: string;
  contentType?: string;
  maxToolListPages?: number;
  signal?: AbortSignal;
  fetch?: FetchLike;
  onDiagnostic?: (diagnostic: McpDiagnostic) => void;
}

interface NormalizedMcpFetchOptions {
  headers: Headers; timeoutMs: number; maxResponseBytes: number; maxTotalResponseBytes: number; maxTools: number;
  protocolVersion: string; clientInfo: McpClientInfo & { name: string; version: string }; capabilities: Record<string, unknown>;
  accept?: string; contentType?: string; maxToolListPages: number; signal?: AbortSignal; fetch: FetchLike;
  retries: number; retryDelayMs: number; onDiagnostic?: (diagnostic: McpDiagnostic) => void;
}
interface RpcResponse { message?: RpcMessage; sessionId?: string; bytes: number; }
interface FetchState { totalBytes: number; negotiatedProtocolVersion?: string; }

function positiveLimit(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}
function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}
function nonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) throw new Error(`${label} must be a non-empty string without line breaks.`);
  return value;
}
function normalizeOptions(options: McpFetchOptions): NormalizedMcpFetchOptions {
  let headers: Headers;
  try { headers = new Headers(options.headers); } catch { throw new Error("MCP custom HTTP headers are invalid."); }
  const clientInfo = { ...DEFAULT_CLIENT_INFO, ...(options.clientInfo ?? {}) };
  nonEmptyString(clientInfo.name, "MCP client name"); nonEmptyString(clientInfo.version, "MCP client version");
  const capabilities = options.capabilities ?? {};
  if (typeof capabilities !== "object" || capabilities === null || Array.isArray(capabilities)) throw new Error("MCP capabilities must be a JSON object.");
  if (options.fetch !== undefined && typeof options.fetch !== "function") throw new Error("MCP fetch must be a function.");
  return {
    headers, timeoutMs: positiveLimit(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "MCP timeoutMs"),
    maxResponseBytes: positiveLimit(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, "MCP maxResponseBytes"),
    maxTotalResponseBytes: positiveLimit(options.maxTotalResponseBytes ?? DEFAULT_MAX_TOTAL_RESPONSE_BYTES, "MCP maxTotalResponseBytes"),
    maxTools: positiveLimit(options.maxTools ?? DEFAULT_MAX_TOOLS, "MCP maxTools"),
    protocolVersion: nonEmptyString(options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION, "MCP protocolVersion"),
    clientInfo, capabilities,
    accept: options.accept === undefined ? undefined : nonEmptyString(options.accept, "MCP Accept header"),
    contentType: options.contentType === undefined ? undefined : nonEmptyString(options.contentType, "MCP Content-Type header"),
    maxToolListPages: positiveLimit(options.maxToolListPages ?? DEFAULT_MAX_TOOL_LIST_PAGES, "MCP maxToolListPages"),
    signal: options.signal, fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    retries: nonNegativeInteger(options.retries ?? 0, "MCP retries"), retryDelayMs: nonNegativeInteger(options.retryDelayMs ?? 250, "MCP retryDelayMs"),
    onDiagnostic: options.onDiagnostic
  };
}
function requestHeaders(options: NormalizedMcpFetchOptions, sessionId: string | undefined, protocolVersion: string): Headers {
  const headers = new Headers(options.headers);
  if (options.accept !== undefined || !headers.has("accept")) headers.set("accept", options.accept ?? DEFAULT_ACCEPT);
  if (options.contentType !== undefined || !headers.has("content-type")) headers.set("content-type", options.contentType ?? DEFAULT_CONTENT_TYPE);
  headers.set("mcp-protocol-version", protocolVersion);
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return headers;
}
function errorMessage(response: Response): string {
  const challenge = response.headers.get("www-authenticate");
  const scheme = challenge?.match(/^[^\s,]+/)?.[0];
  const suffix = scheme ? ` Server challenge: ${scheme}.` : "";
  if (response.status === 401) return `MCP authentication failed (HTTP 401). Check configured authentication headers.${suffix}`;
  if (response.status === 403) return `MCP authorization denied (HTTP 403). Check credentials and server permissions.${suffix}`;
  return `MCP server returned HTTP ${response.status}.`;
}
function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Math.min(Number(value) * 1000, 60_000);
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.min(Math.max(0, timestamp - Date.now()), 60_000);
  return undefined;
}
function combineSignals(caller: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean; cleanup: () => void } {
  const controller = new AbortController(); let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  if (caller?.aborted) controller.abort(); else caller?.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, timedOut: () => timedOut, cleanup: () => { clearTimeout(timeout); caller?.removeEventListener("abort", abort); } };
}
async function readBody(response: Response, maxBytes: number, total: FetchState, method: string, options: NormalizedMcpFetchOptions, requestId: string | number, page?: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new McpRequestError(`MCP response exceeded the ${maxBytes} byte limit.`, { method, status: response.status, requestId, page, retryable: false });
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = item.value ?? new Uint8Array(); size += chunk.byteLength;
      if (size > maxBytes || total.totalBytes + size > options.maxTotalResponseBytes) {
        await reader.cancel();
        const limit = size > maxBytes ? maxBytes : options.maxTotalResponseBytes;
        throw new McpRequestError(`MCP response exceeded the ${limit} byte limit.`, { method, status: response.status, requestId, page });
      }
      chunks.push(chunk);
    }
  } finally { reader.releaseLock(); }
  total.totalBytes += size;
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
function validateRpc(message: unknown, expectedId: string | number, method: string, page: number | undefined, protocolVersion: string): RpcMessage {
  if (typeof message !== "object" || message === null || Array.isArray(message)) throw new McpProtocolError("MCP server returned an invalid JSON-RPC envelope.", { method, requestId: expectedId, page, protocolVersion });
  const rpc = message as RpcMessage;
  if (rpc.jsonrpc !== "2.0") throw new McpProtocolError("MCP server returned a JSON-RPC envelope without jsonrpc 2.0.", { method, requestId: expectedId, page, protocolVersion });
  if (!("id" in rpc) || (rpc.id !== expectedId)) throw new McpProtocolError("MCP server returned a JSON-RPC response with a mismatched id.", { method, requestId: expectedId, page, protocolVersion });
  if ("method" in rpc) throw new McpProtocolError("MCP server returned a JSON-RPC request/notification where a response was expected.", { method, requestId: expectedId, page, protocolVersion });
  if (rpc.error !== undefined) {
    const error = rpc.error;
    const record = typeof error === "object" && error !== null && !Array.isArray(error) ? error as Record<string, unknown> : {};
    const code = typeof record.code === "number" || typeof record.code === "string" ? record.code : undefined;
    const detail = typeof record.message === "string" ? record.message : "MCP JSON-RPC request failed";
    throw new McpRequestError(`MCP ${method} failed: ${detail}`, { method, requestId: expectedId, page, code, protocolVersion });
  }
  if (!("result" in rpc)) throw new McpProtocolError("MCP server returned neither a result nor an error.", { method, requestId: expectedId, page, protocolVersion });
  return rpc;
}
async function postRpc(url: string, message: RpcMessage, options: NormalizedMcpFetchOptions, state: FetchState, sessionId: string | undefined, protocolVersion: string, allowEmpty = false, page?: number): Promise<RpcResponse> {
  const requestId = message.id as string | number;
  const method = typeof message.method === "string" ? message.method : "notification";
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const started = Date.now(); const combined = combineSignals(options.signal, options.timeoutMs);
    options.onDiagnostic?.({ event: "request", method, requestId, page, attempt: attempt + 1 });
    try {
      const response = await options.fetch(url, { method: "POST", headers: requestHeaders(options, sessionId, protocolVersion), body: JSON.stringify(message), signal: combined.signal });
      const bytes = await readBody(response, options.maxResponseBytes, state, method, options, requestId, page);
      options.onDiagnostic?.({ event: "response", method, requestId, page, status: response.status, bytes: bytes.byteLength, durationMs: Date.now() - started, attempt: attempt + 1 });
      if (!response.ok) {
        const error = new McpRequestError(errorMessage(response), { method, status: response.status, requestId, page, retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
        if (!error.retryable || attempt >= options.retries) throw error;
        const delay = retryAfterMs(response) ?? options.retryDelayMs * (2 ** attempt); options.onDiagnostic?.({ event: "retry", method, requestId, page, status: response.status, attempt: attempt + 1 }); await new Promise((resolve) => setTimeout(resolve, delay)); continue;
      }
      const body = new TextDecoder().decode(bytes); const responseSessionId = response.headers.get("mcp-session-id") ?? undefined;
      if (body.trim() === "") { if (allowEmpty) return { sessionId: responseSessionId, bytes: bytes.byteLength }; throw new McpProtocolError("MCP server returned an empty JSON-RPC response.", { method, requestId, page, protocolVersion }); }
      const contentType = response.headers.get("content-type") ?? "";
      let parsed: unknown;
      if (contentType.includes("text/event-stream")) {
        const events = body.split(/\r?\n\r?\n/).flatMap((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean));
        parsed = JSON.parse(events.at(-1) ?? "");
      } else parsed = JSON.parse(body);
      return { message: validateRpc(parsed, requestId, method, page, protocolVersion), sessionId: responseSessionId, bytes: bytes.byteLength };
    } catch (error) {
      if (error instanceof McpRequestError && !error.retryable) throw error;
      if (combined.timedOut()) lastError = new McpRequestError(`MCP request timed out after ${options.timeoutMs} ms.`, { method, requestId, page, protocolVersion, retryable: true });
      else if (options.signal?.aborted) throw new McpRequestError("MCP request was aborted.", { method, requestId, page, protocolVersion });
      else if (error instanceof SyntaxError) throw new McpProtocolError("MCP server returned invalid JSON.", { method, requestId, page, protocolVersion });
      else lastError = new McpRequestError(`MCP ${method} request failed.`, { method, requestId, page, protocolVersion, retryable: true });
      if (attempt >= options.retries) throw lastError;
      options.onDiagnostic?.({ event: "retry", method, requestId, page, attempt: attempt + 1 });
      await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs * (2 ** attempt)));
    } finally { combined.cleanup(); }
  }
  throw lastError;
}
function toolsFromResponse(response: RpcResponse, method: string, page: number | undefined, protocolVersion: string): { tools: MCPTool[]; nextCursor?: string } {
  const result = response.message?.result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw new McpProtocolError("MCP tools/list response did not contain a result object.", { method, page, protocolVersion });
  const record = result as Record<string, unknown>; const tools = validateTools(record.tools, "MCP tools/list result"); const raw = record.nextCursor;
  if (raw !== undefined && (typeof raw !== "string" || raw.trim() === "")) throw new McpProtocolError("MCP tools/list response nextCursor must be a non-empty string when present.", { method, page, protocolVersion });
  return { tools, nextCursor: typeof raw === "string" ? raw : undefined };
}
function validateEndpoint(endpoint: string): void {
  let parsed: URL; try { parsed = new URL(endpoint); } catch { throw new Error("Invalid MCP server URL."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MCP server URL must use http or https.");
}

interface PageMetadata { sessionId?: string; cursors: string[]; pageCount: number; }
async function* fetchMcpToolPagesInternal(endpoint: string, options: McpFetchOptions = {}, metadata?: PageMetadata): AsyncGenerator<MCPTool[], void, void> {
  validateEndpoint(endpoint); const requestOptions = normalizeOptions(options); const state: FetchState = { totalBytes: 0 }; let sessionId: string | undefined;
  const initialize = await postRpc(endpoint, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: requestOptions.protocolVersion, capabilities: requestOptions.capabilities, clientInfo: requestOptions.clientInfo } }, requestOptions, state, sessionId, requestOptions.protocolVersion);
  sessionId = initialize.sessionId ?? sessionId;
  const initResult = initialize.message?.result;
  if (typeof initResult !== "object" || initResult === null || Array.isArray(initResult) || typeof (initResult as Record<string, unknown>).protocolVersion !== "string") throw new McpProtocolError("MCP initialize response did not negotiate a protocolVersion.", { method: "initialize", requestId: 1, protocolVersion: requestOptions.protocolVersion });
  const negotiated = (initResult as Record<string, unknown>).protocolVersion as string;
  if (!SUPPORTED_PROTOCOL_VERSIONS.has(negotiated)) throw new McpProtocolError(`MCP server negotiated unsupported protocol version ${negotiated}.`, { method: "initialize", requestId: 1, protocolVersion: negotiated });
  state.negotiatedProtocolVersion = negotiated;
  const initialized = await postRpc(endpoint, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, requestOptions, state, sessionId, negotiated, true);
  sessionId = initialized.sessionId ?? sessionId;
  if (metadata) metadata.sessionId = sessionId;
  const seen = new Set<string>(); let cursor: string | undefined; let page = 0; let totalTools = 0;
  while (true) {
    if (page >= requestOptions.maxToolListPages) throw new McpRequestError(`MCP tools/list exceeded the maximum of ${requestOptions.maxToolListPages} pages.`, { method: "tools/list", page, protocolVersion: negotiated });
    const listed = await postRpc(endpoint, { jsonrpc: "2.0", id: page + 2, method: "tools/list", params: cursor === undefined ? {} : { cursor } }, requestOptions, state, sessionId, negotiated, false, page + 1);
    sessionId = listed.sessionId ?? sessionId; const result = toolsFromResponse(listed, "tools/list", page + 1, negotiated);
    if (totalTools + result.tools.length > requestOptions.maxTools) throw new McpRequestError(`MCP tools/list exceeded the maximum of ${requestOptions.maxTools} tools.`, { method: "tools/list", requestId: page + 2, page: page + 1, protocolVersion: negotiated });
    totalTools += result.tools.length; page += 1; metadata && (metadata.pageCount = page); options.onDiagnostic?.({ event: "page", method: "tools/list", requestId: page + 1, page, bytes: listed.bytes }); yield result.tools;
    if (result.nextCursor === undefined) return;
    if (seen.has(result.nextCursor)) throw new McpProtocolError("MCP tools/list returned a repeated tools/list cursor; refusing to loop forever.", { method: "tools/list", page, protocolVersion: negotiated });
    seen.add(result.nextCursor); metadata?.cursors.push(result.nextCursor); cursor = result.nextCursor;
  }
}
export async function* fetchMcpToolPages(endpoint: string, options: McpFetchOptions = {}): AsyncGenerator<MCPTool[], void, void> {
  yield* fetchMcpToolPagesInternal(endpoint, options);
}

export async function fetchMcpToolsWithMetadata(endpoint: string, options: McpFetchOptions = {}): Promise<McpFetchResult> {
  const tools: MCPTool[] = []; const metadata: PageMetadata = { pageCount: 0, cursors: [] };
  for await (const page of fetchMcpToolPagesInternal(endpoint, options, metadata)) tools.push(...page);
  return { tools, pagination: { pageCount: metadata.pageCount, cursors: metadata.cursors }, sessionId: metadata.sessionId };
}
export async function fetchMcpTools(endpoint: string, options: McpFetchOptions = {}): Promise<MCPTool[]> { return (await fetchMcpToolsWithMetadata(endpoint, options)).tools; }

export interface McpStdioOptions extends McpFetchOptions { args?: string[]; maxOutputBytes?: number; }
function parseStdioMessages(buffer: Buffer): unknown[] {
  const messages: unknown[] = []; let offset = 0;
  while (offset < buffer.byteLength) {
    while (offset < buffer.byteLength && /\s/.test(String.fromCharCode(buffer[offset]!))) offset += 1;
    if (offset >= buffer.byteLength) break;
    const headerEnd = buffer.indexOf("\r\n\r\n", offset);
    if (headerEnd >= offset && buffer.subarray(offset, headerEnd).toString("utf8").toLowerCase().includes("content-length:")) {
      const header = buffer.subarray(offset, headerEnd).toString("utf8"); const match = header.match(/content-length:\s*(\d+)/i);
      if (!match) throw new Error("MCP stdio response has an invalid Content-Length header.");
      const length = Number(match[1]); const start = headerEnd + 4; const end = start + length;
      if (end > buffer.byteLength) throw new Error("MCP stdio response ended before Content-Length bytes were received.");
      messages.push(JSON.parse(buffer.subarray(start, end).toString("utf8"))); offset = end; continue;
    }
    const lineEnd = buffer.indexOf(10, offset); const end = lineEnd < 0 ? buffer.byteLength : lineEnd;
    messages.push(JSON.parse(buffer.subarray(offset, end).toString("utf8"))); offset = lineEnd < 0 ? buffer.byteLength : lineEnd + 1;
  }
  return messages;
}
export async function fetchMcpToolsStdio(executable: string, args: string[] = [], options: McpStdioOptions = {}): Promise<MCPTool[]> {
  nonEmptyString(executable, "stdio executable"); if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("stdio args must be an array of strings.");
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], shell: false }); const max = options.maxOutputBytes ?? options.maxTotalResponseBytes ?? DEFAULT_MAX_TOTAL_RESPONSE_BYTES; positiveLimit(max, "stdio maxOutputBytes");
  let output = ""; let bytes = 0; let stderr = ""; const timer = setTimeout(() => child.kill(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes > max) child.kill(); else output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8").slice(0, 1000); });
    const messages = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION, capabilities: options.capabilities ?? {}, clientInfo: { ...DEFAULT_CLIENT_INFO, ...(options.clientInfo ?? {}) } } }, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }];
    child.stdin.end(messages.map((message) => `${JSON.stringify(message)}\n`).join(""));
    await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("close", (code) => code === 0 || code === null ? resolve() : reject(new Error(`MCP stdio process exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`))); });
    if (bytes > max) throw new McpRequestError(`MCP stdio output exceeded the ${max} byte limit.`, { method: "tools/list" });
    const response = parseStdioMessages(Buffer.from(output, "utf8")).find((value) => typeof value === "object" && value !== null && (value as Record<string, unknown>).id === 2);
    return toolsFromResponse({ message: validateRpc(response, 2, "tools/list", 1, options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION), bytes }, "tools/list", 1, options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION).tools;
  } catch (error) { if (error instanceof Error && error.message.startsWith("MCP stdio")) throw error; throw new Error(`MCP stdio request failed: ${error instanceof Error ? error.message : String(error)}`); }
  finally { clearTimeout(timer); if (!child.killed) child.kill(); }
}
