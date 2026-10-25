import type { Repository } from "./repo.js";
import { GitError, streamGit } from "./runner.js";

const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const HEADER = /^([0-9a-f]{40,64}) (blob|tree|commit|tag) (\d+)$/;
const MISSING = /^([0-9a-f]{40,64}) missing$/;

export type BlobHandler = (oid: string, content: Buffer | null) => void;

export class CatFileParser {
  private buffer: Buffer = Buffer.alloc(0);
  private body: { oid: string; size: number } | undefined;

  constructor(private readonly onBlob: BlobHandler) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.body) {
        const { oid, size } = this.body;
        if (this.buffer.length < size + 1) return;
        if (this.buffer[size] !== 0x0a) throw parseError("object not followed by a newline");
        this.onBlob(oid, Buffer.from(this.buffer.subarray(0, size)));
        this.buffer = this.buffer.subarray(size + 1);
        this.body = undefined;
        continue;
      }
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) {
        if (this.buffer.length > 256) throw parseError("header too long");
        return;
      }
      const line = this.buffer.subarray(0, newline).toString("latin1");
      this.buffer = this.buffer.subarray(newline + 1);
      const missing = MISSING.exec(line);
      if (missing) {
        this.onBlob(missing[1] as string, null);
        continue;
      }
      const header = HEADER.exec(line);
      if (!header) throw parseError("unexpected header");
      this.body = { oid: header[1] as string, size: Number(header[3]) };
    }
  }

  end(): void {
    if (this.body || this.buffer.length > 0) throw parseError("output ended mid-object");
  }
}

function parseError(detail: string): GitError {
  return new GitError("failed", `Could not parse git cat-file output (${detail}).`);
}

export async function readBlobs(
  repo: Repository,
  oids: readonly string[],
  timeoutMs: number,
  onBlob: BlobHandler,
): Promise<void> {
  if (oids.length === 0) return;
  for (const oid of oids) {
    if (!OID.test(oid)) throw new GitError("failed", `Invalid object id: ${oid.slice(0, 80)}`);
  }
  const parser = new CatFileParser(onBlob);
  await streamGit(
    ["cat-file", "--batch"],
    { cwd: repo.root, timeoutMs, input: oids.join("\n") + "\n" },
    (c) => {
      parser.push(c);
    },
  );
  parser.end();
}
