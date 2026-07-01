import { describe, expect, it } from "vitest";
import { redactSecrets, diff, sanitizeDiff } from "./recorder";

describe("redactSecrets", () => {
  it("redacts secret keys and drops bookkeeping keys", () => {
    const out = redactSecrets({
      name: "Alice",
      passwordHash: "abc",
      apiKey: "k",
      backendApiKey: "b",
      token: "t",
      createdAt: "2020-01-01",
      updatedAt: "2020-01-02",
    });
    expect(out).toEqual({
      name: "Alice",
      passwordHash: "[REDACTED]",
      apiKey: "[REDACTED]",
      backendApiKey: "[REDACTED]",
      token: "[REDACTED]",
    });
  });

  it("returns null for nullish input", () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeNull();
  });
});

describe("diff", () => {
  it("create (before=null) returns redacted after only", () => {
    expect(diff(null, { email: "a@b.com", apiKey: "secret" })).toEqual({
      after: { email: "a@b.com", apiKey: "[REDACTED]" },
    });
  });

  it("delete (after=null) returns before only", () => {
    expect(diff({ email: "a@b.com" }, null)).toEqual({
      before: { email: "a@b.com" },
    });
  });

  it("update returns only changed keys and ignores timestamps", () => {
    const before = { name: "A", isActive: false, createdAt: "t1", updatedAt: "t1" };
    const after = { name: "A", isActive: true, createdAt: "t1", updatedAt: "t2" };
    expect(diff(before, after)).toEqual({
      before: { isActive: false },
      after: { isActive: true },
    });
  });

  it("shows a secret change as redacted on both sides (not hidden)", () => {
    expect(diff({ passwordHash: "old" }, { passwordHash: "new" })).toEqual({
      before: { passwordHash: "[REDACTED]" },
      after: { passwordHash: "[REDACTED]" },
    });
  });

  it("omits an unchanged secret", () => {
    expect(
      diff({ passwordHash: "same", name: "A" }, { passwordHash: "same", name: "B" })
    ).toEqual({
      before: { name: "A" },
      after: { name: "B" },
    });
  });

  it("treats deep-equal object values as unchanged", () => {
    expect(diff({ meta: { a: 1 } }, { meta: { a: 1 } })).toEqual({
      before: {},
      after: {},
    });
  });
});

describe("sanitizeDiff", () => {
  it("redacts secrets a caller forgot to redact (both sides)", () => {
    expect(
      sanitizeDiff({
        before: { apiKey: "old", name: "A" },
        after: { apiKey: "new", name: "B" },
      })
    ).toEqual({
      before: { apiKey: "[REDACTED]", name: "A" },
      after: { apiKey: "[REDACTED]", name: "B" },
    });
  });

  it("returns null for nullish input", () => {
    expect(sanitizeDiff(null)).toBeNull();
    expect(sanitizeDiff(undefined)).toBeNull();
  });
});
