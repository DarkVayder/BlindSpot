import path from "node:path";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".rs": "rust",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".scala": "scala",
};

export const JS_LIKE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;

export function extensionOf(file: string): string {
  return path.posix.extname(file).toLowerCase();
}

export function languageOf(file: string): string {
  return LANGUAGE_BY_EXTENSION[extensionOf(file)] ?? "other";
}

export function isJsLike(file: string): boolean {
  return (JS_LIKE_EXTENSIONS as readonly string[]).includes(extensionOf(file));
}
