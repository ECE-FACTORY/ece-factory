# Open Items — ECE Factory

> Per Layer 2 §15. Each item: status · required action · risk if unresolved.

| # | Item | Status | Required action | Risk if unresolved |
|---|------|--------|-----------------|--------------------|
| 1 | **Refusal-audit path** — denied attempts (authorize REFUSE) are not yet logged; authorize runs before intent/read-log commit. | **Locked for Phase 3.5** | Add a dedicated refusal-audit record ("who tried what they weren't allowed to, and when"), separate from the success path. | Attempted-but-denied access is invisible to audit until built. |
| 2 | **Permission Engine (Module 22)** — `Authorizer` is a stub (`AllowAllAuthorizer`); real authorization is a later wave. | Deferred (later wave) | Implement Module 22 behind the existing `Authorizer` seam. | All authorized actions are ALLOW until then. |
| 3 | **Timestamp tamper-evidence** — `ts` and the DB pk are excluded from the hashed content (round-trip stability). | Deferred | Hash an app-generated canonical `ts` field. | `ts` tampering not detected by the chain (content/order/linkage are). |
| 4 | **Orphan grace window** — `reconcileOrphans` defaults to 0s; in-flight actions could be flagged. | Open | Use a production grace window when scheduling reconciliation. | False-positive orphan flags if run with 0s in production. |
| 5 | **Air-gap install mirror** — reproducible offline build needs a local npm registry mirror (tarball cache). | Deferred (deployment readiness) | Stand up a local mirror; vendor/cature the pinned tree. | True air-gap install not yet reproducible offline. |
| 6 | **External-verifiability layer** — Trillian/Rekor/Tessera reserved behind the `AuditSink.proof()` seam. | Reserved | Build `VerifiableLogSink` only if a sovereign client mandates external cryptographic audit. | None now (seam keeps it additive). |
