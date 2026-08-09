import { readFile, stat } from "node:fs/promises";
import { validateTools, type MCPTool } from "../core/types.js";

const DEFAULT_MAX_INPUT_BYTES = 10 * 1024 * 1024;

export function parseToolsDocument(value: unknown, sourceLabel = "JSON input"): MCPTool[] {
  if (Array.isArray(value)) return validateTools(value, sourceLabel);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const tools = (value as Record<string, unknown>).tools;
    if (tools !== undefined) return validateTools(tools, sourceLabel);
  }
  throw new Error(`Expected ${sourceLabel} to contain an array of MCP tools or an object containing a "tools" array.`);
}

function validateLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("maxInputBytes must be a positive integer.");
  return value;
}

export interface JsonInputOptions { maxInputBytes?: number; }

export async function loadToolsFromJsonFile(filePath: string, options: JsonInputOptions = {}): Promise<MCPTool[]> {
  const max = validateLimit(options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES);
  let text: string;
  try {
    if (filePath !== "-") {
      const metadata = await stat(filePath);
      if (metadata.size > max) throw new Error(`input exceeds the ${max} byte limit; increase maxInputBytes.`);
      text = (await readFile(filePath)).toString("utf8");
    } else {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of process.stdin) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); size += buffer.byteLength;
        if (size > max) throw new Error(`stdin input exceeds the ${max} byte limit; increase maxInputBytes.`);
        chunks.push(buffer);
      }
      text = Buffer.concat(chunks).toString("utf8");
    }
  } catch (error) {
    if (error instanceof Error && (error.message.includes("byte limit") || error.message.startsWith("stdin input"))) throw error;
    const reason = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Unable to read MCP tools from ${filePath}${reason}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch (error) { throw new Error(`Unable to parse MCP tools from ${filePath}: ${error instanceof Error ? error.message : "invalid JSON"}`); }
  return parseToolsDocument(parsed, filePath === "-" ? "stdin" : filePath);
}
