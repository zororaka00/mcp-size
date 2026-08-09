#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { analyzeTools, compareAnalyses, fetchMcpTools, fetchMcpToolsStdio, loadToolsFromJsonFile, parseBaselineDocument, type AnalysisDiff, type AnalysisResult, type McpFetchOptions, type MCPTool } from "../index.js";
import { renderHumanDiff, renderHumanReport, sortTools, type SortField } from "./reporter.js";

const VERSION = "0.4.0";
const SORT_FIELDS: SortField[] = ["tokens", "name", "description", "inputSchema", "outputSchema"];
const VALUE_FLAGS = new Set([
  "--budget", "--top", "--sort", "--header", "--timeout-ms", "--max-response-bytes", "--max-tool-list-pages",
  "--protocol-version", "--client-name", "--client-version", "--accept", "--content-type", "--max-total-response-bytes", "--max-tools", "--retries", "--retry-delay-ms", "--max-input-bytes", "--baseline", "--max-increase", "--stdio", "--stdio-arg"
]);

interface CliOptions {
  mode: "report" | "diff";
  source?: string;
  diffBaseline?: string;
  json: boolean;
  budget?: number;
  top?: number;
  sort: SortField;
  noColor: boolean;
  verbose: boolean;
  headers: Array<[string, string]>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  protocolVersion?: string;
  clientName?: string;
  clientVersion?: string;
  accept?: string;
  contentType?: string;
  maxToolListPages?: number;
  maxTotalResponseBytes?: number;
  maxTools?: number;
  retries?: number;
  retryDelayMs?: number;
  maxInputBytes?: number;
  baseline?: string;
  maxIncrease?: number;
  stdio?: string;
  stdioArgs: string[];
  help: boolean;
  version: boolean;
}

function helpText(): string {
  return `Usage: mcp-size <file.json|http://server/mcp> [options]
       mcp-size diff <current> --baseline <baseline.json> [options]

Estimate the context size of MCP tool definitions.

Options:
  --json              Emit machine-readable JSON only
  --budget <tokens>   Exit 1 when total estimated tokens exceed the budget
  --top <number>      Show only the largest (or sorted) tools
  --sort <field>      tokens, name, description, inputSchema, outputSchema
  --header <Name:Value>
                      Add a custom HTTP header; repeat as needed
  --timeout-ms <ms>   HTTP request timeout (default: 15000)
  --max-response-bytes <bytes>
                      Maximum HTTP response size (default: 10485760)
  --max-tool-list-pages <number>
                      Maximum tools/list pages (default: 100)
  --max-total-response-bytes <bytes>
                      Maximum aggregate HTTP response bytes (default: 52428800)
  --max-tools <number> Maximum aggregate MCP tools (default: 10000)
  --retries <number>  Opt-in retries (timeout/network/408/429/5xx; default: 0)
  --retry-delay-ms <ms>
                      Retry backoff base (timeout is per attempt)
  --max-input-bytes <bytes>
                      Maximum local JSON/stdin input (default: 10485760)
  --baseline <file>   Compare total and per-tool tokens with a JSON report
  --max-increase <tokens>
                      Allowed total, per-tool, and component increase (default: 0)
  --stdio <executable>
                      Run an MCP stdio executable without a shell
  --stdio-arg <arg>   Append one argument to --stdio; repeat as needed
  --protocol-version <version>
                      MCP protocol version (default: 2025-06-18)
  --client-name <name>
                      MCP initialize client name
  --client-version <version>
                      MCP initialize client version
  --accept <media-types>
                      HTTP Accept header (default: application/json, text/event-stream)
  --content-type <media-type>
                      HTTP Content-Type header (default: application/json)
  --no-color          Disable terminal colors (colors are not required)
  --verbose           Include a stack trace on errors
  --version           Print the package version
  --help              Show this help

The diff command reports added, removed, and modified tools plus total and component deltas.
Exit codes: 0 success, 1 budget/regression exceeded, 2 invalid input or runtime error.

For secrets, prefer MCP_SIZE_HEADERS (one Name:Value per line) or the library API.
Shell history and process listings can expose values passed to --header.
`;
}

function positiveInteger(value: string, flag: string, allowZero = false): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a ${allowZero ? "non-negative" : "positive"} integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (!allowZero && parsed < 1)) throw new Error(`${flag} is out of range.`);
  return parsed;
}

function textValue(value: string, flag: string): string {
  if (value.trim() === "" || /[\r\n]/.test(value)) throw new Error(`${flag} must be a non-empty string without line breaks.`);
  return value;
}

