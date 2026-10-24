# Frontend Security & Accessibility Baseline

Mandatory floor for every Finclusion frontend. Security and accessibility are
correctness, not polish. Translate to the framework in use; the requirements hold.

## Security

### Secrets & configuration
- **Never put secrets in client code or `NEXT_PUBLIC_*`.** Anything with that
  prefix (or any value bundled into client JS) is public. API keys, signing
  secrets, the SSO `x-api-key`/`JWT_SECRET` are **server-only** — use them only in
  route handlers / server components, behind unprefixed env vars.
- Anything the browser truly must not see goes through a **server-side proxy**
  (see `data-auth.md`), not a "hidden" client call.

### Token storage (XSS blast radius)
- **Don't store auth tokens in `localStorage`/`sessionStorage`** — any XSS reads
  them. Use **access-token-in-memory + refresh-in-httpOnly-cookie**, or the
  **full server proxy** (tokens never reach the browser).
- Auth cookies: `httpOnly`, `Secure` (prod), `SameSite=Lax` (or `Strict`); scope
  `path`/`domain`. `SameSite=None` only with `Secure` and a real cross-site need.

### XSS & injection
- **Avoid `dangerouslySetInnerHTML`.** If you must render HTML, **sanitize**
  (e.g. DOMPurify) and never feed it raw user/API input.
- Don't build DOM/URLs by string-concatenating untrusted input. Validate/encode
  user-controlled values used in `href`/`src` (block `javascript:` URLs).
- React escapes text by default — keep it that way; don't bypass with `innerHTML`.

### Headers & transport
- Set security headers (in `next.config` or the edge): `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors`),
  `Referrer-Policy: strict-origin-when-cross-origin`, a tight `Permissions-Policy`,
  and `poweredByHeader: false`.
- Add a **Content-Security-Policy** as the app stabilizes (restrict `script-src`,
  `connect-src` to your API origins). HTTPS everywhere; no mixed content.

### Data handling & dependencies
- Request and render only the data the view needs; don't dump full user objects
  into the client. Don't log tokens/PII to the browser console in production.
- Validate API responses you don't control before trusting their shape.
- Keep deps patched; run `pnpm audit` / Dependabot. Avoid heavy/unmaintained libs
  that inflate the bundle and the attack surface.
- Authorization is **never** enforced by the client alone — hiding a button is UX,
  not security. The backend authorizes every action (see backend skill).

## Accessibility (WCAG-minded)

### Structure & semantics
- Use **semantic HTML** (`<button>`, `<nav>`, `<main>`, `<label>`, headings in
  order). Don't make a `<div>` clickable when a `<button>`/`<a>` is correct.
- One `<h1>` per page; logical heading hierarchy; landmarks for major regions.

### Interactive widgets
- Build dialogs, menus, tabs, tooltips, popovers on **Radix UI** — you inherit
  focus management, keyboard interaction, and ARIA. Don't hand-roll these.
- **Keyboard:** everything operable without a mouse; logical tab order; visible
  focus ring (never `outline: none` without a replacement); `Esc` closes
  overlays; focus is trapped in modals and restored on close.

### Forms
- Every input has an associated **`<label>`** (or `aria-label`). Errors are
  programmatically associated (`aria-invalid`, `aria-describedby`) and announced,
  not color-only.
- Don't disable submit so aggressively that screen-reader users can't tell why;
  surface validation messages in text.

### Content & media
- **Color contrast** ≥ 4.5:1 for normal text. Never rely on color alone to convey
  state (pair with icon/text).
- `alt` text on meaningful images; `alt=""` for decorative ones. Caption media.
- Respect `prefers-reduced-motion` for framer-motion animations.

### Honest async states
- Every async view has **loading**, **error** (retry-able), and **empty** states —
  not a blank screen or an infinite spinner. Use route `loading.tsx`/`error.tsx`
  and inline states; announce dynamic updates where appropriate (`aria-live`).

## Frontend Definition of Done (security + a11y)

- [ ] No secrets in client/`NEXT_PUBLIC_*`; server-only values stay server-side or behind a proxy.
- [ ] Tokens in memory + httpOnly cookie (or full server proxy); never in localStorage.
- [ ] No unsanitized `dangerouslySetInnerHTML`; untrusted URLs validated.
- [ ] Security headers set; HTTPS; CSP planned/applied.
- [ ] Authorization enforced server-side; client gating is UX only.
- [ ] Semantic HTML; interactive widgets on Radix; full keyboard operability + visible focus.
- [ ] Inputs labelled; errors associated and announced; not color-only.
- [ ] Contrast ≥ 4.5:1; meaningful `alt` text; `prefers-reduced-motion` respected.
- [ ] Loading / error / empty states for every async view.
