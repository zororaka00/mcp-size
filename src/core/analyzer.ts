import { assertTokenCount, defaultTokenizer, stableStringify } from "./tokenizer.js";
import {
  DEFAULT_THRESHOLDS,
  type AnalyzeOptions,
  type AnalysisBreakdown,
  type AnalysisResult,
  type JsonObject,
  type MCPTool,
  type ToolAnalysis,
  type ToolBreakdown,
  validateTools
} from "./types.js";

const KNOWN_FIELDS = new Set(["name", "title", "description", "inputSchema", "outputSchema", "annotations", "metadata"]);

function countText(text: string | undefined, tokenizer: AnalyzeOptions["tokenizer"], label: string): number {
  if (text === undefined) return 0;
  return assertTokenCount((tokenizer ?? defaultTokenizer).count(text), label);
}

function countJson(value: unknown, tokenizer: AnalyzeOptions["tokenizer"], label: string): number {
  if (value === undefined) return 0;
  return assertTokenCount((tokenizer ?? defaultTokenizer).count(stableStringify(value)), label);
}

function countLongDescriptions(value: unknown, tokenizer: AnalyzeOptions["tokenizer"], limit: number, seen = new Set<object>()): number {
  if (typeof value !== "object" || value === null) return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  let count = 0;
  if (Array.isArray(value)) {
    for (const child of value) count += countLongDescriptions(child, tokenizer, limit, seen);
    return count;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.description === "string" && countText(record.description, tokenizer, "schema description") > limit) {
    count += 1;
  }
  for (const child of Object.values(record)) count += countLongDescriptions(child, tokenizer, limit, seen);
  return count;
}

function breakdownFor(tool: MCPTool, tokenizer: AnalyzeOptions["tokenizer"]): ToolBreakdown {
  const metadata: JsonObject = {};
  for (const [key, value] of Object.entries(tool)) {
    if (!KNOWN_FIELDS.has(key)) metadata[key] = value;
  }
  const metadataValue = tool.metadata === undefined
    ? metadata
    : Object.keys(metadata).length === 0 ? tool.metadata : { ...metadata, metadata: tool.metadata };
  return {
    name: countText(tool.name, tokenizer, `${tool.name}.name`),
    title: countText(tool.title, tokenizer, `${tool.name}.title`),
    description: countText(tool.description, tokenizer, `${tool.name}.description`),
    inputSchema: countJson(tool.inputSchema, tokenizer, `${tool.name}.inputSchema`),
    outputSchema: countJson(tool.outputSchema, tokenizer, `${tool.name}.outputSchema`),
    annotations: countJson(tool.annotations, tokenizer, `${tool.name}.annotations`),
    metadata: Object.keys(metadata).length === 0 && tool.metadata === undefined ? 0 : countJson(metadataValue, tokenizer, `${tool.name}.metadata`)
  };
}

function sumBreakdowns(items: ToolAnalysis[]): AnalysisBreakdown {
  return items.reduce<AnalysisBreakdown>((sum, item) => ({
    names: sum.names + item.breakdown.name,
    titles: sum.titles + item.breakdown.title,
    descriptions: sum.descriptions + item.breakdown.description,
    inputSchemas: sum.inputSchemas + item.breakdown.inputSchema,
    outputSchemas: sum.outputSchemas + item.breakdown.outputSchema,
    annotations: sum.annotations + item.breakdown.annotations,
    metadata: sum.metadata + item.breakdown.metadata
  }), { names: 0, titles: 0, descriptions: 0, inputSchemas: 0, outputSchemas: 0, annotations: 0, metadata: 0 });
}

function percentages(breakdown: AnalysisBreakdown, totalTokens: number): AnalysisBreakdown {
  const share = (value: number) => totalTokens === 0 ? 0 : (value / totalTokens) * 100;
  return {
    names: share(breakdown.names),
    titles: share(breakdown.titles),
    descriptions: share(breakdown.descriptions),
    inputSchemas: share(breakdown.inputSchemas),
    outputSchemas: share(breakdown.outputSchemas),
    annotations: share(breakdown.annotations),
    metadata: share(breakdown.metadata)
  };
}

export function analyzeTools(tools: MCPTool[], options: AnalyzeOptions = {}): AnalysisResult {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const validTools = validateTools(tools, "tools");
  const analyzed: ToolAnalysis[] = validTools.map((tool) => {
    const breakdown = breakdownFor(tool, options.tokenizer);
    const tokens = Object.values(breakdown).reduce((total, value) => total + value, 0);
    const warnings: string[] = [];
    const suggestions: string[] = [];
    if (tokens > thresholds.largeToolTokens) warnings.push(`${tool.name} is a large tool: ${tokens} estimated tokens.`);
    if (breakdown.description > thresholds.largeDescriptionTokens) warnings.push(`${tool.name} has a large description: ${breakdown.description} estimated tokens.`);
    if (breakdown.inputSchema > thresholds.largeInputSchemaTokens) warnings.push(`${tool.name} has a large input schema: ${breakdown.inputSchema} estimated tokens.`);
    if (breakdown.outputSchema > thresholds.largeOutputSchemaTokens) warnings.push(`${tool.name} has a large output schema: ${breakdown.outputSchema} estimated tokens.`);
    const longDescriptions = countLongDescriptions(tool.inputSchema, options.tokenizer, thresholds.longPropertyDescriptionTokens) + countLongDescriptions(tool.outputSchema, options.tokenizer, thresholds.longPropertyDescriptionTokens);
    if (longDescriptions > 0) suggestions.push(`${tool.name} has ${longDescriptions} schema property description${longDescriptions === 1 ? "" : "s"} over ${thresholds.longPropertyDescriptionTokens} estimated tokens.`);
    return { name: tool.name, tokens, percentage: 0, breakdown, warnings, suggestions };
  });
  analyzed.sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  const totalTokens = analyzed.reduce((sum, tool) => sum + tool.tokens, 0);
  for (const tool of analyzed) tool.percentage = totalTokens === 0 ? 0 : (tool.tokens / totalTokens) * 100;
  const warnings = analyzed.flatMap((tool) => tool.warnings);
  const suggestions = analyzed.flatMap((tool) => tool.suggestions);
  for (const tool of analyzed) {
    if (tool.percentage > thresholds.dominantSharePercent) {
      warnings.push(`${tool.name} accounts for ${tool.percentage.toFixed(1)}% of the MCP context.`);
    }
  }
  const concentration = analyzed.slice(0, thresholds.concentrationToolLimit);
  const concentrationTokens = concentration.reduce((sum, tool) => sum + tool.tokens, 0);
  if (analyzed.length > thresholds.concentrationToolLimit && totalTokens > 0 && (concentrationTokens / totalTokens) * 100 >= thresholds.concentrationSharePercent) {
    warnings.push(`${concentration.length} tools account for ${((concentrationTokens / totalTokens) * 100).toFixed(1)}% of the MCP context.`);
  }
  const breakdown = sumBreakdowns(analyzed);
  const duplicateNames = new Set<string>();
  const seenNames = new Set<string>();
  for (const tool of validTools) {
    if (seenNames.has(tool.name)) duplicateNames.add(tool.name);
    seenNames.add(tool.name);
  }
  for (const name of Array.from(duplicateNames)) warnings.push(`Duplicate tool name "${name}" was retained in server order.`);
  return {
    toolCount: analyzed.length,
    totalTokens,
    averageTokens: analyzed.length === 0 ? 0 : totalTokens / analyzed.length,
    tools: analyzed,
    breakdown,
    breakdownPercentages: percentages(breakdown, totalTokens),
    warnings,
    suggestions
  };
}
