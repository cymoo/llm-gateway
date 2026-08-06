import { describe, expect, it } from "vitest";
import { MODEL_ALIAS_PATTERN, validateModelAlias } from "./validators";

describe("MODEL_ALIAS_PATTERN", () => {
  // The model form feeds `.source` straight into an HTML `pattern` attribute.
  // Browsers compile that attribute with the RegExp `v` flag, which rejects an
  // unescaped `/` or `-` inside a character class — and per the HTML spec a
  // pattern that fails to compile is ignored, silently disabling validation.
  it("compiles under the `v` flag used by the HTML pattern attribute", () => {
    expect(() => new RegExp(MODEL_ALIAS_PATTERN.source, "v")).not.toThrow();
  });

  it("behaves identically with and without the `v` flag", () => {
    const withV = new RegExp(MODEL_ALIAS_PATTERN.source, "v");
    const cases = [
      "qwen-plus",
      "ds-flash",
      "openai/gpt-4o",
      "a.b_c/d-e",
      "x",
      "-bad",
      "bad-",
      "UPPER",
      "",
    ];
    for (const value of cases) {
      expect(withV.test(value), value).toBe(MODEL_ALIAS_PATTERN.test(value));
    }
  });

  it("accepts the separators the admin API documents", () => {
    for (const alias of ["qwen-plus", "openai/gpt-4o", "a.b", "a_b", "q3"]) {
      expect(validateModelAlias(alias), alias).toBe(true);
    }
  });

  it("rejects aliases not bounded by a letter or digit", () => {
    for (const alias of ["-lead", "trail-", "/slash", "UPPER", ""]) {
      expect(validateModelAlias(alias), alias).toBe(false);
    }
  });
});
