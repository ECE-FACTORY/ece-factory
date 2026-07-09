// Hash-chain integrity verifier (Design §4) — walks a store's JSONL, recomputes each record's hash, and checks
// prevHash + seq continuity. Any tampered payload (hash mismatch), deleted/reordered record (prevHash or seq
// break) ⇒ ok:false with the first brokenAt. An EMPTY/ABSENT store is VALID (ok, length:0) — a fresh factory has
// remembered nothing; that is truth. It NEVER repairs — a broken chain is reported, never silently rewritten.

import { GENESIS, readRecords, recordHash } from './store.js';

export interface ChainVerification {
  readonly ok: boolean;
  readonly length: number;
  readonly brokenAt?: number;  // index of the first broken record
  readonly reason?: string;
}

export function verifyChain(path: string): ChainVerification {
  const recs = readRecords(path);
  let prevHash = GENESIS;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]!;
    if (r.seq !== i) return { ok: false, length: recs.length, brokenAt: i, reason: `seq ${r.seq} ≠ expected ${i} (missing/reordered record)` };
    if (r.prevHash !== prevHash) return { ok: false, length: recs.length, brokenAt: i, reason: `prevHash link broken at ${i}` };
    if (recordHash(r.seq, r.prevHash, r.payload) !== r.hash) return { ok: false, length: recs.length, brokenAt: i, reason: `hash mismatch at ${i} — tampered payload` };
    prevHash = r.hash;
  }
  return { ok: true, length: recs.length };
}
