# Layer 5 — Action Layer / Command Center

The MCP bridge (read-only by default, gated writes, human attribution, write-ahead audit) and the Operator Cockpit / command center (read + route-to-gate only).

This layer now contains: **mcp-bridge · tool-registry · pr-engine · external-gateways · operator-cockpit · operator-cockpit-ui**

These modules were moved here during the six-layer restructure. Behavior is intended to be preserved — the read-only-by-default posture, the route-not-act cockpit boundary, and the ApprovalGate boundary are unchanged; imports were rewritten mechanically, and the restructure is verified by typecheck and the test suite.

The live MCP bridge implementation is `src/layer-5-action/mcp-bridge/`. The standalone `ece-mcp-bridge` repo remains a stub until a governed extraction is approved.