function parseHeader(value: string, flag: string): [string, string] {
  const separator = value.indexOf(":");
  const name = separator < 0 ? "" : value.slice(0, separator).trim();
  const headerValue = separator < 0 ? "" : value.slice(separator + 1).trim();
  if (!name || /[\r\n]/.test(value) || /[\r\n]/.test(headerValue)) throw new Error(`${flag} must use Name:Value format without line breaks.`);
  return [name, headerValue];
}

function setValue(options: CliOptions, flag: string, value: string): void {
  if (flag === "--budget") options.budget = positiveInteger(value, flag, true);
  else if (flag === "--top") options.top = positiveInteger(value, flag);
  else if (flag === "--sort") {
    if (!SORT_FIELDS.includes(value as SortField)) throw new Error(`--sort must be one of: ${SORT_FIELDS.join(", ")}.`);
    options.sort = value as SortField;
  } else if (flag === "--header") options.headers.push(parseHeader(value, flag));
  else if (flag === "--timeout-ms") options.timeoutMs = positiveInteger(value, flag);
  else if (flag === "--max-response-bytes") options.maxResponseBytes = positiveInteger(value, flag);
  else if (flag === "--max-tool-list-pages") options.maxToolListPages = positiveInteger(value, flag);
  else if (flag === "--max-total-response-bytes") options.maxTotalResponseBytes = positiveInteger(value, flag);
  else if (flag === "--max-tools") options.maxTools = positiveInteger(value, flag);
  else if (flag === "--retries") options.retries = positiveInteger(value, flag, true);
  else if (flag === "--retry-delay-ms") options.retryDelayMs = positiveInteger(value, flag, true);
  else if (flag === "--max-input-bytes") options.maxInputBytes = positiveInteger(value, flag);
  else if (flag === "--baseline") options.baseline = value;
  else if (flag === "--max-increase") options.maxIncrease = positiveInteger(value, flag, true);
  else if (flag === "--stdio") options.stdio = value;
  else if (flag === "--stdio-arg") options.stdioArgs.push(value);
  else if (flag === "--protocol-version") options.protocolVersion = textValue(value, flag);
  else if (flag === "--client-name") options.clientName = textValue(value, flag);
  else if (flag === "--client-version") options.clientVersion = textValue(value, flag);
  else if (flag === "--accept") options.accept = textValue(value, flag);
  else if (flag === "--content-type") options.contentType = textValue(value, flag);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mode: "report", json: false, sort: "tokens", noColor: false, verbose: false, headers: [], stdioArgs: [], help: false, version: false };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (index === 0 && arg === "diff") options.mode = "diff";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--no-color") options.noColor = true;
    else if (arg === "--verbose") options.verbose = true;
    else if (VALUE_FLAGS.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      setValue(options, arg, value);
    } else {
      const separator = arg.indexOf("=");
      const flag = separator < 0 ? "" : arg.slice(0, separator);
      if (separator > 0 && VALUE_FLAGS.has(flag)) {
        const value = arg.slice(separator + 1);
        if (!value) throw new Error(`${flag} requires a value.`);
        setValue(options, flag, value);
      } else if (arg.startsWith("-") && arg !== "-") throw new Error(`Unknown option: ${arg}`);
      else positional.push(arg);
    }
  }
  if (options.mode === "diff") {
    if (positional.length === 2 && !options.baseline) {
      options.diffBaseline = positional[0];
      options.source = positional[1];
    } else if (positional.length === 1) {
      options.source = positional[0];
    } else if (positional.length > 2) {
      throw new Error("Diff accepts a current source and baseline, either as two sources or with --baseline.");
    }
  } else {
    if (positional.length > 1) throw new Error("Only one source may be provided.");
    options.source = positional[0];
  }
  if (options.stdio && options.source) throw new Error("Use either a JSON/HTTP source or --stdio, not both.");
  return options;
}

function environmentHeaders(): Array<[string, string]> {
  const value = process.env.MCP_SIZE_HEADERS;
  if (!value) return [];
  return value.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => parseHeader(line, "MCP_SIZE_HEADERS"));
}

