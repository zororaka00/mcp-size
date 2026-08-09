# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-09

### Added

- Separate annotation and metadata token breakdowns, including aggregate percentages and deterministic large output-schema warnings.
- `mcp-size diff` for added, removed, and modified tools with total, per-tool, and component-level deltas and percentages.
- Diff enforcement for total, per-tool, and component regressions using the existing `--max-increase` flag, plus deterministic JSON output and CI documentation.

### Changed

- Baseline checks now reuse the diff model and validate malformed reports instead of silently ignoring invalid tool entries.
- CLI and MCP client version is now 0.4.0. The default tokenizer remains dependency-free and estimates context size rather than exact model billing tokens.

## [0.3.0] - 2026-08-09

### Added

- Streaming per-response and aggregate MCP byte limits, aggregate tool limits, and incremental `fetchMcpToolPages()`.
- Strict JSON-RPC 2.0 validation, matching response IDs, initialize protocol negotiation, session preservation, and public `McpRequestError`/`McpProtocolError` classes.
- Public abort signals, injectable fetch, safe opt-in retries with bounded backoff, diagnostics callbacks, and configurable analyzer thresholds.
- Bounded local-file/stdin input, baseline/diff CLI checks, safe executable-plus-argument stdio support, duplicate-name warnings, and a reproducible benchmark script.

### Changed

- CLI and client version is now 0.3.0. Response and input limits are enforced while bytes are being read; limits fail before unbounded accumulation.
- Authentication and error diagnostics continue to redact credentials and header values. Legacy GET-only SSE session setup remains intentionally unsupported.

### Migration notes

- MCP servers must return a valid `initialize` result with a supported `protocolVersion`; callers relying on empty or malformed initialize responses must fix the server.
- Retry behavior is opt-in (`retries: 0` by default) and timeout is per attempt.

## [0.2.0] - 2026-08-09

### Added

- Repeatable custom HTTP headers and `MCP_SIZE_HEADERS` for generic MCP authentication, tenant headers, and vendor negotiation without logging header values.
- Configurable MCP protocol version, client information, request timeout, response-size limit, `Accept`, `Content-Type`, capabilities, and tools/list page limit.
- Automatic `tools/list` cursor pagination with order-preserving aggregation, repeated-cursor detection, and a safe maximum-page guard.
- Actionable HTTP 401/403 errors and offline local-server coverage for authentication, negotiation, pagination, and CLI behavior.
- Package metadata: `repository`, `homepage`, and npm `keywords`.
- `CONTRIBUTING.md` with local development and pull request guidelines.

### Changed

- License and README attribution to Raka Widhi Antoro.

## [0.1.0] - 2026-08-08

### Added

- Initial release of the `mcp-size` CLI and TypeScript library.
- Deterministic MCP tool analysis for names, titles, descriptions, schemas, annotations, and metadata.
- Dependency-free token estimates, custom tokenizer support, warnings, suggestions, sorting, top limits, JSON output, and budget exit codes.
- Local JSON sources and minimal MCP Streamable HTTP `tools/list` support with response limits.
- Offline tests, example fixture, CI workflow, README, and MIT license.

[0.4.0]: https://github.com/zororaka00/mcp-size/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/zororaka00/mcp-size/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zororaka00/mcp-size/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zororaka00/mcp-size/releases/tag/v0.1.0
