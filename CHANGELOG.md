# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/zororaka00/mcp-size/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zororaka00/mcp-size/releases/tag/v0.1.0
