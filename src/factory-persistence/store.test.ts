// Store primitive + verifier — unit tests. Writes to an isolated tmp dir (never the real factory-state/), cleaned
// up after. Proves: append chains correctly, verifyChain passes a good chain, detects tamper/delete/reorder, and
// treats an empty/absent store as valid.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRecord, readRecords, recordHash, canonicalJson, GENESIS, storeFilePath } from './store.js';
import { verifyChain } from './verify.js';

const tmps: string[] = [];
function tmpFile(): string { const d = mkdtempSync(join(tmpdir(), 'ece-store-')); tmps.push(d); return join(d, 'x.jsonl'); }
afterEach(() => { while (tmps.length) { try { rmSync(tmps.pop()!, { recursive: true, force: true }); } catch { /* best effort */ } } });

const at = () => '2026-07-09T00:00:00.000Z';

describe('store — append-only hash-chained JSONL', () => {
  it('appends a chained record: genesis prevHash, seq 0, hash = sha256(seq+prevHash+canonicalJson)', () => {
    const f = tmpFile();
    const r0 = appendRecord(f, { event: 'requested', actionId: 'act_1' }, at);
    expect(r0.seq).toBe(0);
    expect(r0.prevHash).toBe(GENESIS);
    expect(r0.hash).toBe(recordHash(0, GENESIS, { event: 'requested', actionId: 'act_1' }));
    const r1 = appendRecord(f, { event: 'consumed', actionId: 'act_1', approvalId: 'apr_1' }, at);
    expect(r1.seq).toBe(1);
    expect(r1.prevHash).toBe(r0.hash); // chained to the tip
    expect(readRecords(f).length).toBe(2);
  });

  it('canonicalJson is key-order stable (same hash regardless of key order)', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('verifyChain passes a good chain', () => {
    const f = tmpFile();
    for (let i = 0; i < 5; i++) appendRecord(f, { event: 'audit', n: i }, at);
    expect(verifyChain(f)).toEqual({ ok: true, length: 5 });
  });

  it('TAMPER: editing a persisted payload breaks the chain (hash mismatch)', () => {
    const f = tmpFile();
    appendRecord(f, { event: 'approved', approver: 'bitez' }, at);
    appendRecord(f, { event: 'consumed', approvalId: 'apr_1' }, at);
    const lines = readFileSync(f, 'utf8').trim().split('\n');
    const rec = JSON.parse(lines[0]!); rec.payload.approver = 'attacker'; lines[0] = JSON.stringify(rec); // tamper record 0
    writeFileSync(f, lines.join('\n') + '\n');
    const v = verifyChain(f);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(0);
    expect(v.reason).toMatch(/tampered payload/);
  });

  it('DELETE/REORDER: removing a record breaks seq/prevHash continuity', () => {
    const f = tmpFile();
    appendRecord(f, { n: 0 }, at); appendRecord(f, { n: 1 }, at); appendRecord(f, { n: 2 }, at);
    const lines = readFileSync(f, 'utf8').trim().split('\n');
    writeFileSync(f, [lines[0], lines[2]].join('\n') + '\n'); // drop the middle record
    const v = verifyChain(f);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it('EMPTY / ABSENT store is VALID (fresh factory has remembered nothing)', () => {
    const f = tmpFile();
    expect(existsSync(f)).toBe(false);
    expect(verifyChain(f)).toEqual({ ok: true, length: 0 }); // absent ⇒ valid
    writeFileSync(f, '');
    expect(verifyChain(f)).toEqual({ ok: true, length: 0 }); // empty ⇒ valid
  });

  it('storeFilePath resolves the four stores under factory-state/', () => {
    expect(storeFilePath('approvals', '/root')).toBe('/root/factory-state/approvals.jsonl');
    expect(storeFilePath('evidence', '/root')).toBe('/root/factory-state/evidence-index.jsonl');
  });

  it('APPEND-ONLY discipline: store.ts uses only appendFile/mkdir — never writeFile/rm/unlink/truncate', () => {
    const src = readFileSync(new URL('./store.ts', import.meta.url), 'utf8');
    for (const re of [/\bwriteFileSync?\s*\(/, /\brmSync?\s*\(/, /\bunlinkSync?\s*\(/, /\btruncateSync?\s*\(/, /\brename\s*\(/]) {
      expect({ pattern: String(re), hit: re.test(src) }).toEqual({ pattern: String(re), hit: false });
    }
    expect(/\bappendFileSync\s*\(/.test(src)).toBe(true);
  });
});
