---
name: finclusion-frontend-standard
description: >-
  Build or audit a frontend to the Finclusion engineering standard and industry
  best practice — Next.js (App Router) + React + TypeScript, accessible,
  secure, and consistent. Grounded in Finclusion's real frontends. Use this
  skill whenever someone wants to "build a frontend / UI / web app", "scaffold a
  Next.js app", "set up the component structure", "add a page/form/table",
  "make this UI solid / accessible / production-ready", "wire the frontend to
  the API", "handle login on the frontend", or asks how to structure components,
  state, styling, data fetching, forms, or auth for a web client — even if they
  don't name a framework. For backends use finclusion-backend-standard; for
  auth wiring defer to finclusion-sso-integration.
---

# Finclusion Frontend Standard

Build web frontends that are **consistent, accessible, secure, and fast** across
every Finclusion project. This skill encodes the conventions proven in
Finclusion's own frontends (the Next.js/React reference is grounded in real
code) plus industry best practice.

The house stack is **Next.js (App Router) + React + TypeScript (strict) +
Tailwind + Radix/shadcn-style primitives + react-hook-form/zod + zustand**.
Prefer it for new work. If a project uses a different framework (Vite/React SPA,
Remix, etc.), the **universal pillars** below still apply — translate idiomatically.

## How to use this skill

1. **Establish framework and mode.**
   - **Framework** — detect from the repo: `next` in `package.json` → Next.js;
     a plain React/Vite app; etc. If unknown and unstated, **ask**.
   - **Mode** — *scaffold new*, *add a feature* (page/form/table/flow to an
     existing app), or *audit/refactor*. For audits, read the current structure
     first and propose incremental changes; match the existing conventions.
2. **Apply the universal pillars** (below) — framework-independent.
3. **Open the references** for concrete structure and copy-paste code:
   - `references/nextjs.md` — App Router structure, RSC vs client, config, perf.
   - `references/components-styling.md` — UI primitives (`cva` + `cn`), design
     tokens, Radix a11y, forms with react-hook-form + zod.
   - `references/data-auth.md` — typed API client + auto-refresh, the server-
     proxy pattern, state layering (zustand / server state), frontend auth.
   - `references/security-a11y.md` — frontend security + accessibility baseline
     (read for every UI).
4. **Finish against the Definition of Done** at the bottom.

## The universal pillars (every frontend)

1. **Server-first, client only where needed.** In the App Router, components are
   **Server Components by default**; add `"use client"` only for interactivity
   (state, effects, browser APIs, event handlers). *Why: less JS shipped, faster
   loads, and data fetching stays close to the server.*

2. **Two-tier component model.** Split **`components/ui/` primitives** (Button,
   Input, Dialog — styled, variant-driven, reusable, app-agnostic) from
   **`components/features/` (domain components)** that compose primitives with
   business logic. Pages/routes stay thin — they arrange features. *Why: the
   design system stays stable while features churn.*

3. **Design tokens, never ad-hoc styles.** Style with Tailwind classes bound to
   **CSS-variable design tokens** (`--bg-surface`, `--text-primary`, …), merged
   via the **`cn()`** helper (clsx + tailwind-merge). Variants come from
   **`class-variance-authority`**. No hardcoded hex colors in components, no
   inline style soup. *Why: theming (incl. dark mode) and consistency come for
   free; one place controls the look.*

4. **State, layered correctly.** Keep three kinds of state separate: **server
   state** (data from the API — fetch in RSC or cache with React Query; do NOT
   mirror it into a global store), **global client state** (session, theme — a
   small zustand store, persisted only where it makes sense), and **local UI
   state** (`useState`). *Why: the #1 frontend mess is treating server data as
   global state — it goes stale and you hand-write cache invalidation forever.*

5. **Typed, resilient data access.** All network calls go through **one typed API
   client** (base URL from `NEXT_PUBLIC_*`), which attaches auth, throws a
   structured **`ApiError`**, and **transparently refreshes the token once on a
   401** (dedupe concurrent refreshes). Features never call `fetch` raw. *Why:
   one place for auth, errors, and retries; consistent handling everywhere.*

