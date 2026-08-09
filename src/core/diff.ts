import type {
  AnalysisBreakdown,
  AnalysisResult,
  ToolAnalysis
} from "./types.js";

export const DIFF_COMPONENTS = ["name", "description", "inputSchema", "outputSchema", "annotations", "metadata"] as const;
export type DiffComponent = typeof DIFF_COMPONENTS[number];

export interface DiffMetric {
  baseline: number;
  current: number;
  delta: number;
  percentage: number;
}

export interface ToolDiff {
  name: string;
  status: "added" | "removed" | "modified";
  baselineTokens: number;
  currentTokens: number;
  tokenDelta: number;
  tokenPercentage: number;
  components: Record<DiffComponent, DiffMetric>;
  occurrence?: number;
}

export interface DiffEnforcement {
  allowedIncrease: number;
  exceeded: boolean;
  reasons: string[];
}

export interface AnalysisDiff {
  baselineTotalTokens: number;
  currentTotalTokens: number;
  total: DiffMetric;
  totalDelta: number;
  totalPercentage: number;
  components: Record<DiffComponent, DiffMetric>;
  addedTools: ToolDiff[];
  removedTools: ToolDiff[];
  modifiedTools: ToolDiff[];
  enforcement: DiffEnforcement;
}

export interface DiffOptions {
  allowedIncrease?: number;
  budget?: number;
  enforce?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Baseline ${label} must be a non-negative integer.`);
  }
  return value;
}

function metric(baseline: number, current: number): DiffMetric {
  const delta = current - baseline;
  return {
    baseline,
    current,
    delta,
    percentage: baseline === 0 ? (current === 0 ? 0 : 100) : (delta / baseline) * 100
  };
}

function componentValues(tool: Pick<ToolAnalysis, "breakdown"> | undefined): Record<DiffComponent, number> {
  return {
    name: tool?.breakdown.name ?? 0,
    description: tool?.breakdown.description ?? 0,
    inputSchema: tool?.breakdown.inputSchema ?? 0,
    outputSchema: tool?.breakdown.outputSchema ?? 0,
    annotations: tool?.breakdown.annotations ?? 0,
    metadata: tool?.breakdown.metadata ?? 0
  };
}

function aggregateValues(breakdown: Partial<AnalysisBreakdown> | undefined): Record<DiffComponent, number> {
  return {
    name: breakdown?.names ?? 0,
    description: breakdown?.descriptions ?? 0,
    inputSchema: breakdown?.inputSchemas ?? 0,
    outputSchema: breakdown?.outputSchemas ?? 0,
    annotations: breakdown?.annotations ?? 0,
    metadata: breakdown?.metadata ?? 0
  };
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function occurrenceKey(name: string, occurrence: number): string {
  return `${name}\u0000${occurrence}`;
}

function indexed(tools: ToolAnalysis[]): Array<{ tool: ToolAnalysis; occurrence: number }> {
  const counts = new Map<string, number>();
  return tools.map((tool) => {
    const occurrence = (counts.get(tool.name) ?? 0) + 1;
    counts.set(tool.name, occurrence);
    return { tool, occurrence };
  });
}

function toolDiff(
  baseline: ToolAnalysis | undefined,
  current: ToolAnalysis | undefined,
  status: ToolDiff["status"],
  occurrence: number
): ToolDiff {
  const baselineComponents = componentValues(baseline);
  const currentComponents = componentValues(current);
  const components = Object.fromEntries(DIFF_COMPONENTS.map((component) => [component, metric(baselineComponents[component], currentComponents[component])])) as Record<DiffComponent, DiffMetric>;
  const result: ToolDiff = {
    name: current?.name ?? baseline!.name,
    status,
    baselineTokens: baseline?.tokens ?? 0,
    currentTokens: current?.tokens ?? 0,
    tokenDelta: (current?.tokens ?? 0) - (baseline?.tokens ?? 0),
    tokenPercentage: metric(baseline?.tokens ?? 0, current?.tokens ?? 0).percentage,
    components
  };
  if (occurrence > 1) result.occurrence = occurrence;
  return result;
}

function changed(diff: ToolDiff): boolean {
  return diff.tokenDelta !== 0 || DIFF_COMPONENTS.some((component) => diff.components[component].delta !== 0);
}

export function parseBaselineDocument(value: unknown, sourceLabel = "baseline"): AnalysisResult {
  if (!isRecord(value)) throw new Error(`Baseline ${sourceLabel} must be a mcp-size JSON report.`);
  const totalTokens = nonNegativeInteger(value.totalTokens, `${sourceLabel}.totalTokens`);
  const rawTools = value.tools;
  if (rawTools !== undefined && !Array.isArray(rawTools)) throw new Error(`Baseline ${sourceLabel}.tools must be an array when present.`);
  const tools: ToolAnalysis[] = [];
  const rawToolList: unknown[] = Array.isArray(rawTools) ? rawTools : [];
  for (let index = 0; index < rawToolList.length; index += 1) {
    const rawTool = rawToolList[index];
    if (!isRecord(rawTool) || typeof rawTool.name !== "string" || rawTool.name.trim() === "") {
      throw new Error(`Baseline ${sourceLabel}.tools[${index}] must have a non-empty string name.`);
    }
    const tokens = nonNegativeInteger(rawTool.tokens, `${sourceLabel}.tools[${index}].tokens`);
    if (rawTool.breakdown !== undefined && !isRecord(rawTool.breakdown)) throw new Error(`Baseline ${sourceLabel}.tools[${index}].breakdown must be an object when present.`);
    const breakdown = isRecord(rawTool.breakdown) ? rawTool.breakdown : {};
    const valueFor = (key: string): number => nonNegativeInteger(breakdown[key] ?? 0, `${sourceLabel}.tools[${index}].breakdown.${key}`);
    tools.push({
      name: rawTool.name,
      tokens,
      percentage: 0,
      breakdown: {
        name: valueFor("name"),
        title: valueFor("title"),
        description: valueFor("description"),
        inputSchema: valueFor("inputSchema"),
        outputSchema: valueFor("outputSchema"),
        annotations: valueFor("annotations"),
        metadata: valueFor("metadata")
      },
      warnings: [],
      suggestions: []
    });
  }
  const rawBreakdown = isRecord(value.breakdown) ? value.breakdown : {};
  if (value.breakdown !== undefined && !isRecord(value.breakdown)) throw new Error(`Baseline ${sourceLabel}.breakdown must be an object when present.`);
  const breakdown = {
    names: nonNegativeInteger(rawBreakdown.names ?? 0, `${sourceLabel}.breakdown.names`),
    titles: nonNegativeInteger(rawBreakdown.titles ?? 0, `${sourceLabel}.breakdown.titles`),
    descriptions: nonNegativeInteger(rawBreakdown.descriptions ?? 0, `${sourceLabel}.breakdown.descriptions`),
    inputSchemas: nonNegativeInteger(rawBreakdown.inputSchemas ?? 0, `${sourceLabel}.breakdown.inputSchemas`),
    outputSchemas: nonNegativeInteger(rawBreakdown.outputSchemas ?? 0, `${sourceLabel}.breakdown.outputSchemas`),
    annotations: nonNegativeInteger(rawBreakdown.annotations ?? 0, `${sourceLabel}.breakdown.annotations`),
    metadata: nonNegativeInteger(rawBreakdown.metadata ?? 0, `${sourceLabel}.breakdown.metadata`)
  };
  return {
    toolCount: tools.length,
    totalTokens,
    averageTokens: tools.length === 0 ? 0 : totalTokens / tools.length,
    tools,
    breakdown,
    breakdownPercentages: breakdown,
    warnings: [],
    suggestions: []
  };
}

export function compareAnalyses(baseline: AnalysisResult, current: AnalysisResult, options: DiffOptions = {}): AnalysisDiff {
  const allowedIncrease = options.allowedIncrease ?? 0;
  if (!Number.isSafeInteger(allowedIncrease) || allowedIncrease < 0) throw new Error("allowedIncrease must be a non-negative integer.");
  const baselineValues = aggregateValues(baseline.breakdown);
  const currentValues = aggregateValues(current.breakdown);
  const components = Object.fromEntries(DIFF_COMPONENTS.map((component) => [component, metric(baselineValues[component], currentValues[component])])) as Record<DiffComponent, DiffMetric>;
  const total = metric(baseline.totalTokens, current.totalTokens);
  const baselineIndexed = indexed(baseline.tools);
  const currentIndexed = indexed(current.tools);
  const baselineMap = new Map(baselineIndexed.map(({ tool, occurrence }) => [occurrenceKey(tool.name, occurrence), tool]));
  const currentMap = new Map(currentIndexed.map(({ tool, occurrence }) => [occurrenceKey(tool.name, occurrence), tool]));
  const keys = new Set([...Array.from(baselineMap.keys()), ...Array.from(currentMap.keys())]);
  const changes: ToolDiff[] = [];
  for (const key of Array.from(keys)) {
    const baselineTool = baselineMap.get(key);
    const currentTool = currentMap.get(key);
    const occurrence = Number(key.slice(key.lastIndexOf("\u0000") + 1));
    const change = toolDiff(baselineTool, currentTool, baselineTool && currentTool ? "modified" : baselineTool ? "removed" : "added", occurrence);
    if (change.status !== "modified" || changed(change)) changes.push(change);
  }
  changes.sort((a, b) => compareNames(a.name, b.name) || (a.occurrence ?? 1) - (b.occurrence ?? 1));
  const addedTools = changes.filter((change) => change.status === "added");
  const removedTools = changes.filter((change) => change.status === "removed");
  const modifiedTools = changes.filter((change) => change.status === "modified");
  const reasons: string[] = [];
  if (options.enforce ?? true) {
    const over = (value: number): number => Math.max(0, value - allowedIncrease);
    if (over(total.delta) > 0) reasons.push(`total increased by ${total.delta} tokens`);
    for (const component of DIFF_COMPONENTS) if (over(components[component].delta) > 0) reasons.push(`${component} increased by ${components[component].delta} tokens`);
    for (const change of [...addedTools, ...modifiedTools]) {
      if (over(change.tokenDelta) > 0) reasons.push(`${change.name}${change.occurrence ? ` #${change.occurrence}` : ""} increased by ${change.tokenDelta} tokens`);
      for (const component of DIFF_COMPONENTS) if (over(change.components[component].delta) > 0) reasons.push(`${change.name}${change.occurrence ? ` #${change.occurrence}` : ""}.${component} increased by ${change.components[component].delta} tokens`);
    }
    if (options.budget !== undefined && current.totalTokens > options.budget) reasons.push(`current total exceeds budget by ${current.totalTokens - options.budget} tokens`);
  }
  return {
    baselineTotalTokens: baseline.totalTokens,
    currentTotalTokens: current.totalTokens,
    total,
    totalDelta: total.delta,
    totalPercentage: total.percentage,
    components,
    addedTools,
    removedTools,
    modifiedTools,
    enforcement: { allowedIncrease, exceeded: reasons.length > 0, reasons }
  };
}
