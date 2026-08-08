import type { Tokenizer } from "./types.js";

/** A dependency-free estimate: roughly one token per four Unicode code points. */
export const defaultTokenizer: Tokenizer = Object.freeze({
  count(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(Array.from(text).length / 4);
  }
});

export function assertTokenCount(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`Tokenizer returned an invalid count for ${label}; expected a non-negative integer.`);
  }
  return value;
}

function sortedJson(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
      throw new Error("Value contains a non-JSON-serializable property.");
    }
    return value;
  }
  if (ancestors.has(value)) throw new Error("Value contains a circular reference.");
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) return value.map((item) => sortedJson(item, nextAncestors));
  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) output[key] = sortedJson(record[key], nextAncestors);
  }
  return output;
}

/** Compact JSON with recursively sorted object keys for reproducible estimates. */
export function stableStringify(value: unknown): string {
  const serialized = JSON.stringify(sortedJson(value, new Set<object>()));
  return serialized ?? "";
}
