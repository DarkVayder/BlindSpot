# 0003 — Configuration is JSON only

**Context.** The brief suggests `blindspot.config.ts` as one option. Loading a TS or JS config means _executing a file from the analyzed repository_. That breaks the rule that repository content is untrusted, both on the hosted worker and when a developer analyzes an unfamiliar clone.

**Decision.** Config lives in `blindspot.config.json` (or a `"blindspot"` key in `package.json`) and is validated by a Zod schema. A JSON Schema is published so editors can autocomplete it. `blindspot init` writes a commented example to the docs, not to the file, because JSON has no comments.

**Consequences.** No code execution from config. Config cannot be computed dynamically, which is acceptable for this domain.
