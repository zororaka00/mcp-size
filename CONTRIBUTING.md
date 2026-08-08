# Contributing to mcp-size

Thanks for helping improve `mcp-size`. The project stays small, dependency-free where possible, and easy to run offline or in CI.

## Development setup

Requirements:

- Node.js 18 or newer
- npm

```bash
git clone https://github.com/zororaka00/mcp-size.git
cd mcp-size
npm install
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Type-check without emitting output |
| `npm test` | Build, compile tests, and run the Node test suite |
| `npm run test:watch` | Watch mode for the test suite |
| `npm run build` | Emit `dist/` for the CLI and library |

Prefer these scripts over ad-hoc one-off commands so CI and local results stay aligned.

## Guidelines

- Keep changes focused. Prefer small, reviewable pull requests.
- Stay dependency-light. Default behavior must not require third-party tokenizers, network mocks, or external LLM APIs.
- Keep analysis deterministic: same tools and options should produce the same token totals and breakdowns.
- Cover behavior with offline tests. Prefer local fixtures and in-process HTTP servers over remote MCP endpoints.
- Match existing TypeScript and CLI style: clear errors, no silent credential logging, ESM-only modules.
- Do not print configured header values or secrets in normal or verbose output.
- Update docs when behavior changes: `README.md` for users, `CHANGELOG.md` under an `Unreleased` section for release notes.
- Place imports at the top of each module. Do not use inline imports unless a documented circular-dependency exception is required.

## Pull requests

1. Branch from `main`.
2. Implement the change and add or update tests.
3. Run `npm run typecheck` and `npm test`.
4. Open a pull request that explains the problem, the approach, and any user-facing impact.
5. Link related issues when applicable.

PR title and description should say **why** the change exists, not only what files moved.

## Reporting issues

When filing a bug, include:

- `mcp-size` version (`mcp-size --version`)
- Node.js version
- Minimal reproduction (local JSON fixture preferred)
- Expected vs actual output or exit code

Do not paste live credentials, private tokens, or production Authorization headers into issues or pull requests.

## License

By contributing, you agree that your contributions are licensed under the MIT License. See [LICENSE](./LICENSE).
