# 0002 — Use the system `git` binary

**Context.** History analysis needs rename detection, numstat, `.mailmap` support and good performance on repositories with 100k+ commits. The options were isomorphic-git (pure JS), simple-git (a shell wrapper) and calling `git` directly.

**Decision.** Run `git` with `child_process.spawn` using an argv array (never a shell) and stream `-z` output through an incremental parser.

- The executable is resolved to an absolute path from absolute `PATH` entries only, or from `BLINDSPOT_GIT`. On Windows a bare `git` could otherwise resolve to a `git.exe` inside the analyzed repository.
- Every invocation applies the hardened flags and environment from threat model §3.1.
- The minimum supported git version is 2.31, the first release with `--diff-merges=off`, which keeps merge commits from double-counting churn whatever the user's `log.diffMerges` setting. The version is checked at startup.

**Consequences.** The fastest and most accurate option, with native rename detection. It requires git on the PATH, so the CLI shows an actionable error if git is missing. Output parsers must be robust and are property-tested against arbitrary chunking and hostile file names.
