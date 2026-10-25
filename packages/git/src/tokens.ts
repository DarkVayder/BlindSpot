import { StringDecoder } from "node:string_decoder";

export class NulSplitter {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";

  constructor(private readonly onToken: (token: string) => void) {}

  push(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk);
    let start = 0;
    let index = this.pending.indexOf("\0", start);
    while (index !== -1) {
      this.onToken(this.pending.slice(start, index));
      start = index + 1;
      index = this.pending.indexOf("\0", start);
    }
    this.pending = this.pending.slice(start);
  }

  end(): void {
    this.pending += this.decoder.end();
    if (this.pending.length > 0) this.onToken(this.pending);
    this.pending = "";
  }
}
