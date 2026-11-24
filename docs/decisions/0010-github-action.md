# 0010 — A self-contained GitHub Action instead of the hosted product

**Context.** The hosted stages are paused ([ADR 0008](0008-descriptive-not-predictive.md)).
Their main value for a single team was seeing Blindspot on every pull request without
running it by hand. That needs no backend if the analysis runs inside the team's own CI.

**Decision.**

- Ship a JavaScript action (`action.yml` at the repository root) that runs on GitHub's
  `node24` runtime from one bundled file, `packages/action/bundle/index.mjs`, committed to
  the repository. It bundles everything, including the TypeScript compiler, so it installs
  nothing, needs no network, and leaves the job's Node.js version alone.
- On a pull request, compare with the commit the pull request branched from by analyzing it
  in the same run (the engine's pinned-commit support). There are no baseline artifacts to
  store or fetch.
- Report through the job summary, outputs and two report files. There are no pull request
  comments, so the action needs no write permission and nothing it prints notifies anyone.
- Reuse the CLI's gate logic, so `fail-on` means the same thing in both.
- CI rebuilds the bundle and fails if it differs from the committed file, and runs the
  action against this repository on Linux and Windows.

**Consequences.**

- Teams get pull request feedback with no service, no token and no data leaving the
  runner. This is most of what Stages 3–5 offered a single team.
- The committed bundle is about 7 MB and changes whenever bundled code changes. That is the
  usual cost of a self-contained action.
- Users must check out full history (`fetch-depth: 0`). On a shallow clone the action says
  so instead of comparing.
- Organization-wide views across many repositories still need the hosted product. Demand
  for them is one of the triggers for resuming it.
