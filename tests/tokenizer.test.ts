import assert from "node:assert/strict";
import test from "node:test";
import { defaultTokenizer } from "../src/index.js";

test("default tokenizer returns a dependency-free deterministic estimate", () => {
  assert.equal(defaultTokenizer.count(""), 0);
  assert.equal(defaultTokenizer.count("1234"), 1);
  assert.equal(defaultTokenizer.count("12345"), 2);
  assert.equal(defaultTokenizer.count("😀😀😀😀"), 1);
  assert.equal(defaultTokenizer.count('{"type":"object"}'), 5);
});
