import { readFile } from "node:fs/promises";
import { validateTools, type MCPTool } from "../core/types.js";

export function parseToolsDocument(value: unknown, sourceLabel = "JSON input"): MCPTool[] {
  if (Array.isArray(value)) return validateTools(value, sourceLabel);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const tools = (value as Record<string, unknown>).tools;
    if (tools !== undefined) return validateTools(tools, sourceLabel);
  }
  throw new Error(`Expected ${sourceLabel} to contain an array of MCP tools or an object containing a "tools" array.`);
}

export async function loadToolsFromJsonFile(filePath: string): Promise<MCPTool[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Unable to read MCP tools from ${filePath}${reason}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Unable to parse MCP tools from ${filePath}: ${reason}`);
  }
  return parseToolsDocument(parsed, filePath);
}
