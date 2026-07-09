// Factory persistence store primitive (Design §1) — append-only, hash-chained JSONL. Every record links to the
// prior via prevHash so any tamper/delete/reorder breaks the chain (verify.ts). The writer NEVER rewrites or
// deletes a prior line: it only reads the tip and appends. This is a NEW, distinct durability writer (it writes
// factory-state/*.jsonl, NOT the executor's /tmp/ece-dryrun- jail) — append-only by construction.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export const GENESIS = '0'.repeat(64);

/** The git-tracked durability tree + the four M3 stores. */
export const STORE_DIR = 'factory-state';
export const STORE_FILES = {
  approvals: 'approvals.jsonl',
  audit: 'audit.jsonl',
  executions: 'executions.jsonl',
  evidence: 'evidence-index.jsonl',
} as const;
export type StoreName = keyof typeof STORE_FILES;

/** Absolute path of a store file under a factory root (default: cwd). */
export function storeFilePath(name: StoreName, root: string = process.cwd()): string {
  return join(root, STORE_DIR, STORE_FILES[name]);
}

export interface ChainedRecord<P = unknown> {
  readonly seq: number;       // 0-based, contiguous
  readonly ts: string;        // ISO — when persisted
  readonly prevHash: string;  // the prior record's `hash` ('0'×64 for genesis)
  readonly payload: P;
  readonly hash: string;      // sha256(seq \n prevHash \n canonicalJson(payload))
}

/** Deterministic JSON with sorted object keys — so a payload always hashes identically. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return v;
}

export function recordHash(seq: number, prevHash: string, payload: unknown): string {
  return createHash('sha256').update(`${seq}\n${prevHash}\n${canonicalJson(payload)}`).digest('hex');
}

/** Read all records (empty array if the file is absent — a fresh store is valid, not an error). */
export function readRecords<P = unknown>(path: string): ChainedRecord<P>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as ChainedRecord<P>);
}

/** The chain tip: the last record's {seq, hash}, or the genesis pair for an empty/absent store. */
export function tipOf(path: string): { seq: number; hash: string } {
  const recs = readRecords(path);
  const last = recs[recs.length - 1];
  return last ? { seq: last.seq, hash: last.hash } : { seq: -1, hash: GENESIS };
}

/**
 * Append ONE record, chained to the current tip. Append-only: reads the tip, computes the next seq/prevHash/hash,
 * and appends a single line. Never rewrites or deletes prior lines. Creates the store dir if needed.
 */
export function appendRecord<P>(path: string, payload: P, now: () => string = () => new Date().toISOString()): ChainedRecord<P> {
  const tip = tipOf(path);
  const seq = tip.seq + 1;
  const prevHash = tip.hash;
  const rec: ChainedRecord<P> = { seq, ts: now(), prevHash, payload, hash: recordHash(seq, prevHash, payload) };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(rec) + '\n');
  return rec;
}