6. **Forms = react-hook-form + zod.** Define a **zod schema**, infer the type
   (`z.infer`), drive the form with `useForm({ resolver: zodResolver(schema) })`,
   and render field errors from `formState.errors`. Share schemas across
   client/back where possible. *Why: one schema gives you validation, types, and
   messages; manual `useState` forms drift and under-validate.*

7. **Auth handled safely.** Don't reinvent identity — integrate with the
   Finclusion SSO (see `finclusion-sso-integration`). Store the **access token in
   memory and the refresh token in an httpOnly cookie**, or for sensitive/admin
   surfaces use a **server-side proxy** so the browser never holds a token. Gate
   routes with **`middleware.ts`**. *Why: tokens in `localStorage` are XSS-lootable;
   httpOnly/proxy isn't.* Details in `references/data-auth.md`.

8. **Accessible by default.** Build interactive widgets on **Radix UI** primitives
   (focus traps, keyboard nav, ARIA), label every input, maintain visible focus,
   and provide **loading / error / empty** states for every async view (route
   `loading.tsx` + `error.tsx` boundaries). *Why: accessibility and honest async
   states are correctness, not polish.*

9. **TypeScript strict, types real.** `strict: true`; **type every API response**
   and infer form types from schemas. No `any` at boundaries. *Why: the compiler
   catches the bugs users would otherwise find.*

10. **Secure & fast.** Never put secrets in `NEXT_PUBLIC_*` or client code; avoid
    `dangerouslySetInnerHTML` with untrusted input; set security headers. Use
    `next/image`, `next/font`, route-level code splitting, and avoid shipping
    unnecessary client JS. Full lists in `references/security-a11y.md`. *Why:
    these are cheap to do up front and expensive to retrofit.*

## Don't reinvent these — reuse the Finclusion patterns

- **Auth/identity** → `finclusion-sso-integration` skill.
- **The API contract** the frontend talks to → the backend's own contract; for
  SSO-facing calls, the SSO skill's `api-reference.md`.
- **The reference stack is proven** — prefer it as-is for new apps rather than
  re-picking libraries (see `references/nextjs.md`).

## Definition of Done (check before declaring a frontend "solid")

- [ ] Server Components by default; `"use client"` only where interactivity needs it.
- [ ] `components/ui/` primitives vs `components/features/`; pages/routes stay thin.
- [ ] Styling via Tailwind + CSS-variable tokens + `cn()`; variants via `cva`; no hardcoded colors.
- [ ] Server state fetched/cached (RSC or React Query), not duplicated into a global store; global store is small + intentional.
- [ ] One typed API client with `ApiError` + dedup'd refresh-on-401; no raw `fetch` in features.
- [ ] Forms use react-hook-form + zod; types inferred from schemas; field errors rendered.
- [ ] Identity via SSO; access token in memory + httpOnly refresh (or server proxy); routes gated by middleware.
- [ ] Radix-based interactive widgets; inputs labelled; loading/error/empty states + route boundaries.
- [ ] `strict: true`; API responses typed; no boundary `any`.
- [ ] No secrets in client/`NEXT_PUBLIC_*`; security headers set; `next/image` + `next/font`; minimal client JS.

## Reference files

- `references/nextjs.md` — App Router layout, RSC vs client, routing/layouts,
  config, env, tooling, performance. The canonical Finclusion Next.js stack.
- `references/components-styling.md` — UI primitives with `cva`, the `cn()`
  helper, CSS-variable tokens/theming, Radix accessibility, and the
  react-hook-form + zod form pattern.
- `references/data-auth.md` — the typed API client (auto-refresh), the server-
  proxy pattern, state management (zustand + when to use React Query), and
  frontend auth/session/route-protection.
- `references/security-a11y.md` — frontend security baseline and accessibility
  checklist. Read for every UI.
