// The ONE sanctioned read-plane import for the browser bundle: the PURE zod contracts
// (provenance + read objects — zod and plain objects only, no node, no adapters). The
// boundary test (console.boundary.test.ts) allows exactly this path and forbids every other
// src/read-plane/*, src/layer-*, factory-persistence, and node: import from the client.
export * from '../../read-plane/contracts/index.js';
