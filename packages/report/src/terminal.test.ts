import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeTerminal } from "./escape.js";
import { renderTerminal, truncateMiddle } from "./terminal.js";
import { emptyResult, goldenResult, HOSTILE_PATHS, withPaths } from "./test/fixture.js";

describe("sanitizeTerminal", () => {
  it("makes control sequences visible instead of executing them", () => {
    expect(sanitizeTerminal("a\u001b[31mb\u0007c\u009bd\u007fe\nf")).toBe(
      "a\\x1b[31mb\\x07c\\x9bd\\x7fe\\x0af",
    );
    expect(sanitizeTerminal("plain/path é 文件.ts")).toBe("plain/path é 文件.ts");
  });

  it("reveals bidirectional overrides", () => {
    expect(sanitizeTerminal("a\u202Eb\u2066c")).toBe("a\\u{202e}b\\u{2066}c");
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("renderTerminal", () => {
  it("summarizes coverage, bands, ranked files and notes without color", () => {
    const text = renderTerminal(goldenResult(), { color: false, width: 100 });
    expect(text).toMatchInlineSnapshot(`
      "Blindspot · bs-risk@0.1.0 · commit fb5f60351cf1 · as of 2026-06-01
      Analyzed 5 of 8 tracked files (3 excluded: 1 default excluded, 1 extension, 1 generated) · 6
        commits read
      Bands: High 0 · Elevated 0 · Moderate 2 · Low 2 · Insufficient evidence 1

      Highest estimated risk
        SCORE  BAND        CONF  FILE
         44.6  Moderate    0.71  src/core/parser.ts
               100% of lines changed in the last 365 days came from a single contributor.
         37.8  Moderate    0.47* src/core/tokens.ts
               100% of this file's historical changes were made by contributors with no commits in the la…
         17.3  Low         0.55* src/index.ts
               100% of this file's historical changes were made by contributors with no commits in the la…
         16.2  Low         0.46* src/util/format.ts
               100% of lines changed in the last 365 days came from a single contributor.
        * limited evidence: treat this estimate with extra caution.
        1 file(s) have insufficient evidence and are not ranked.

      Note: Scores estimate comprehension risk relative to other files in this repository. They are not
            comparable across repositories and are not a measure of any developer.
      Note: Review evidence is not available in local mode, so it is reported as missing rather than
            counted against any file.
      "
    `);
  });

  it("never passes control characters from file names to the terminal", () => {
    const text = renderTerminal(withPaths(goldenResult(), HOSTILE_PATHS), { color: false, width: 160 });
    // eslint-disable-next-line no-control-regex -- asserting no control characters reach the terminal
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202e]/);
    expect(text).toContain("\\x1b]8;;https://evil.example\\x07click");
  });

  it("uses ANSI color only when asked", () => {
    expect(renderTerminal(goldenResult(), { color: true, width: 100 })).toContain("\u001b[36mModerate");
    expect(renderTerminal(goldenResult(), { color: false, width: 100 })).not.toContain("\u001b");
  });

  it("reports an empty analysis honestly", () => {
    const text = renderTerminal(emptyResult(), { color: false, width: 80 });
    expect(text).toContain("commit no commits · as of n/a");
    expect(text).toContain("No file has enough evidence to be ranked yet.");
    expect(text).toContain("! The repository has no commits yet");
  });

  it("keeps every line within the requested width", () => {
    const long = withPaths(goldenResult(), [`${"deeply/nested/".repeat(20)}file.ts`]);
    for (const width of [60, 80, 120]) {
      for (const line of renderTerminal(long, { color: false, width }).split("\n")) {
        expect(line.length).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe("truncateMiddle", () => {
  it("keeps both ends of a long path", () => {
    expect(truncateMiddle("abcdefghij", 10)).toBe("abcdefghij");
    expect(truncateMiddle("packages/core/src/model/score.ts", 20)).toBe("package…del/score.ts");
    expect(truncateMiddle("packages/core/src/model/score.ts", 20)).toHaveLength(20);
    expect(truncateMiddle("x", 1)).toBe("x");
  });
});
