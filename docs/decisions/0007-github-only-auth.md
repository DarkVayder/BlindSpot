# 0007 — GitHub is the only sign-in method

**Context.** Every hosted user must have GitHub access to the repositories they view. A separate identity system would duplicate authorization and could drift from GitHub's permissions.

**Decision.** Users sign in through the GitHub App's user-to-server OAuth flow. Dashboard access to a repository requires (a) the org's installation covering the repo and (b) the user's GitHub access to that repo, re-verified periodically. Sessions are server-side and referenced by `__Host-` secure cookies.

**Consequences.** No password storage. Adding GitLab or Bitbucket later would need a provider abstraction, which is out of scope for v1.
