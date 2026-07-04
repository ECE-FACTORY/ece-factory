// ECE Trust Layer — attestation ledger (Pillar 3 reuse, VC pillar tie-in).
//
// An append-only, per-entry SHA-256 hash-chained ledger — the SAME tamper-evidence pattern the ECE Factory's
// audit engine already proves (`entryHash = SHA-256(canonical || prevHash)`, recomputed by `verifyChain`). It
// is reused here as a SELF-CONTAINED, air-gapped component — NO import/coupling to factory internals (per the
// product-packaging requirement). At productionization every attestation event routes to the factory's
// PostgresHashChainSink; the chain semantics are identical, so the tamper-evidence is continuous.

import { createHash } from 'node:crypto';

export interface AttestationEntry {
  seq: number;
  event: string;
  atIso: string;
  payload: Record<string, unknown>;
  prevHash: string;
  entryHash: string;
}

const GENESIS = '0'.repeat(64);

export class AttestationLog {
  private readonly entries: AttestationEntry[] = [];
  private readonly now: () => number;
  constructor(now: () => number = () => Date.now()) { this.now = now; }

  /** Append a tamper-evident attestation event. Append-only — entries are never mutated or removed. */
  record(event: string, payload: Record<string, unknown>): AttestationEntry {
    const prevHash = this.entries.length ? this.entries[this.entries.length - 1].entryHash : GENESIS;
    const seq = this.entries.length + 1;
    const atIso = new Date(this.now()).toISOString();
    const entryHash = chainHash({ seq, event, atIso, payload }, prevHash);
    const entry: AttestationEntry = { seq, event, atIso, payload, prevHash, entryHash };
    this.entries.push(entry);
    return entry;
  }

  /** Inspectable history (array copy; entry objects are the live references so tamper is detectable by verifyChain). */
  list(): AttestationEntry[] { return this.entries.slice(); }

  /** Recompute the chain end-to-end; detect any tamper (mutated payload/event or broken linkage). */
  verifyChain(): { ok: boolean; brokenAt?: number } {
    let prev = GENESIS;
    for (const e of this.entries) {
      if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq };
      const recomputed = chainHash({ seq: e.seq, event: e.event, atIso: e.atIso, payload: e.payload }, e.prevHash);
      if (recomputed !== e.entryHash) return { ok: false, brokenAt: e.seq };
      prev = e.entryHash;
    }
    return { ok: true };
  }
}

function chainHash(body: unknown, prevHash: string): string {
  return createHash('sha256').update(JSON.stringify(body)).update('|').update(prevHash).digest('hex');
}
