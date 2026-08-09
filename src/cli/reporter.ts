import type { AnalysisResult, ToolAnalysis } from "../core/types.js";
import type { AnalysisDiff, DiffComponent, ToolDiff } from "../core/diff.js";

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
    ["Annotations", result.breakdown.annotations, result.breakdownPercentages.annotations],
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

const DIFF_LABELS: Record<DiffComponent, string> = {
  name: "name",
  description: "description",
  inputSchema: "inputSchema",
  outputSchema: "outputSchema",
  annotations: "annotations",
  metadata: "metadata"
};

function signed(value: number): string {
  return value > 0 ? `+${number(value)}` : number(value);
}

function renderChanges(lines: string[], label: string, changes: ToolDiff[]): void {
  lines.push("", label);
  if (changes.length === 0) {
    lines.push("- none");
    return;
  }
  for (const change of changes) {
    const name = `${change.name}${change.occurrence ? ` #${change.occurrence}` : ""}`;
    lines.push(`- ${name}: ${signed(change.tokenDelta)} tokens (${change.tokenPercentage.toFixed(1)}%)`);
    const deltas = Object.entries(change.components)
      .filter(([, component]) => component.delta !== 0)
      .map(([component, value]) => `${DIFF_LABELS[component as DiffComponent]} ${signed(value.delta)} (${value.percentage.toFixed(1)}%)`);
    if (deltas.length > 0) lines.push(`  ${deltas.join(", ")}`);
  }
}

export interface HumanDiffOptions {
  baseline: string;
  current: string;
}

export function renderHumanDiff(diff: AnalysisDiff, options: HumanDiffOptions): string {
  const lines = [
    "MCP Tool Size Diff",
    "",
    `Baseline: ${options.baseline}`,
    `Current:  ${options.current}`,
    `Total tokens: ${number(diff.baselineTotalTokens)} -> ${number(diff.currentTotalTokens)} (${signed(diff.totalDelta)}, ${diff.totalPercentage.toFixed(1)}%)`
  ];
  renderChanges(lines, "Added tools", diff.addedTools);
  renderChanges(lines, "Removed tools", diff.removedTools);
  renderChanges(lines, "Modified tools", diff.modifiedTools);
  lines.push("", "Component deltas");
  for (const component of Object.keys(diff.components) as DiffComponent[]) {
    const value = diff.components[component];
    lines.push(`- ${DIFF_LABELS[component]}: ${signed(value.delta)} tokens (${value.percentage.toFixed(1)}%)`);
  }
  if (diff.enforcement.exceeded) {
    lines.push("", "Enforcement: exceeded");
    for (const reason of diff.enforcement.reasons) lines.push(`- ${reason}`);
  } else {
    lines.push("", "Enforcement: within limits");
  }
  return `${lines.join("\n")}\n`;
}
