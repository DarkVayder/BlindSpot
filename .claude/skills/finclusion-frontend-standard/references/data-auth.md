# Data Fetching, State & Auth

How the frontend talks to the backend, manages state, and handles
authentication. Two proven patterns for tokens: **in-memory access + httpOnly
refresh** (public-facing apps) and **server-side proxy** (sensitive/admin
surfaces). Both grounded in the reference apps.

## The typed API client (in-memory token + refresh-on-401)

One client module owns the base URL, auth attachment, error shape, and a single
transparent refresh on 401. Features import typed endpoint functions, never call
`fetch` directly.

```ts
// lib/api/client.ts
"use client";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message); this.name = "ApiError";
  }
}

let accessToken: string | null = null;
let refreshInflight: Promise<string | null> | null = null;
const listeners = new Set<(t: string | null) => void>();

export function setAccessToken(t: string | null) { accessToken = t; listeners.forEach((fn) => fn(t)); }
export function getAccessToken() { return accessToken; }
export function subscribeToken(fn: (t: string | null) => void) { listeners.add(fn); return () => listeners.delete(fn); }

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInflight) return refreshInflight;          // dedupe concurrent refreshes
  refreshInflight = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) { setAccessToken(null); return null; }
      const data = await res.json();
      setAccessToken(data.accessToken);
      return data.accessToken as string;
    } catch { setAccessToken(null); return null; }
    finally { refreshInflight = null; }
  })();
  return refreshInflight;
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown; auth?: boolean; skipRefresh?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, auth = true, skipRefresh, headers, ...rest } = options;
  const build = (token: string | null): HeadersInit => ({
    ...(headers as Record<string, string> | undefined),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
  });
  const doRequest = (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      ...rest, credentials: "include", headers: build(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await doRequest(accessToken);
  if (res.status === 401 && auth && !skipRefresh) {          // one transparent retry
    const fresh = await refreshAccessToken();
    if (fresh) res = await doRequest(fresh);
  }
  if (!res.ok) {
    let payload: unknown = null, message = res.statusText;
    try { payload = await res.json();
      if (payload && typeof payload === "object" && "message" in payload) {
        const m = (payload as { message: unknown }).message;
        message = typeof m === "string" ? m : JSON.stringify(m);
      }
    } catch { /* non-json */ }
    throw new ApiError(res.status, message, payload);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? ((await res.json()) as T) : ((await res.text()) as unknown as T);
}
```

Per-domain typed endpoint modules wrap `apiFetch`:
```ts
// lib/api/auth.ts
export async function apiLogin(input: LoginInput): Promise<SessionResponse> {
  const res = await apiFetch<SessionResponse>("/auth/login", { method: "POST", body: input, auth: false });
  setAccessToken(res.accessToken);
  return res;
}
export const apiMe = () => apiFetch<MeResponse>("/auth/me");
```

Why this shape: tokens live **in memory** (not `localStorage` → not XSS-lootable);
the refresh token rides an **httpOnly cookie** (`credentials: "include"`); one
dedup'd refresh avoids stampedes; every error is a typed `ApiError` features can
branch on (`err.status === 401`).

## Server-side proxy (for sensitive / admin surfaces)

When the browser should hold **no token at all**, route calls through the app's
own server (`/api/proxy/*`). Tokens live in httpOnly cookies and are attached
server-side; the browser only ever talks to its own origin. This also sidesteps
CORS and hides the upstream entirely.

```ts
// lib/session.ts  — server only
import "server-only";
import { cookies } from "next/headers";
export const ACCESS_COOKIE = "fc_at", REFRESH_COOKIE = "fc_rt";
const isProd = process.env.NODE_ENV === "production";
export async function getTokens() {
  const c = await cookies();
  return { accessToken: c.get(ACCESS_COOKIE)?.value, refreshToken: c.get(REFRESH_COOKIE)?.value };
}
export async function setTokens(at: string, rt: string) {
  const c = await cookies();
  const base = { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/" };
  c.set(ACCESS_COOKIE, at, { ...base, maxAge: 60 * 60 });
  c.set(REFRESH_COOKIE, rt, { ...base, maxAge: 60 * 60 * 24 * 7 });
}
```
```ts
// app/api/proxy/[...path]/route.ts — attaches token server-side, refreshes once on 401
import { proxyToBackend } from "@/lib/backend";
async function handle(req, ctx, method) {
  const { path } = await ctx.params;
  const body = method === "GET" || method === "DELETE" ? undefined : (await req.text()) || undefined;
  const result = await proxyToBackend(`/${path.join("/")}${req.nextUrl.search}`, { method, body });
  return Response.json(result.body ?? {}, { status: result.status });
}
export const GET = (r, c) => handle(r, c, "GET");
export const POST = (r, c) => handle(r, c, "POST");
// ...PATCH/PUT/DELETE
```
The browser client just calls `/api/proxy/<path>` and bounces to `/login` on 401.
Choose this pattern for admin dashboards and anything handling restricted data;
use the in-memory pattern for public/customer apps. **Don't mix** within one app.

