import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { WriteAheadSequencer, type SequencerRequest } from '../../factory-shared/audit-engine/sequencer.js';
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import { createDefaultToolRegistry } from '../../layer-5-action/tool-registry/tool-registry.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { InMemoryKillSwitch } from './kill-switch.js';

// Kill Switch integration. NO mocks: real PostgreSQL. Proves the switch takes effect immediately
// through the full sequencer path, and that a kill-switched call is REFUSED + writes exactly one
// refusal record with no orphan (Phase 3.5 holds with the kill switch wired in).

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
const registry = createDefaultToolRegistry(); // search_clients ALLOW for role user
const ks = new InMemoryKillSwitch();
const seq = new WriteAheadSequencer(sink, new PermissionEngine(registry, { killSwitch: ks }));

function reqFor(org: string): SequencerRequest {
  return {
    principal: { user_id: `human_${org}`, email: `${org}@ece.ae`, role: 'user' },
    organization_id: org, session: { session_id: `s_${org}` },
    tool: { name: 'search_clients' }, environment: 'local', via: 'claude',
  };
}
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

afterAll(async () => { await pool.end(); });

describe('Kill Switch — integration through the sequencer', () => {
  it('flips an in-flight tool from ALLOW to REFUSED immediately, writing one refusal record and no orphan', async () => {
    const ORG = 'orgK';

    // 1) Kill switch inactive → the call proceeds and logs an intent + result.
    let ran1 = false;
    const ok = await seq.run(reqFor(ORG), async () => { ran1 = true; return { value: 'ok', outcome: { status: 'success' as const } }; });
    expect(ok.status).toBe('completed');
    expect(ran1).toBe(true);

    // 2) Activate the kill switch at runtime — no restart.
    ks.activate({ type: 'tool', name: 'search_clients' }, 'human_admin', 'incident');

    // 3) The very next run is REFUSED; execute never runs.
    let ran2 = false;
    const refused = await seq.run(reqFor(ORG), async () => { ran2 = true; return { value: 'x', outcome: { status: 'success' as const } }; });
    expect(refused.status).toBe('refused');
    expect(ran2).toBe(false);

    const rows = await sink.readEntries(ORG);
    expect(kinds(rows, 'intent')).toBe(1); // only run 1
    expect(kinds(rows, 'result')).toBe(1); // only run 1
    expect(kinds(rows, 'refusal')).toBe(1); // run 2's kill-switch refusal
    expect((await seq.reconcileOrphans(ORG, { olderThanSeconds: 0 })).length).toBe(0); // run 1 paired; run 2 made no intent
  });
});
