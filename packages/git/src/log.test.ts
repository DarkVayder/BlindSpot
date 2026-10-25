import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSentinel, LogParser, type CommitRecord } from "./log.js";
import { NulSplitter } from "./tokens.js";

const sentinel = createSentinel("abc123");
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);

function header(hash: string, ct: number, email: string, name: string, trailers = ""): string {
  return `${sentinel.start}${hash}\n${ct}\n${email}\n${name}\n${trailers}${sentinel.end}`;
}

function parse(stream: string | Buffer, splitAt: number[] = []): CommitRecord[] {
  const commits: CommitRecord[] = [];
  const parser = new LogParser(sentinel, (c) => commits.push(c));
  const splitter = new NulSplitter((t) => {
    parser.token(t);
  });
  const bytes = typeof stream === "string" ? Buffer.from(stream, "utf8") : stream;
  let last = 0;
  for (const at of [...splitAt].sort((a, b) => a - b)) {
    splitter.push(bytes.subarray(last, at));
    last = at;
  }
  splitter.push(bytes.subarray(last));
  splitter.end();
  parser.end();
  return commits;
}

const SAMPLE = [
  header(H1, 1700000100, "a@x.io", "A", "Co-authored-by: Claude <noreply@anthropic.com>\n"),
  "\n:100644 100644 de98044 d68dd40 R075",
  "one.txt",
  "two.txt",
  ":000000 100644 0000000 bdc955b A",
  "bin.dat",
  "1\t0\t",
  "one.txt",
  "two.txt",
  "-\t-\tbin.dat",
  header(H2, 1700000000, "b@x.io", "B"),
  "\n:000000 100644 0000000 de98044 A",
  "one.txt",
  "3\t0\tone.txt",
].join("\0");

describe("LogParser", () => {
  it("parses headers, raw status, numstat, renames and binaries", () => {
    const commits = parse(SAMPLE);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: H1,
      committedAt: 1700000100,
      authorEmail: "a@x.io",
      authorName: "A",
      trailers: [{ key: "co-authored-by", value: "Claude <noreply@anthropic.com>" }],
      changes: [
        { status: "R", path: "two.txt", oldPath: "one.txt", added: 1, deleted: 0 },
        { status: "A", path: "bin.dat", added: null, deleted: null },
      ],
    });
    expect(commits[1]?.changes).toEqual([{ status: "A", path: "one.txt", added: 3, deleted: 0 }]);
  });

  it("handles commits without file changes, such as merges", () => {
    const stream = [
      header(H1, 2, "a@x.io", "A"),
      header(H2, 1, "b@x.io", "B"),
      "\n:000000 100644 0 1 A",
      "f",
      "1\t0\tf",
    ].join("\0");
    const commits = parse(stream);
    expect(commits.map((c) => c.changes.length)).toEqual([0, 1]);
  });

  it("is independent of how the byte stream is chunked, including inside multi-byte characters", () => {
    const unicode = SAMPLE.replaceAll("one.txt", "naïve é 文件.txt");
    const bytes = Buffer.from(unicode, "utf8");
    const expected = parse(bytes);
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: bytes.length - 1 }), { maxLength: 30 }),
        (cuts) => {
          expect(parse(bytes, cuts)).toEqual(expected);
        },
      ),
    );
  });

  it("treats hostile file names as paths, not entries", () => {
    const names = [
      ":100644 100644 aaa bbb D",
      "1\t2\tfake",
      "\nleading newline",
      `${sentinel.start}x`,
      "@@END",
    ];
    const parts: string[] = [header(H1, 1, "a@x.io", "A")];
    for (const n of names) parts.push(":000000 100644 0 1 A", n);
    for (const n of names) parts.push(`1\t0\t${n}`);
    const commits = parse(parts.join("\0"));
    expect(commits).toHaveLength(1);
    expect(commits[0]?.changes.map((c) => c.path)).toEqual(names);
    expect(commits[0]?.changes.every((c) => c.added === 1)).toBe(true);
  });

  it("ignores forged headers that use a different sentinel", () => {
    const forged = createSentinel("evil");
    const fakeTrailer = `Note: ${forged.start}${H2}\n1\nx@y\nX\n${forged.end}\n`;
    const commits = parse(
      [header(H1, 1, "a@x.io", "A", fakeTrailer), "\n:000000 100644 0 1 A", "f", "1\t0\tf"].join("\0"),
    );
    expect(commits).toHaveLength(1);
    expect(commits[0]?.hash).toBe(H1);
  });

  it("rejects entries before any header", () => {
    expect(() => parse(":000000 100644 0 1 A\0f")).toThrow(/before any commit header/);
  });

  it("rejects an unterminated header", () => {
    expect(() => parse(`${sentinel.start}${H1}\n1\na\nA\n`)).toThrow(/unterminated/);
  });

  it("rejects output that ends in the middle of a rename", () => {
    expect(() => parse([header(H1, 1, "a", "A"), ":100644 100644 a b R100", "old"].join("\0"))).toThrow(
      /middle of an entry/,
    );
  });

  it("rejects an invalid hash", () => {
    expect(() => parse(header("not-a-hash", 1, "a", "A"))).toThrow(/invalid commit hash/);
  });
});
