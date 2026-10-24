# Finclusion Next.js / React Standard

The canonical frontend stack, grounded in the `VidVerify frontend` and
`sso-auth-frontend` reference apps. Adopt as-is for new apps; for audits, compare
and close gaps.

## The stack (defaults — don't re-litigate)

| Concern | Choice |
|---|---|
| Framework | **Next.js 15** App Router (`app/`), **React 19** |
| Language | **TypeScript**, `strict: true` |
| Styling | **Tailwind 3** + CSS-variable design tokens |
| UI primitives | **Radix UI** + `class-variance-authority` + `clsx` + `tailwind-merge` (shadcn/ui pattern) |
| Icons | `lucide-react` |
| Forms | **react-hook-form** + `@hookform/resolvers` + **zod** |
| Global state | **zustand** (+ `persist` where appropriate) |
| Server-state cache | **@tanstack/react-query** for client-fetched data (or fetch in RSC) |
| Tables | `@tanstack/react-table` |
| Animation | `framer-motion` (sparingly) |

## Directory layout

```
app/                         # App Router (or src/app/ — pick one per repo, alias to match)
├── layout.tsx               # root layout: fonts, <ThemeSync/>, <SessionHydrator/>, globals.css
├── globals.css              # CSS-variable design tokens (:root + .dark)
├── (auth)/                  # route group: public auth pages (login, signup, verify-email)
│   └── login/page.tsx
├── (app)/                   # route group: authenticated surface, shared layout
│   ├── layout.tsx
│   └── dashboard/page.tsx
├── <segment>/
│   ├── page.tsx             # Server Component by default
│   ├── loading.tsx          # Suspense fallback for the segment
│   └── error.tsx            # error boundary ("use client")
├── [dynamicId]/page.tsx     # dynamic routes
└── api/                     # route handlers (BFF: proxy, auth bridges) — server only
components/
├── ui/                      # primitives: button.tsx, input.tsx, dialog.tsx, card.tsx, ...
└── features/                # domain components composing primitives + logic
lib/
├── api/                     # client.ts (apiFetch + tokens), <domain>.ts endpoint modules
├── auth/                    # login-bridge.ts, role-routing.ts
├── stores/                  # zustand: session-store.ts, ui-theme-store.ts
├── hooks/                   # use-debounced-value.ts, use-network-status.ts, ...
├── <domain>/                # shared schemas + helpers (e.g. zod signup-schema.ts)
└── utils.ts                 # cn() helper
types/                       # shared TS types (shared.ts, <domain>.ts) — or lib/types.ts
middleware.ts                # route guards
next.config.ts / .mjs
tsconfig.json                # strict: true; paths { "@/*": [...] }
.env.example                 # documented NEXT_PUBLIC_* + server-only vars
```

Use **route groups** `(auth)`, `(app)`, `(dashboard)` to share layouts without
affecting the URL. Standardize the path alias `@/*` (point it at the app root,
whether that's `./` or `./src` — be consistent within a repo).

## Server vs Client Components

- **Default = Server Component.** Pages, layouts, and presentational/data-loading
  components stay server-side. Fetch data here (no client round-trip, secrets
  stay server-side).
- **`"use client"`** only for: state/effects (`useState`, `useEffect`), zustand
  stores, browser APIs (`localStorage`, `window`), event handlers, and libraries
  that need the DOM. The API client and stores are `"use client"`.
- Push `"use client"` **down the tree** — make small interactive leaves clients,
  keep parents as servers. Don't slap `"use client"` on a whole page to make one
  button work.

```tsx
// app/(app)/dashboard/page.tsx — Server Component: fetch on the server
import { StatsCards } from "@/components/features/stats-cards";
export default async function DashboardPage() {
  const stats = await getStats();         // server-side fetch
  return <StatsCards stats={stats} />;     // pass data down to client leaf if needed
}
```

## Routing, layouts, and async UX

- Each async segment gets a **`loading.tsx`** (renders during data load via
  Suspense) and an **`error.tsx`** (`"use client"`, receives `{ error, reset }`).
- Root `layout.tsx` mounts cross-cutting client helpers once: theme sync, session
  hydration, fonts via `next/font` (no layout shift, self-hosted).

```tsx
// app/<segment>/error.tsx
"use client";
import { useEffect } from "react";
export default function SegmentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <button onClick={reset} className="mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground">Retry</button>
    </div>
  );
}
```

## Config

```ts
// next.config.ts (or .mjs) — minimal, strict, secure headers
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,                 // don't advertise the stack
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
export default nextConfig;
```

## Environment variables

- `NEXT_PUBLIC_*` is **shipped to the browser** — use **only** for non-secret
  config (API base URL, feature flags). **Never** put API keys, tokens, or signing
  secrets behind a `NEXT_PUBLIC_` name.
- Server-only vars (no prefix) are for route handlers / server components only
  (e.g. `SSO_BACKEND_URL`, `SESSION_COOKIE_SECRET`).
- Always ship a **documented `.env.example`**.

```env
# .env.example
NEXT_PUBLIC_API_URL=http://localhost:4000/api    # public: backend base URL
SSO_BACKEND_URL=http://localhost:5000            # server-only: never exposed to browser
```

## TypeScript

```jsonc
// tsconfig.json
{ "compilerOptions": { "strict": true, "noEmit": true, "jsx": "preserve",
  "baseUrl": ".", "paths": { "@/*": ["./*"] } } }
```
- Type every API response (in `lib/api/*`); infer form types from zod schemas.
- Organize shared types under `types/` (or `lib/types.ts` for smaller apps).

## Performance

- Prefer **Server Components + server fetching** to shrink client JS.
- `next/image` for images (sizing, lazy-load, formats); `next/font` for fonts.
- Code-split heavy client-only widgets with `next/dynamic` (`{ ssr: false }` when
  they need the DOM). Don't pull a charting/animation lib into the initial bundle.
- Memoize expensive client computations; virtualize/paginate large tables.

## Tooling & scripts

```jsonc
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",            // eslint-config-next / core-web-vitals
  "typecheck": "tsc --noEmit"     // run in CI
}
```
- ESLint: `next/core-web-vitals`. Prettier consistent with the repo.
- Run `typecheck` + `lint` in CI; treat warnings as signal.

## New-app bootstrap order

1. `create-next-app` (App Router, TS, Tailwind); set `@/*` alias; `strict: true`.
2. `globals.css` design tokens (`:root` + `.dark`); `cn()` in `lib/utils.ts`.
3. `components/ui/` primitives (button/input/card/dialog) with `cva` — see
   `components-styling.md`.
4. `lib/api/client.ts` typed client with refresh-on-401 — see `data-auth.md`.
5. Session store + `SessionHydrator` + `middleware.ts`; integrate SSO (SSO skill).
6. Root layout (fonts, ThemeSync, SessionHydrator); route groups `(auth)`/`(app)`.
7. First feature page end-to-end (server page → feature component → form/table) as the template.
8. `.env.example`, security headers, CI (`lint` + `typecheck`); walk the Definition of Done.
