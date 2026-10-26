import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BAND_ORDER } from "./order.js";
import { REPORT_CSP, renderHtml, THEME } from "./html.js";
import { emptyResult, goldenResult, HOSTILE_PATHS, withPaths } from "./test/fixture.js";

const sha = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

function between(html: string, open: string, close: string): string[] {
  const out: string[] = [];
  let at = html.indexOf(open);
  while (at !== -1) {
    const start = at + open.length;
    const end = html.indexOf(close, start);
    out.push(html.slice(start, end));
    at = html.indexOf(open, end);
  }
  return out;
}

// Parses each start tag's attributes the way a browser tokenizer would: a quoted value ends
// only at a real quote, so text escaped as &quot; stays inside the value. If escaping broke,
// an injected attribute would surface here as its own name.
function attributeNames(html: string): Set<string> {
  const names = new Set<string>();
  for (const tag of html.matchAll(
    /<[a-zA-Z][a-zA-Z0-9]*((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g,
  )) {
    for (const attr of (tag[1] ?? "").matchAll(
      /\s+([^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g,
    )) {
      names.add((attr[1] ?? "").toLowerCase());
    }
  }
  return names;
}

describe("renderHtml security", () => {
  const html = renderHtml(withPaths(goldenResult(), HOSTILE_PATHS));

  it("escapes hostile file paths everywhere they appear", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("</style><style>");
    const names = attributeNames(html);
    expect(names.size).toBeGreaterThan(5);
    expect([...names].filter((n) => n.startsWith("on"))).toEqual([]);
    expect(html).toContain("src/&lt;script&gt;alert(1)&lt;/script&gt;.ts");
    expect(html).toContain("src/&quot; onmouseover=&quot;alert(1)&quot; x=&quot;.ts");
    expect(html).toContain("src/&#39;single&#39;&amp;amp;.ts");
  });

  it("shows bidirectional override characters instead of applying them", () => {
    expect(html).not.toContain("\u202e");
    expect(html).toContain("invoice\\u{202e}txt.exe.ts");
  });

  it("contains exactly one style and one script element, both allowed by the CSP hashes", () => {
    const styles = between(html, "<style>", "</style>");
    const scripts = between(html, "<script>", "</script>");
    expect(styles).toHaveLength(1);
    expect(scripts).toHaveLength(1);
    expect(REPORT_CSP).toContain(`style-src ${sha(styles[0] ?? "")}`);
    expect(REPORT_CSP).toContain(`script-src ${sha(scripts[0] ?? "")}`);
    expect(REPORT_CSP).toMatch(/^default-src 'none'; /);
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP.replaceAll("'", "&#39;")}">`,
    );
  });

  it("references no external resources, even when paths contain URLs", () => {
    expect(html).not.toMatch(/\ssrc=/);
    expect(html.match(/\shref="([^"]*)"/g)).toEqual([' href="#files"']);
    expect(renderHtml(goldenResult())).not.toMatch(/https?:\/\//);
  });
});

describe("renderHtml content and accessibility", () => {
  const result = goldenResult();
  const html = renderHtml(result);

  it("is deterministic", () => {
    expect(renderHtml(goldenResult())).toBe(html);
  });

  it("has one h1, a language, landmarks and a skip link", () => {
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('<html lang="en">');
    for (const tag of ["<header>", "<main>", "<footer>"]) expect(html).toContain(tag);
    expect(html).toContain('<a class="skip" href="#files">');
  });

  it("labels every form control and scopes every column header", () => {
    const inputs = html.match(/<(input|select)\b/g) ?? [];
    const labelled = html.match(/<label>[^<]*<(input|select)\b/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    expect(labelled).toHaveLength(inputs.length);
    const headers = html.match(/<th\b[^>]*>/g) ?? [];
    expect(headers.every((th) => th.includes('scope="col"'))).toBe(true);
  });

  it("always names the band in text, not only by color", () => {
    for (const file of result.files) {
      expect(html).toContain(`data-path="${file.path}" data-band="${file.band}"`);
    }
    expect(html).toContain('<span class="chip insufficient_evidence">Insufficient evidence</span>');
  });

  it("does not rank or score files with insufficient evidence", () => {
    const insufficient = result.files.filter((f) => f.band === "insufficient_evidence");
    expect(insufficient.length).toBeGreaterThan(0);
    for (const f of insufficient)
      expect(html).toContain(`data-path="${f.path}" data-band="insufficient_evidence" data-score="-1"`);
    expect(html).toContain('<span class="sr">not ranked</span>');
  });

  it("includes each file's explanations, limitations and signals", () => {
    const parser = result.files.find((f) => f.path === "src/core/parser.ts");
    expect(parser).toBeDefined();
    for (const line of [...(parser?.explanations ?? []), ...(parser?.limitations ?? [])]) {
      expect(html).toContain(line.replaceAll("'", "&#39;"));
    }
    expect(html).toContain("<code>cyclomatic_max</code>");
  });

  it("shows an empty state when nothing was analyzed", () => {
    const empty = renderHtml(emptyResult());
    expect(empty).toContain("No files were analyzed.");
    expect(empty).not.toContain('id="files-table"');
    expect(empty).toContain("The repository has no commits yet");
  });

  it("caps the number of files and says where the rest are", () => {
    const capped = renderHtml(result, { maxFiles: 2 });
    expect(capped.match(/<tr data-path=/g)).toHaveLength(2);
    expect(capped).toContain(
      `Showing 2 of ${result.files.length} files. The JSON report contains every file.`,
    );
  });
});

describe("theme contrast", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  it.each(["light", "dark"] as const)("meets WCAG AA (4.5:1) for all text in the %s theme", (mode) => {
    const t: Record<string, string> = THEME[mode];
    const pairs: [string, string][] = [
      ["text", "bg"],
      ["muted", "bg"],
      ["muted", "surface"],
      ["text", "surface"],
      ...BAND_ORDER.map((b): [string, string] => [`${b}-fg`, `${b}-bg`]),
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(t[fg] ?? "", t[bg] ?? ""), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t.focus ?? "", t.bg ?? ""), "focus ring").toBeGreaterThanOrEqual(3);
  });
});
