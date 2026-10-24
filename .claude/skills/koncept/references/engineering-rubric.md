# Engineering rubric

Applies to any language/framework. Read the stack first (manifest files, lockfile, README,
directory layout), then apply these checks against what you find — don't check for
language-specific things that don't apply (e.g. don't ask about `go vet` in a Python repo).

## Correctness

- Does the code do what it claims to do on the happy path? Trace it, don't skim it.
- Off-by-one, null/nil/undefined handling, integer overflow or float precision on money/counts,
  timezone/date handling, race conditions on shared state or concurrent requests.
- For anything touching money, quantities, or inventory: check rounding direction and where it
  happens. Silent floating-point arithmetic on currency is a recurring, expensive bug class —
  flag any `float`/`double` used for money instead of a decimal/integer-minor-units type.
- Error paths: does a failure actually get handled, or does it get swallowed (empty catch,
  ignored error return, `.catch(() => {})`)? A caught-and-ignored error is often worse than an
  uncaught one because it hides the failure instead of surfacing it.

## Maintainability

- Does this match the existing codebase's conventions (naming, file organization, layering,
  error-handling style, how similar features are structured)? Read 2-3 comparable existing
  files before judging — don't import conventions from a different ecosystem or from "best
  practice" blog posts if they conflict with what the codebase already does consistently.
- **No premature abstraction.** Three similar concrete lines beat one clever generic helper
  used twice. Flag interfaces/base classes/config systems built for a hypothetical future
  requirement that hasn't materialized.
- Error handling and validation belong at system boundaries (user input, external API
  responses, file/network I/O) — not sprinkled defensively around internal function calls that
  can't actually fail in ways the type system/caller contract doesn't already guarantee.
  Overly defensive code is a maintainability cost, not a safety win.
- Dead code, unused imports/params, commented-out blocks, leftover debug logging/`console.log`/
  `print` statements, TODOs without an owner or ticket.
- Naming: does a name describe what the thing is/does without needing the reviewer to open it?

## Testing

- Does a test exist for the specific path that changed? Not "is coverage high" — is the exact
  new/changed behavior exercised, including the failure/edge case, not just the happy path?
- If there's no test framework in the project at all, don't insist on one being added for a
  small change — but say so, and suggest running the change manually and reporting what you
  observed instead of leaving it unverified.
- Flaky-looking tests (time-dependent, order-dependent, network-dependent without mocking) are
  worth a note even if unrelated to the current change, if you happen to notice them.

## AI-generated code smells

Increasingly common now that a large share of code is written with AI assistance. These are
distinct from ordinary bugs — they're the specific failure modes of code that reads fluently
but wasn't actually grounded in the real codebase or actually run.

- **Hallucinated APIs.** A method, library, config key, or CLI flag that looks plausible but
  doesn't exist in the actual installed version of the dependency. Check against the lockfile
  version, not the library's latest docs.
- **Unverified claims.** Language in a PR description, commit message, or code comment like
  "this should work" / "this handles X" without evidence it was run. Treat these as an
  explicit prompt to go verify, not as a fact.
- **Over-engineering relative to the ask.** A one-endpoint feature that came with a new
  abstraction layer, a config system, or a plugin architecture. AI assistants left unchecked
  tend to build more scaffolding than a task needs — this is the single most common AI-code
  smell to flag.
- **Inconsistency with the rest of the repo.** A new file that reinvents a pattern (error
  wrapper, response shape, logging call, naming style) that the rest of the codebase already
  has an established way of doing. This usually means the change was written without reading
  neighboring code first.
- **Copy-adjacent duplication.** Near-identical logic pasted and lightly modified instead of
  reused, especially validation logic or provider-integration boilerplate.
- **Missing tests specifically on the changed path**, even when the rest of the file/module has
  good coverage — a strong signal the change was bolted on rather than integrated.
- **Confident-sounding comments that are wrong or stale** — comments describing behavior that
  doesn't match the code beneath them, often left over from an earlier version of a generated
  edit.

When you find one of these, say so plainly (it's a useful signal for the developer to learn to
self-check) but don't editorialize about *how* the code was produced — focus on the concrete
defect.
