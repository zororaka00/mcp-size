#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { analyzeTools, fetchMcpTools, loadToolsFromJsonFile, type AnalysisResult, type McpFetchOptions, type MCPTool } from "../index.js";
import { renderHumanReport, sortTools, type SortField } from "./reporter.js";

const VERSION = "0.1.0";
const SORT_FIELDS: SortField[] = ["tokens", "name", "description", "inputSchema", "outputSchema"];
const VALUE_FLAGS = new Set([
  "--budget", "--top", "--sort", "--header", "--timeout-ms", "--max-response-bytes", "--max-tool-list-pages",
  "--protocol-version", "--client-name", "--client-version", "--accept", "--content-type"
]);

interface CliOptions {
  source?: string;
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
  help: boolean;
  version: boolean;
}

function helpText(): string {
  return `Usage: mcp-size <file.json|http://server/mcp> [options]

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
  else if (flag === "--protocol-version") options.protocolVersion = textValue(value, flag);
  else if (flag === "--client-name") options.clientName = textValue(value, flag);
  else if (flag === "--client-version") options.clientVersion = textValue(value, flag);
  else if (flag === "--accept") options.accept = textValue(value, flag);
  else if (flag === "--content-type") options.contentType = textValue(value, flag);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { json: false, sort: "tokens", noColor: false, verbose: false, headers: [], help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
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
      } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
      else if (options.source === undefined) options.source = arg;
      else throw new Error("Only one source may be provided.");
    }
  }
  return options;
}

function environmentHeaders(): Array<[string, string]> {
  const value = process.env.MCP_SIZE_HEADERS;
  if (!value) return [];
  return value.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => parseHeader(line, "MCP_SIZE_HEADERS"));
}

async function loadSource(source: string, options: CliOptions): Promise<MCPTool[]> {
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
    };
    return fetchMcpTools(source, mcpOptions);
  }
  return loadToolsFromJsonFile(source);
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
  if (!options.source) throw new Error("A JSON file path or HTTP(S) MCP server URL is required. Use --help for usage.");
  const tools = await loadSource(options.source, options);
  const result = analyzeTools(tools);
  const displayedTools = sortTools(result.tools, options.sort).slice(0, options.top);
  const exceeded = options.budget !== undefined && result.totalTokens > options.budget;
  if (options.json) process.stdout.write(`${jsonReport(result, displayedTools, options.source, options.budget)}\n`);
  else process.stdout.write(renderHumanReport(result, { source: options.source, tools: displayedTools, budget: options.budget }));
  return exceeded ? 1 : 0;
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
