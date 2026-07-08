# GitHub Adapter — DRY-RUN (first implementation of the Governed Adapter contract)

`GithubAdapterDryRun` **implements** `GovernedAdapter` — it does **not** re-implement the gating. It inherits
the ConsumedApproval requirement, write-ahead audit, human attribution, intent-binding, and fail-closed
behavior from the contract, and adds **only** GitHub-specific plan shaping.

## What it adds (and only this)

- **`intentBinding(intent)`** — the `(tool, target, payload)` a fork approval is bound to:
  `tool = plan_github_fork_dryrun`, `target = {sourceOwner}/{sourceRepo}`, `payload = forkPayload(intent)`.
- **`shapePlan(intent, approval, boundIntentHash)`** — the inert planned write:
  - `method: POST`, `endpoint: /repos/{sourceOwner}/{sourceRepo}/forks`, `payload: { organization, name? }`.
  - `preflight` — an inert **read-only** existence verify (`GET /repos/{targetNamespace}/{repo}`) the real
    executor would run first. **Planned only — never fetched here.**
  - contract fields: `dryRun:true, plannedOnly:true, boundIntentHash, boundToApprovalId`.

## Hard limits (inherited + adapter-specific)

- **No mutating fetch/POST is executed anywhere** — the POST and the GET are descriptors (data), not calls.
  There is no executor.
- The write-capable call requires a real `ConsumedApproval`; no token ⇒ fail closed (enforced by the contract).
- Examples target a **throwaway sandbox** namespace only — never docassemble or any real ECE/product target.
- Secrets are never logged; the adapter holds only an abstract scoped-credential reference (unused in dry-run).
