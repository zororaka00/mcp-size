import { performance } from "node:perf_hooks";
import { analyzeTools } from "../dist/index.js";

const count = Number(process.env.MCP_SIZE_BENCH_TOOLS ?? 10_000);
const tools = Array.from({ length: count }, (_, index) => ({
  name: `tool_${index}`,
  description: "A reproducible benchmark tool description.",
  inputSchema: { type: "object", properties: { value: { type: "string", description: "A value." } } },
  annotations: { readOnlyHint: index % 2 === 0 }
}));
const started = performance.now();
const result = analyzeTools(tools);
const elapsed = performance.now() - started;
process.stdout.write(JSON.stringify({ tools: count, totalTokens: result.totalTokens, elapsedMs: Number(elapsed.toFixed(2)) }) + "\n");