## State management

Keep the three kinds of state separate — this is the most important frontend
discipline.

- **Server state** (data owned by the API): fetch in a Server Component, or cache
  on the client with **React Query** (`useQuery`/`useMutation`, key-based
  invalidation). **Do not copy server data into a zustand store** — it goes stale
  and you end up hand-writing cache logic.
  ```ts
  // hooks/queries.ts
  export const useUsers = (page: number, search: string) =>
    useQuery({ queryKey: ["users", page, search],
      queryFn: () => api.get<Paginated<User>>(`users?page=${page}&search=${search}`),
      placeholderData: (prev) => prev });
  export function useCreateUser() {
    const qc = useQueryClient();
    return useMutation({ mutationFn: (d) => api.post("users", d),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });
  }
  ```
- **Global client state** (session, theme): a **small** zustand store. Persist
  only what's safe and useful (theme preference; a pending link) — **never persist
  tokens or full server objects**. Read with selectors.
  ```ts
  // lib/stores/session-store.ts
  export const useSessionStore = create<SessionState>()((set, get) => ({
    user: null, workspaces: [], hydrated: false,
    setSession: (user, workspaces) => set({ user, workspaces }),
    hydrate: async () => {
      if (get().hydrated) return;
      try { const me = await apiMe(); set({ user: me, workspaces: me.workspaces ?? [], hydrated: true }); }
      catch { set({ user: null, hydrated: true }); }
    },
    logout: async () => { try { await apiLogout(); } finally { set({ user: null, workspaces: [] }); } },
  }));
  // usage: const user = useSessionStore((s) => s.user);   // selector, not whole store
  ```
- **Local UI state** (form inputs, toggles, modal open): plain `useState`. Don't
  globalize what one component owns.

## Frontend auth & session

- **Identity = the Finclusion SSO.** The frontend calls login/refresh/me; it does
  not implement identity. See `finclusion-sso-integration` (and its
  `references/nodejs.md` for the BFF route that sets the cookies).
- **Login flow** via a thin "bridge" that calls the API, hydrates the store, and
  returns a typed outcome + next route (role-based):
  ```ts
  // lib/auth/login-bridge.ts
  export async function loginViaBackend(input: LoginInput): Promise<LoginOutcome> {
    try {
      await apiLogin(input);
      const me = await apiMe();
      useSessionStore.getState().setSession(me, me.workspaces ?? []);
      return { ok: true, nextPath: postLoginPath(me) };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { ok: false, code: "invalid", message: "Invalid email or password" };
      return { ok: false, code: "network", message: "Couldn't reach the server. Try again." };
    }
  }
  ```
- **Session hydration**: a `SessionHydrator` client component mounted in the root
  layout calls `hydrate()` on authenticated routes so a refresh restores the user.
- **Route protection**: gate navigation in **`middleware.ts`** (redirect
  unauthenticated users to `/login`, and authenticated users away from `/login`).
  Treat this as coarse UX gating — **real authorization is enforced server-side on
  every data call**, never by the client alone.
  ```ts
  // middleware.ts
  export function middleware(req: NextRequest) {
    const hasSession = req.cookies.has("fc_at") || req.cookies.has("fc_rt");
    const isLogin = req.nextUrl.pathname === "/login";
    if (!hasSession && !isLogin) return NextResponse.redirect(new URL("/login", req.url));
    if (hasSession && isLogin) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }
  export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"] };
  ```

## Async UX states (don't skip these)

Every async view handles **loading**, **error**, and **empty** explicitly — a
spinner, a retry-able error, and a real empty state (not a blank screen). Use
route `loading.tsx`/`error.tsx` for segment-level, and inline states (e.g. React
Query's `isPending`/`isError`) for in-page fetches. Disable submit buttons and
show a `loading` state while mutations run.
