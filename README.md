# mcp-size

> Bundle analyzer for MCP tools.

Measure how much context your MCP tool definitions consume before they reach the model.

[Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md) · [MIT License](./LICENSE)

## What it does

`mcp-size` reads local MCP tool JSON or asks an MCP server for `tools/list`, then reports estimated token overhead for tool names, titles, descriptions, JSON schemas, annotations, and other metadata. It is intentionally local, fast, and small enough to run in CI.

Current release: **0.3.0**. Highlights include bounded streaming and aggregate MCP responses, negotiated protocol validation, typed errors, opt-in retries, stdin/stdio inputs, baseline checks, and configurable analyzer thresholds. See [CHANGELOG.md](./CHANGELOG.md) for the full list.

## Installation

```bash
npm install --save-dev mcp-size
```

Or run it without installing:

```bash
npx mcp-size ./examples/tools.json
```

## Quick start

```bash
npx mcp-size ./examples/tools.json
```

Example output:

```text
MCP Tool Size Report

Source: ./examples/tools.json
Tools:               3
Estimated tokens:    113
Average/tool:        38

Top tools
search                         58 ████████████████████
create_issue                   37 █████████████
health                         18 ██████

Largest tool: search

Largest contributors
Names                       16   14.2%
Titles                       0    0.0%
Descriptions                43   38.1%
Input schemas               42   37.2%
Output schemas               0    0.0%
Other metadata              12   10.6%
```

The numbers are illustrative; run the command to inspect the fixture with the installed version.

## CLI

```bash
mcp-size <file.json|http://server/mcp>

mcp-size ./tools.json --top 5
mcp-size ./tools.json --sort inputSchema
mcp-size ./tools.json --json
mcp-size ./tools.json --budget 5000
mcp-size http://localhost:3000/mcp --no-color
mcp-size https://example.invalid/mcp --header "Authorization: Bearer ${MCP_TOKEN}"
```

Options:

- `--json` emits one machine-readable JSON document and no decorative output.
- `--budget <tokens>` returns exit code `1` when the total exceeds the budget.
- `--top <number>` limits the displayed `tools` list; totals and budget checks still use every tool.
- `--sort tokens|name|description|inputSchema|outputSchema` controls display order. The default is largest first (`tokens`).
- `--header <Name:Value>` adds a custom HTTP header; repeat it for multiple headers. This is the generic mechanism for Bearer/API-key/Basic authentication, tenant headers, and vendor-specific negotiation.
- `--timeout-ms <milliseconds>` sets the request timeout; the default is `15000`.
- `--max-response-bytes <bytes>` sets the response-size limit; the default is `10485760` (10 MiB).
- `--max-tool-list-pages <number>` sets the pagination safety limit; the default is `100`.
- `--max-total-response-bytes <bytes>` limits bytes accumulated across all MCP responses; the default is `52428800`.
- `--max-tools <number>` limits aggregate MCP tools; the default is `10000`.
- `--retries <number>` enables bounded retries for network errors, timeouts, HTTP 408/429/5xx; default `0`.
- `--retry-delay-ms <milliseconds>` sets exponential backoff base. Timeout is per attempt and `Retry-After` is honored up to one minute when parseable.
- `--max-input-bytes <bytes>` bounds local JSON files and `-` stdin; the default is `10485760`.
- `--baseline <file>` compares total and per-tool token counts with a prior `--json` report; `--max-increase` sets the allowed increase and regressions exit `1`.
- `--stdio <executable> --stdio-arg <argument>` runs an MCP executable with an argument array, without shell interpolation.
- `--protocol-version <version>` overrides the MCP protocol version sent in `initialize` and `MCP-Protocol-Version` (default `2025-06-18`).
- `--client-name <name>` and `--client-version <version>` override the client information sent in `initialize`.
- `--accept <media-types>` overrides `Accept`; the default is `application/json, text/event-stream`, the Streamable HTTP negotiation default.
- `--content-type <media-type>` overrides the JSON request `Content-Type` (default `application/json`).
- `--no-color` is accepted for scripts and terminals; the default report is readable without color.
- `--verbose` includes an error stack trace.
- `--version` and `--help` print package information.

For credentials, prefer environment/configuration rather than putting values in arguments. `MCP_SIZE_HEADERS` accepts one `Name:Value` entry per line, for example:

```bash
MCP_SIZE_HEADERS=$'Authorization: Bearer '"$MCP_TOKEN"$'\nX-Tenant: '"$MCP_TENANT" \\
  mcp-size https://example.invalid/mcp --json
```

Shell history and process listings can expose values passed to `--header`; do not use that form for long-lived or sensitive credentials. `mcp-size` does not print configured header values in normal or verbose output.

Exit codes are `0` for success or an in-budget report, `1` for a budget overrun, and `2` for invalid input or runtime errors.

### JSON sources

Both of these formats are accepted:

```json
[{"name":"search","description":"Search files","inputSchema":{"type":"object"}}]
```

```json
{"tools":[{"name":"search","description":"Search files","inputSchema":{"type":"object"}}]}
```

Thresholds can be overridden without changing defaults for unspecified fields: `analyzeTools(tools, { thresholds: { largeToolTokens: 2000, dominantSharePercent: 30 } })`. The merge is deterministic. Duplicate tool names are never deduplicated; a warning identifies each repeated name.

For a provider tokenizer, implement the small adapter `{ count(text) { return provider.encode(text).length; } }` and pass it as `tokenizer`. Keep that provider in your application rather than adding it as a runtime dependency of `mcp-size`.