async function loadSource(source: string, options: CliOptions): Promise<MCPTool[]> {
  if (options.stdio) return fetchMcpToolsStdio(options.stdio, options.stdioArgs, { timeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes, maxTotalResponseBytes: options.maxTotalResponseBytes, maxTools: options.maxTools, protocolVersion: options.protocolVersion, clientInfo: options.clientName || options.clientVersion ? { name: options.clientName ?? VERSION, version: options.clientVersion ?? VERSION } : undefined, retries: options.retries, retryDelayMs: options.retryDelayMs });
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const mcpOptions: McpFetchOptions = {
      headers: [...environmentHeaders(), ...options.headers],
      timeoutMs: options.timeoutMs,
      maxResponseBytes: options.maxResponseBytes,
      protocolVersion: options.protocolVersion,
      clientInfo: options.clientName || options.clientVersion ? { name: options.clientName ?? VERSION, version: options.clientVersion ?? VERSION } : undefined,
      accept: options.accept,
      contentType: options.contentType,
      maxToolListPages: options.maxToolListPages
      ,maxTotalResponseBytes: options.maxTotalResponseBytes, maxTools: options.maxTools, retries: options.retries, retryDelayMs: options.retryDelayMs
    };
    return fetchMcpTools(source, mcpOptions);
  }
  return loadToolsFromJsonFile(source, { maxInputBytes: options.maxInputBytes });
}

async function loadBaseline(path: string): Promise<AnalysisResult> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error(`Unable to read baseline JSON from ${path}.`);
  }
  return parseBaselineDocument(value, path);
}

function jsonReport(result: AnalysisResult, displayedTools: AnalysisResult["tools"], source: string, budget: number | undefined): string {
  const budgetExceeded = budget !== undefined && result.totalTokens > budget;
  return JSON.stringify({
    source,
    ...result,
    tools: displayedTools,
    displayedToolCount: displayedTools.length,
    budget,
    budgetExceeded,
    budgetOver: budgetExceeded ? result.totalTokens - budget! : 0
  });
}

export async function runCli(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (options.mode === "diff") return runDiffCli(options);
  if (!options.source && !options.stdio) throw new Error("A JSON file path, HTTP(S) MCP server URL, or --stdio executable is required. Use --help for usage.");
  const source = options.source ?? `stdio:${options.stdio}`;
  const tools = await loadSource(source, options);
  const result = analyzeTools(tools);
  const displayedTools = sortTools(result.tools, options.sort).slice(0, options.top);
  const baselineResult = options.baseline ? await loadBaseline(options.baseline) : undefined;
  const baselineDiff = baselineResult ? compareAnalyses(baselineResult, result, { allowedIncrease: options.maxIncrease ?? 0 }) : undefined;
  const baseline = baselineDiff ? {
    totalOver: Math.max(0, baselineDiff.totalDelta - (options.maxIncrease ?? 0)),
    tools: baselineDiff.enforcement.reasons,
    diff: baselineDiff
  } : { totalOver: 0, tools: [] };
  const exceeded = (options.budget !== undefined && result.totalTokens > options.budget) || Boolean(baselineDiff?.enforcement.exceeded);
  if (options.json) process.stdout.write(`${JSON.stringify({ ...JSON.parse(jsonReport(result, displayedTools, source, options.budget)), baseline })}\n`);
  else process.stdout.write(renderHumanReport(result, { source, tools: displayedTools, budget: options.budget }));
  if (exceeded && (baseline.totalOver > 0 || baseline.tools.length > 0) && !options.json) process.stderr.write(`Baseline regression: ${baseline.totalOver > 0 ? `${baseline.totalOver} total tokens over allowance` : ""}${baseline.tools.length ? `; ${baseline.tools.join("; ")}` : ""}.\n`);
  return exceeded ? 1 : 0;
}

async function runDiffCli(options: CliOptions): Promise<number> {
  const baselinePath = options.baseline ?? options.diffBaseline;
  if (!baselinePath) throw new Error("The diff command requires --baseline <file> or two positional sources.");
  if (!options.source && !options.stdio) throw new Error("The diff command requires a current JSON file, HTTP(S) MCP server URL, or --stdio executable.");
  const source = options.source ?? `stdio:${options.stdio}`;
  const [tools, baseline] = await Promise.all([loadSource(source, options), loadBaseline(baselinePath)]);
  const result = analyzeTools(tools);
  const diff: AnalysisDiff = compareAnalyses(baseline, result, {
    allowedIncrease: options.maxIncrease ?? 0,
    budget: options.budget,
    enforce: options.maxIncrease !== undefined || options.budget !== undefined
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ baseline: baselinePath, current: source, budget: options.budget, ...diff })}\n`);
  } else {
    process.stdout.write(renderHumanDiff(diff, { baseline: baselinePath, current: source }));
  }
  return diff.enforcement.exceeded ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    const options = process.argv.includes("--verbose");
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    if (options && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 2;
  });
}
