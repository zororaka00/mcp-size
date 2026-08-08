import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTools } from "../src/index.js";

test("library entrypoint exposes analyzer without CLI side effects", () => {
  const result = analyzeTools([{ name: "library" }]);
  assert.equal(result.toolCount, 1);
});
