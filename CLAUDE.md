# Blindspot — working rules

## Git
- Never run `git add` or `git commit`. At each checkpoint, give the commit message to the user instead.

## Code style
- No unnecessary comments. Comment only non-obvious algorithms or trade-offs.

## Skills
- `koncept`: use for every plan, implementation and self-review. In Implement mode, always self-review before reporting.
- `finclusion-backend-standard`: apply to `apps/web` API routes, `apps/worker`, `packages/db` and `packages/github`.
- `finclusion-frontend-standard`: apply to `apps/web` UI and the HTML report.
- **Identity exception:** Blindspot is not a Finclusion app. It authenticates users with GitHub ([ADR 0007](docs/decisions/0007-github-only-auth.md)). Wherever the standards say to use the Finclusion SSO or `finclusionId`, use GitHub sign-in and GitHub user/installation IDs instead. Every other pillar applies as written.

## Source of truth
- Architecture, scoring, threats and stage gates live in `docs/`. Update the relevant doc in the same change as the code.
