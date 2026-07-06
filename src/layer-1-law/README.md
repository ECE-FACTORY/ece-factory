# Layer 1 — The Law

Governance enforcement in code. The constitution lives in the `organization-source-of-truth` repo; this layer is where its gates are enforced at runtime.

This layer now contains: **approval-gate · kill-switch · permission-engine · policy-engine**

These modules were moved here during the six-layer restructure. Behavior is intended to be preserved — gate logic files were relocated whole (only their paths and import specifiers changed), imports were rewritten mechanically, and the restructure is verified by typecheck and the test suite. The gates in this layer must never be weakened and hold no new approval authority.
