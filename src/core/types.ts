export interface Tokenizer {
  count(text: string): number;
}

export type JsonObject = Record<string, unknown>;

export interface MCPTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  annotations?: JsonObject;
  [key: string]: unknown;
}

export interface ToolBreakdown {
  name: number;
  title: number;
  description: number;
  inputSchema: number;
  outputSchema: number;
  metadata: number;
}

export interface ToolAnalysis {
  name: string;
  tokens: number;
  percentage: number;
  breakdown: ToolBreakdown;
  warnings: string[];
  suggestions: string[];
}

export interface AnalysisBreakdown {
  names: number;
  titles: number;
  descriptions: number;
  inputSchemas: number;
  outputSchemas: number;
  metadata: number;
}

export interface AnalysisResult {
  toolCount: number;
  totalTokens: number;
  averageTokens: number;
  tools: ToolAnalysis[];
  breakdown: AnalysisBreakdown;
  breakdownPercentages: AnalysisBreakdown;
  warnings: string[];
  suggestions: string[];
}

export interface AnalyzeOptions {
  tokenizer?: Tokenizer;
  thresholds?: Partial<Record<keyof typeof DEFAULT_THRESHOLDS, number>>;
}

export const DEFAULT_THRESHOLDS = Object.freeze({
  largeToolTokens: 1000,
  largeDescriptionTokens: 300,
  largeInputSchemaTokens: 500,
  dominantSharePercent: 20,
  longPropertyDescriptionTokens: 50,
  concentrationSharePercent: 50,
  concentrationToolLimit: 3
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTools(value: unknown, sourceLabel = "input"): MCPTool[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${sourceLabel} to contain an array of MCP tools.`);
  }
  return value.map((candidate, index) => validateTool(candidate, index));
}

function validateTool(value: unknown, index: number): MCPTool {
  if (!isRecord(value)) {
    throw new Error(`Tool at index ${index} must be an object with a non-empty string name.`);
  }
  if (typeof value.name !== "string" || value.name.trim() === "") {
    throw new Error(`Tool at index ${index} must have a non-empty string name.`);
  }
  for (const field of ["title", "description"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(`Tool at index ${index} field "${field}" must be a string when present.`);
    }
  }
  for (const field of ["inputSchema", "outputSchema"] as const) {
    if (value[field] !== undefined && !isRecord(value[field])) {
      throw new Error(`Tool at index ${index} field "${field}" must be a JSON object when present.`);
    }
  }
  if (value.annotations !== undefined && !isRecord(value.annotations)) {
    throw new Error(`Tool at index ${index} field "annotations" must be a JSON object when present.`);
  }
  return value as MCPTool;
}
