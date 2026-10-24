# Components, Styling & Forms

How to build UI the Finclusion way: variant-driven primitives on Radix, styling
through CSS-variable tokens merged with `cn()`, and forms with react-hook-form +
zod. Grounded in the reference apps.

## The `cn()` helper (used everywhere)

```ts
// lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```
`clsx` composes conditional classes; `twMerge` resolves Tailwind conflicts so the
last/explicit class wins (and a caller's `className` can always override). Use
`cn()` for every component that accepts a `className`.

## UI primitives with class-variance-authority

Primitives live in `components/ui/`, are `forwardRef`, accept `className`, and
declare variants with `cva`. Style with **token-bound** Tailwind classes, not raw
hex.

```tsx
// components/ui/button.tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-95",
        outline: "border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        ghost:   "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        danger:  "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--badge-danger-bg)] hover:text-[var(--badge-danger-text)]",
      },
      size: { sm: "h-7 px-2.5 text-xs", default: "h-8 px-3", lg: "h-9 px-4 text-sm", icon: "h-8 w-8 p-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading && <span className="mr-2 size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
export { buttonVariants };
```

Inputs follow the same shape (forwardRef + token classes + `cn(className)`).
Give a primitive a built-in **`loading`** state so callers don't reinvent spinners.

## Feature components

`components/features/` compose primitives with domain logic and data. They are
usually `"use client"` (they hold state / handlers). Keep pages thin — a page
arranges feature components; the logic lives in the feature.

```tsx
// components/features/user-table.tsx
"use client";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
// ...build columns, render <table>, handle row actions
```

## Styling: CSS-variable design tokens

Define the palette once as CSS variables in `globals.css`; reference tokens in
components. Dark mode is just an override block — no per-component conditionals.

```css
/* app/globals.css */
:root {
  color-scheme: light;
  --bg-page: #fbfbfb;  --bg-surface: #ffffff;  --bg-hover: #f3f3f3;
  --text-primary: #1c1c1c; --text-secondary: #6b6b6b; --text-tertiary: #9b9b9b;
  --border-default: #e8e8e8; --border-strong: #d4d4d4;
  --badge-success-bg: #ecfdf5; --badge-success-text: #065f46;
  --badge-danger-bg: #fef2f2;  --badge-danger-text: #991b1b;
  --primary: var(--brand);
}
.dark, [data-theme="dark"] {
  color-scheme: dark;
  --bg-page: #0a0a0a; --bg-surface: #141414; --text-primary: #f5f5f5; /* ... */
}
```

Rules:
- **No hardcoded hex in components** — reference tokens (`bg-[var(--bg-surface)]`)
  or Tailwind theme colors mapped to tokens. New color need? Add a token.
- Theme preference lives in a small persisted zustand store; a `ThemeSync` client
  component writes `data-theme`/`.dark` on `<html>`. Respect `system` default.

## Accessibility via Radix

Build every interactive widget (dialog, dropdown, tabs, popover, tooltip,
accordion) on **Radix UI** primitives — you get focus trapping, keyboard
navigation, ARIA roles, and escape handling for free. Wrap them in
`components/ui/` with your tokens.

```tsx
// components/ui/dialog.tsx (excerpt)
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--backdrop)] animate-[fadeIn_100ms_ease]" />
      <DialogPrimitive.Content
        className={cn("fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-modal", className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
```

Always: label inputs (`<label>` / Radix Label / `aria-label`), keep focus visible,
add `sr-only` text to icon-only controls, and ensure adequate color contrast.

## Forms: react-hook-form + zod

Define a zod schema (with messages), infer the type, drive the form with
`zodResolver`, render errors from `formState.errors`. Put reusable schemas in
`lib/<domain>/*-schema.ts` so they can be shared/composed.

```ts
// lib/onboarding/signup-schema.ts
import { z } from "zod";
export const signupSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(50),
  lastName:  z.string().trim().min(1, "Last name is required").max(50),
  email:     z.string().trim().toLowerCase().email("Enter a valid email"),
  password:  z.string().min(8, "Use at least 8 characters"),
});
export type SignupFormValues = z.infer<typeof signupSchema>;
```

```tsx
// components/features/signup-form.tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signupSchema, type SignupFormValues } from "@/lib/onboarding/signup-schema";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function SignupForm({ onSubmit }: { onSubmit: (v: SignupFormValues) => Promise<void> }) {
  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { firstName: "", lastName: "", email: "", password: "" },
    mode: "onChange",
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
      <div>
        <label htmlFor="email" className="text-sm text-[var(--text-secondary)]">Work email</label>
        <Input id="email" type="email" {...register("email")} aria-invalid={!!errors.email} />
        {errors.email && <p className="mt-1 text-sm text-[var(--badge-danger-text)]">{errors.email.message}</p>}
      </div>
      {/* firstName / lastName / password follow the same shape */}
      <Button type="submit" loading={isSubmitting} className="w-full">Create account</Button>
    </form>
  );
}
```

Form rules:
- One schema = validation + types + messages. Don't hand-roll `useState` forms for
  anything non-trivial (≥ ~3 fields or any validation).
- Use `mode: "onChange"` (or `onBlur`) for responsive validation; disable submit
  while `isSubmitting`.
- Map server-side field errors (the API's `errors[]`) back onto fields with
  `form.setError(path, { message })` so client and server validation align.
- The submit handler delegates to the API client (see `data-auth.md`); the form
  doesn't call `fetch` directly.
