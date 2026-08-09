import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTools, type MCPTool } from "../src/index.js";

const countCharacters = { count: (text: string) => text.length };

test("analyzes empty tools with zero totals", () => {
  const result = analyzeTools([], { tokenizer: countCharacters });
  assert.equal(result.toolCount, 0);
  assert.equal(result.totalTokens, 0);
  assert.equal(result.averageTokens, 0);
  assert.deepEqual(result.breakdown, {
    names: 0,
    titles: 0,
    descriptions: 0,
    inputSchemas: 0,
    outputSchemas: 0,
    annotations: 0,
    metadata: 0
  });
});

test("counts tool fields deterministically and sorts largest first", () => {
  const tools: MCPTool[] = [
    {
      name: "small",
      description: "ok",
      inputSchema: { type: "object" },
      custom: { z: 1, a: true }
    },
    {
      name: "large",
      title: "Large",
      description: "long",
      inputSchema: { properties: { q: { type: "string" } } },
      outputSchema: { type: "string" },
      annotations: { readOnlyHint: true }
    }
  ];
  const result = analyzeTools(tools, { tokenizer: countCharacters });
  assert.equal(result.toolCount, 2);
  assert.equal(result.tools[0]?.name, "large");
  assert.equal(result.tools[0]?.breakdown.name, 5);
  assert.equal(result.tools[0]?.breakdown.title, 5);
  assert.equal(result.tools[0]?.breakdown.description, 4);
  assert.equal(result.tools[0]?.breakdown.inputSchema, 38);
  assert.equal(result.tools[0]?.breakdown.outputSchema, 17);
  assert.equal(result.tools[0]?.breakdown.annotations, 21);
  assert.equal(result.tools[0]?.breakdown.metadata, 0);
  assert.equal(result.tools[0]?.percentage, (result.tools[0]!.tokens / result.totalTokens) * 100);
  assert.equal(result.breakdown.names, 10);
  assert.ok(result.breakdown.inputSchemas > 0);
});

test("handles missing schemas and emits deterministic warnings", () => {
  const result = analyzeTools([
    { name: "hello", description: "short" }
  ], { tokenizer: countCharacters });
  assert.equal(result.tools[0]?.breakdown.inputSchema, 0);
  assert.equal(result.tools[0]?.breakdown.outputSchema, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("accounts for 100.0%")));
});

test("rejects malformed tools with an actionable error", () => {
  assert.throws(
    () => analyzeTools([{ description: "missing name" } as unknown as MCPTool]),
    /Tool at index 0 must have a non-empty string name/
  );
});

test("finds large descriptions and schema property descriptions", () => {
  const result = analyzeTools([{
    name: "deploy",
    description: "x".repeat(301),
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "y".repeat(51) } }
    }
  }], { tokenizer: countCharacters });
  assert.ok(result.warnings.some((warning) => warning.includes("description")));
  assert.ok(result.suggestions.some((suggestion) => suggestion.includes("schema property description")));
});

test("merges thresholds and warns about duplicate names without deduplicating", () => {
  const result = analyzeTools([{ name: "same" }, { name: "same" }], { thresholds: { dominantSharePercent: 101 } });
  assert.equal(result.toolCount, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('Duplicate tool name "same"')));
  assert.equal(result.warnings.some((warning) => warning.includes("accounts for 50.0%")), false);
});

test("breaks out annotations and metadata and warns about expensive output schemas", () => {
  const result = analyzeTools([{
    name: "expensive",
    outputSchema: { description: "z".repeat(501) },
    annotations: { hint: "read-only" },
    metadata: { owner: "platform" }
  }], { tokenizer: countCharacters });
  const tool = result.tools[0]!;
  assert.equal(tool.breakdown.annotations, 20);
  assert.equal(tool.breakdown.metadata, 20);
  assert.equal(result.breakdown.annotations, 20);
  assert.equal(result.breakdown.metadata, 20);
  assert.ok(result.warnings.some((warning) => warning.includes("output schema")));
});

test("keeps Unicode and custom tokenizer output deterministic", () => {
  const tools: MCPTool[] = [{ name: "😀", description: "日本語" }];
  const tokenizer = { count: (text: string) => text.length };
  const first = analyzeTools(tools, { tokenizer });
  const second = analyzeTools(tools, { tokenizer });
  assert.equal(first.tools[0]?.breakdown.name, 2);
  assert.deepEqual(first, second);
});
