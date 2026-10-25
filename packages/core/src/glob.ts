// Glob patterns come from repository configuration, which is untrusted. Backtracking
// matchers (minimatch, path.matchesGlob) can take exponential time on patterns such as
// "*a*a*a...b", so matching here is dynamic programming: O(pattern × path) per pattern.
//
// Syntax: "*" and "?" within a segment, "**" as a whole segment for any depth,
// "[abc]", "[a-z]", "[!x]" classes, "{a,b}" alternatives and "\" escapes. Unlike
// minimatch, wildcards match names that start with ".".

export const MAX_BRACE_EXPANSIONS = 64;

type Token =
  | { kind: "literal"; char: string }
  | { kind: "any" }
  | { kind: "one" }
  | { kind: "class"; test: (c: string) => boolean };
type Segment = { kind: "globstar" } | { kind: "tokens"; tokens: Token[] };

export class GlobError extends Error {}

const compiled = new Map<string, Segment[][]>();

export function matchesGlob(file: string, pattern: string): boolean {
  let alternatives = compiled.get(pattern);
  if (!alternatives) {
    alternatives = expandBraces(pattern.replace(/^\.\//, "")).map(compileSegments);
    compiled.set(pattern, alternatives);
  }
  const parts = file.split("/");
  return alternatives.some((segments) => matchSegments(segments, parts));
}

export function validateGlob(pattern: string): string | undefined {
  try {
    expandBraces(pattern.replace(/^\.\//, "")).forEach(compileSegments);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

export function expandBraces(pattern: string): string[] {
  const open = findUnescaped(pattern, "{", 0);
  if (open === -1) return [pattern];
  let depth = 0;
  let close = -1;
  const commas: number[] = [];
  for (let i = open; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    } else if (c === "," && depth === 1) commas.push(i);
  }
  if (close === -1) throw new GlobError(`Unclosed "{" in glob "${pattern}".`);

  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  const bounds = [open, ...commas, close];
  const results: string[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const option = pattern.slice((bounds[k] as number) + 1, bounds[k + 1]);
    for (const expanded of expandBraces(prefix + option + suffix)) {
      results.push(expanded);
      if (results.length > MAX_BRACE_EXPANSIONS) {
        throw new GlobError(`Glob "${pattern}" expands to more than ${MAX_BRACE_EXPANSIONS} alternatives.`);
      }
    }
  }
  return results;
}

function findUnescaped(s: string, target: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === target) return i;
  }
  return -1;
}

function compileSegments(pattern: string): Segment[] {
  const segments: Segment[] = [];
  for (const raw of pattern.split("/")) {
    if (raw === "**") {
      if (segments[segments.length - 1]?.kind !== "globstar") segments.push({ kind: "globstar" });
    } else {
      segments.push({ kind: "tokens", tokens: tokenize(raw, pattern) });
    }
  }
  return segments;
}

function tokenize(segment: string, pattern: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i] as string;
    if (c === "\\") {
      const next = segment[i + 1];
      if (next === undefined) throw new GlobError(`Glob "${pattern}" ends with an escape.`);
      tokens.push({ kind: "literal", char: next });
      i++;
    } else if (c === "*") {
      if (tokens[tokens.length - 1]?.kind !== "any") tokens.push({ kind: "any" });
    } else if (c === "?") {
      tokens.push({ kind: "one" });
    } else if (c === "[") {
      const end = segment.indexOf("]", i + 2);
      if (end === -1) throw new GlobError(`Unclosed "[" in glob "${pattern}".`);
      tokens.push({ kind: "class", test: compileClass(segment.slice(i + 1, end)) });
      i = end;
    } else {
      tokens.push({ kind: "literal", char: c });
    }
  }
  return tokens;
}

function compileClass(body: string): (c: string) => boolean {
  const negated = body.startsWith("!") || body.startsWith("^");
  const spec = negated ? body.slice(1) : body;
  const ranges: [string, string][] = [];
  for (let i = 0; i < spec.length; i++) {
    const from = spec[i] as string;
    if (spec[i + 1] === "-" && i + 2 < spec.length) {
      ranges.push([from, spec[i + 2] as string]);
      i += 2;
    } else {
      ranges.push([from, from]);
    }
  }
  return (c) => ranges.some(([lo, hi]) => c >= lo && c <= hi) !== negated;
}

function matchSegments(segments: readonly Segment[], parts: readonly string[]): boolean {
  let reachable = new Array<boolean>(parts.length + 1).fill(false);
  reachable[0] = true;
  segments.forEach((segment, index) => {
    const next = new Array<boolean>(parts.length + 1).fill(false);
    if (segment.kind === "globstar") {
      // Paths are files, so a trailing "**" must consume at least one segment:
      // "**/dist/**" matches "dist/a.js" but not a file named "dist".
      const trailing = index === segments.length - 1 && index > 0;
      let any = false;
      for (let j = 0; j <= parts.length; j++) {
        if (trailing) next[j] = any;
        any ||= reachable[j] === true;
        if (!trailing) next[j] = any;
      }
    } else {
      for (let j = 0; j < parts.length; j++) {
        if (reachable[j] && matchTokens(segment.tokens, parts[j] as string)) next[j + 1] = true;
      }
    }
    reachable = next;
  });
  return reachable[parts.length] === true;
}

function matchTokens(tokens: readonly Token[], text: string): boolean {
  let reachable = new Array<boolean>(text.length + 1).fill(false);
  reachable[0] = true;
  for (const token of tokens) {
    const next = new Array<boolean>(text.length + 1).fill(false);
    if (token.kind === "any") {
      let any = false;
      for (let j = 0; j <= text.length; j++) {
        any ||= reachable[j] === true;
        next[j] = any;
      }
    } else {
      for (let j = 0; j < text.length; j++) {
        if (!reachable[j]) continue;
        const c = text[j] as string;
        const ok = token.kind === "one" || (token.kind === "literal" ? token.char === c : token.test(c));
        if (ok) next[j + 1] = true;
      }
    }
    reachable = next;
  }
  return reachable[text.length] === true;
}
