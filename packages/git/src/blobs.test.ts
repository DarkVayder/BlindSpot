import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CatFileParser, readBlobs } from "./blobs.js";
import { listTrackedFiles, openRepository } from "./repo.js";
import { TestRepo } from "./test/repo.js";

const T = 20_000;
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

function parse(bytes: Buffer, cuts: number[] = []) {
  const out: [string, string | null][] = [];
  const parser = new CatFileParser((oid, content) =>
    out.push([oid, content ? content.toString("latin1") : null]),
  );
  let last = 0;
  for (const at of [...cuts].sort((x, y) => x - y)) {
    parser.push(bytes.subarray(last, at));
    last = at;
  }
  parser.push(bytes.subarray(last));
  parser.end();
  return out;
}

describe("CatFileParser", () => {
  const stream = Buffer.concat([
    Buffer.from(`${A} blob 5\nhello\n`),
    Buffer.from(`${B} missing\n`),
    Buffer.from(`${C} blob 4\n`),
    Buffer.from([0x00, 0x0a, 0xff, 0x0a]),
    Buffer.from("\n"),
    Buffer.from(`${A} blob 0\n\n`),
  ]);

  it("reads blobs, missing objects, binary content with embedded newlines, and empty blobs", () => {
    expect(parse(stream)).toEqual([
      [A, "hello"],
      [B, null],
      [C, "\u0000\nÿ\n"],
      [A, ""],
    ]);
  });

  it("is independent of chunk boundaries", () => {
    const expected = parse(stream);
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: stream.length - 1 }), { maxLength: 20 }),
        (cuts) => {
          expect(parse(stream, cuts)).toEqual(expected);
        },
      ),
    );
  });

  it("rejects truncated output", () => {
    expect(() => parse(Buffer.from(`${A} blob 10\nshort`))).toThrow(/mid-object/);
  });

  it("rejects unexpected headers", () => {
    expect(() => parse(Buffer.from("garbage line\n"))).toThrow(/unexpected header/);
  });
});

describe("readBlobs", () => {
  it("returns file contents at HEAD, not the working tree", async () => {
    const r = TestRepo.create();
    r.write("a.ts", "committed\n").write("b.bin", "\u0000\u0001").commit("one", "2026-01-01T00:00:00Z");
    r.write("a.ts", "uncommitted edit\n");
    const repo = await openRepository(r.root, T);
    const entries = await listTrackedFiles(repo, T);
    const contents = new Map<string, string | null>();
    await readBlobs(
      repo,
      entries.map((e) => e.oid),
      T,
      (oid, content) => contents.set(oid, content ? content.toString("utf8") : null),
    );
    const byPath = Object.fromEntries(entries.map((e) => [e.path, contents.get(e.oid)]));
    expect(byPath).toEqual({ "a.ts": "committed\n", "b.bin": "\u0000\u0001" });
  });

  it("rejects malformed object ids before running git", async () => {
    const r = TestRepo.create();
    r.write("a.ts", "x\n").commit("one", "2026-01-01T00:00:00Z");
    const repo = await openRepository(r.root, T);
    await expect(readBlobs(repo, ["HEAD"], T, () => undefined)).rejects.toThrow(/Invalid object id/);
  });
});
