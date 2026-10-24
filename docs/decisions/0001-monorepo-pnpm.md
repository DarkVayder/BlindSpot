# 0001 — pnpm workspaces monorepo, strict TypeScript, ESM, Node 24

**Context.** The CLI, worker, research pipeline and dashboard must share one validated domain model and one scoring implementation.

**Decision.** Use a single repository with pnpm workspaces (`packages/*` and `apps/*`). TypeScript runs with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. All packages are ESM. Node 24 LTS is pinned via `.nvmrc` and `engines`. Turborepo or Nx is not used until build times justify it.

**Consequences.** One lockfile and one CI pipeline. Shared types are imported, not copied. Package boundaries are enforced by the dependency rules in `architecture.md` §2, which an ESLint import rule will check.
