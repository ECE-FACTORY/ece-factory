// EvidenceAdapter (M3, additive) — reads factory-state/evidence-index.jsonl and returns the evidence entries with
// store-file provenance (pinned by the chain tip). READ-ONLY. Malformed records are skipped, not fabricated
// around (honest — a bad record is dropped, never invented). An empty/absent store ⇒ present-and-empty [].

import { readRecords, storeFilePath, tipOf } from '../../factory-persistence/store.js';
import { present, EvidenceEntry } from '../contracts/index.js';
import type { EvidenceIndex, EvidenceEntry as TEvidenceEntry } from '../contracts/index.js';

const nowIso = () => new Date().toISOString();

export interface EvidenceAdapterOpts { root?: string; now?: () => string; }

export function evidenceIndex(opts: EvidenceAdapterOpts = {}): EvidenceIndex {
  const now = opts.now ?? nowIso;
  const path = storeFilePath('evidence', opts.root);
  const entries: TEvidenceEntry[] = [];
  for (const rec of readRecords(path)) {
    const parsed = EvidenceEntry.safeParse(rec.payload); // strips extra keys; drops malformed
    if (parsed.success) entries.push(parsed.data);
  }
  return present(entries, { source: 'store-file', locator: { kind: 'path', path }, pin: { kind: 'hash', sha256: tipOf(path).hash }, readAt: now() });
}
