// StoreAdapter (M3 flip) — reads the append-only factory-state/*.jsonl stores and flips absent→present with real
// provenance (Design §3). READ-ONLY: only `readRecords` (readFileSync under the hood) — the writer lives in
// factory-persistence; Rule 0.2 still forbids any write symbol under src/read-plane/. An EMPTY/absent store is
// PRESENT-and-empty (count:0, latest:null) — present-and-empty is truth, never a mocked record. Provenance
// `source:'store-file'`, pinned by the chain tip hash (genesis for an empty store).

import { readRecords, storeFilePath, tipOf, type StoreName } from '../../factory-persistence/store.js';
import { present } from '../contracts/index.js';
import type { StoreState, StoreSnapshot, Provenanced, PresentProvenance } from '../contracts/index.js';

const nowIso = () => new Date().toISOString();

export interface StoreAdapterOpts { root?: string; now?: () => string; }

function snapshot(name: StoreName, opts: StoreAdapterOpts): Provenanced<StoreSnapshot> {
  const now = opts.now ?? nowIso;
  const path = storeFilePath(name, opts.root);
  const recs = readRecords(path);
  const prov: PresentProvenance = { source: 'store-file', locator: { kind: 'path', path }, pin: { kind: 'hash', sha256: tipOf(path).hash }, readAt: now() };
  return present({ count: recs.length, latest: recs.at(-1)?.payload ?? null }, prov);
}

export function storeState(opts: StoreAdapterOpts = {}): StoreState {
  return {
    approvals: snapshot('approvals', opts),
    audit: snapshot('audit', opts),
    executions: snapshot('executions', opts),
  };
}
