# 0009 — Release the CLI on its own, as one reproducible npm package

**Context.** Stage 2 found no signal beyond file size and churn, so the hosted stages are
paused ([ADR 0008](0008-descriptive-not-predictive.md)). The CLI works on its own, makes no
network calls, and is honest about what the index means. The stage plan assumed Stage 8
would release the CLI and the hosted product together.

**Decision.**

- Release the CLI alone as version 0.1.0, under the MIT license.
- Publish **one** npm package. `scripts/release.js` bundles the six workspace packages into
  a single ESM file with esbuild. `typescript` stays a runtime dependency, because the
  complexity analyzer loads its compiler. commander and zod are bundled, and their licenses
  are reproduced in `THIRD_PARTY_NOTICES.md`.
- The package name lives only in `release.json`. It is a placeholder until the npm scope is
  confirmed (blocker B1), and the release workflow refuses to run while it is.
- **Releases are reproducible.** File modes are normalized and npm fixes timestamps, so the
  same commit gives a byte-identical tarball on Windows and Linux. The release workflow
  builds on both, requires the hashes to match, and publishes that exact tarball with npm
  provenance through trusted publishing, so no long-lived npm token is stored.
- Before any release, a smoke test installs the tarball into an empty project and checks
  every command. On Linux it also runs with no network.
- The Stage 8 gate applies to the CLI only. Hosted items wait for Stages 3–7.

**Consequences.**

- Users get the tool without cloning or building, and can verify that the published
  tarball matches a build of the tagged commit.
- Workspace packages stay private. Their APIs can change freely, because only the
  bundled command is public.
- The tagline is "Know the code." The brand no longer refers to risk.
- Publishing needs three things only the maintainer can provide: an npm scope, a GitHub
  remote with the `npm` environment and trusted publishing configured, and the decision to
  run the workflow.
