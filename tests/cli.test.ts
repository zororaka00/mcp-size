import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

const cli = join(process.cwd(), "dist", "cli", "index.js");

test("CLI emits human and JSON reports and honors budget exit code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-size-cli-"));
  const file = join(directory, "tools.json");
  await writeFile(file, JSON.stringify([{ name: "one", description: "hello", inputSchema: { type: "object" } }]), "utf8");
  const human = spawnSync(process.execPath, [cli, file, "--no-color"], { encoding: "utf8" });
  assert.equal(human.status, 0);
  assert.match(human.stdout, /MCP Tool Size Report/);
  const json = spawnSync(process.execPath, [cli, file, "--json"], { encoding: "utf8" });
  assert.equal(json.status, 0);
  assert.equal(json.stderr, "");
  const parsed = JSON.parse(json.stdout) as { toolCount: number; totalTokens: number };
  assert.equal(parsed.toolCount, 1);
  assert.ok(parsed.totalTokens > 0);
  const budget = spawnSync(process.execPath, [cli, file, "--budget", "1"], { encoding: "utf8" });
  assert.equal(budget.status, 1);
  assert.match(budget.stdout, /budget exceeded/i);
  await rm(directory, { recursive: true, force: true });
});

test("CLI uses exit code 2 for invalid input", () => {
  const result = spawnSync(process.execPath, [cli, "missing-tools.json"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unable to read MCP tools/);
});

test("CLI help includes HTTP authentication and negotiation options", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  for (const option of ["--header", "--timeout-ms", "--max-response-bytes", "--max-tool-list-pages", "--protocol-version", "--client-name", "--accept"]) {
    assert.match(result.stdout, new RegExp(option.replace(/-/g, "\\-")));
  }
});

test("CLI forwards custom headers without printing their values", async () => {
  let receivedHeader = "";
  const server = createServer(async (request, response) => {
    receivedHeader = Array.isArray(request.headers["x-api-key"]) ? (request.headers["x-api-key"][0] ?? "") : (request.headers["x-api-key"] ?? "");
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const message = JSON.parse(body) as { method: string };
    response.setHeader("content-type", "application/json");
    if (message.method === "initialize") response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    else if (message.method === "tools/list") response.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "remote" }] } }));
    else response.end(JSON.stringify({ jsonrpc: "2.0", result: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = (address as import("node:net").AddressInfo).port;
  const child = spawn(process.execPath, [cli, `http://127.0.0.1:${port}/mcp`, "--json", "--header", "X-API-Key: placeholder-value"]);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  });
  assert.equal(exitCode, 0);
  assert.equal(receivedHeader, "placeholder-value");
  assert.doesNotMatch(stdout, /placeholder-value/);
  assert.doesNotMatch(stderr, /placeholder-value/);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