Tool names must be non-empty strings. Known string fields and JSON object schemas are validated with concise errors.

### MCP servers

HTTP(S) URLs use the MCP JSON-RPC behavior: `initialize`, `notifications/initialized`, then `tools/list`. The client supports MCP Streamable HTTP-style POST requests and JSON or server-sent-event responses, preserves the `MCP-Session-Id`, validates JSON-RPC 2.0 envelopes and matching IDs, and uses the server's negotiated protocol version on subsequent requests. It follows `nextCursor` until all pages are collected. Tools remain in server order; server-supplied duplicates are retained and reported by the analyzer. A repeated cursor, page, byte, tool, or total-response limit fails with an actionable typed error. Legacy GET-only SSE session setup and arbitrary custom transports are intentionally not implemented; use a Streamable HTTP endpoint or stdio.

Custom headers are passed on every MCP request, so the same generic option covers Authorization Bearer, API keys, Basic auth, tenant headers, and vendor-specific headers. HTTP 401 and 403 errors identify the authentication/authorization problem without echoing credentials; a safe authentication challenge scheme may be included. This is not an OAuth/browser-login client and does not provide a provider-specific authentication framework. The explicit stdio API/CLI is safe and uses an executable plus argument array; legacy GET-only SSE session setup and custom transports are not implemented.

## Library API

The CLI uses the same public analyzer as the library:

```ts
import { analyzeTools, type MCPTool, type Tokenizer } from "mcp-size";

const tools: MCPTool[] = [
  { name: "search", description: "Search files", inputSchema: { type: "object" } }
];
const result = analyzeTools(tools);
console.log(result.totalTokens, result.tools[0]?.breakdown.inputSchema);
```

Remote MCP options are available from the same library entrypoint:

```ts
import { fetchMcpTools } from "mcp-size";

const token = process.env.MCP_TOKEN;
if (!token) throw new Error("MCP_TOKEN is required");
const tools = await fetchMcpTools("https://example.invalid/mcp", {
  headers: { Authorization: `Bearer ${token}`, "X-Tenant": process.env.MCP_TENANT ?? "" },
  protocolVersion: "2025-06-18",
  clientInfo: { name: "my-analyzer", version: "1.0.0" },
  capabilities: {},
  timeoutMs: 15000,
  maxResponseBytes: 10 * 1024 * 1024,
  maxTotalResponseBytes: 50 * 1024 * 1024,
  maxTools: 10_000,
  maxToolListPages: 100
});
```

`headers` accepts standard `HeadersInit`, allowing repeated entries when needed. `McpFetchOptions` also accepts a caller `signal`, injectable `fetch`, opt-in `retries`/`retryDelayMs`, and `onDiagnostic`. Diagnostics contain only method, request ID, page, status, byte, attempt, and timing fields; credentials and header values are never exposed. `fetchMcpToolPages()` yields validated pages incrementally, while `fetchMcpTools()` remains the order-preserving aggregate API. `fetchMcpToolsWithMetadata` additionally returns pagination metadata and the negotiated session ID.

A custom tokenizer can be supplied when you need a model- or application-specific estimate:

```ts
const tokenizer: Tokenizer = {
  count(text) {
    return text.length; // replace with your own tokenizer
  }
};
const result = analyzeTools(tools, { tokenizer });
```

The package is intentionally ESM-only; use it from Node.js 18+ with standard `import` syntax.

The built-in tokenizer is dependency-free and estimates roughly one token per four Unicode code points. Token counts are estimates, not exact billing or model-usage measurements. Actual usage varies with the model tokenizer, client serialization, protocol wrapper, and which metadata a client includes in the final request.

The result includes per-tool breakdowns and percentages, aggregate category totals and percentages, deterministic warnings, and structural suggestions. Default thresholds are documented in the exported `DEFAULT_THRESHOLDS` constant.

## CI usage

Fail a job when tool metadata exceeds a context budget:

```yaml
- name: Check MCP context budget
  run: npx mcp-size ./tools.json --budget 5000 --json
```

The JSON output includes `totalTokens`, `toolCount`, `tools`, `breakdown`, `warnings`, `suggestions`, `budgetExceeded`, and `budgetOver`.

## Methodology and limitations

Schemas and metadata are serialized as compact JSON with recursively sorted object keys. This makes counts reproducible regardless of input object key insertion order and avoids inflating estimates with pretty-print whitespace. Names, titles, and descriptions are counted as text; `annotations` and all other unknown fields are counted as compact metadata. Missing optional fields safely contribute zero tokens.

The default tokenizer is deliberately an estimate. It is not tied to OpenAI, Anthropic, or any other model and must not be treated as a billing meter. The analyzer does not rewrite schemas, predict model quality, contact an LLM, or infer whether a tool is useful. Warnings use fixed structural thresholds: large tools over 1,000 estimated tokens, descriptions over 300, input schemas over 500, a tool share over 20%, and schema property descriptions over 50.

## Contributing

Development is setup-light:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Please keep changes small, deterministic, dependency-light, and covered by offline tests. Full guidelines for setup, pull requests, and issue reports are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Changelog

Release history lives in [CHANGELOG.md](./CHANGELOG.md).

## License

MIT © Raka Widhi Antoro — see [LICENSE](./LICENSE).

Repository: [github.com/zororaka00/mcp-size](https://github.com/zororaka00/mcp-size)
