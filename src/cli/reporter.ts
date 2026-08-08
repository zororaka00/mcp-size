import type { AnalysisResult, ToolAnalysis } from "../core/types.js";

export type SortField = "tokens" | "name" | "description" | "inputSchema" | "outputSchema";

export function sortTools(tools: ToolAnalysis[], field: SortField): ToolAnalysis[] {
  return [...tools].sort((a, b) => {
    if (field === "name") return a.name.localeCompare(b.name);
    const value = field === "tokens" ? a.tokens : field === "description" ? a.breakdown.description : field === "inputSchema" ? a.breakdown.inputSchema : a.breakdown.outputSchema;
    const other = field === "tokens" ? b.tokens : field === "description" ? b.breakdown.description : field === "inputSchema" ? b.breakdown.inputSchema : b.breakdown.outputSchema;
    return other - value || a.name.localeCompare(b.name);
  });
}

function number(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function bar(value: number, maximum: number): string {
  if (maximum === 0) return "";
  return "█".repeat(Math.max(1, Math.round((value / maximum) * 20)));
}

export interface HumanReportOptions {
  source: string;
  tools: ToolAnalysis[];
  budget?: number;
}

export function renderHumanReport(result: AnalysisResult, options: HumanReportOptions): string {
  const lines = [
    "MCP Tool Size Report",
    "",
    `Source: ${options.source}`,
    `Tools:               ${number(result.toolCount)}`,
    `Estimated tokens:    ${number(result.totalTokens)}`,
    `Average/tool:        ${number(result.averageTokens)}`,
    "",
    "Top tools"
  ];
  const maximum = options.tools[0]?.tokens ?? 0;
  for (const tool of options.tools) {
    lines.push(`${tool.name.padEnd(24)} ${number(tool.tokens).padStart(8)} ${bar(tool.tokens, maximum)}`);
  }
  if (result.tools[0]) lines.push("", `Largest tool: ${result.tools[0].name}`);
  lines.push("", "Largest contributors");
  const categories: Array<[string, number, number]> = [
    ["Names", result.breakdown.names, result.breakdownPercentages.names],
    ["Titles", result.breakdown.titles, result.breakdownPercentages.titles],
    ["Descriptions", result.breakdown.descriptions, result.breakdownPercentages.descriptions],
    ["Input schemas", result.breakdown.inputSchemas, result.breakdownPercentages.inputSchemas],
    ["Output schemas", result.breakdown.outputSchemas, result.breakdownPercentages.outputSchemas],
    ["Other metadata", result.breakdown.metadata, result.breakdownPercentages.metadata]
  ];
  for (const [label, tokens, share] of categories) lines.push(`${label.padEnd(20)} ${number(tokens).padStart(8)}  ${percent(share).padStart(6)}`);
  if (options.budget !== undefined) {
    lines.push("");
    if (result.totalTokens > options.budget) {
      const over = result.totalTokens - options.budget;
      const overPercent = options.budget === 0 ? 100 : (over / options.budget) * 100;
      lines.push("MCP token budget exceeded.", `Budget: ${number(options.budget)}`, `Actual: ${number(result.totalTokens)}`, `Over:   ${number(over)} (+${percent(overPercent)})`);
    } else {
      lines.push(`Budget: ${number(options.budget)} (within budget)`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push("", "Warnings");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  if (result.suggestions.length > 0) {
    lines.push("", "Suggestions");
    for (const suggestion of result.suggestions) lines.push(`- ${suggestion}`);
  }
  return `${lines.join("\n")}\n`;
}
