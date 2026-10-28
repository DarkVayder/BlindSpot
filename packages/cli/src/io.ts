import { sanitizeTerminal } from "@blindspot/report";

export interface OutputStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

export interface CliIO {
  stdout: OutputStream;
  stderr: OutputStream;
  cwd: string;
  env: Record<string, string | undefined>;
}

export const EXIT = {
  ok: 0,
  riskThreshold: 1,
  usage: 2,
  analysis: 3,
  internal: 4,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  constructor(
    readonly exitCode: ExitCode,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function useColor(io: CliIO, stream: OutputStream, disabled: boolean): boolean {
  if (disabled || io.env.NO_COLOR !== undefined || io.env.TERM === "dumb") return false;
  if (io.env.FORCE_COLOR !== undefined && io.env.FORCE_COLOR !== "0") return true;
  return stream.isTTY === true;
}

export function terminalWidth(stream: OutputStream): number {
  return stream.columns && stream.columns > 0 ? stream.columns : 100;
}

export function writeLine(stream: OutputStream, text: string): void {
  stream.write(`${text.split("\n").map(sanitizeTerminal).join("\n")}\n`);
}
