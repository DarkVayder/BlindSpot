# 0004 — Complexity and dependency analysis for TS/JS first

**Context.** Multi-language parsing (tree-sitter WASM grammars) adds a large dependency surface and more correctness work for each language.

**Decision.** v1 computes complexity and the import graph for `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` and `.cjs` using the TypeScript compiler API. Files in all other configured languages still get the history-based signals (G1, G2, G5). Their complexity and impact are reported as `missing` with the reason "language not supported", and confidence is lowered.

**Consequences.** Honest partial coverage instead of a weak complexity proxy such as line counts or indentation. The `analyzers` package exposes a `LanguageAnalyzer` interface so other languages can be added later without changing the scoring code.
