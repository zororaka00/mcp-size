# Changelog

All notable changes to this project are documented here.

## Unreleased

- Added repeatable custom HTTP headers and `MCP_SIZE_HEADERS` support for generic MCP authentication, tenant headers, and vendor negotiation without logging header values.
- Added configurable MCP protocol version, client information, request timeout, response-size limit, `Accept`, `Content-Type`, capabilities, and tools/list page limit.
- Added automatic `tools/list` cursor pagination with order-preserving aggregation, repeated-cursor detection, and a safe maximum-page guard.
- Added actionable HTTP 401/403 errors and offline local-server coverage for authentication, negotiation, pagination, and CLI behavior.

## [0.1.0] - 2026-08-08

- Initial release of the `mcp-size` CLI and TypeScript library.
- Added deterministic MCP tool analysis for names, titles, descriptions, schemas, annotations, and metadata.
- Added dependency-free token estimates, custom tokenizer support, warnings, suggestions, sorting, top limits, JSON output, and budget exit codes.
- Added local JSON sources and minimal MCP Streamable HTTP `tools/list` support with response limits.
- Added offline tests, example fixture, CI workflow, README, and MIT license.
