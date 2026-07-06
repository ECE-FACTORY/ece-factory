# Layer 2 — Two-Agent Command System

Builder/Reviewer verdict loop (pass/fail/revise/stop), adversarial review, next-instruction generation, bounded autonomous driver.

This layer now contains: **review-engine · autopilot · autopilot-scheduler · decision-console**

These modules were moved here during the six-layer restructure. Behavior is intended to be preserved; imports were rewritten mechanically, and the restructure is verified by typecheck and the test suite. The autopilot's authority ceiling (no executed/committed outcome variant) is unchanged — it drafts and proposes, never executes.
