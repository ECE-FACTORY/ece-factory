# Governed Adapter — the Layer-5 write CONTRACT

Every Layer-5 write adapter implements this contract. It defines the **shared write-governance once**;
concrete adapters (GitHub is the first) add only their transport-specific plan shaping. This is the first
piece of the far side of the human gate — and it is **dry-run**: it plans the write it *would* perform and
returns that plan as inert data. **No real external write exists in any file. Safety is by construction.**

## Sovereign-adapter doctrine

- **Authority = the ApprovalGate.** Not a connector, not a transport, not MCP. The gate, the write-ahead
  audit, the human attribution, and the intent-binding all live in THIS contract.
- **MCP (or any transport) is an OPTIONAL connector, never authority/core.** Remove the connector and the
  adapter is **still sovereign** — nothing about the gating depends on the transport. (The one thing we reuse
  from the bridge module is the real branded token TYPE and its dispatcher; that is the *gate*, not a transport.)
- **Remove-MCP-still-sovereign:** a concrete adapter can be driven by any caller that presents an approved
  Approval Gate action id; the safety properties hold regardless of how the call arrived.

## The contract's guarantees (inherited by every adapter)

1. **ConsumedApproval required on every write-capable call.** `shapePlan(intent, approval: ConsumedApproval, …)`
   is type-gated by the real branded token (`../mcp-bridge/tool-classes.ts:100-104`); its mint
   (`tool-classes.ts:105`) is module-private to the bridge — nothing here can construct one. No token ⇒ the real
   dispatcher yields `STOP_FOR_APPROVAL` ⇒ **fail closed**, no plan, refusal audited.
2. **Approval BOUND to the specific intent.** `boundIntentHash(binding)` (this file) is a stable, dependency-free
   fingerprint of the exact `(tool, target, payload)` the human approved. The gate independently enforces that
   same per-action binding at consume time (`tool-classes.ts:88-90`); the hash is the provable fingerprint we
   record in the audit and surface in the plan. *Finding:* the `ConsumedApproval` token carries only
   `approvalId`+`tool`, so binding is enforced at **consume-time by the gate**, not embedded in the token.
3. **Write-ahead audit.** The audit intent is *awaited* **before** the plan is shaped. A failed audit ⇒ no plan.
4. **Human attribution; never self-approval.** The approver is read from the real gate resolution; the
   `BridgeApprovalGate` rejects a self-approver and any `"claude"` approver (`tool-classes.ts:87`).
5. **Abstract scoped-credential reference.** The adapter holds a `ScopedCredentialRef` (a handle + scopes, never
   a secret) — **unused in dry-run**, never logged or emitted.
6. **No execute(), no mutating fetch, no executor.** `planWrite` returns an inert `PlannedWrite`
   (`dryRun:true, plannedOnly:true`). The real executor is a separate, later, human-approved build.

## Surface

- `abstract class GovernedAdapter<I, P>` — `planWrite(ctx)` (shared enforcement), `intentBinding` +
  `shapePlan` (adapter hooks), `intentHash(intent)`.
- `boundIntentHash(binding)` / `canonicalBinding(binding)` — the reusable, GitHub-agnostic intent-binding primitive.
- `PlannedWrite`, `ScopedCredentialRef`, `GovernedAuditRecorder` (write-ahead audit seam onto the Audit Engine).
