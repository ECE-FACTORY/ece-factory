# factory-shared — Cross-Cutting Infrastructure

**Not a layer.** Cross-cutting modules imported across multiple layers: audit, evidence, redaction, registries, settings, and the capability-reuse graph substrate that Venture Intelligence reasons over.

This directory now contains: **audit-engine · redaction-engine · evidence-pack · settings · domain-registry · project-registry · risk-register · capability-reuse-graph**

These modules were moved here during the six-layer restructure. Behavior is intended to be preserved; imports were rewritten mechanically, and the restructure is verified by typecheck and the test suite.

`capability-reuse-graph` lives here (not in Layer 6) because modules across Layer 3 and Layer 6 depend on it; placing it in Layer 6 would force lower layers to import upward.
