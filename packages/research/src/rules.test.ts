import { describe, expect, it } from "vitest";
import { classifyBugfix, isRevert } from "./rules.js";

const one = (message: string, changedFiles = 1) => classifyBugfix({ message, changedFiles });

describe("bugfix@1", () => {
  it.each([
    "Fix crash when the input is empty",
    "fix(router): handle a null match",
    "fix!: drop the broken fallback",
    "BUG: wrong offset in tokenizer",
    "Handle empty arrays\n\nFixes #1234",
    "Regression in v2 parsing",
    "hotfix for release",
  ])("labels %j as a bug fix", (message) => {
    expect(one(message)).toBe("bugfix");
  });

  it.each([
    ["Add streaming support", "no_fix_terms"],
    ["Improve prefix handling", "no_fix_terms"],
    ["Add debug logging", "no_fix_terms"],
    ["Update fixtures", "no_fix_terms"],
    ["Mention bugs in the FAQ", "no_fix_terms"],
    ["docs: fix the install steps", "excluded_type"],
    ["chore(deps): fix vulnerable dependency", "excluded_type"],
    ["test: fix flaky timeout", "excluded_type"],
    ["Fix typo in error message", "excluded_subject"],
    ["Fix lint errors", "excluded_subject"],
  ])("labels %j as %s", (message, verdict) => {
    expect(one(message)).toBe(verdict);
  });

  it("excludes mass edits of more than 20 files", () => {
    expect(one("Fix imports", 20)).toBe("bugfix");
    expect(one("Fix imports", 21)).toBe("too_many_files");
  });

  it("applies the excluded-type and typo checks to the subject only", () => {
    expect(one("Fix the parser\n\ndocs: also mention the typo")).toBe("bugfix");
  });
});

describe("revert@1", () => {
  it.each([
    ['Revert "Add streaming support"', true],
    ["Undo the cache\n\nThis reverts commit 1a2b3c4d.", true],
    ["Revert the cache change", false],
    ['Mention Revert "x" in docs', false],
    ["Explain how to revert\n\nThis reverts nothing.", false],
  ])("labels %j as revert=%s", (message, expected) => {
    expect(isRevert(message)).toBe(expected);
  });
});
