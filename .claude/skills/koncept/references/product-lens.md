# Product lens

The engineering, AI-standards, and security lenses ask "is this built correctly." This lens
asks "is this the right thing, built to the right scope." A technically flawless
implementation of the wrong scope is still a failed review.

## Problem-solution fit

- What user-facing problem does this change actually solve? If you can't state it in one
  sentence from reading the code/ticket/PR description, that's itself a finding — unclear
  intent usually means unclear scope too.
- Does the implementation match how the product actually behaves elsewhere, or does it quietly
  introduce a second way of doing something the product already does one way (a second auth
  flow, a second error-display pattern, a second status-taxonomy for the same kind of entity)?
  Product inconsistency is often invisible in a code-only review but very visible to users.

## Scope

- **Scope gaps:** does the change handle the feature end-to-end from the user's perspective, or
  does it stop at the part that's easy to build and leave a dead end (a form that submits but
  the confirmation screen was never built; a new entity type that can be created but not
  edited/deleted; a flow that works on desktop but wasn't checked on mobile if the product
  supports mobile)?
- **Scope creep:** does the change do meaningfully more than what was asked, in a way that adds
  review burden, risk, or maintenance cost without a stated reason? Flag it even if the extra
  work is individually fine — bundling unrelated changes makes review and rollback harder.
- If scope was intentionally cut down (e.g. "v1, no retries yet"), is that documented somewhere
  a future reader will see it (ticket, comment, README), or does it look like an oversight?

## Edge cases, from the user's seat

Engineering edge cases ask "does the code handle this input." Product edge cases ask "what
does the *user* see and can do when this happens." Always ask, for anything with multiple
possible states or an async/multi-step flow:

- What does the user see while it's in progress (loading state, no state at all)?
- What does the user see and what can they do if it fails partway through (a multi-step flow
  that fails on step 3 of 4 — can they resume, retry, or are they stuck)?
- What does the user see if it succeeds but slowly (async settlement, background job, eventual
  consistency) — is there a "pending"/"processing" state, or does the UI look broken/stale?
- Is there a support/recovery path for the case where automated retry isn't enough (manual
  intervention, an admin action, a support contact)? For anything involving money or
  irreversible actions, "what does support do when a user complains this didn't work" is a
  fair question to ask even if the answer is out of scope for this specific change.
- Does an error message actually tell the user what happened and what to do, or is it a raw
  technical error surfaced directly (stack trace, provider's raw API error, generic "something
  went wrong" with no next step)?

## Decision-weighing (Mode C)

When asked to weigh in on a choice rather than review code:

- Identify the actual axis of disagreement (cost, speed to ship, long-term maintainability,
  risk, user experience) rather than listing generic pros/cons for both options.
- Give a real recommendation, not a non-answer. "It depends" is only acceptable paired with the
  specific condition it depends on ("if you expect to add more than 2 more providers in the
  next quarter, do the abstraction now; otherwise don't").
- State the reversibility of the decision. A cheap-to-reverse choice deserves a quick decision
  with low deliberation cost; a hard-to-reverse one (schema design, public API shape, a
  compliance-relevant data model) deserves more scrutiny before recommending.
