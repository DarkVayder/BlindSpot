# 0002 — Use the system `git` binary through `execFile`

**Context.** History analysis needs rename detection, numstat, `.mailmap` support and good performance on repositories with 100k+ commits. The options were isomorphic-git (pure JS), simple-git (a shell wrapper) and calling `git` directly.

**Decision.** Spawn `git` with `child_process.execFile` or `spawn` using an argv array (never a shell) and streaming `-z` output. Every invocation applies the hardened flags and environment from threat model §3.1. The minimum supported git version is 2.30, checked at startup.

**Consequences.** The fastest and most accurate option, with native rename detection. It requires git on the PATH, so the CLI shows an actionable error if git is missing. Output parsers must be robust and are fuzz-tested with hostile file names.
